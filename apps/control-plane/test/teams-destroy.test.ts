import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { createIdentityFixture, defaultIdentityConfig, reasonOf, signToken, type StoreResult } from '@platfolio/contracts';
import { loadSpec, validateResponse, type SpecDocument } from '@platfolio/api-contract';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const token = (subject: string) => signToken(fixture, { scope: 'platfolio.user', subject });
const build = { version: '9.9.9', commit: 'a'.repeat(40), buildTime: '2026-11-11T00:00:00.000Z' };
let seq = 0;

function must<T>(r: StoreResult<T>, label: string): T {
  if (r.ok) return r.value;
  throw new Error(`${label} refused: ${reasonOf(r)}`);
}

async function start() {
  const ctx: KernelContext = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 }, email: { driver: 'memory' },
    extensions: buildCapabilities({ build }), requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const base = `http://127.0.0.1:${String(ctx.server.address.port)}`;
  const call = async (p: string, init: RequestInit = {}, subject = `user-${String(++seq)}`) => {
    const response = await fetch(base + p, { ...init, headers: { authorization: `Bearer ${token(subject)}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const text = await response.text();
    let body: unknown;
    try { body = response.status === 204 ? undefined : JSON.parse(text) as unknown; } catch { body = text; }
    return { status: response.status, body, text, subject };
  };
  const against = (operationId: string, status: number, body: unknown) => {
    const check = validateResponse(spec, operationId, status, body);
    assert.ok(check.ok, `${operationId} ${String(status)} violates the spec: ${check.errors.join('; ')}\n  body: ${JSON.stringify(body).slice(0, 200)}`);
  };
  return { ctx, call, against };
}

const post = { method: 'POST' } as const;

test('a person can create a team and immediately owns it (D44, #195)', async () => {
  const app = await start();
  try {
    const created = await app.call('/api/v1/teams', { ...post, body: JSON.stringify({ name: ' Acme-Corp ' }) }, 'creator-one');
    assert.equal(created.status, 201, created.text);
    app.against('createTeam', 201, created.body);
    assert.equal((created.body as { role: string }).role, 'owner', 'the caller must own what they made, or nothing in it is ever manageable');
    assert.equal((created.body as { name: string }).name, 'acme-corp', 'the name is normalised on write');

    const mine = await app.call('/api/v1/teams', {}, 'creator-one');
    app.against('listTeams', 200, mine.body);
    const rows = mine.body as Array<{ teamId: string; role: string }>;
    assert.equal(rows.length, 1, `creator should see exactly their team: ${created.text}`);
    assert.equal(rows[0]?.role, 'owner');

    // A different person sees nothing: the list is derived from membership, not from a teamId in the request.
    const stranger = await app.call('/api/v1/teams', {}, 'creator-two');
    assert.equal((stranger.body as unknown[]).length, 0, 'teams are not enumerable across people');
  } finally { await disposeKernel(app.ctx); }
});

test('team names are addressable slugs, and a collision is refused with a reason (D45)', async () => {
  const app = await start();
  try {
    const taken = await app.call('/api/v1/teams', { ...post, body: JSON.stringify({ name: 'collide' }) }, 'first-owner');
    assert.equal(taken.status, 201, taken.text);
    // Same normalised name, different caller: the collision is about the ADDRESS, not about who typed it.
    const dupe = await app.call('/api/v1/teams', { ...post, body: JSON.stringify({ name: 'COLLIDE' }) }, 'second-owner');
    assert.equal(dupe.status, 409, `a case-differing name must collide: ${dupe.text}`);
    app.against('createTeam', 409, dupe.body);

    for (const bad of ['Has Space', '-lead', 'trail-', 'under_score', 'x'.repeat(45)]) {
      const refused = await app.call('/api/v1/teams', { ...post, body: JSON.stringify({ name: bad }) }, 'strict-owner');
      assert.equal(refused.status, 400, `"${bad}" should be refused as a name that cannot be a URL segment (got ${String(refused.status)})`);
      app.against('createTeam', 400, refused.body);
    }
    const missing = await app.call('/api/v1/teams', { ...post, body: JSON.stringify({}) }, 'empty-owner');
    assert.equal(missing.status, 400, 'a name is required');
  } finally { await disposeKernel(app.ctx); }
});

test('destroy is refused while something depends on it, naming the dependant (D43, #176)', async () => {
  const app = await start();
  try {
    const team = must(await app.ctx.store.createTeam({ name: 'guard-lab' }), 'createTeam');
    const owner = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'guard-owner' }), 'person');
    must(await app.ctx.store.putTeamMember({ teamId: team.id, personId: owner.person.id, role: 'owner' }), 'member');
    const memberPerson = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'guard-member' }), 'person2');
    must(await app.ctx.store.putTeamMember({ teamId: team.id, personId: memberPerson.person.id, role: 'member' }), 'member2');
    const provider = must(await app.ctx.store.createInstance({ teamId: team.id, name: 'idp', template: 'shared-identity' }), 'provider');
    const consumer = must(await app.ctx.store.createInstance({ teamId: team.id, name: 'shop', template: 'starter-web' }), 'consumer');
    must(await app.ctx.store.publishCapability({ instanceId: provider.id, teamId: team.id, capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }), 'publish');
    must(await app.ctx.store.bindCapability({ consumerInstanceId: consumer.id, capability: 'identity', providerInstanceId: provider.id, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }], boundBy: owner.person.id }), 'bind');

    const blocked = await app.call(`/api/v1/instances/${provider.id}`, { method: 'DELETE' }, 'guard-owner');
    assert.equal(blocked.status, 409, `a destroy that strands a running consumer must be refused, got ${String(blocked.status)}`);
    assert.match(JSON.stringify(blocked.body), new RegExp(consumer.id), `the refusal must name what depends on it: ${blocked.text}`);
    assert.match(JSON.stringify(blocked.body), /identity/, 'and say which capability');

    const asMember = await app.call(`/api/v1/instances/${consumer.id}`, { method: 'DELETE' }, 'guard-member');
    assert.equal(asMember.status, 403, 'destroy is owner-only (D43) and a member is told so, not hidden from');
    app.against('destroyInstance', 403, asMember.body);
    const asStranger = await app.call(`/api/v1/instances/${provider.id}`, { method: 'DELETE' }, 'nobody-here');
    assert.equal(asStranger.status, 404, 'a non-member must not learn the instance exists');

    const unbound = await app.call(`/api/v1/instances/${consumer.id}/bindings/identity`, { method: 'DELETE' }, 'guard-owner');
    assert.equal(unbound.status, 204, unbound.text);
    const allowed = await app.call(`/api/v1/instances/${provider.id}`, { method: 'DELETE' }, 'guard-owner');
    assert.equal(allowed.status, 202, allowed.text);
    app.against('destroyInstance', 202, allowed.body);
    assert.equal((allowed.body as { state: string }).state, 'deprovisioning');

    const readBack = await app.call(`/api/v1/instances/${provider.id}`, {}, 'guard-owner');
    assert.equal((readBack.body as { state: string }).state, 'deprovisioning', 'the state is a record, not just a response');
  } finally { await disposeKernel(app.ctx); }
});

test('destroy claims only what it has done (#196: recorded, not executed)', async () => {
  const app = await start();
  try {
    const team = must(await app.ctx.store.createTeam({ name: 'honesty-lab' }), 'team');
    const person = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'honest-owner' }), 'person');
    must(await app.ctx.store.putTeamMember({ teamId: team.id, personId: person.person.id, role: 'owner' }), 'member');
    const instance = must(await app.ctx.store.createInstance({ teamId: team.id, name: 'solo', template: 'starter-web' }), 'instance');
    const gone = await app.call(`/api/v1/instances/${instance.id}`, { method: 'DELETE' }, 'honest-owner');
    assert.equal(gone.status, 202, gone.text);
    const body = gone.body as { recorded?: boolean; state?: string };
    assert.equal(body.recorded, true, '202 means recorded; anything claiming completion would be a lie');
    assert.doesNotMatch(JSON.stringify(body), /deleted|destroyed|removed/, `the response must not claim teardown it has not performed: ${gone.text}`);
    // And the instance is still readable -- a soft removal is a state, not a disappearance.
    const still = await app.call(`/api/v1/instances/${instance.id}`, {}, 'honest-owner');
    assert.equal(still.status, 200, 'the record survives its own removal decision');
  } finally { await disposeKernel(app.ctx); }
});
