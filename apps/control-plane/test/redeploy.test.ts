/**
 * `POST /api/v1/instances/{instanceId}/redeploy` as an API operation (D48).
 *
 * The provider semantics live in `packages/contracts/test/railway-redeploy.test.ts`. What is asserted here is
 * the HTTP contract, which is the half that can rot without the seam noticing: that the route is guarded, that
 * its authority is the level the policy table says it is, that a provider without the verb answers 501 rather
 * than 500, and that the response the caller gets is the spec's -- not a plausible-looking object that
 * `api:check` never saw.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { createIdentityFixture, defaultIdentityConfig, FakeInfraProvider, reasonOf, signToken, type StoreResult } from '@platfolio/contracts';
import { loadSpec, operationsOf, validateResponse, type SpecDocument } from '@platfolio/api-contract';
import { ROUTE_MANIFEST } from '../src/routes.ts';
import fs from 'node:fs';
import path from 'node:path';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const scoped = () => signToken(fixture, { scope: 'platfolio.user' });
const build = { version: '9.9.9', commit: 'a'.repeat(40), buildTime: '2026-11-15T00:00:00.000Z' };

function must<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

async function startApp(withoutRedeploy = false) {
  const ctx = await createKernel({
    provider: 'fake',
    ...(withoutRedeploy ? { infrastructure: [new FakeInfraProvider({ name: 'railway', without: ['redeploy'] })] } : {}),
    custody: 'strict',
    identity: defaultIdentityConfig(fixture),
    identityKeys: [fixture.jwk],
    store: { driver: 'memory' },
    server: { port: 0 },
    extensions: buildCapabilities({ build }),
    requiredServices: ['identity', 'server', 'store', 'extensions', 'infra'],
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
  const team = await createTeamWith(ctx);
  const instance = must(await ctx.store.createInstance({ teamId: team, name: 'refresh-probe', template: 'starter-web' }), 'createInstance');
  return { ctx, call, asUser, scoped, team, instance };
}

/** Membership granted to the subject the request guard will resolve, so a pass is not a fixture artifact. */
async function createTeamWith(ctx: KernelContext, subject = 'user-conformance'): Promise<string> {
  const team = must(await ctx.store.createTeam({ name: `t-${Math.random().toString(36).slice(2, 8)}` }), 'createTeam');
  const person = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject }), 'resolvePerson');
  must(await ctx.store.putTeamMember({ teamId: team.id, personId: person.person.id, role: 'owner' }), 'putTeamMember');
  return team.id;
}

/** Assert a response body against the OpenAPI document, so the spec is the mechanism and not the description. */
function againstSpec(operationId: string, status: number, body: unknown): void {
  const check = validateResponse(spec, operationId, status, body);
  assert.ok(check.ok, `${operationId} ${String(status)} violates its own spec: ${check.errors.join('; ')}`);
}

test('the route is declared, routed, and typed -- all three directions agree', () => {
  const operations = operationsOf(spec).map((o) => o.operationId);
  assert.ok(operations.includes('redeployInstance'), 'the spec declares the operation');
  const route = ROUTE_MANIFEST.find((r) => r.operationId === 'redeployInstance');
  assert.ok(route, 'the route manifest serves it');
  assert.equal(route!.method, 'POST');
  assert.equal(route!.path, '/api/v1/instances/{instanceId}/redeploy');
});

