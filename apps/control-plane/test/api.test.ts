import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import {
  CONTRACT_VERSION, createIdentityFixture, defaultIdentityConfig, reasonOf, signToken,
  type DispatchIntent, type StoreResult,
} from '@platfolio/contracts';
import { loadSpec, operationsOf, validateResponse, type RouteManifestEntry, type SpecDocument } from '@platfolio/api-contract';
import { ROUTE_MANIFEST } from '../src/routes.ts';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../openapi.yaml'), 'utf8'));
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

/** A team the given token subject can act for. Membership is granted, never assumed. */
async function createTeamWith(ctx: KernelContext, subject = 'user-conformance'): Promise<string> {
  const team = must(await ctx.store.createTeam({ name: `t-${Math.random().toString(36).slice(2, 8)}` }), 'createTeam');
  // Membership is granted to a *person* resolved from the same (issuer, subject) the request guard will use,
  // so a test cannot pass by writing a key the API never looks up.
  const person = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject }), 'resolvePerson');
  must(await ctx.store.putTeamMember({ teamId: team.id, personId: person.person.id, role: 'owner' }), 'putTeamMember');
  return team.id;
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
  // Compared against the document, not a snapshot of it: a hardcoded list has to be remembered, and a test
  // that must be edited every time the API grows is a test that gets skipped. api:check enforces the same
  // agreement in CI; this one catches it at the unit level with the manifest the app actually exports.
  const declared = operationsOf(spec).map((o) => o.operationId).sort();
  assert.deepEqual(ops, declared, 'the route manifest and the document disagree');
  assert.ok(ops.length >= 21, `expected the whole surface, got ${String(ops.length)} operations`);
  for (const bindingOp of ['publishCapability', 'shareCapability', 'revokeCapabilityShare', 'listBindings', 'bindCapability', 'unbindCapability', 'listConsumers', 'listAvailableCapabilities']) {
    assert.ok(ops.includes(bindingOp), `${bindingOp} is missing from the manifest`);
  }
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
    const teamId = await createTeamWith(app.ctx);
    const post = { ...app.asUser(scoped()), method: 'POST' as const };

    const created = await app.call('/api/v1/instances', { ...post, body: JSON.stringify({ teamId, name: 'marketing', template: 'starter-web' }) });
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
      instanceId: instance.id, teamId, provider: 'railway', contract: CONTRACT_VERSION, planHash: 'b'.repeat(64),
      manifestRef: { template: 'starter-web', version: '1.0.0' },
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
    const teamId = await createTeamWith(app.ctx);
    const instance = must(await app.ctx.store.createInstance({ teamId, name: 'worker', template: 'starter-worker' }), 'createInstance');
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

