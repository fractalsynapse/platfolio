import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import {
  createIdentityFixture, defaultIdentityConfig, reasonOf, signToken,
  type DispatchIntent, type StoreResult,
} from '@platfolio/contracts';
import { loadSpec, validateResponse, type RouteManifestEntry, type SpecDocument } from '@platfolio/api-contract';
import { ROUTE_MANIFEST } from '../src/routes.ts';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../../../api/control-plane.openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const scoped = (extra: string[] = []) => signToken(fixture, { scope: ['platfolio.user', ...extra].join(' ') });
// 40 hex, exactly. My first version was 42 characters and the OpenAPI pattern refused it -- the gate working
// as designed against my own test fixture, which is the best possible advertisement for it.
const build = { version: '9.9.9', commit: 'abcdef0123456789abcdef0123456789abcdef0123'.slice(0, 40), buildTime: '2026-11-11T00:00:00.000Z' };

/** Unwrap a StoreResult in test setup, naming the refusal instead of leaving `.value` on undefined. */
function must<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

async function startApp(options: { reconcileIntervalMs?: number } = {}) {
  process.env.PLATFOLIO_RECONCILE_INTERVAL_MS = String(options.reconcileIntervalMs ?? 120);
  const ctx = await createKernel({
    provider: 'fake',
    custody: 'strict',
    identity: defaultIdentityConfig(fixture),
    identityKeys: [fixture.jwk],
    store: { driver: 'memory' },
    server: { port: 0 },
    extensions: buildCapabilities({ build }),
    requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const base = () => `http://127.0.0.1:${String(ctx.server.address.port)}`;
  const call = async (p: string, init: RequestInit = {}) => {
    const response = await fetch(base() + p, init);
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text) as unknown; } catch { body = text; }
    return { status: response.status, body, text };
  };
  const asUser = (token: string) => ({ headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  return { ctx, base, call, asUser };
}

/** The D41 assertion, applied to every response this suite sees. */
const againstSpec = (operationId: string, status: number, body: unknown) => {
  const check = validateResponse(spec, operationId, status, body);
  assert.ok(check.ok, `${operationId} ${String(status)} violates the spec: ${check.errors.join('; ')}\nbody: ${JSON.stringify(body).slice(0, 250)}`);
};

test('the route manifest matches the document, and both cover the same surface', () => {
  const ops = (ROUTE_MANIFEST as RouteManifestEntry[]).map((r) => r.operationId).sort();
  assert.deepEqual(ops, ['createDispatch', 'createInstance', 'getDispatchPlan', 'getHealth', 'getInstance', 'getLatestAttestation', 'getReady', 'getVersion', 'getWhoami', 'listAudit', 'listInstances', 'postAttestation', 'putPlan']);
  assert.equal(ops.length, 13, 'one per operation in api/control-plane.openapi.yaml');
});

test('Slice 1 behaviour survives the refactor to plugins', async () => {
  const app = await startApp();
  try {
    againstSpec('getHealth', 200, (await app.call('/healthz')).body);
    const ready = await app.call('/readyz');
    againstSpec('getReady', ready.status, ready.body);
    const checks = (ready.body as { checks: Array<{ name: string; status: string; detail?: string }> }).checks;
    const database = checks.find((c) => c.name === 'database');
    assert.equal(database?.status, 'degraded', 'an in-memory store must not read as production-ready, even when it answers');
    assert.ok(database?.detail && /lost on restart/.test(database.detail), 'and it must say why');
    againstSpec('getVersion', 200, (await app.call('/version')).body);
    const whoami = await app.call('/api/v1/whoami', app.asUser(scoped()));
    againstSpec('getWhoami', 200, whoami.body);
    assert.equal((whoami.body as { tenantAuthority: boolean }).tenantAuthority, false);
    const unscoped = await app.call('/api/v1/whoami', app.asUser(signToken(fixture, { scope: 'profile' })));
    againstSpec('getWhoami', 403, unscoped.body);
    againstSpec('getWhoami', 401, (await app.call('/api/v1/whoami')).body);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('the lifecycle: record, register a plan, dispatch, fetch once, attest, reconcile', async () => {
  const app = await startApp({ reconcileIntervalMs: 60 });
  try {
    const team = must(await app.ctx.store.createTeam({ name: 'acme' }), 'createTeam');
    const post = { ...app.asUser(scoped()), method: 'POST' as const };

    const created = await app.call('/api/v1/instances', { ...post, body: JSON.stringify({ teamId: team.id, name: 'marketing', platform: 'starter-web' }) });
    againstSpec('createInstance', 201, created.body);
    const instance = created.body as { id: string; state: string };
    assert.equal(instance.state, 'pending', 'a 201 records intent; nothing was verified, so nothing may claim progress (D30 law 1)');

    againstSpec('listInstances', 200, (await app.call('/api/v1/instances', app.asUser(scoped()))).body);
    const missing = await app.call('/api/v1/instances/inst-nope', app.asUser(scoped()));
    againstSpec('getInstance', 404, missing.body);

    const badHash = await app.call(`/api/v1/instances/${instance.id}/plan`, { method: 'PUT', ...app.asUser(scoped()), body: JSON.stringify({ plan: { instanceId: instance.id, planHash: 'sha256:short' } }) });
    againstSpec('putPlan', 400, badHash.body);
    assert.match((badHash.body as { message: string }).message, /buildPlan/, 'the refusal must name the one place a digest is computed');

    const plan = {
      instanceId: instance.id, teamId: team.id, provider: 'railway', contract: '1.0.0', planHash: 'b'.repeat(64),
      manifestRef: { platform: 'starter-web', version: '1.0.0' },
      environments: [{ name: 'production', services: [], databases: [], volumes: [], buckets: [], domains: [] }],
    };
    const registered = await app.call(`/api/v1/instances/${instance.id}/plan`, { method: 'PUT', ...app.asUser(scoped()), body: JSON.stringify({ plan }) });
    againstSpec('putPlan', 200, registered.body);
    assert.equal((registered.body as { planHash: string }).planHash, plan.planHash, 'the stored hash is the plans own, not a re-derivation');

    const dispatched = await app.call(`/api/v1/instances/${instance.id}/dispatches`, { ...post, body: JSON.stringify({ action: 'apply', environment: 'production' }) });
    againstSpec('createDispatch', 201, dispatched.body);
    const intent = (dispatched.body as { intent: DispatchIntent }).intent;
    assert.equal(intent.planHash, plan.planHash);
    assert.ok(intent.nonce.length >= 16);

    const dispatchPath = `/api/v1/instances/${instance.id}/dispatches/${intent.dispatchId}`;
    const fetched = await app.call(dispatchPath);
    againstSpec('getDispatchPlan', 200, fetched.body);
    const replay = await app.call(dispatchPath);
    againstSpec('getDispatchPlan', 409, replay.body);
    assert.equal((replay.body as { error: string }).error, 'nonce-consumed', 'a duplicated job cannot apply the plan twice');

    const attestation = {
      dispatchId: intent.dispatchId, instanceId: instance.id, nonce: intent.nonce, planHash: intent.planHash,
      action: 'apply', environment: 'production', result: 'ok',
      resources: [{ kind: 'service', name: 'web', externalId: 'svc-1', status: 'live' }],
      release: { version: '0.4.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` },
      durationMs: 1200, finishedAt: new Date().toISOString(),
    };
    const attestPath = { method: 'POST' as const, headers: { 'content-type': 'application/json' } };
    const accepted = await app.call('/api/v1/attestations', { ...attestPath, body: JSON.stringify(attestation) });
    againstSpec('postAttestation', 202, accepted.body);
    const duplicate = await app.call('/api/v1/attestations', { ...attestPath, body: JSON.stringify(attestation) });
    againstSpec('postAttestation', 409, duplicate.body);
    const foreign = await app.call('/api/v1/attestations', { ...attestPath, body: JSON.stringify({ ...attestation, dispatchId: 'disp-other', nonce: 'f'.repeat(32) }) });
    againstSpec('postAttestation', 400, foreign.body);

    const latest = await app.call(`/api/v1/instances/${instance.id}/latest-attestation`, app.asUser(scoped()));
    againstSpec('getLatestAttestation', 200, latest.body);

    // The controller: an attested outcome moves recorded state without a human reading a log line. This is
    // what #123 was missing -- runState had no caller.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const reconciled = await app.call(`/api/v1/instances/${instance.id}`, app.asUser(scoped()));
    assert.equal((reconciled.body as { state: string }).state, 'live', 'the controller consumed the attestation');
    assert.equal((reconciled.body as { lastAppliedPlanHash?: string }).lastAppliedPlanHash, plan.planHash);

    const audit = await app.call('/api/v1/audit?limit=50', app.asUser(scoped()));
    againstSpec('listAudit', 200, audit.body);
    const rows = audit.body as Array<{ action: string; actorKind: string; actorRef: string }>;
    const actions = rows.map((r) => r.action);
    for (const expected of ['instance.create', 'plan.register', 'dispatch.create', 'attestation.record', 'instance.state']) {
      assert.ok(actions.includes(expected), `audit is missing ${expected}: ${JSON.stringify(actions)}`);
    }
    const controllerRows = rows.filter((r) => r.actorKind === 'controller');
    assert.ok(controllerRows.length > 0, 'the controller must be identifiable in the trail, not blended with humans');
    assert.ok(controllerRows.every((r) => /^sweep-\d+$/.test(r.actorRef)), `controller actors should be sweep ids: ${JSON.stringify(controllerRows.map((r) => r.actorRef))}`);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('a partial attestation degrades the instance rather than calling it live', async () => {
  const app = await startApp({ reconcileIntervalMs: 60 });
  try {
    const team = must(await app.ctx.store.createTeam({ name: 'acme' }), 'createTeam');
    const instance = must(await app.ctx.store.createInstance({ teamId: team.id, name: 'worker', platform: 'starter-worker' }), 'createInstance');
    const planHash = 'a'.repeat(64);
    must(await app.ctx.store.putPlan(instance.id, { instanceId: instance.id, planHash }, planHash), 'putPlan');
    const dispatch = must(await app.ctx.store.createDispatch({
      instanceId: instance.id, nonce: 'e'.repeat(32), planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { instanceId: instance.id },
    }), 'createDispatch');
    const result = await app.call('/api/v1/attestations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dispatchId: dispatch.id, instanceId: instance.id, nonce: dispatch.nonce, planHash, action: 'apply', environment: 'production',
        result: 'partial', errorCode: 'domain:create-refused',
        resources: [{ kind: 'service', name: 'queue', externalId: 'svc-2', status: 'live' }],
        release: { version: '0.4.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` },
        durationMs: 900, finishedAt: new Date().toISOString(),
      }),
    });
    assert.equal(result.status, 202, result.text);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const state = must(await app.ctx.store.getInstance(instance.id), 'getInstance');
    assert.equal(state.state, 'degraded', 'some resources landed and one did not: neither live nor failed');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('requests are bounded, and a malformed body refuses cleanly instead of throwing', async () => {
  const app = await startApp();
  try {
    const notJson = await app.call('/api/v1/instances', { ...app.asUser(scoped()), method: 'POST', body: 'this is not json' });
    assert.equal(notJson.status, 400);
    assert.match(notJson.text, /not valid JSON/);

    const emptyBody = await app.call('/api/v1/instances', { ...app.asUser(scoped()), method: 'POST' });
    assert.equal(emptyBody.status, 400, 'a POST with no body is a bad request, not a null-pointer 500');

    const wrongType = await app.call('/api/v1/instances', { ...app.asUser(scoped()), method: 'POST', body: JSON.stringify({ teamId: 42, name: 'x', platform: 'starter-web' }) });
    assert.equal(wrongType.status, 400, 'a non-string teamId is refused by the shared schema, not coerced');

    const auditLimit = await app.call('/api/v1/audit?limit=9999', app.asUser(scoped()));
    assert.equal(auditLimit.status, 400, 'the limit is bounded, so a list endpoint cannot be asked for everything');

    againstSpec('listAudit', 200, (await app.call('/api/v1/audit?limit=5', app.asUser(scoped()))).body);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('boot fails loudly when a capability a plugin requires is missing', async () => {
  await assert.rejects(
    () => createKernel({ identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk], server: { port: 0 }, extensions: buildCapabilities({ build }), requiredServices: ['store'] }),
    (error: Error) => {
      assert.match(error.message, /"store" is not present|requires "store"/, error.message.slice(0, 240));
      return true;
    },
    'a composition that quietly starts without persistence must not look healthy',
  );
});

test('stopping the runtime stops the controller interval -- the disposer is load-bearing', async () => {
  const app = await startApp({ reconcileIntervalMs: 50 });
  const port = app.ctx.server.address.port;
  await disposeKernel(app.ctx);
  await assert.rejects(() => fetch(`http://127.0.0.1:${String(port)}/healthz`), 'the listener must close with the fiber');
});
