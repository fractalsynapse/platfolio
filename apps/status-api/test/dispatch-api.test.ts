import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { samplePlan, type InfraPlan } from '@platfolio/contracts';
import { createServer } from '../src/service.ts';
import { createDispatchStore, planHashOf } from '../src/dispatch-api.ts';

const INFO = { version: '1.2.3', commit: 'a'.repeat(40), buildTime: '2026-11-09T00:00:00Z' };
const store = createDispatchStore();
const server = createServer(INFO, { dispatch: { store, token: 'test-dispatch-token' } });
const listening = new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
server.listen(0, '127.0.0.1');
await listening;
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

const call = async (path: string, method: string, body?: unknown, token = 'test-dispatch-token') => {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.text() };
};

const plan = (() => {
  const p = samplePlan();
  for (const e of p.environments) { e.cloneFrom = undefined; e.buckets = []; e.databases = []; e.volumes = []; for (const s of e.services) { s.image = 'ghcr.io/acme/api:1'; s.digest = `sha256:${'d'.repeat(64)}`; } }
  // A plan arrives with the digest buildPlan computed for it; the API stores that and never re-derives one.
  p.planHash = 'e'.repeat(64);
  return p;
})();

test('a wrong or absent token is refused, and an unconfigured server fails closed', async () => {
  assert.equal((await call('/api/v1/attestations/capabilities', 'GET', undefined, 'nope')).status, 401);
  const unconfigured = createServer(INFO, { dispatch: { store: createDispatchStore(), token: undefined } });
  await new Promise<void>((resolve) => unconfigured.listen(0, '127.0.0.1', () => resolve()));
  const port = (unconfigured.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/instances/anything/dispatches/d1`);
  assert.equal(response.status, 503, 'no token configured must not mean no authentication required');
  unconfigured.close();
});

test('liveness stays a GET-only surface while /api/v1 accepts POST', async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const blocked = await fetch(`${base}/healthz`, { method: 'POST' });
  assert.equal(blocked.status, 405, 'the method guard must not be widened to the whole server');
});

test('a plan is stored by hash and the instance must match the path', async () => {
  const ok = await call(`/api/v1/instances/${plan.instanceId}/plans`, 'POST', { plan });
  assert.equal(ok.status, 201);
  assert.equal(planHashOf(plan), (JSON.parse(ok.body) as { planHash: string }).planHash, 'the stored hash is the plan own digest, not a re-derivation');
  const noHash = { ...structuredClone(plan), planHash: undefined } as unknown as InfraPlan;
  assert.equal((await call(`/api/v1/instances/${plan.instanceId}/plans`, 'POST', { plan: noHash })).status, 400, 'a plan without a digest cannot be registered');
  const mismatch = await call('/api/v1/instances/other/plans', 'POST', { plan });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body, /instance-mismatch/);
});

test('a dispatch is single-use, and the second fetch is a replay', async () => {
  const created = await call(`/api/v1/instances/${plan.instanceId}/dispatches`, 'POST', { action: 'apply', environment: 'production' });
  assert.equal(created.status, 201);
  const intent = (JSON.parse(created.body) as { intent: { dispatchId: string; nonce: string } }).intent;
  const first = await call(`/api/v1/instances/${plan.instanceId}/dispatches/${intent.dispatchId}`, 'GET');
  assert.equal(first.status, 200);
  const fetched = JSON.parse(first.body) as { plan: InfraPlan; planHash: string };
  assert.equal(fetched.plan.instanceId, plan.instanceId);
  assert.equal(JSON.stringify(fetched.plan).includes('test-dispatch-token'), false, 'a plan must not carry the API credential anywhere');
  const again = await call(`/api/v1/instances/${plan.instanceId}/dispatches/${intent.dispatchId}`, 'GET');
  assert.equal(again.status, 409, 'the same dispatch must not be applied twice by two runs');
  assert.match(again.body, /nonce-consumed/);
});

test('an attestation is accepted once and its binding is enforced', async () => {
  const created = await call(`/api/v1/instances/${plan.instanceId}/dispatches`, 'POST', { action: 'apply', environment: 'production' });
  const intent = (JSON.parse(created.body) as { intent: { dispatchId: string; nonce: string; planHash: string; instanceId: string; environment: string; action: string } }).intent;
  const attestation = (dispatchId: string, nonce: string, planHash: string) => ({
    dispatchId, nonce, planHash, instanceId: intent.instanceId, environment: intent.environment, action: intent.action,
    result: 'ok', resources: [{ kind: 'service', name: 'api', externalId: 'svc-1', status: 'live' }],
    release: { version: '0.4.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` },
    durationMs: 1200, finishedAt: new Date().toISOString(),
  });
  assert.equal((await call('/api/v1/attestations', 'POST', attestation(intent.dispatchId, 'wrong-nonce-0000000000000', intent.planHash))).status, 400, 'a foreign nonce is not an attestation for this dispatch');
  assert.equal((await call('/api/v1/attestations', 'POST', attestation(intent.dispatchId, intent.nonce, 'f'.repeat(64)))).status, 400, 'a hash that does not match the dispatch cannot attest success');
  assert.equal((await call('/api/v1/attestations', 'POST', attestation('disp-unknown', intent.nonce, intent.planHash))).status, 400);
  assert.equal((await call('/api/v1/attestations', 'POST', attestation(intent.dispatchId, intent.nonce, intent.planHash))).status, 202);
  const duplicate = await call('/api/v1/attestations', 'POST', attestation(intent.dispatchId, intent.nonce, intent.planHash));
  assert.equal(duplicate.status, 409, 'one attestation per dispatch, or a retried job rewrites history');
  const read = await call(`/api/v1/instances/${plan.instanceId}/latest-attestation`, 'GET');
  assert.equal(read.status, 200);
  assert.equal((JSON.parse(read.body) as { result: string }).result, 'ok');
});

test('the capabilities route says what is not implemented, in its own words', async () => {
  const body = JSON.parse((await call('/api/v1/attestations/capabilities', 'GET')).body) as { checks: string[]; notImplemented: string[]; headers: { authenticate: string; identityEvidence: string } };
  assert.deepEqual(body.notImplemented.sort(), ['oidc-audience', 'oidc-issuer', 'repository-binding', 'signature']);
  assert.ok(body.checks.includes('nonce-replay'), 'what it does check is named too, so nobody reads the gap as silence');
  // The header split is stated because it is the difference between "authenticated" and "identified": the
  // shared secret authenticates today, the OIDC token is evidence waiting for JWKS verification.
  assert.equal(body.headers.authenticate, 'authorization: Bearer <shared>');
  assert.match(body.headers.identityEvidence, /unverified/);
});

test('a malformed attestation is refused by the shared schema, not accepted and stored', async () => {
  const bad = await call('/api/v1/attestations', 'POST', { dispatchId: 'x' });
  assert.equal(bad.status, 400);
  assert.match(bad.body, /invalid-attestation/);
});
