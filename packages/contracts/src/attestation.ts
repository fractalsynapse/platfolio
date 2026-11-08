import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Attestation contract between platfolio and the tenant's runner (docs/design/04).
 *
 * Trust model: the control plane never holds infrastructure credentials and never fetches job logs.
 * It sends intent plus a single-use nonce; the runner executes with the tenant's own token and posts
 * back a structured claim authenticated by the runner's OIDC identity. A claim is only a *claim* —
 * the controller re-verifies by read-back before any state advances, so a forged or stale attestation
 * can mislead nothing that survives contact with the provider.
 */

export const DispatchIntentSchema = z.object({
  instanceId: z.string().min(1),
  teamId: z.string().min(1),
  /** Echoed back by the runner; binds the attestation to exactly one dispatch. */
  dispatchId: z.string().min(1),
  nonce: z.string().min(16),
  planHash: z.string().regex(/^[a-f0-9]{16,64}$/),
  action: z.enum(['apply', 'check', 'drift', 'suspend', 'export']),
  environment: z.string().min(1),
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1),
}).strict();

export const AttestationResourceSchema = z.object({
  kind: z.enum(['service', 'database', 'bucket', 'volume', 'domain', 'environment']),
  name: z.string().min(1),
  externalId: z.string().min(1),
  status: z.enum(['pending', 'building', 'deploying', 'live', 'failed', 'crashed', 'sleeping', 'awaiting-approval', 'removed']),
}).strict();

export const AttestationSchema = z.object({
  dispatchId: z.string().min(1),
  nonce: z.string().min(16),
  planHash: z.string().regex(/^[a-f0-9]{16,64}$/),
  instanceId: z.string().min(1),
  environment: z.string().min(1),
  action: z.enum(['apply', 'check', 'drift', 'suspend', 'export']),
  result: z.enum(['ok', 'failed', 'noop']),
  errorCode: z.string().min(1).optional(),
  resources: z.array(AttestationResourceSchema).max(200),
  release: z.object({ version: z.string().min(1), commitSha: z.string().length(40), imageDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/) }).strict().optional(),
  durationMs: z.number().int().nonnegative(),
  finishedAt: z.string().min(1),
}).strict().superRefine((a, ctx) => {
  if (a.result === 'ok' && a.errorCode) ctx.addIssue({ code: 'custom', path: ['errorCode'], message: 'a successful attestation must not carry an error code' });
  if (a.result === 'failed' && !a.errorCode) ctx.addIssue({ code: 'custom', path: ['errorCode'], message: 'a failed attestation must name an error code' });
  if (a.result === 'ok' && a.action === 'apply' && a.resources.length === 0) ctx.addIssue({ code: 'custom', path: ['resources'], message: 'an ok apply must report at least one resource' });
});

/** Claims the control plane requires from the runner's OIDC token. */
export const RunnerClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.string().min(1),
  sub: z.string().min(1),
  repository: z.string().min(1),
  repository_owner: z.string().min(1),
  run_id: z.string().min(1),
  /** Environment protection is what makes a production dispatch a human-gated act. */
  environment: z.string().optional(),
  environment_id: z.string().optional(),
  ref: z.string().min(1),
}).passthrough();

export interface VerificationContext {
  expectedAudience: string;
  expectedIssuer: string;
  /** The repository the instance is connected to, `owner/name`. */
  expectedRepository: string;
  instance: { teamId: string; repoFullName: string; environments: string[] };
  dispatch: z.infer<typeof DispatchIntentSchema>;
  /** Server-owned state; a replayed nonce must be rejected exactly once. */
  usedNonces: { has(n: string): boolean; add(n: string): void };
  nowMs: number;
}

export interface VerificationIssue { code: string; message: string; }

/** Node built-in crypto only: no dependency, and identical in CI and locally. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** A dispatch nonce is derived, not stored per instance: cheap to check, impossible to guess. */
export function deriveNonce(dispatchId: string, serverSecret: string): string {
  return sha256Hex(`${dispatchId}\u0000${serverSecret}`).slice(0, 32);
}

