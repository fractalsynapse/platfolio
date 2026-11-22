import type { CapabilityOffer, CapabilityShare, Instance, StoreError } from './persistence.ts';

/**
 * Whether a binding may exist, as one pure function (#176, D42).
 *
 * Same reasoning as `checkAttestationPolicy`: a decision this consequential cannot be re-implemented per store
 * driver, because the two implementations would drift in exactly the way nobody notices until a tenant binds
 * to something they should not have been able to reach.
 *
 * The rules, in the order they are checked:
 * 1. the offer must exist and be published by a real instance;
 * 2. every destination the consumer declares must be satisfied by an output the provider actually offers --
 *    binding to a capability that cannot fill the variables is a broken promise, not a partial success;
 * 3. same team binds freely; cross-team needs a live share (D42), and a revoked share does not retroactively
 *    invalidate an existing binding -- it marks it stale, which is a decision made by the store, not here.
 */
export interface BindingRequest {
  consumer: Instance;
  offer: CapabilityOffer | null;
  provider: Instance | null;
  /** The destinations the consumer's manifest declares for this capability (name -> variable names). */
  required: Array<{ output: string; into: string[] }>;
  shares: CapabilityShare[];
}

export type BindingVerdict = { ok: true } | { ok: false; error: StoreError };

export function checkBindingPolicy(request: BindingRequest): BindingVerdict {
  const { consumer, offer, provider, required, shares } = request;
  if (!offer) return { ok: false, error: { code: 'not-found', what: 'capability offer', id: `${consumer.id}/${'capability'}` } };
  if (!provider) return { ok: false, error: { code: 'not-found', what: 'provider instance', id: offer.instanceId } };
  if (provider.id === consumer.id) return { ok: false, error: { code: 'conflict', reason: 'an instance cannot bind to a capability it provides itself' } };
  if (offer.outputs.length === 0 && required.length > 0) {
    return { ok: false, error: { code: 'conflict', reason: `offer "${offer.capability}" publishes no outputs yet, so nothing can be bound` } };
  }
  const offered = new Set(offer.outputs.map((o) => o.output));
  const missing = required.filter((r) => !offered.has(r.output)).map((r) => r.output);
  if (missing.length > 0) {
    return { ok: false, error: { code: 'conflict', reason: `provider does not offer: ${missing.join(', ')}` } };
  }
  if (consumer.teamId !== provider.teamId) {
    const open = shares.some((s) => s.toTeamId === consumer.teamId || s.toTeamId === '*');
    if (!open) {
      // D42: sharing is explicit. A capability being *reachable* is not the same as being *offered*, and the
      // error says which team owns it, because that is information the consumer is entitled to have.
      return { ok: false, error: { code: 'conflict', reason: `"${provider.teamId}" has not shared ${offer.capability} with "${consumer.teamId}"` } };
    }
  }
  return { ok: true };
}

/**
 * What a destroy would strand (D43). Kept separate from the delete path so the *policy* -- "refuse while
 * consumers exist" -- is testable without provisioning a provider, and so the message can name them.
 */
export function bindingImpact(consumers: Array<{ consumerInstanceId: string; capability: string; state: string }>): string[] {
  return consumers.map((c) => `${c.consumerInstanceId} consumes ${c.capability}${c.state === 'stale' ? ' (share already revoked)' : ''}`);
}
