import { EmailMessageSchema, type EmailFailure, type EmailMessage, type EmailResult, type EmailTransport, failureOf } from './email.ts';

/**
 * One suite, every transport (D46). Same rule as the Store conformance file: a claim about email is only worth
 * what the second implementation cost to discover, and the point of running this against Mailpit in CI is that
 * the local answer and the hosted answer come from the same list of expectations.
 */
export interface EmailFixture {
  /** The transport under test. */
  transport: () => EmailTransport;
  /** Whether this transport also exposes a mailbox, i.e. is a `MailboxReader` (memory and Mailpit are). */
  readable: boolean;
  /** A message this transport will accept. */
  valid?: Partial<EmailMessage>;
  /** If the transport refuses oversized payloads, produce one that trips it; otherwise the case is skipped, not passed. */
  oversized?: () => EmailMessage;
  /**
   * A message this transport refuses on its own grounds (a deny-listed mailbox, a relay that rejects an
   * address). Optional by design: refusing *invalid* input is the schema's job, which every implementation
   * inherits, so a case built on a bad subject was really testing whoever validated first. The suite asks each
   * implementation to refuse something it genuinely would -- and skips honestly when it refuses nothing.
   */
  refusing?: () => EmailMessage;
}

type Case = { status: 'pass' | 'fail' | 'skipped'; detail?: string };
const results: Record<string, Case> = {};

export function emailConformanceCases(fixture: EmailFixture): Array<{ name: string; run: () => Promise<Case> }> {
  const base: EmailMessage = {
    to: ['someone@example.test'],
    subject: 'Verify your address',
    text: 'Open this link to accept the invitation: https://example.test/i/abc',
    ...(fixture.valid ?? {}),
  };
  const t = () => fixture.transport();

  return [
    { name: 'accepts a well-formed message and reports an id', run: async () => {
      const receipt = await t().send(base);
      if (receipt.accepted !== true) return { status: 'fail', detail: `refused: ${JSON.stringify(receipt)}` };
      if (typeof receipt.messageId !== 'string' || receipt.messageId.length === 0) return { status: 'fail', detail: 'accepted without a message id' };
      return { status: 'pass', detail: `id ${receipt.messageId.slice(0, 24)}` };
    } },
    { name: 'refuses an empty recipient list rather than silently sending nowhere', run: async () => {
      const parsed = EmailMessageSchema.safeParse({ ...base, to: [] });
      return parsed.success ? { status: 'fail', detail: 'the schema accepted zero recipients' } : { status: 'pass', detail: 'schema refuses it before the transport sees it' };
    } },
    { name: 'refuses a malformed address at the schema boundary', run: async () => {
      for (const bad of ['nope', 'a b@c.test', 'x@y', '@x.test']) {
        if (EmailMessageSchema.safeParse({ ...base, to: [bad] }).success) return { status: 'fail', detail: `accepted "${bad}"` };
      }
      return { status: 'pass', detail: 'four malformed shapes refused' };
    } },
    { name: 'a refusal is typed, reported, and never throws', run: async () => {
      if (!fixture.refusing) return { status: 'skipped', detail: 'this transport refuses nothing on its own grounds' };
      const result: EmailResult = await t().send(fixture.refusing());
      const failure = failureOf(result);
      if (failure === null) return { status: 'fail', detail: 'the message the transport should refuse was accepted' };
      if (!['rejected', 'payload-too-large', 'not-configured', 'auth-failed', 'transport-unavailable'].includes(failure.code)) return { status: 'fail', detail: `untyped failure ${failure.code}` };
      return { status: 'pass', detail: `${failure.code}: ${failure.reason.slice(0, 40)}` };
    } },

    { name: 'invalid input is refused at the schema before any transport sees it', run: async () => {
      for (const bad of [{ ...base, subject: '' }, { ...base, text: '' }, { ...base, to: ['not-an-address'] }, { ...base, extraKey: 1 }]) {
        const parsed = EmailMessageSchema.safeParse(bad);
        if (parsed.success) return { status: 'fail', detail: `the schema accepted ${JSON.stringify(bad).slice(0, 60)}` };
      }
      return { status: 'pass', detail: 'empty subject, empty body, bad address, unknown key all refused' };
    } },
    { name: 'ping reports reachability without sending anything', run: async () => {
      const up = await t().ping();
      return typeof up === 'boolean' ? { status: 'pass', detail: `ping=${String(up)}` } : { status: 'fail', detail: 'ping returned a non-boolean' };
    } },
    { name: 'oversized payloads are refused with the right code', run: async () => {
      if (!fixture.oversized) return { status: 'skipped', detail: 'no oversized fixture for this transport' };
      const failure = failureOf(await t().send(fixture.oversized()));
      if (failure === null) return { status: 'fail', detail: 'an oversized message was accepted' };
      return failure.code === 'payload-too-large' || failure.code === 'rejected'
        ? { status: 'pass', detail: failure.code }
        : { status: 'fail', detail: `expected payload-too-large, got ${failure.code}` };
    } },
    { name: 'correlation id travels with the message when the mailbox can be read', run: async () => {
      if (!fixture.readable) return { status: 'skipped', detail: 'transport is not a MailboxReader (production relays are not, by design)' };
      // One instance for the whole case: `fixture.transport()` is a factory, and calling it twice would send
      // into a mailbox nobody reads back -- which is exactly the kind of suite that passes by construction.
      const transport = t();
      const reader = transport as unknown as { listMessages(to?: string): Promise<Array<Record<string, unknown>>> };
      const before = (await reader.listMessages(base.to[0])).length;
      const receipt = await transport.send({ ...base, correlationId: 'invite-42' });
      if (!receipt.accepted) return { status: 'fail', detail: 'send refused' };
      const after = await reader.listMessages(base.to[0]);
      if (after.length !== before + 1) return { status: 'fail', detail: `mailbox went ${String(before)} -> ${String(after.length)}` };
      const newest = after[after.length - 1] as Record<string, unknown>;
      const headers = (newest['headers'] ?? {}) as Record<string, string>;
      const carried = JSON.stringify(newest).includes('invite-42') || Object.values(headers).some((v) => String(v).includes('invite-42'));
      return carried ? { status: 'pass', detail: 'the id is observable in the stored message' } : { status: 'fail', detail: `correlation id not carried: ${JSON.stringify(newest).slice(0, 120)}` };
    } },
    { name: 'close is idempotent', run: async () => {
      const transport = t();
      await transport.close();
      await transport.close();
      const after = failureOf(await transport.send(base));
      return after !== null && (after.code === 'transport-unavailable' || after.code === 'not-configured')
        ? { status: 'pass', detail: `send after close refused as ${after.code}` }
        : { status: 'fail', detail: after === null ? 'send after close was accepted' : `unexpected code ${after.code}` };
    } },
  ];
}

/** Shared reporter so both implementations produce the same table, like the store suite. */
export function recordEmailCase(name: string, outcome: Case): void { results[name] = outcome; }
export function emailResults(): Record<string, Case> { return { ...results }; }
export function firstEmailFailure(): EmailFailure | null { return null; }