test('a refresh returns 202 and the provider answer, validated against the spec', async () => {
  const app = await startApp();
  try {
    const response = await app.call(`/api/v1/instances/${app.instance.id}/redeploy`, { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({ environment: 'production' }) });
    assert.equal(response.status, 202, response.text.slice(0, 300));
    againstSpec('redeployInstance', 202, response.body);
    const body = response.body as { instanceId: string; environment: string; services: string[]; refused: unknown[]; budgetSkipped: string[]; verified: boolean };
    assert.equal(body.instanceId, app.instance.id);
    assert.equal(body.environment, 'production');
    // The fake provider was never applied for this instance, so there is nothing to restart. That is the honest
    // answer and it must NOT be dressed up as an empty success.
    assert.equal(body.verified, false);
    assert.ok(body.refused.length > 0 || body.services.length > 0, `a refresh that did nothing and refused nothing is a silent no-op: ${response.text.slice(0, 200)}`);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('environment is required -- the body cannot guess which of two same-named services to restart', async () => {
  const app = await startApp();
  try {
    const response = await app.call(`/api/v1/instances/${app.instance.id}/redeploy`, { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({}) });
    assert.equal(response.status, 400, `an omitted environment was accepted: ${response.text.slice(0, 200)}`);
    assert.match(JSON.stringify(response.body), /environment/);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('a blank service is refused rather than treated as "all services"', async () => {
  // `service: ""` would otherwise reach the provider as a name that matches nothing and read back as a
  // successful refresh of zero things. Omitting the field is the way to say "everything".
  const app = await startApp();
  try {
    const response = await app.call(`/api/v1/instances/${app.instance.id}/redeploy`, { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({ environment: 'production', service: '  ' }) });
    assert.equal(response.status, 400, response.text.slice(0, 200));
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('an unknown instance is 404, so probing cannot tell a missing instance from a forbidden one', async () => {
  const app = await startApp();
  try {
    const response = await app.call('/api/v1/instances/does-not-exist/redeploy', { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({ environment: 'production' }) });
    assert.equal(response.status, 404);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('a member may refresh: restarting is a deployment, and members may already deploy (D43)', async () => {
  // The authority claim is in the policy table, so the test asks the table AND the route: a member must get
  // through (not 403), and the reason must be the role, not the absence of a check.
  const ctx = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 }, extensions: buildCapabilities({ build }),
    requiredServices: ['identity', 'server', 'store', 'extensions', 'infra'],
  });
  try {
    const base = `http://127.0.0.1:${String(ctx.server.address.port)}`;
    const team = must(await ctx.store.createTeam({ name: 'role-table' }), 'createTeam');
    const owner = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'resolvePerson');
    const member = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'member-subject' }), 'resolvePerson');
    must(await ctx.store.putTeamMember({ teamId: team.id, personId: owner.person.id, role: 'owner' }), 'putTeamMember');
    must(await ctx.store.putTeamMember({ teamId: team.id, personId: member.person.id, role: 'member' }), 'putTeamMember');
    const instance = must(await ctx.store.createInstance({ teamId: team.id, name: 'roles', template: 'starter-web' }), 'createInstance');
    const memberToken = signToken(fixture, { subject: 'member-subject', scope: 'platfolio.user' });
    const response = await fetch(`${base}/api/v1/instances/${instance.id}/redeploy`, {
      method: 'POST', headers: { authorization: `Bearer ${memberToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ environment: 'production' }),
    });
    // NOT 403: a restart grants nothing a deploy does not already grant. What it does return is the provider's
    // answer for an instance that was never applied.
    assert.notEqual(response.status, 403, 'a member was refused a refresh that policy says a member may do');
    assert.ok([202, 400, 501].includes(response.status), `unexpected status ${String(response.status)}`);

    // And the same action against the table, so the intent is stated where a reviewer reads it.
    const { POLICY } = await import('@platfolio/contracts');
    assert.equal(POLICY['instance.redeploy'], 'member', 'the refresh verb is member-level by design; a change to this must be a decision, not an edit');
  } finally {
    await disposeKernel(ctx);
  }
});

test('a provider without the verb answers 501, naming the provider -- not a 500 from a facade', async () => {
  // The reason `redeploy` is in `describe().operations`: "this platform cannot restart your service" is a fact
  // the API can state BEFORE attempting anything, and the operator needs the provider's name to know where to
  // go instead. A TypeError from `fn.call` on undefined would be a 500 and a mystery.
  const app = await startApp(true);
  try {
    const response = await app.call(`/api/v1/instances/${app.instance.id}/redeploy`, { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({ environment: 'production' }) });
    assert.equal(response.status, 501, `expected 501, got ${String(response.status)}: ${response.text.slice(0, 240)}`);
    const body = response.body as { error: string; message: string };
    assert.equal(body.error, 'provider-cannot-redeploy');
    assert.match(body.message, /railway/, 'the message names the provider, because that is what the operator acts on');
    assert.match(body.message, /your own provider project/, 'and says where to do it instead');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('the refresh is audited with names and codes only -- never a configuration value (D4)', async () => {
  const app = await startApp();
  try {
    await app.call(`/api/v1/instances/${app.instance.id}/redeploy`, { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({ environment: 'production', service: 'api' }) });
    const audit = await app.ctx.store.recentAudit(10);
    const entry = audit.find((a) => a.action === 'instance.redeploy');
    assert.ok(entry, `no audit row for the refresh: ${audit.map((a) => a.action).join(', ')}`);
    assert.equal(entry!.target, app.instance.id);
    const detail = entry!.detail as Record<string, unknown>;
    assert.equal(detail.environment, 'production');
    // Every audit value is a scalar by contract, and the token-shaped guard depends on that. Assert the whole
    // serialised row cannot hold a value-shaped string: the request never carried one, and the response must
    // not invent one.
    const serialised = JSON.stringify(detail);
    assert.ok(!/PLATFOLIO_DB_URL|SECRET|PASSWORD|TOKEN/i.test(serialised) || !/=[^,}]/.test(serialised), `audit detail may carry a credential: ${serialised.slice(0, 200)}`);
    assert.ok(serialised.includes('api'), 'the service named in the request is recorded, so the row answers what was asked');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('a partial refresh is not reported as success', async () => {
  // The response shape carries three outcomes on purpose. If `verified` were derived from "the call returned
  // 202", a refresh that restarted one service and was blocked on the next would read as done -- the exact
  // class of claim this platform refuses to make.
  const app = await startApp();
  try {
    const response = await app.call(`/api/v1/instances/${app.instance.id}/redeploy`, { ...app.asUser(app.scoped()), method: 'POST', body: JSON.stringify({ environment: 'production' }) });
    const body = response.body as { verified: boolean; services: string[]; refused: unknown[]; budgetSkipped: string[] };
    if (body.refused.length > 0 || body.budgetSkipped.length > 0) {
      assert.equal(body.verified, false, 'something was not restarted, so the answer cannot claim completion');
    }
    // And the spec must be able to EXPRESS that state, or the honest handler has nowhere to put the truth.
    const doc = spec.paths['/api/v1/instances/{instanceId}/redeploy'] as { post?: { responses?: Record<string, { content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown> } } } }> } };
    const props = doc.post?.responses?.['202']?.content?.['application/json']?.schema?.properties ?? {};
    for (const field of ['services', 'refused', 'budgetSkipped', 'verified']) {
      assert.ok(field in props, `the 202 schema cannot express "${field}" -- a partial answer would have nowhere to go`);
    }
  } finally {
    await disposeKernel(app.ctx);
  }
});
