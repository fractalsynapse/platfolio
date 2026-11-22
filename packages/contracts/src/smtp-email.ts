import net from 'node:net';
import tls from 'node:tls';
import { EmailMessageSchema, type EmailMessage, type EmailResult, type EmailTransport } from './email.ts';
import { redactCredentialShaped } from './managed-action.ts';

/**
 * A minimal SMTP client (D46), written against sockets rather than a dependency.
 *
 * Why not a package: the project adds dependencies for demonstrated requirements, and this needs the 220/250/354
 * dialogue, STARTTLS and one SASL mechanism -- about this much code, reviewable in one screen, with the failure
 * vocabulary this seam defines. A library would have supplied its own error taxonomy and I would have written an
 * adapter for it, which is the same lines of code wearing a version number.
 *
 * The credential handling is the point of the whole file: the password appears in exactly one base64 blob that
 * goes to the socket and is never placed in a reason string. Server replies are passed through the same
 * redaction used for attestations before they reach a caller, because a hostile or misconfigured relay can put
 * anything in a 5xx line.
 */
export interface SmtpOptions {
  host: string;
  port?: number;
  /** Implicit TLS (465). When false, plain or STARTTLS on 587/25. */
  secure?: boolean;
  auth?: { user: string; password: string };
  from: string;
  /** `require` refuses to send without TLS; `allow` upgrades when offered; `off` never (loopback test use). */
  startTls?: 'require' | 'allow' | 'off';
  timeoutMs?: number;
  /** Name advertised in HELO/EHLO and used to synthesise a Message-ID. */
  clientName?: string;
}

interface Reply { code: number; text: string }

export class SmtpEmailTransport implements EmailTransport {
  readonly driver = 'smtp' as const;
  private readonly options: SmtpOptions;
  private closed = false;

  constructor(options: SmtpOptions) { this.options = options; }

  async ping(): Promise<boolean> {
    if (this.closed) return false;
    try {
      const session = await this.open();
      await session.command('QUIT', 221).catch(() => undefined);
      session.destroy();
      return true;
    } catch { return false; }
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (this.closed) return { accepted: false, code: 'transport-unavailable', reason: 'the transport is closed' };
    const parsed = EmailMessageSchema.safeParse(message);
    if (!parsed.success) return { accepted: false, code: 'rejected', reason: parsed.error.issues.map((i) => `${String(i.path.join('.'))}: ${i.message}`).join('; ') };
    const startTls = this.options.startTls ?? 'require';
    let session: Session | undefined;
    try {
      session = await this.open();
      const hello = await session.command(`EHLO ${this.options.clientName ?? 'platfolio'}`, 250);
      const features = parseFeatures(hello.text);
      if (startTls === 'require' && !session.secure && !features.startTls) {
        return { accepted: false, code: 'transport-unavailable', reason: 'relay does not offer STARTTLS and startTls=require' };
      }
      if (!session.secure && features.startTls && startTls !== 'off') {
        await session.command('STARTTLS', 220);
        await session.upgrade(this.options.host);
        await session.command(`EHLO ${this.options.clientName ?? 'platfolio'}`, 250);
      }
      if (this.options.auth !== undefined) {
        if (session.secure === false && startTls !== 'off') {
          return { accepted: false, code: 'transport-unavailable', reason: 'refusing to send credentials over an unencrypted connection' };
        }
        const { user, password } = this.options.auth;
        const secret = Buffer.from(`\u0000${user}\u0000${password}`, 'utf8').toString('base64');
        const auth = await session.command(`AUTH PLAIN ${secret}`, 235).catch((error: SmtpReplyError) => {
          throw new SmtpReplyError({ code: error.reply?.code ?? 535, text: error.reply?.text ?? 'AUTH PLAIN rejected' });
        });
        void auth;
      }
      const max = features.size;
      const body = this.renderBody(parsed.data);
      // RFC 1870: `SIZE 0` means the relay states no limit. Treating it as a limit of zero rejected every
      // message against Mailpit -- the first real server this client ever talked to, which is exactly why it
      // was worth pointing at one.
      if (max !== undefined && max > 0 && body.length > max) {
        return { accepted: false, code: 'payload-too-large', reason: `message is ${String(body.length)} bytes; relay advertises SIZE ${String(max)}` };
      }
      await session.command(`MAIL FROM:<${this.options.from}>`, 250);
      const refused: string[] = [];
      for (const address of parsed.data.to) {
        try { await session.command(`RCPT TO:<${address}>`, 250); }
        catch (error) { if (error instanceof SmtpReplyError && error.reply.code >= 550) { refused.push(address); continue; } throw error; }
      }
      if (refused.length === parsed.data.to.length) {
        return { accepted: false, code: 'rejected', reason: `relay refused every recipient: ${refused.join(', ')}` };
      }
      await session.command('DATA', 354);
      const ack = await session.data(body);
      await session.command('QUIT', 221).catch(() => undefined);
      const queued = /queued as\s+(\S+)/i.exec(ack.text);
      // One providerId, assembled once. An earlier draft spread it twice, and the second spread silently
      // replaced the first -- a duplicate key in an object literal is exactly the kind of thing a type
      // checker waves through and a reader has to catch.
      const providerId = [queued?.[1], refused.length > 0 ? `refused=${refused.join(',')}` : undefined]
        .filter((part) => part !== undefined).join('; ');
      return {
        accepted: true,
        ...(providerId === '' ? {} : { providerId }),
        messageId: `<${Date.now().toString(36)}@${this.options.clientName ?? 'local'}>`,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof SmtpReplyError) {
        const code = error.reply.code;
        const text = redactCredentialShaped(error.reply.text).slice(0, 300);
        if (code === 535 || code === 504) return { accepted: false, code: 'auth-failed', reason: `relay rejected authentication: ${text}` };
        if (code === 552 || code === 452) return { accepted: false, code: 'payload-too-large', reason: `relay refused the message size: ${text}` };
        if (code >= 500) return { accepted: false, code: 'rejected', reason: `relay refused: ${text}` };
        return { accepted: false, code: 'transport-unavailable', reason: `relay answered ${String(code)}: ${text}` };
      }
      // Never assume the thrown value is an Error: this file's first bug was a `null` rejection reaching here
      // and throwing a TypeError inside the catch, which turned a typed refusal into an unhandled crash.
      const described = error instanceof Error ? error.message : String(error);
      return { accepted: false, code: 'transport-unavailable', reason: redactCredentialShaped(described).slice(0, 300) };
    } finally {
      session?.destroy();
    }
  }

