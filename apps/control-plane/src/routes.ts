import { buildCapabilities } from './capabilities.ts';
import { operationsOf, type RouteManifestEntry } from '@platfolio/api-contract';
import { spec } from './respond.ts';

/**
 * The route manifest `api:check` compares against the OpenAPI document (D41).
 *
 * It is *derived* from the capability descriptors rather than maintained beside them, which is the difference
 * between a manifest that can drift and one that cannot: adding a route to a capability makes it appear here
 * automatically, so the only way the two disagree is a missing spec entry -- and that is the failure the gate
 * is for. The placeholder build info is deliberate: the manifest is metadata, and reading it must not require
 * a live store or identity (a deps object that had to be real would make this file need a database).
 */
export const ROUTE_MANIFEST: RouteManifestEntry[] = buildCapabilities({
  build: { version: 'manifest-only', commit: '0'.repeat(40), buildTime: '1970-01-01T00:00:00.000Z' },
}).flatMap((capability) => (capability.routes ?? []).map((route) => ({ method: route.method, path: route.path, operationId: route.operationId })));

export type InstallationRole = 'hub' | 'private';

export function capabilitiesForRole(deps: Parameters<typeof buildCapabilities>[0], role?: InstallationRole) {
  const capabilities = buildCapabilities(deps);
  const document = spec();
  const allowed = new Set<string>();
  for (const { method, path, operationId } of operationsOf(document)) {
    const configured: unknown = document.paths[path][method.toLowerCase()]['x-platfolio-role'];
    if (configured !== 'hub' && configured !== 'private' && configured !== 'shared') {
      throw new Error(`OpenAPI operation ${operationId} requires an installation role`);
    }
    if (!role || configured === role || configured === 'shared') allowed.add(operationId);
  }
  return capabilities.flatMap((capability) => {
    if (!capability.routes) return [capability];
    const routes = capability.routes.filter(({ operationId }) => allowed.has(operationId));
    return routes.length ? [{ ...capability, routes }] : [];
  });
}
