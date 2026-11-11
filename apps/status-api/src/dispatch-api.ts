import { AttestationSchema, DispatchIntentSchema, sha256Hex, type Attestation, type InfraPlan } from '@platfolio/contracts';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The dispatch and attestation surface the managed action talks to (#123).
 *
 * This is the minimum that makes a real dispatch possible, and it is explicit about what it does **not**
 * do: it does not verify the runner's OIDC token. Audience, issuer and repository binding are what make an
 * attestation mean something, and verifying them needs JWKS fetching and key pinning -- so a claim accepted
 * here is checked for replay, nonce, and plan-hash agreement, and nothing more. That is enough to exercise
 * the flow end to end; it is not enough to trust for a tenant, and the gap is stated in the response of
 * `/api/v1/attestations/capabilities` rather than left for someone to discover.
 *
 * Auth is a shared bearer, fail-closed when unset. Plans contain topology and digests, never credentials --
 * there is a test for that, because the claim is only safe if it is checked.
 */
export interface DispatchRecord {
  dispatchId: string;
  instanceId: string;
  nonce: string;
  planHash: string;
  plan: InfraPlan;
  issuedAt: string;
  expiresAt: string;
  consumed: boolean;
}

export interface DispatchStore {
  plans: Map<string, { plan: InfraPlan; planHash: string }>;
  dispatches: Map<string, DispatchRecord>;
  attestations: Attestation[];
}

export function createDispatchStore(): DispatchStore {
  return { plans: new Map(), dispatches: new Map(), attestations: [] };
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

export interface DispatchApiConfig {
  store: DispatchStore;
  /** When unset, every mutating and reading route answers 503 rather than falling open. */
  token: string | undefined;
}

// No hash here. `buildPlan` computes the plan's digest once, in one place, and the plan carries it; a second
// implementation -- even a deterministic one -- is a second truth, and the two disagreed within minutes of
// this file existing (the runner attested buildPlan's hash, the API expected its own, and every attestation
// was rejected 400). Reading the plan's own field is the fix; inventing another canonicalization is the bug.
export function planHashOf(plan: { planHash?: unknown }): string {
  if (typeof plan.planHash !== 'string' || plan.planHash.length < 16) {
    throw new Error('plan must carry the planHash computed by buildPlan');
  }
  return plan.planHash.replace(/^sha256:/, '').toLowerCase();
}

/** Returns true when the request was handled here (a /api/v1 path), false for the caller's routes. */
export async function handleDispatchApi(req: IncomingMessage, res: ServerResponse, config: DispatchApiConfig): Promise<boolean> {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (!path.startsWith('/api/v1/')) return false;
  const method = req.method ?? 'GET';

  const token = config.token;
  if (!token) {
    reply(res, 503, { error: 'dispatch-api-unconfigured', hint: 'set PLATFOLIO_DISPATCH_TOKEN; the routes fail closed rather than open' });
    return true;
  }
  const supplied = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (supplied !== token) {
    reply(res, 401, { error: 'unauthorized' });
    return true;
  }

  // Behind the same token as everything else: this describes what the server does and does not verify, and
  // that is operational information, not a public health signal.
  if (path === '/api/v1/attestations/capabilities') {
    reply(res, 200, {
      checks: ['nonce-replay', 'plan-hash-agreement', 'dispatch-known', 'schema'],
      notImplemented: ['oidc-audience', 'oidc-issuer', 'repository-binding', 'signature'],
      note: 'The Authorization bearer is a shared dispatch secret and is what authenticates; the runner sends its OIDC token in x-platfolio-runner-token, which is recorded, not verified.',
      headers: { authenticate: 'authorization: Bearer <shared>', identityEvidence: 'x-platfolio-runner-token (unverified)' },
    });
    return true;
  }

  const instanceMatch = path.match(/^\/api\/v1\/instances\/([^/]+)(?:\/(plans|dispatches))?\/?$/);
  if (instanceMatch && method === 'POST' && instanceMatch[2] === 'plans') {
    const instanceId = decodeURIComponent(instanceMatch[1] ?? '');
    try {
      const body = await readJson<{ plan: InfraPlan }>(req);
      const plan = body.plan;
      if (!plan || typeof plan !== 'object') throw new Error('expected { plan }');
      if (plan.instanceId !== instanceId) { reply(res, 400, { error: 'instance-mismatch', hint: `path says ${instanceId}, plan says ${String(plan.instanceId)}` }); return true; }
      const hash = planHashOf(plan as { planHash?: unknown });
      config.store.plans.set(instanceId, { plan, planHash: hash });
      reply(res, 201, { instanceId, planHash: hash });
    } catch (error) {
      reply(res, 400, { error: 'invalid-plan', message: (error as Error).message.slice(0, 160) });
    }
    return true;
  }

  if (instanceMatch && method === 'POST' && instanceMatch[2] === 'dispatches') {
    const instanceId = decodeURIComponent(instanceMatch[1] ?? '');
    const stored = config.store.plans.get(instanceId);
    if (!stored) { reply(res, 404, { error: 'no-plan-for-instance', instanceId }); return true; }
    const body = await readJson<{ action?: string; environment?: string }>(req).catch(() => ({}) as { action?: string; environment?: string });
    const dispatchId = `disp-${randomBytes(6).toString('hex')}`;
    const record: DispatchRecord = {
      dispatchId,
      instanceId,
      nonce: sha256Hex(`${dispatchId}\u0000${token}`).slice(0, 32),
      planHash: stored.planHash,
      plan: stored.plan,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      consumed: false,
    };
    config.store.dispatches.set(dispatchId, record);
    const intent = DispatchIntentSchema.parse({
      instanceId, teamId: 'tenant', dispatchId, nonce: record.nonce, planHash: record.planHash,
      action: body.action ?? 'apply', environment: body.environment ?? 'production',
      issuedAt: record.issuedAt, expiresAt: record.expiresAt,
    });
    reply(res, 201, { intent });
    return true;
  }

  const dispatchMatch = path.match(/^\/api\/v1\/instances\/([^/]+)\/dispatches\/([^/]+)$/);
  if (dispatchMatch && method === 'GET') {
    const record = config.store.dispatches.get(decodeURIComponent(dispatchMatch[2] ?? ''));
    if (!record || record.instanceId !== decodeURIComponent(dispatchMatch[1] ?? '')) { reply(res, 404, { error: 'unknown-dispatch' }); return true; }
    // Single use: a second fetch is a replay, and the plan the runner applies must be tied to exactly one run.
    if (record.consumed) { reply(res, 409, { error: 'nonce-consumed' }); return true; }
    record.consumed = true;
    reply(res, 200, { plan: record.plan, planHash: record.planHash, issuedAt: record.issuedAt, expiresAt: record.expiresAt });
    return true;
  }

  const instanceGet = path.match(/^\/api\/v1\/instances\/([^/]+)\/latest-attestation$/);
  if (instanceGet && method === 'GET') {
    const found = [...config.store.attestations].reverse().find((a) => a.instanceId === decodeURIComponent(instanceGet[1] ?? ''));
    reply(res, found ? 200 : 404, found ?? { error: 'no-attestation' });
    return true;
  }

  if (path === '/api/v1/attestations' && method === 'POST') {
    const parsed = AttestationSchema.safeParse(await readJson<unknown>(req));
    if (!parsed.success) { reply(res, 400, { error: 'invalid-attestation', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }); return true; }
    const attestation = parsed.data;
    const record = config.store.dispatches.get(attestation.dispatchId);
    if (!record) { reply(res, 400, { error: 'unknown-dispatch', dispatchId: attestation.dispatchId }); return true; }
    if (record.nonce !== attestation.nonce) { reply(res, 400, { error: 'nonce-mismatch' }); return true; }
    if (record.planHash !== attestation.planHash) { reply(res, 400, { error: 'plan-hash-mismatch', expected: record.planHash, attested: attestation.planHash }); return true; }
    if (config.store.attestations.some((a) => a.dispatchId === attestation.dispatchId)) { reply(res, 409, { error: 'already-attested', dispatchId: attestation.dispatchId }); return true; }
    config.store.attestations.push(attestation);
    reply(res, 202, { accepted: true, instanceId: attestation.instanceId, result: attestation.result });
    return true;
  }

  reply(res, 404, { error: 'no-such-route', path });
  return true;
}
