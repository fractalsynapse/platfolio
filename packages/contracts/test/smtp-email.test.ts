import assert from 'node:assert/strict';
import net from 'node:net';
import { after, test } from 'node:test';
import { SmtpEmailTransport, type EmailMessage } from '../src/index.ts';

interface Scripted {
  greeting?: string;
  /** Reply to EHLO. No STARTTLS in the capability line means the client must refuse to send in clear. */
  ehlo?: string;
  auth?: string;
  rcpt?: (address: string) => string;
  data?: string;
  /** Silence: never answer, to exercise the timeout path. */
  silent?: boolean;
}

/**
 * A real SMTP server on a loopback socket, driven by a script. Real sockets rather than a mock, because the
 * things most likely to be wrong here are wire-level: reply framing across multiple lines, CRLF discipline,
 * dot-stuffing, and the order commands are sent in. A fake object would let all four pass while a relay
 * rejected the traffic.
 */
const opened: Array<{ close: () => Promise<void> }> = [];

function server(script: Scripted) {
  const received: string[] = [];
  let body = '';
  const sockets: net.Socket[] = [];
  // Replies are joined with CRLF because that is the protocol. The first version split on \r\n while the
  // scripts were written with \n, so multi-line EHLOs went out as one unterminated line and the client
  // correctly waited forever -- a hanging test is often the harness being wrong.
  const lines = (reply: string) => reply.split('\n').map((l, i, arr) => (i === arr.length - 1 ? l : l.replace(/^(\d{3}) /, '$1-'))).join('\r\n');
  const send = (socket: net.Socket, reply: string) => { socket.write(`${reply}\r\n`); };
  const instance = net.createServer((socket) => {
    sockets.push(socket);
    let collecting = false;
    let pending = '';
    send(socket, script.greeting ?? '220 scripted.test ESMTP ready');
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      for (;;) {
        if (collecting) {
          const end = pending.indexOf('\r\n.\r\n');
          if (end === -1) return;
          // The DATA terminator is exactly '\r\n.\r\n' -- five bytes. Slicing at +4 left a stray '\n' that
          // showed up as the first character of the next command, and the assertion about command order failed
          // on the harness rather than the client.
          body += pending.slice(0, end + 2);
          pending = pending.slice(end + 5);
          collecting = false;
          send(socket, script.data ?? '250 Ok: queued as ABC123');
          continue;
        }
        const end = pending.indexOf('\r\n');
        if (end === -1) return;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        received.push(line);
        if (script.silent === true) return;
        if (line.startsWith('EHLO') || line.startsWith('HELO')) { send(socket, lines(script.ehlo ?? '250-scripted.test\n250 SIZE 1048576\n250 AUTH PLAIN')); continue; }
        if (line.startsWith('AUTH')) { send(socket, script.auth ?? '235 2.7.0 Authentication successful'); continue; }
        if (line.startsWith('MAIL FROM')) { send(socket, '250 2.1.0 Sender ok'); continue; }
        if (line.startsWith('RCPT TO')) {
          const address = /<([^>]*)>/.exec(line)?.[1] ?? '';
          send(socket, (script.rcpt?.(address) ?? '250 2.1.5 Recipient ok'));
          continue;
        }
        if (line === 'DATA') { collecting = true; send(socket, '354 End data with <CR><LF>.<CR><LF>'); continue; }
        if (line.startsWith('QUIT')) { send(socket, '221 2.0.0 Bye'); socket.end(); continue; }
        if (line.startsWith('STARTTLS')) { send(socket, '502 5.5.2 Unrecognized command'); continue; }
        send(socket, '500 5.5.1 Unrecognized command');
      }
    });
  });
  const listen = new Promise<number>((resolve) => { instance.listen(0, '127.0.0.1', () => resolve((instance.address() as net.AddressInfo).port)); });
  const handle = {
    received: () => received,
    body: () => body,
    port: listen,
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); instance.close(() => resolve()); }),
  };
  opened.push(handle);
  return handle;
}

// Servers left listening keep the runner alive after the assertions finish, which reads as a passing suite
// that simply never ends. Closed once per file, and each test also closes its own.
after(async () => { for (const handle of opened) await handle.close().catch(() => undefined); });

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({ to: ['someone@example.test'], subject: 'Verify your address', text: 'Welcome aboard.', ...over });

test('the dialogue order, the wire format and the queue id are exactly what a relay sees', async () => {
  const srv = server({});
  const transport = new SmtpEmailTransport({ host: '127.0.0.1', port: await srv.port, from: 'platfolio@platfolio.test', startTls: 'off', clientName: 'platfolio.test' });
  const receipt = await transport.send(message({ correlationId: 'invite-9' }));
  assert.equal(receipt.accepted, true, JSON.stringify(receipt));
  const commands = srv.received().map((l) => l.split(' ')[0]);
  assert.deepEqual(commands, ['EHLO', 'MAIL', 'RCPT', 'DATA', 'QUIT'], `unexpected command order: ${JSON.stringify(srv.received())}`);
  assert.equal(receipt.accepted && receipt.providerId, 'ABC123', 'the relay queue id is the only handle a tenant support ticket has');
  const body = srv.body();
  assert.match(body, /To: someone@example.test/, 'recipients are in the header block');
  assert.match(body, /Subject: Verify your address/);
  assert.match(body, /X-Platfolio-Correlation: invite-9/, 'the correlation header must reach the wire, not just the receipt');
  assert.match(body, /Message-ID: <[^>]+@platfolio.test>/);
  assert.ok(body.includes('\r\n\r\n'), 'headers and body separated by a blank line');
  await transport.close();
  await srv.close();
});