/**
 * Policy checks over an already-authenticated token's claims. Signature verification is *not* done
 * here (it belongs to the transport, which must pin JWKS to the provider's issuer) — the types make
 * that boundary explicit: this function takes RunnerClaims, not a raw JWT.
 */
export function verifyAttestation(attestation: unknown, claims: unknown, ctx: VerificationContext): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const a = AttestationSchema.safeParse(attestation);
  if (!a.success) {
    for (const i of a.error.issues) issues.push({ code: 'attestation-schema', message: `${i.path.join('.') || '(root)'}: ${i.message}` });
    return issues;
  }
  const c = RunnerClaimsSchema.safeParse(claims);
  if (!c.success) {
    for (const i of c.error.issues) issues.push({ code: 'claims-schema', message: `${i.path.join('.')}: ${i.message}` });
    return issues;
  }
  const payload = a.data;
  const claim = c.data;

  if (claim.aud !== ctx.expectedAudience) issues.push({ code: 'audience', message: `token audience "${claim.aud}" is not "${ctx.expectedAudience}"` });
  if (claim.iss !== ctx.expectedIssuer) issues.push({ code: 'issuer', message: `token issuer "${claim.iss}" is not "${ctx.expectedIssuer}"` });
  if (claim.repository !== ctx.expectedRepository) issues.push({ code: 'repository', message: `token is for "${claim.repository}", the instance is connected to "${ctx.expectedRepository}"` });

  if (payload.dispatchId !== ctx.dispatch.dispatchId) issues.push({ code: 'dispatch-unknown', message: 'attestation names a dispatch this intent did not issue' });
  if (payload.instanceId !== ctx.dispatch.instanceId) issues.push({ code: 'instance-mismatch', message: 'attestation is for a different instance' });
  if (payload.action !== ctx.dispatch.action) issues.push({ code: 'action-mismatch', message: `ran "${payload.action}" for a "${ctx.dispatch.action}" dispatch` });
  if (payload.planHash !== ctx.dispatch.planHash) issues.push({ code: 'plan-hash-mismatch', message: 'attested plan hash does not match the dispatched plan' });
  if (payload.nonce !== ctx.dispatch.nonce) issues.push({ code: 'nonce-mismatch', message: 'attestation does not carry the dispatched nonce' });

  const dispatchExpiry = Date.parse(ctx.dispatch.expiresAt);
  if (!Number.isNaN(dispatchExpiry) && ctx.nowMs > dispatchExpiry) issues.push({ code: 'dispatch-expired', message: 'dispatch window closed before the runner reported' });
  if (ctx.usedNonces.has(payload.nonce)) issues.push({ code: 'nonce-replayed', message: 'this nonce has already been accepted' });

  if (!ctx.instance.environments.includes(payload.environment)) issues.push({ code: 'unknown-environment', message: `"${payload.environment}" is not an environment of this instance` });
  if (payload.environment !== ctx.dispatch.environment && ctx.dispatch.environment !== '*') issues.push({ code: 'environment-mismatch', message: `attestation is for "${payload.environment}", dispatch targeted "${ctx.dispatch.environment}"` });
  if (payload.environment === 'production' && claim.environment !== 'production') issues.push({ code: 'production-ungated', message: 'a production attestation must come from the protected production environment' });

  const finished = Date.parse(payload.finishedAt);
  const issued = Date.parse(ctx.dispatch.issuedAt);
  if (!Number.isNaN(finished) && !Number.isNaN(issued) && finished < issued) issues.push({ code: 'time-travel', message: 'attestation finished before the dispatch was issued' });

  if (issues.some((i) => i.code === 'attestation-schema' || i.code === 'claims-schema')) return issues;
  // Only after the payload is structurally sound do we consume the nonce, so a malformed retry is
  // not charged against a legitimate one.
  if (issues.length === 0) ctx.usedNonces.add(payload.nonce);
  return issues;
}

export type DispatchIntent = z.infer<typeof DispatchIntentSchema>;
export type Attestation = z.infer<typeof AttestationSchema>;
export type RunnerClaims = z.infer<typeof RunnerClaimsSchema>;
