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
