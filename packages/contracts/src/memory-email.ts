import { EMAIL_CONTRACT, type EmailMessage, type EmailResult, type EmailTransport, type MailboxMessage, type MailboxReader } from './email.ts';

/**
 * The in-memory email double, and the reason the conformance suite has anything to run against in a unit test.
 *
 * It is deliberately as unhelpful as a real transport where that matters: it refuses malformed addresses only
 * because the schema does, it reports `rejected` for a deny-listed recipient rather than throwing, and after
 * `close()` it refuses everything. A double that always accepts would let a bug through by being nicer than
 * production.
 */
export interface MemoryEmailOptions {
  /** Addresses that always come back `rejected`, the way a relay answers an unknown mailbox. */
  denylist?: string[];
  /** Refuse anything with more bytes than this, as a real relay's SIZE capability would. */
  maxBytes?: number;
  /** Make ping answer false, to prove readiness reflects reachability. */
  unreachable?: boolean;
}

export class MemoryEmailTransport implements EmailTransport, MailboxReader {
  readonly driver = 'memory' as const;
  readonly sent: Array<{ message: EmailMessage; stored: MailboxMessage }> = [];
  private closed = false;
  private sequence = 0;

  private readonly options: MemoryEmailOptions;

  // Not a parameter property: `erasableSyntaxOnly` forbids the shorthand, because the image runs the source
  // through Node's type stripping and parameter properties are not erasable.
  constructor(options: MemoryEmailOptions = {}) { this.options = options; }

  async ping() { return !this.closed && this.options.unreachable !== true; }

  async send(message: EmailMessage): Promise<EmailResult> {
    if (this.closed) return { accepted: false, code: 'transport-unavailable', reason: 'the transport is closed' };
    const denied = message.to.filter((address) => this.options.denylist?.includes(address));
    if (denied.length > 0) return { accepted: false, code: 'rejected', reason: `relay refused: ${denied.join(', ')}` };
    const bytes = message.text.length + message.subject.length + (message.html?.length ?? 0);
    if (this.options.maxBytes !== undefined && bytes > this.options.maxBytes) {
      return { accepted: false, code: 'payload-too-large', reason: `${String(bytes)} bytes exceeds the advertised limit of ${String(this.options.maxBytes)}` };
    }
    this.sequence += 1;
    const id = `memory-${String(this.sequence).padStart(4, '0')}`;
    const stored: MailboxMessage = { ...message, providerId: id, receivedAt: new Date(this.sequence * 1000).toISOString() };
    this.sent.push({ message, stored });
    return { accepted: true, providerId: id, messageId: `<${id}@memory.local>`, sentAt: stored.receivedAt };
  }

  async listMessages(to?: string): Promise<MailboxMessage[]> {
    return this.sent.map((entry) => entry.stored).filter((m) => to === undefined || m.to.includes(to));
  }

  async close() { this.closed = true; }

  static contract = EMAIL_CONTRACT;
}
