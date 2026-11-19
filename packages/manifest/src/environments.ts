import type { Manifest, ServiceSpec } from './schema.ts';

export type EnvName = 'production' | 'staging';

/** Environments the platform enables. */
export function enabledEnvironments(m: Manifest): EnvName[] {
  const out: EnvName[] = [];
  if (m.spec.environments.production.enabled) out.push('production');
  if (m.spec.environments.staging.enabled) out.push('staging');
  return out;
}

/**
 * Which environments a service exists in (D23). An explicit list always wins; otherwise a maintained
 * service runs wherever the platform does, and an external upstream image is production-only, because
 * a staging copy of something nobody is developing costs money and attention for no signal.
 */
export function serviceEnvironments(svc: ServiceSpec, enabled: EnvName[]): EnvName[] {
  const requested = svc.environments ?? (svc.ownership === 'external' ? ['production'] : enabled);
  const allowed = new Set(enabled);
  return requested.filter((e) => allowed.has(e));
}

export function presentIn(m: Manifest, name: string, env: EnvName): boolean {
  const svc = m.spec.services[name];
  if (!svc) return false;
  return serviceEnvironments(svc, enabledEnvironments(m)).includes(env);
}

/**
 * The staging prefix used when a composition's `dns` block does not state one.
 *
 * Three sites previously spelled this default themselves and two of them disagreed: `schema.ts` declares
 * `stagingPrefix: z.string().min(1).default('staging-')` (which applies whenever `dns:` exists), while
 * `build-plan.ts` and `validate.ts` fell back to `'staging'` when the whole `dns` block was absent. Because
 * `stagingHost` concatenates without inserting a separator, `'staging'` produces `stagingapi.example.com` and
 * `'staging-'` produces `staging-api.example.com` -- **two different hostnames for one tenant composition,
 * depending on which code path resolved it.** A tenant with no `dns:` block would get a plan from one rule and
 * rendered IaC from the other, which is the failure this file's own doc comment on `stagingHost` claims to
 * prevent ("one fact, one home") while the default itself violated it.
 *
 * The dashed form wins because it is what `schema.ts` -- the declared contract -- already defaults to, and
 * what the live `compose.yaml` hostnames (`staging-api.platfolio.dev`) were built with.
 */
export const DEFAULT_STAGING_PREFIX = 'staging-';

/**
 * Staging host derived from a declared production host, rendered explicitly rather than left to
 * provider behaviour: one host cannot be claimed by two environments.
 *
 * It moved here from `render.ts` (D68) because it is the primitive underneath hostname derivation, not a
 * rendering choice, and both the plan builder and the validator must resolve a host through the SAME rule --
 * one fact, one home. `render.ts` re-exports it so the public surface of the package does not move.
 */
export function stagingHost(host: string, prefix: string): string {
  if (host.startsWith('*.')) return `*.${prefix}${host.slice(2)}`;
  const parts = host.split('.');
  if (parts.length < 2) return `${prefix}${host}`;
  return [`${prefix}${parts[0]}`, ...parts.slice(1)].join('.');
}

/**
 * The full host list ONE service serves in ONE environment (D68) -- the single place precedence is decided,
 * so `buildPlan` and `validateManifest` cannot disagree about what a service's staging host is.
 *
 * A declared `environmentDomains[environment]` wins; otherwise the base `domains` list is used as-is for
 * production and passed through `stagingHost()` for every other environment. Absent `environmentDomains` this
 * is byte-for-byte the old derivation, which is what keeps every existing platform and template unchanged.
 * The caller applies `public` (a private service hosts nothing); this function is about hosts, not exposure.
 */
export function effectiveDomains(
  svc: { domains: string[]; environmentDomains?: Record<string, string[]> | undefined },
  environment: string,
  stagingPrefix: string,
): string[] {
  const declared = svc.environmentDomains?.[environment];
  if (declared !== undefined) return declared;
  if (environment === 'production') return svc.domains;
  return svc.domains.map((host) => stagingHost(host, stagingPrefix));
}