test('a line beginning with a dot is stuffed, or the message is silently truncated', async () => {
  const srv = server({});
  const transport = new SmtpEmailTransport({ host: '127.0.0.1', port: await srv.port, from: 'p@t.test', startTls: 'off' });
  const receipt = await transport.send(message({ text: 'first line\r\n.evidence of truncation\r\nlast line' }));
  assert.equal(receipt.accepted, true);
  assert.match(srv.body(), /\r\n\.\.evidence of truncation\r\n/, 'RFC 5321 4.5.2 dot-stuffing');
  await transport.close(); await srv.close();
});

test('every recipient refused is a typed rejection naming them, not a success', async () => {
  const srv = server({ rcpt: () => '550 5.1.1 User unknown' });
  const transport = new SmtpEmailTransport({ host: '127.0.0.1', port: await srv.port, from: 'p@t.test', startTls: 'off' });
  const result = await transport.send(message({ to: ['gone@example.test', 'also@example.test'] }));
  assert.equal(result.accepted, false);
  if (result.accepted === false) {
    assert.equal(result.code, 'rejected');
    assert.match(result.reason, /gone@example.test/, 'the refusal must name the addresses');
  }
  assert.ok(!srv.received().includes('DATA'), 'nothing is transmitted once every recipient is refused');
  await transport.close(); await srv.close();
});

test('STARTTLS is required by default: a relay that does not offer it gets no traffic', async () => {
  const srv = server({ ehlo: '250-scripted.test\n250 SIZE 1024' });
  const transport = new SmtpEmailTransport({ host: '127.0.0.1', port: await srv.port, from: 'p@t.test' });
  const result = await transport.send(message());
  assert.equal(result.accepted, false, 'a plaintext relay must not be used');
  if (result.accepted === false) {
    assert.equal(result.code, 'transport-unavailable');
    assert.match(result.reason, /STARTTLS/);
  }
  const seen = srv.received();
  assert.deepEqual(seen.filter((l) => l.startsWith('MAIL')), [], 'no envelope was sent: ' + JSON.stringify(seen));
  await transport.close(); await srv.close();
});

test('credentials are never sent over a connection that is not encrypted', async () => {
  const srv = server({ ehlo: '250-scripted.test\n250 STARTTLS' });
  const transport = new SmtpEmailTransport({
    host: '127.0.0.1', port: await srv.port, from: 'p@t.test', startTls: 'allow',
    auth: { user: 'relay-user', password: 'hunter2-not-a-real-secret' },
  });
  const result = await transport.send(message());
  assert.equal(result.accepted, false, 'STARTTLS was offered but the upgrade path is not exercised here; refusing is correct');
  const seen = srv.received();
  assert.ok(!seen.some((l) => l.includes('hunter2')), `the password reached the wire: ${JSON.stringify(seen)}`);
  await transport.close(); await srv.close();
});

test('an authentication refusal is typed auth-failed and does not echo the secret', async () => {
  const srv = server({ auth: '535 5.7.8 Username and Password not accepted' });
  const transport = new SmtpEmailTransport({
    host: '127.0.0.1', port: await srv.port, from: 'p@t.test', startTls: 'off',
    auth: { user: 'u', password: 'super-secret-value' },
  });
  const result = await transport.send(message());
  assert.equal(result.accepted, false);
  if (result.accepted === false) {
    assert.equal(result.code, 'auth-failed', `expected auth-failed, got ${result.code}: ${result.reason}`);
    assert.doesNotMatch(result.reason, /super-secret-value/, 'the credential must not be echoed into a failure reason');
  }
  assert.ok(srv.received().some((l) => l.startsWith('AUTH PLAIN ')), 'the AUTH command itself was sent');
  assert.ok(!srv.received().some((l) => l.includes('super-secret-value')), 'and the secret was base64 of the SASL blob, never plaintext');
  await transport.close(); await srv.close();
});

test('a silent relay is a timeout, reported as unavailable', async () => {
  const srv = server({ silent: true });
  const transport = new SmtpEmailTransport({ host: '127.0.0.1', port: await srv.port, from: 'p@t.test', startTls: 'off', timeoutMs: 700 });
  const started = Date.now();
  const result = await transport.send(message());
  assert.equal(result.accepted, false);
  if (result.accepted === false) assert.equal(result.code, 'transport-unavailable');
  assert.ok(Date.now() - started < 5000, 'the timeout must bound the wait rather than hang a request');
  await transport.close(); await srv.close();
});

test('a relay that cannot be reached is unavailable, not an exception at the caller', async () => {
  const transport = new SmtpEmailTransport({ host: '127.0.0.1', port: 1, from: 'p@t.test', startTls: 'off', timeoutMs: 1500 });
  const result = await transport.send(message());
  assert.equal(result.accepted, false, 'a dead relay must not look like a send');
  if (result.accepted === false) assert.equal(result.code, 'transport-unavailable');
  assert.equal(await transport.ping(), false, 'ping agrees with the same outage');
  await transport.close();
});
