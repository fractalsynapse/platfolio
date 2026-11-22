import { EmailMessageSchema, type EmailMessage, type EmailResult, type EmailTransport, type MailboxMessage, type MailboxReader } from './email.ts';

/**
 * Mailpit as a transport -- the local and CI answer to "did the platform actually send that?" (D46).
 *
 * It talks to Mailpit's HTTP API rather than its SMTP port on purpose: the assertion path (`GET /api/v1/messages`)
 * and the send path share a base URL, so a developer with `docker compose up` has a mailbox they can query in
 * one command. Production never uses this driver: a real relay cannot be read back, which is why `MailboxReader`
 * is a separate interface rather than a method here.
 */
export interface MailpitOptions {
  /** e.g. http://localhost:8025 -- the API/UI port, not 1025. */
  url: string;
  from: string;
  /** Injected for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class MailpitEmailTransport implements EmailTransport, MailboxReader {
  readonly driver = 'mailpit' as const;
  private closed = false;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  private readonly options: MailpitOptions;

  // Field, not parameter property -- see the note in memory-email.ts on `erasableSyntaxOnly`.
  constructor(options: MailpitOptions) { this.options = options;
    this.base = options.url.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async ping(): Promise<boolean> {
    if (this.closed) return false;
    try {
      const response = await this.withTimeout(`${this.base}/api/v1/info`);
      return response.ok;
    } catch { return false; }
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (this.closed) return { accepted: false, code: 'transport-unavailable', reason: 'the transport is closed' };
    const parsed = EmailMessageSchema.safeParse(message);
    if (!parsed.success) return { accepted: false, code: 'rejected', reason: parsed.error.issues.map((i) => `${String(i.path.join('.'))}: ${i.message}`).join('; ') };
    const headers: Record<string, string> = {};
    if (parsed.data.correlationId !== undefined) headers['X-Platfolio-Correlation'] = parsed.data.correlationId;
    // Every shape here was measured against the running container, not read off a README: `Email` (not
    // `Address`) on the send request, `Text` (not `PlainText`), headers as a map, and `ReplyTo` as its own
    // field -- Mailpit answers 400 `cannot overwrite header: "Reply-To"` if it is smuggled into Headers.
    const body = {
      From: { Name: 'platfolio', Email: this.options.from },
      To: parsed.data.to.map((address) => ({ Name: '', Email: address })),
      Subject: parsed.data.subject,
      Text: parsed.data.text,
      ...(parsed.data.html === undefined ? {} : { HTML: parsed.data.html }),
      ...(parsed.data.replyTo === undefined ? {} : { ReplyTo: [{ Name: '', Email: parsed.data.replyTo }] }),
      ...(Object.keys(headers).length === 0 ? {} : { Headers: headers }),
    };
    try {
      const response = await this.withTimeout(`${this.base}/api/v1/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        return { accepted: false, code: response.status >= 500 ? 'transport-unavailable' : 'rejected', reason: `mailpit answered ${String(response.status)} ${detail}`.slice(0, 500) };
      }
      const ack = await response.json() as { ID?: string; Error?: string };
      if (typeof ack.ID !== 'string' || ack.ID.length === 0) {
        return { accepted: false, code: 'rejected', reason: `mailpit accepted the request but returned no id: ${JSON.stringify(ack).slice(0, 120)}` };
      }
      // Mailpit's own Message-ID is only visible after the fact (in the stored message); the id it hands back
      // here is the handle for every later lookup, so it is what a support thread cites.
      return { accepted: true, providerId: ack.ID, messageId: ack.ID, sentAt: new Date().toISOString() };
    } catch (error) {
      return { accepted: false, code: 'transport-unavailable', reason: `cannot reach mailpit at ${this.base}: ${String(error instanceof Error ? error.message : error).slice(0, 160)}` };
    }
  }

  /**
   * Reading back costs two calls per message and is worth it: the list endpoint carries no body, and the
   * detail endpoint carries no headers -- so the correlation id is observable only in `/raw`. A test that
   * asserted on the list alone would silently pass while the header went nowhere.
   */
  async listMessages(to?: string): Promise<MailboxMessage[]> {
    if (this.closed) return [];
    // The `query=to:` parameter is passed for efficiency but cannot be trusted for correctness: against a
    // running Mailpit it returned unrelated messages, so the real filter is applied below on the parsed
    // recipients. An assertion that silently looked at somebody else's mail is the kind of green that hides
    // a broken feature.
    const query = to === undefined ? '' : `?query=${encodeURIComponent(`to:${to}`)}`;
    const listed = await this.withTimeout(`${this.base}/api/v1/messages${query}`);
    if (!listed.ok) throw new Error(`mailpit list failed: ${String(listed.status)}`);
    const payload = await listed.json() as { messages?: Array<{ ID: string; Subject?: string; To?: Array<{ Address: string }>; Created?: string }> };
    const matched = (payload.messages ?? []).filter((summary) => to === undefined || (summary.To ?? []).some((entry) => entry.Address === to));
    const out: MailboxMessage[] = [];
    for (const summary of matched.slice(0, 25)) {
      const detailResponse = await this.withTimeout(`${this.base}/api/v1/message/${encodeURIComponent(summary.ID)}`);
      const detail = detailResponse.ok ? await detailResponse.json() as { Text?: string; HTML?: string } : {};
      const rawResponse = await this.withTimeout(`${this.base}/api/v1/message/${encodeURIComponent(summary.ID)}/raw`);
      const raw = rawResponse.ok ? await rawResponse.text() : '';
      const correlation = /^X-Platfolio-Correlation:\s*(.+)$/im.exec(raw)?.[1]?.trim();
      out.push({
        to: (summary.To ?? []).map((entry) => entry.Address),
        subject: summary.Subject ?? '',
        text: detail.Text ?? '',
        ...(detail.HTML === undefined || detail.HTML === '' ? {} : { html: detail.HTML }),
        ...(correlation === undefined || correlation === '' ? {} : { correlationId: correlation }),
        providerId: summary.ID,
        receivedAt: summary.Created ?? new Date(0).toISOString(),
      });
    }
    return out;
  }

  async close() { this.closed = true; }

  private withTimeout(url: string, init?: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    return this.fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  }
}