  async close() { this.closed = true; }

  /** The wire format kept in one place so the tests can assert exactly what a relay sees. */
  private renderBody(message: EmailMessage): string {
    const id = `<${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@${this.options.clientName ?? 'local'}>`;
    const lines = [
      `From: platfolio <${this.options.from}>`,
      `To: ${message.to.join(', ')}`,
      `Subject: ${message.subject}`,
      `Message-ID: ${id}`,
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      ...(message.replyTo === undefined ? [] : [`Reply-To: ${message.replyTo}`]),
      ...(message.correlationId === undefined ? [] : [`X-Platfolio-Correlation: ${message.correlationId}`]),
      ...(message.html === undefined
        ? ['Content-Type: text/plain; charset=utf-8', '', message.text]
        : ['Content-Type: multipart/alternative; boundary=platfolio', '--platfolio',
           'Content-Type: text/plain; charset=utf-8', '', message.text, '--platfolio',
           'Content-Type: text/html; charset=utf-8', '', message.html, '--platfolio--']),
    ];
    // Dot-stuffing (RFC 5321 4.5.2): a line beginning with '.' ends the DATA block early, so a body holding
    // one would be silently truncated -- sent successfully, delivered cut off. Stuffing therefore applies to
    // EVERY line, including lines the caller embedded inside `text`, which is the case a previous version
    // missed by checking only the array elements it built itself.
    return lines.join('\r\n').split('\r\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n') + '\r\n';
  }

  private open(): Promise<Session> {
    const timeoutMs = this.options.timeoutMs ?? 20_000;
    const port = this.options.port ?? (this.options.secure ? 465 : 25);
    return new Promise<Session>((resolve, reject) => {
      const socket = this.options.secure === true
        ? tls.connect({ host: this.options.host, port, servername: this.options.host })
        : net.connect({ host: this.options.host, port });
      const session = new Session(socket, this.options.secure === true, timeoutMs);
      const timer = setTimeout(() => { socket.destroy(); reject(new Error(`SMTP connect to ${this.options.host}:${String(port)} timed out`)); }, timeoutMs);
      socket.once('error', (error) => { clearTimeout(timer); reject(error); });
      session.read(220).then(() => { clearTimeout(timer); resolve(session); }).catch((error) => { clearTimeout(timer); reject(error); });
    });
  }
}

class SmtpReplyError extends Error {
  readonly reply: Reply;
  constructor(reply: Reply) { super(`SMTP ${String(reply.code)}: ${reply.text}`); this.reply = reply; this.name = 'SmtpReplyError'; }
}

/**
 * A session owns one socket and the reply framing: a reply is one or more `NNN-` continuation lines closed by a
 * `NNN ` line. Getting this wrong (reading one line at a time) makes multi-line EHLO responses look like
 * protocol errors, which is the failure this class exists to avoid.
 */
