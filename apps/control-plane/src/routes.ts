import { buildCapabilities } from './capabilities.ts';
import type { RouteManifestEntry } from '@platfolio/api-contract';

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

export { buildCapabilities };
