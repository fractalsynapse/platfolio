import {
  AttestationSchema,
  DispatchIntentSchema,
  deriveNonce,
  type Attestation,
  type DispatchIntent,
} from './attestation.ts';
import type { ApplyResult } from './infra.ts';

/**
 * Action-side helpers over the attestation contract (D37, issue #123).
 *
 * There is deliberately **no new schema here.** The trust model already has one -- `DispatchIntent` out,
 * `Attestation` back, verified by read-back -- and a parallel shape on the action side is how two
 * implementations of "the same" contract drift apart and then argue. What lives here is only the translation
 * from provider reality into that vocabulary, plus the refusals that must happen before anything mutates.
 *
 * The executable runner is not in this repository yet, and that is a decision rather than an omission:
 * #135 records that `RailwayInfraProvider` is built around a workspace grant while the install document
 * promises the tenant a per-environment project token. Those cannot both stand. A `run.ts` written before the
 * answer exists would have to invent the credential handling, and invented credential handling is exactly the
 * failure mode this project keeps paying to avoid.
 */

/** The intent the runner receives, checked before it can be acted on. */
export function parseDispatchIntent(source: unknown): DispatchIntent {
  return DispatchIntentSchema.parse(source);
}

/** Refusal before mutation: the dispatch names one plan, and the plan available now is another. */
export function staleIntent(input: {
  intent: DispatchIntent;
  fetchedPlanHash: string;
  release: Attestation['release'];
  finishedAt: string;
}): Attestation | undefined {
  const fetched = normalizeHash(input.fetchedPlanHash);
  if (fetched === input.intent.planHash) return undefined;
  return AttestationSchema.parse({
    dispatchId: input.intent.dispatchId,
    nonce: input.intent.nonce,
    // The hash the caller asked for, because this attestation is about the dispatch that was refused.
    planHash: input.intent.planHash,
    instanceId: input.intent.instanceId,
    environment: input.intent.environment,
    action: input.intent.action,
    result: 'failed',
    // Both halves in the message: one hash alone lets a reader guess which side moved.
    errorCode: `stale-plan-hash:requested-${input.intent.planHash.slice(0, 12)}-found-${fetched.slice(0, 12)}`.slice(0, 120),
    resources: [],
    release: input.release,
    durationMs: 0,
    finishedAt: input.finishedAt,
  });
}

/**
 * Provider result to attestation, with the three-way distinction that is the reason this exists: a result
 * carrying failures *and* live resources is `partial` -- never `ok` (hides drift forever) and never `failed`
 * (discards what actually landed).
 */
export function attestationFromApply(input: {
  intent: DispatchIntent;
  /** The digest of the plan that was actually applied, not the one that was asked for. */
  appliedPlanHash: string;
  result: ApplyResult;
  release: Attestation['release'];
  durationMs: number;
  finishedAt: string;
}): Attestation {
  const { intent, result } = input;
  // Provider status words are not attestation status words, so the mapping is explicit: an invented value
  // fails at the schema instead of silently rewriting what the tenant's stack is doing.
  const toResourceStatus = (status: string): 'live' | 'failed' | 'deploying' =>
    status === 'live' ? 'live' : status === 'failed' || status === 'crashed' ? 'failed' : 'deploying';
  const resources = result.services.map((s) => ({
    kind: 'service' as const,
    name: s.name,
    externalId: s.externalId ?? s.name,
    status: toResourceStatus(s.status),
  }));
  const landed = resources.some((r) => r.status === 'live');
  const outcome = result.failures.length === 0
    ? (resources.length > 0 ? 'ok' : 'noop')
    : landed ? 'partial' : 'failed';
  const first = result.failures[0];
  const errorCode = (outcome === 'partial' || outcome === 'failed')
    ? `${first?.code ?? 'apply-failed'}@${first?.step ?? 'unknown'}`.slice(0, 120)
    : undefined;
  return AttestationSchema.parse({
    dispatchId: intent.dispatchId,
    nonce: intent.nonce,
    planHash: normalizeHash(input.appliedPlanHash),
    instanceId: intent.instanceId,
    environment: intent.environment,
    action: intent.action,
    result: outcome,
    ...(errorCode ? { errorCode } : {}),
    resources,
    release: input.release,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    finishedAt: input.finishedAt,
  });
}

/** GitHub and Railway both spell digests differently; the attestation contract is bare hex. */
export function normalizeHash(digest: string): string {
  return digest.replace(/^sha256:/, '').slice(0, 64).toLowerCase();
}

/**
 * A leak check on the action's own outgoing text. Not the boundary -- the boundary is that no secret is ever
 * present in a plan or an argument -- but a message assembled from a provider response is exactly how a token
 * reaches a run summary, and this fails at the place the mistake was made rather than in review.
 */
export function containsCredentialShapedText(text: string): boolean {
  return /(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{16,}/.test(text);
}

export function redactCredentialShaped(text: string): string {
  // Provider errors are assembled from responses that can echo back what was sent -- a token in a URL, a
  // key in a rejected payload. Truncating is not enough, since the secret is usually near the start.
  return text
    .replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9]{8,}/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, 'Bearer [redacted]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-key]')
    .replace(/([?&](?:access_token|token|password)=)[^&\\s]+/gi, '$1[redacted]');
}

export function assertAttestationClean(attestation: Attestation): Attestation {
  const parsed = AttestationSchema.parse({ ...attestation, errorCode: attestation.errorCode ? redactCredentialShaped(attestation.errorCode) : undefined });
  if (parsed.errorCode && containsCredentialShapedText(parsed.errorCode)) {
    throw new Error('attestation errorCode looks like a credential even after redaction; redact it at the source');
  }
  return parsed;
}

/** Re-exported so an action imports one module and cannot drift from the contract it is supposed to satisfy. */
export { AttestationSchema, DispatchIntentSchema, deriveNonce };
export type { Attestation, DispatchIntent };