class Session {
  socket: net.Socket | tls.TLSSocket;  // reassigned by upgrade()
  secure: boolean;
  private buffer = '';
  private readonly waiters: Array<{ resolve: (reply: Reply) => void; reject: (error: unknown) => void; expect: number; deadline: number }> = [];
  private failure: unknown;

  readonly timeoutMs: number;

  constructor(socket: net.Socket | tls.TLSSocket, secure: boolean, timeoutMs: number) {
    this.socket = socket;
    this.secure = secure;
    this.timeoutMs = timeoutMs;
    // One persistent reader, established at construction. Registering a 'data' listener inside read() is a
    // race: the greeting arrives the moment the socket connects, and anything that lands before the listener
    // is attached is gone -- which is exactly how this version came to time out on a server that was answering.
    this.socket.on('data', (chunk: Buffer) => { this.buffer += chunk.toString('utf8'); this.drain(); });
    this.socket.once('error', (error) => { this.failure = error; this.drain(); });
    this.socket.once('close', () => { this.failure ??= new Error('connection closed before a reply arrived'); this.drain(); });
  }

  command(line: string, expect: number): Promise<Reply> {
    this.socket.write(`${line}\r\n`, (error) => { if (error !== null && error !== undefined) this.fail(error as Error); });
    return this.read(expect);
  }

  data(body: string): Promise<Reply> {
    this.socket.write(`${body}.\r\n`, (error) => { if (error !== null && error !== undefined) this.fail(error as Error); });
    return this.read(250);
  }

  /**
   * A reply is one or more `NNN-` continuation lines closed by `NNN `. Framing walks whole lines: a regex over
   * the buffer matched the first `250-`, stopped, and re-matched the same line forever -- a multi-line EHLO
   * therefore hung with no error at all, the worst shape a bug in a request path can have.
   */
  read(expect: number): Promise<Reply> {
    return new Promise<Reply>((resolve, reject) => {
      // Every awaited reply is bounded. Only the connect had a deadline before, so a relay that greeted and
      // then went silent hung the request handler indefinitely -- which is worse than a timeout, because it
      // looks alive. The dispatcher is platfolio's own; a stuck sender must not become a stuck deployment.
      this.waiters.push({ resolve, reject, expect, deadline: Date.now() + this.timeoutMs });
      this.arm();
      this.drain();
    });
  }

  private timer: NodeJS.Timeout | undefined;
  private arm() {
    if (this.timer !== undefined) return;
    const next = this.waiters[0];
    if (next === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.failure ??= new Error(`no reply within ${String(this.timeoutMs)}ms`);
      this.drain();
    }, Math.max(1, next.deadline - Date.now()));
    this.timer.unref?.();
  }

  private fail(error: Error) { this.failure = error; this.drain(); }

  private drain() {
    for (;;) {
      const waiter = this.waiters[0];
      if (waiter === undefined) return;
      const reply = this.takeReply();
      if (reply === undefined) {
        if (this.failure !== undefined) { this.waiters.shift()?.reject(this.failure); continue; }
        break;
      }
      this.waiters.shift();
      this.arm();
      if (reply.code === waiter.expect || (waiter.expect === 250 && reply.code >= 200 && reply.code < 300)) waiter.resolve(reply);
      else waiter.reject(new SmtpReplyError(reply));
    }
  }

  private takeReply(): Reply | undefined {
    const lines = this.buffer.split('\r\n');
    const texts: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line === '') return undefined;
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (match === null) return undefined;
      texts.push(match[3] ?? '');
      if (match[2] === ' ') {
        this.buffer = lines.slice(index + 1).join('\r\n');
        return { code: Number(match[1]), text: texts.join(' ') };
      }
    }
    return undefined;
  }

  upgrade(host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const plain = this.socket as net.Socket;
      plain.removeAllListeners('data');
      const secure = tls.connect({ socket: plain, servername: host }, () => {
        this.socket = secure;
        this.secure = true;
        secure.on('data', (chunk: Buffer) => { this.buffer += chunk.toString('utf8'); this.drain(); });
        secure.once('error', (error) => { this.fail(error); });
        resolve();
      });
      secure.once('error', reject);
    });
  }

  destroy() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    try { this.socket.destroy(); } catch { /* already gone */ }
  }
}

function parseFeatures(hello: string): { size?: number; startTls: boolean } {
  return {
    startTls: /\bSTARTTLS\b/i.test(hello),
    ...(/\bSIZE\s+(\d+)/i.exec(hello)?.[1] === undefined ? {} : { size: Number(/SIZE\s+(\d+)/i.exec(hello)?.[1]) }),
  };
}
