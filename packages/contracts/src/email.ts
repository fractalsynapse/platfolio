import { z } from 'zod';

/**
 * Sending email is a capability seam (D46), like storage and like the provider: one interface, several
 * implementations, one conformance suite, and the driver chosen by configuration rather than by code path.
 *
 * The reason it is a seam and not a feature: platform email has to work in three materially different places --
 * Mailpit in the local Compose stack (where "sent" must be *assertable*, not just logged), a customer's SMTP
 * relay in a self-hosted deployment, and our own provider in the managed one. A `sendEmail()` function that
 * grew an `if (local)` would put the environment into the business logic, which is the shape this project keeps
 * paying to avoid.
 *
 * Note what is NOT here: no template bodies, no campaign state, no recipient lists. This seam moves one message
 * to one or more addresses and reports honestly whether the transport took it.
 */
export const EmailAddressSchema = z.string().min(3).max(320).refine(
  (value) => /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value),
  { message: 'a plain addr-spec is required; display names and group syntax are the transport\'s concern, not this contract\'s' },
);
export type EmailAddress = z.infer<typeof EmailAddressSchema>;

export const EmailMessageSchema = z.object({
  to: z.array(EmailAddressSchema).min(1).max(50),
  subject: z.string().min(1).max(998),
  text: z.string().min(1).max(200_000),
  html: z.string().max(400_000).optional(),
  /** The address mail should be *replied to*; defaults to the configured from-address. Never a tenant secret. */
  replyTo: EmailAddressSchema.optional(),
  /** A stable id for correlation (e.g. an invitation id) -- carried as a header so a reply can be traced. */
  correlationId: z.string().min(1).max(120).optional(),
}).strict();
export type EmailMessage = z.infer<typeof EmailMessageSchema>;

/**
 * What a transport answers. `accepted` means the transport handed the message to something that will attempt
 * delivery -- it does NOT mean the recipient got it, and nothing here pretends otherwise: bounces, suppression
 * and inbox placement belong to the provider, and platfolio will not claim knowledge it does not have.
 */
export const EmailReceiptSchema = z.object({
  accepted: z.literal(true),
  /** Provider-side id when it gives one; Mailpit's message id is what makes local assertion possible. */
  providerId: z.string().max(200).optional(),
  messageId: z.string().min(1).max(200),
  sentAt: z.string().min(1),
}).strict();
export type EmailReceipt = z.infer<typeof EmailReceiptSchema>;

/**
 * The failure vocabulary. `transport-unavailable` is distinct from `rejected` because the operator actions
 * differ: one is "the relay is down, retry", the other is "the address is bad, do not retry". Collapsing them
 * produces a retry loop against a permanent refusal.
 */
export const EmailFailureSchema = z.object({
  accepted: z.literal(false),
  code: z.enum(['rejected', 'transport-unavailable', 'not-configured', 'payload-too-large', 'auth-failed']),
  reason: z.string().min(1).max(500),
}).strict();
export type EmailFailure = z.infer<typeof EmailFailureSchema>;

export type EmailResult = EmailReceipt | EmailFailure;
export type EmailTransportName = 'smtp' | 'mailpit' | 'memory' | 'none';

/** The seam every implementation satisfies. */
export interface EmailTransport {
  readonly driver: EmailTransportName;
  send(message: EmailMessage): Promise<EmailResult>;
  /** Cheap liveness for readiness endpoints: can the transport be reached at all. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Reading a mailbox is a SEPARATE capability, not a method on the sender.
 *
 * Production transports do not offer it -- an SMTP relay that let platfolio read the tenant's mail would be a
 * custody violation of the kind D4 exists to prevent. Mailpit and the in-memory double do, which is exactly why
 * the assertion power lives behind its own interface: a test can depend on it, and a deployment cannot
 * accidentally acquire it by choosing a driver.
 */
export const MailboxMessageSchema = EmailMessageSchema.extend({
  providerId: z.string().max(200),
  receivedAt: z.string().min(1),
}).strict();
export type MailboxMessage = z.infer<typeof MailboxMessageSchema>;

export interface MailboxReader {
  listMessages(to?: string): Promise<MailboxMessage[]>;
}

export const EMAIL_CONTRACT = { name: 'email.transport', version: '1.0.0' } as const;

export function failureOf(result: EmailResult): EmailFailure | null {
  return result.accepted ? null : result;
}

/**
 * The null transport (D46). Installed when no sender is configured, so the capability is always present and
 * always answers honestly.
 *
 * This exists because of a bug I wrote first: the invitations capability declared `email` as a requirement,
 * and with no email service installed the extension lost its ROUTES -- an operator who forgot to configure a
 * relay got 404 on a real endpoint with nothing in the log to explain it. A missing collaborator must not be
 * able to erase a route table. Presence with an explicit refusal is the shape that survives that.
 */
export class NullEmailTransport implements EmailTransport {
  readonly driver = 'none' as const;
  async send(): Promise<EmailResult> {
    return { accepted: false, code: 'not-configured', reason: 'no email transport is configured on this control plane' };
  }
  async ping() { return false; }
  async close() { /* nothing to release */ }
}
