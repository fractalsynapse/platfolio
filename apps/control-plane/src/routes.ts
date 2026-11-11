import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadSpec, validateResponse, type RouteManifestEntry, type SpecDocument } from '@platfolio/api-contract';
import { CONTRACT_NAME, CONTRACT_VERSION, type IdentityProvider, type VerificationFailureCode } from '@platfolio/contracts';

/**
 * The Slice 1 handlers.
 *
 * Two properties are structural here rather than polite:
 *
 * 1. **Every response body is validated against the OpenAPI document before it goes on the wire** (`send`).
 *    A handler that would emit a shape the spec does not describe becomes a 500 with a message naming the
 *    mismatch. This is what D41 means by "the specification is the validation mechanism": the check runs in
 *    the request path, not only in CI against fixtures.
 * 2. **The route manifest is exported data**, matched against the spec by `api:check` in both directions. A
 *    handler added here without a spec entry is a build failure, so the API cannot grow by accident.
 *
 * Auth: `whoami` requires the `platfolio.user` scope. Refusing when the scope is absent is what makes the
 * spec's 403 reachable instead of decorative.
 */

export const SPEC_PATH = path.resolve(import.meta.dirname, '../../../api/control-plane.openapi.yaml');
const spec: SpecDocument = loadSpec(fs.readFileSync(SPEC_PATH, 'utf8'));

export interface AppDeps {
  identity: Pick<IdentityProvider, 'verifyAccessToken' | 'describe'>;
  build: { version: string; commit: string; buildTime: string };
  /** Optional so readiness reports `not-configured` honestly instead of pretending. */
  database?: { ping(): Promise<boolean> };
  readyTimeoutMs?: number;
}

export const ROUTE_MANIFEST: RouteManifestEntry[] = [
  { method: 'GET', path: '/healthz', operationId: 'getHealth' },
  { method: 'GET', path: '/readyz', operationId: 'getReady' },
  { method: 'GET', path: '/version', operationId: 'getVersion' },
  { method: 'GET', path: '/api/v1/whoami', operationId: 'getWhoami' },
];

export type HttpResponse = { status: number; body: unknown; headers?: Record<string, string> };

/** Validate-then-send. An unvalidated body is a bug in this program, and the wire is not where to discover it. */
function send(operationId: string, status: number, body: unknown): HttpResponse {
  const check = validateResponse(spec, operationId, status, body);
  if (check.ok) return { status, body };
  return {
    status: 500,
    body: { error: 'response-violates-spec', message: `${operationId} ${String(status)}: ${check.errors.join('; ')}`.slice(0, 300) },
  };
}

const bearerOf = (header: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
};

export async function handleGetHealth(): Promise<HttpResponse> {
  // A fixed payload on purpose, so liveness can be compared across instances without reading a varying value.
  const livenessToken = createHash('sha256').update(`${build().commit}\u0000${build().version}`).digest('hex').slice(0, 16);
  return send('getHealth', 200, { status: 'ok', livenessToken });
}

let depsRef: AppDeps | undefined;
const build = () => depsRef?.build ?? { version: '0.0.0-dev', commit: '0'.repeat(40), buildTime: '1970-01-01T00:00:00Z' };

export async function handleGetReady(): Promise<HttpResponse> {
  const checks: Array<{ name: string; status: 'ok' | 'degraded' | 'failed' | 'not-configured'; detail?: string }> = [];
  const identity = depsRef?.identity.describe();
  if (!identity) {
    checks.push({ name: 'identity', status: 'not-configured', detail: 'no identity provider is attached; authenticated routes will refuse' });
  } else if (identity.provider === 'unattached') {
    checks.push({ name: 'identity', status: 'failed', detail: 'identity is configured but has no key set -- every token will be refused' });
  } else {
    checks.push({ name: 'identity', status: 'ok' });
  }
  if (!depsRef?.database) {
    checks.push({ name: 'database', status: 'not-configured', detail: 'Slice 1 has no persistence; records arrive in Slice 2' });
  } else {
    const db = depsRef.database;
    const timeoutMs = depsRef.readyTimeoutMs ?? 1_000;
    const alive = await Promise.race([db.ping(), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
    checks.push(alive ? { name: 'database', status: 'ok' } : { name: 'database', status: 'failed', detail: 'connection could not be established' });
  }
  const body = { status: checks.some((c) => c.status === 'failed') ? 'not-ready' : 'ready', checks };
  // `not-configured` must not read as healthy: readiness says ready, but the detail lines are the honest part.
  return send('getReady', body.status === 'ready' ? 200 : 503, body);
}

export async function handleGetVersion(): Promise<HttpResponse> {
  const info = build();
  return send('getVersion', 200, {
    name: 'control-plane',
    version: info.version,
    commit: info.commit,
    buildTime: info.buildTime,
    providerContract: { name: CONTRACT_NAME, version: CONTRACT_VERSION },
  });
}

export async function handleGetWhoami(request: { headers: Record<string, string | string[] | undefined> }): Promise<HttpResponse> {
  const raw = request.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const token = bearerOf(header);
  if (!token) {
    return send('getWhoami', 401, { error: 'no-credentials', message: 'a Bearer access token is required' });
  }
  if (!depsRef) return send('getWhoami', 503, { error: 'unconfigured', message: 'the application is not booted' });
  // Authentication and authorization are separate calls on purpose. Passing requiredScope into verification made
  // a scope-less-but-genuine token fail as *unauthenticated* (401), which is both wrong and left the spec's 403
  // unreachable -- a decorative status code is a documentation lie. Verify who, then decide whether they may.
  const result = await depsRef.identity.verifyAccessToken(token);
  if (!result.ok) {
    const code = result.code satisfies VerificationFailureCode;
    // The failure code is echoed as the machine-readable error, so a client can branch on why it was refused
    // without scraping prose. Claims never are -- only the refusal reason.
    return send('getWhoami', 401, { error: `unauthenticated:${code}`, message: result.message.slice(0, 200) });
  }
  if (!result.claims.scope.includes('platfolio.user')) {
    return send('getWhoami', 403, { error: 'insufficient-scope', message: 'token lacks the platfolio.user scope' });
  }
  return send('getWhoami', 200, {
    subject: result.claims.subject,
    issuer: result.claims.issuer,
    audience: result.claims.audience,
    clientId: result.claims.clientId,
    scope: result.claims.scope,
    expiresAt: result.claims.expiresAt,
    tenantAuthority: false,
  });
}

export function registerRoutes(server: { addRoute(r: { method: string; path: string; operationId: string; handle: (req: never, params: Record<string, string>) => Promise<HttpResponse> }): void }, deps: AppDeps): void {
  depsRef = deps;
  const routes: Array<{ method: string; path: string; operationId: string; handle: (req: { headers: Record<string, string | string[] | undefined> } & object, params: Record<string, string>) => Promise<HttpResponse> }> = [
    { method: 'GET', path: '/healthz', operationId: 'getHealth', handle: () => handleGetHealth() },
    { method: 'GET', path: '/readyz', operationId: 'getReady', handle: () => handleGetReady() },
    { method: 'GET', path: '/version', operationId: 'getVersion', handle: () => handleGetVersion() },
    { method: 'GET', path: '/api/v1/whoami', operationId: 'getWhoami', handle: (req) => handleGetWhoami(req) },
  ];
  for (const route of routes) {
    server.addRoute(route as never);
  }
}
