import type { Attestation } from './attestation.ts';
import type { DispatchRecord, StoreError } from './persistence.ts';

/**
 * Attestation acceptance, as one pure function shared by every Store implementation.
 *
 * This lives outside the stores on purpose. If each driver re-implemented "is this attestation admissible",
 * then swapping persistence would change a security decision -- and the two implementations would drift in
 * exactly the way nobody notices until an attestation is accepted that should not be.
 */
// The failure is a StoreError, not a lookalike: one union for "why this was refused", so a driver cannot
// invent a third shape the HTTP layer has to special-case.
export type PolicyVerdict = { ok: true } | { ok: false; error: StoreError };

export function checkAttestationPolicy(attestation: Attestation, dispatch: DispatchRecord | null, now = new Date()): PolicyVerdict {
  if (!dispatch) return { ok: false, error: { code: 'not-found', what: 'dispatch', id: attestation.dispatchId } };
  if (dispatch.instanceId !== attestation.instanceId) {
    return { ok: false, error: { code: 'conflict', reason: `attestation names instance ${attestation.instanceId}, dispatch belongs to ${dispatch.instanceId}` } };
  }
  if (dispatch.nonce !== attestation.nonce) return { ok: false, error: { code: 'conflict', reason: 'nonce does not match the dispatch' } };
  const expected = dispatch.planHash.replace(/^sha256:/, '').toLowerCase();
  const attested = attestation.planHash.replace(/^sha256:/, '').toLowerCase();
  if (expected !== attested) return { ok: false, error: { code: 'conflict', reason: `plan hash moved: dispatch ${expected.slice(0, 12)}, attested ${attested.slice(0, 12)}` } };
  if (attestation.action !== dispatch.action || attestation.environment !== dispatch.environment) {
    return { ok: false, error: { code: 'conflict', reason: `attestation is for ${attestation.action}/${attestation.environment}, dispatch was ${dispatch.action}/${dispatch.environment}` } };
  }
  if (Date.parse(dispatch.expiresAt) < now.getTime() && dispatch.consumedAt === null) {
    return { ok: false, error: { code: 'expired', reason: `dispatch expired at ${dispatch.expiresAt} before it was ever fetched` } };
  }
  return { ok: true };
}
