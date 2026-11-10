import { z } from 'zod';

/**
 * Cross-instance outputs and binding (D34, issue #94).
 *
 * A team runs services that other platforms consume: an identity provider whose issuer a hosted app must
 * point at, a shared backend API, a log sink. The dependent instance needs those values as *inputs*, and
 * platfolio is the only component that can see both sides.
 *
 * Two rules shape everything below, and both come from decisions already taken rather than from taste here.
 *
 * 1. **Requires name a capability, not an instance** (D34). A platform says "I need an OIDC provider", not
 *    "I need `identity/inst-a1`", so a team can swap the supplier without editing every consumer. The
 *    resolution to a concrete instance is platfolio's, and it is recorded so it can be shown.
 * 2. **A credential is relayed once and cannot be replayed** (D32). If the supplier mints a client secret
 *    and we place it into the dependent's execution plane, we hold nothing to send again. So a secret output
 *    has an explicit state machine whose only recovery is re-issue, and a binding that "retries" a secret is
 *    a bug by construction.
 */

const Name = z.string().regex(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i, 'letters, digits, dot, underscore, hyphen');

/** What a team service publishes. `secret` outputs are never carried by a binding record. */
export const OutputKindSchema = z.enum(['url', 'value', 'secret']);
export type OutputKind = z.infer<typeof OutputKindSchema>;

export const ProvidedOutputSchema = z.object({
  /** Key used by dependents, e.g. `issuer`, `client_id`, `client_secret`. */
  output: Name,
  kind: OutputKindSchema,
  description: z.string().min(1).optional(),
}).strict();

export const CapabilitySchema = z.object({
  /** Stable name dependents refer to: `identity`, `search`, `billing-api`. */
  name: Name,
  /** A platform instance may provide more than one capability; each needs its own outputs. */
  outputs: z.array(ProvidedOutputSchema).min(1),
}).strict();

export const RequiredCapabilitySchema = z.object({
  capability: Name,
  /** Where the resolved values go: the inventory entry names they satisfy (D33). */
  as: z.array(Name).default([]),
  /** Without this the dependent is incomplete rather than broken; the UI says so rather than failing. */
  required: z.boolean().default(true),
}).strict();

/**
 * The value half of a binding. Secret outputs are represented by state only — there is deliberately no
 * field that could hold one, because a binding record is stored, logged and rendered.
 */
export const BoundValueSchema = z.object({
  output: Name,
  kind: z.enum(['url', 'value']),
  /** Public by definition: an issuer URL, a client id, a log endpoint. */
  value: z.string().min(1),
}).strict();

export const SecretOutputStateSchema = z.enum(['not-issued', 'issued-and-placed', 'placement-unknown', 're-issue-required']);
export type SecretOutputState = z.infer<typeof SecretOutputStateSchema>;

export const BindingSchema = z.object({
  dependentInstanceId: Name,
  capability: Name,
  /** Resolved supplier, kept so a UI can say which instance a consumer is pointed at. */
  providerInstanceId: Name.optional(),
  /**
   * Hash of the provider's published outputs at bind time. A change here is how "two of three consumers
   * still point at the old issuer" becomes a state we can show instead of an incident we discover.
   */
  providerGeneration: z.string().min(8).optional(),
  values: z.array(BoundValueSchema).default([]),
  secretStates: z.array(z.object({ output: Name, state: SecretOutputStateSchema }).strict()).default([]),
}).strict();
export type Binding = z.infer<typeof BindingSchema>;

export interface ProviderInstance {
  instanceId: string;
  capability: string;
  outputs: Record<string, { kind: OutputKind; value?: string }>;
}

export type BindingIssue = { path: string; code: string; message: string };