test('staging can be degraded while production is live, and both are recorded (#179)', async () => {
  const app = await startApp({ reconcileIntervalMs: 60 });
  try {
    const teamId = await createTeamWith(app.ctx);
    const created = await app.call('/api/v1/instances', { ...app.asUser(scoped()), method: 'POST', body: JSON.stringify({ teamId, name: 'two-envs', template: 'starter-web' }) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const instanceId = (created.body as { id: string }).id;
    const planHash = 'c'.repeat(64);
    const plan = { instanceId, teamId, provider: 'railway', contract: '1.0.0', planHash, manifestRef: { template: 'starter-web', version: '1.0.0' }, environments: [] };
    await app.call(`/api/v1/instances/${instanceId}/plan`, { method: 'PUT', ...app.asUser(scoped()), body: JSON.stringify({ plan }) });

    const attest = async (environment: string, result: 'ok' | 'partial') => {
      const issued = await app.call(`/api/v1/instances/${instanceId}/dispatches`, { ...app.asUser(scoped()), method: 'POST', body: JSON.stringify({ action: 'apply', environment }) });
      assert.equal(issued.status, 201, `dispatch for ${environment}: ${JSON.stringify(issued.body)}`);
      const intent = (issued.body as { intent: Record<string, string> }).intent;
      await app.call(`/api/v1/instances/${instanceId}/dispatches/${intent.dispatchId}`);
      const body = {
        dispatchId: intent.dispatchId, instanceId, nonce: intent.nonce, planHash: intent.planHash,
        action: 'apply', environment, result,
        resources: [{ kind: 'service', name: 'web', externalId: 'svc-1', status: 'live' }],
        release: { version: '0.4.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` },
        durationMs: 500, finishedAt: new Date().toISOString(),
        ...(result === 'partial' ? { errorCode: 'domain:create-refused' } : {}),
      };
      const posted = await app.call('/api/v1/attestations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(posted.status, 202, `attestation for ${environment}: ${posted.text}`);
    };

    await attest('production', 'ok');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await attest('staging', 'partial');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const read = await app.call(`/api/v1/instances/${instanceId}`, app.asUser(scoped()));
    assert.equal(read.status, 200);
    againstSpec('getInstance', 200, read.body);
    const instance = read.body as { state: string; environments: Array<{ environment: string; state: string; appliedPlanHash?: string }> };
    const byEnv = Object.fromEntries(instance.environments.map((e) => [e.environment, e.state]));
    assert.equal(byEnv.production, 'live', `production should be live, got ${JSON.stringify(byEnv)}`);
    assert.equal(byEnv.staging, 'degraded', `a partial attestation should leave staging degraded, got ${JSON.stringify(byEnv)}`);
    assert.equal(instance.state, 'live', 'the rollup follows production: a staging problem is not a production outage, and pretending otherwise hides real incidents');
    const listed = await app.call('/api/v1/instances', app.asUser(scoped()));
    againstSpec('listInstances', 200, listed.body);
    assert.equal((listed.body as Array<{ environments: unknown[] }>).length, 1);
    assert.ok(Array.isArray((listed.body as Array<{ environments: unknown[] }>)[0]?.environments), 'the list must carry environments too, or the CLI has to fetch each instance to be honest');
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

    const wrongType = await app.call('/api/v1/instances', { ...app.asUser(scoped()), method: 'POST', body: JSON.stringify({ teamId: 42, name: 'x', template: 'starter-web' }) });
    assert.equal(wrongType.status, 400, 'a non-string teamId is refused by the shared schema, not coerced');

    const auditLimit = await app.call('/api/v1/audit?limit=9999', app.asUser(scoped()));
    assert.equal(auditLimit.status, 400, 'the limit is bounded, so a list endpoint cannot be asked for everything');

    againstSpec('listAudit', 200, (await app.call('/api/v1/audit?limit=5', app.asUser(scoped()))).body);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('cross-team reads are indistinguishable from missing ones (#173)', async () => {
  // The security property is not "the outsider is refused" -- a 403 would confirm the record exists. It is
  // that the outsider learns nothing at all, so probing cannot enumerate teams' infrastructure. Every route
  // that touches an instance is exercised here, by enumeration rather than by spot check, so the next
  // instance-scoped route cannot quietly skip the guard.
  const app = await startApp();
  try {
    const mine = await createTeamWith(app.ctx);
    const theirs = must(await app.ctx.store.createTeam({ name: 'not-mine' }), 'createTeam').id;
    const stranger = must(await app.ctx.store.createInstance({ teamId: theirs, name: 'secret-svc', template: 'starter-web' }), 'createInstance');
    const mineInstance = must(await app.ctx.store.createInstance({ teamId: mine, name: 'mine', template: 'starter-web' }), 'createInstance');
    const token = scoped();

    const list = await app.call('/api/v1/instances', app.asUser(token));
    assert.equal(list.status, 200);
    const ids = (list.body as Array<{ id: string }>).map((i) => i.id);
    assert.ok(ids.includes(mineInstance.id), 'own instance missing from the list');
    assert.ok(!ids.includes(stranger.id), 'another team instance leaked into the list');

    const scopedRoutes: Array<[string, string, RequestInit]> = [
      ['GET', `/api/v1/instances/${stranger.id}`, {}],
      ['PUT', `/api/v1/instances/${stranger.id}/plan`, { method: 'PUT', body: JSON.stringify({ plan: { instanceId: stranger.id, planHash: 'a'.repeat(64) } }) }],
      ['POST', `/api/v1/instances/${stranger.id}/dispatches`, { method: 'POST', body: '{}' }],
      ['GET', `/api/v1/instances/${stranger.id}/latest-attestation`, {}],
    ];
    for (const [method, path, init] of scopedRoutes) {
      const r = await app.call(path, { ...init, method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
      assert.equal(r.status, 404, `${method} ${path} returned ${String(r.status)} to a non-member; body ${r.text.slice(0, 90)}`);
      assert.equal(r.status, 404, 'sanity');
      assert.ok(!/stranger|secret-svc|not-mine/.test(r.text), `${method} ${path} echoed the other team's identifiers`);
    }

    // Existence of a team is the same question, asked at creation time.
    const createTheirs = await app.call('/api/v1/instances', { ...app.asUser(token), method: 'POST', body: JSON.stringify({ teamId: theirs, name: 'x', template: 'starter-web' }) });
    assert.equal(createTheirs.status, 404, 'a caller was allowed to plant an instance in another team');

    // Unauthenticated stays 401: the distinction is between "who are you" and "not yours", and the API must
    // not blur them -- a 404 for a missing token would hide auth regressions behind authorization.
    const anonymous = await app.call('/api/v1/instances');
    assert.equal(anonymous.status, 401);

    // Authenticated but belonging to nothing: an empty list, not an error, and the same shape as an empty team.
    const lonely = await startApp();
    try {
      const empty = await lonely.call('/api/v1/instances', lonely.asUser(scoped()));
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.body, [], 'a caller with no teams should see an empty list');
    } finally {
      await disposeKernel(lonely.ctx);
    }
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('every instance-scoped route enforces membership rather than trusting the handler', async () => {
  // Table-driven over the manifest itself: a route under /api/v1/instances that does not answer 404 to a
  // non-member is a hole, and adding such a route without the guard fails here rather than in production.
  const app = await startApp();
  try {
    const theirs = must(await app.ctx.store.createTeam({ name: 'enumerated' }), 'createTeam').id;
    const foreign = must(await app.ctx.store.createInstance({ teamId: theirs, name: 'probe', template: 'starter-web' }), 'createInstance');
    const instanceRoutes = ROUTE_MANIFEST.filter((r) => r.path.startsWith('/api/v1/instances') && r.path !== '/api/v1/instances' && !r.path.includes('/dispatches/{dispatchId}'));
    assert.ok(instanceRoutes.length >= 4, `expected the scoped routes to be enumerated, got ${String(instanceRoutes.length)}`);
    for (const route of instanceRoutes) {
      const path = route.path.replace('{instanceId}', foreign.id);
      const init: RequestInit = { method: route.method, headers: { authorization: `Bearer ${scoped()}`, 'content-type': 'application/json' } };
      if (route.method !== 'GET') init.body = JSON.stringify(route.operationId === 'putPlan' ? { plan: { instanceId: foreign.id, planHash: 'b'.repeat(64) } } : {});
      const response = await app.call(path, init);
      assert.equal(response.status, 404, `${route.operationId} answered ${String(response.status)} to a non-member -- the guard was skipped`);
    }
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