/** Deterministic stand-in for the release job's digest of published outputs; stable across processes. */
export function generationOf(outputs: Record<string, { kind: OutputKind; value?: string }>): string {
  const material = Object.keys(outputs).sort().map((k) => `${k}=${outputs[k]?.kind ?? ''}:${outputs[k]?.value ?? ''}`).join('&');
  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export interface ResolveResult { binding?: Binding; issues: BindingIssue[] }

/**
 * Bind one dependent to whichever supplier instance offers its capability.
 *
 * Deliberate choices visible in the output: an unresolved capability is a **state** (`awaiting-provider`)
 * rather than an exception, because a team may legitimately bind consumers before the supplier exists; a
 * secret output never appears in `values`, only in `secretStates`; and a generation mismatch is reported
 * as `rebind-required` instead of being silently refreshed, because refreshing without the tenant seeing it
 * would rewrite a running platform's configuration under their feet.
 */
export function resolveBinding(dependent: { instanceId: string; required: { capability: string; as?: string[]; required?: boolean } }, providers: ProviderInstance[]): ResolveResult {
  const issues: BindingIssue[] = [];
  const matches = providers.filter((p) => p.capability === dependent.required.capability);
  if (matches.length === 0) {
    if (dependent.required.required !== false) {
      issues.push({ path: dependent.instanceId, code: 'awaiting-provider', message: `no instance in this team provides capability "${dependent.required.capability}"; the dependent stays incomplete until one does` });
    }
    return { issues };
  }
  if (matches.length > 1) {
    issues.push({ path: dependent.instanceId, code: 'ambiguous-provider', message: `${String(matches.length)} instances provide "${dependent.required.capability}" (${matches.map((m) => m.instanceId).join(', ')}); the team must choose one rather than have it guessed` });
    return { issues };
  }

  const provider = matches[0]!;
  const values: Binding['values'] = [];
  const secretStates: Binding['secretStates'] = [];
  for (const [output, spec] of Object.entries(provider.outputs)) {
    if (spec.kind === 'secret') {
      // No value is carried and none is remembered: a retry must re-issue, because replay would require
      // us to have kept the thing D32 says we cannot keep.
      secretStates.push({ output, state: 'issued-and-placed' });
      continue;
    }
    if (spec.value === undefined) {
      issues.push({ path: `${dependent.instanceId}.${output}`, code: 'provider-output-missing', message: `${provider.instanceId} declares "${output}" but publishes no value yet` });
      continue;
    }
    values.push({ output, kind: spec.kind, value: spec.value });
  }

  return {
    binding: {
      dependentInstanceId: dependent.instanceId,
      capability: dependent.required.capability,
      providerInstanceId: provider.instanceId,
      providerGeneration: generationOf(provider.outputs),
      values,
      secretStates,
    },
    issues,
  };
}

/** How a previously-stored binding looks against the provider's current state. */
export type BindingStatus = 'ok' | 'rebind-required' | 'provider-gone' | 're-issue-required';

export function bindingStatus(binding: Binding, providers: ProviderInstance[]): { status: BindingStatus; detail: string } {
  const provider = providers.find((p) => p.instanceId === binding.providerInstanceId && p.capability === binding.capability);
  if (!provider) return { status: 'provider-gone', detail: `${binding.providerInstanceId} no longer provides ${binding.capability}` };
  if (binding.secretStates.some((s) => s.state === 're-issue-required')) {
    return { status: 're-issue-required', detail: 'a credential was lost upstream; the supplier must issue a fresh one -- replay is not possible because nothing was kept' };
  }
  if (binding.providerGeneration && binding.providerGeneration !== generationOf(provider.outputs)) {
    return { status: 'rebind-required', detail: `the supplier published new values since this binding was made; ${binding.dependentInstanceId} is still pointed at the previous set` };
  }
  return { status: 'ok', detail: 'resolved' };
}

/**
 * Roll up the team's bindings into counts per capability, which is what lets the UI say "two of three
 * consumers still point at the old issuer" instead of leaving an operator to click through instances.
 */
export function summarise(bindings: Binding[], providers: ProviderInstance[]): { capability: string; total: number; ok: number; attention: { dependentInstanceId: string; status: BindingStatus; detail: string }[] }[] {
  const byCapability = new Map<string, Binding[]>();
  for (const b of bindings) byCapability.set(b.capability, [...(byCapability.get(b.capability) ?? []), b]);
  return [...byCapability.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([capability, list]) => {
    const attention = list.map((b) => ({ b, s: bindingStatus(b, providers) }))
      .filter((x) => x.s.status !== 'ok')
      .map((x) => ({ dependentInstanceId: x.b.dependentInstanceId, status: x.s.status, detail: x.s.detail }));
    return { capability, total: list.length, ok: list.length - attention.length, attention };
  });
}
