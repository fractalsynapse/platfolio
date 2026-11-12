import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities, OPERATION_ACTIONS } from '../src/capabilities.ts';
import { createIdentityFixture, defaultIdentityConfig, POLICY, reasonOf, signToken, uncoveredActions, type StoreResult, type PolicyAction } from '@platfolio/contracts';

const fixture = createIdentityFixture();
const token = (subject: string) => signToken(fixture, { scope: 'platfolio.user', subject });

function must<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

async function start() {
  const ctx = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    extensions: buildCapabilities({ build: { version: '1', commit: 'a'.repeat(40), buildTime: '2026-11-11T00:00:00.000Z' } }),
    requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const call = async (p: string, init: RequestInit = {}, subject = 'owner-subject') => {
    const response = await fetch(`http://127.0.0.1:${String(ctx.server.address.port)}${p}`, {
      ...init, headers: { authorization: `Bearer ${token(subject)}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: Record<string, unknown> | undefined;
    try { body = response.status === 204 ? undefined : JSON.parse(text) as Record<string, unknown>; } catch { body = { raw: text }; }
    return { status: response.status, body, text };
  };
  /** A team with two principals at different roles, plus one instance to act on. */
  const seed = async (actionTeamName: string) => {
    const team = must(await ctx.store.createTeam({ name: actionTeamName }), 'createTeam');
    const owner = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'owner-subject' }), 'owner person');
    const member = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'member-subject' }), 'member person');
    must(await ctx.store.putTeamMember({ teamId: team.id, personId: owner.person.id, role: 'owner' }), 'owner member');
    must(await ctx.store.putTeamMember({ teamId: team.id, personId: member.person.id, role: 'member' }), 'plain member');
    const instance = must(await ctx.store.createInstance({ teamId: team.id, name: 'svc', template: 'shared-identity' }), 'createInstance');
    return { team, owner, member, instance };
  };
  return { ctx, call, seed };
}

test('every scoped route declares an action, and every action is exercised somewhere', () => {
  // The reason this exists: a route added without an action would fall back to "membership is enough", which
  // is the exact regression #178 removes. Deriving the map from the routes that were built makes that visible.
  // The registry fills when capabilities are built, so build them against placeholder deps first -- the same
  // trick routes.ts uses to derive the manifest. Reading the map before anything was built asserted nothing.
  buildCapabilities({ build: { version: 'probe', commit: 'a'.repeat(40), buildTime: '2026-11-11T00:00:00.000Z' } });
  assert.ok(OPERATION_ACTIONS.size >= 11, `expected the scoped routes to register actions, got ${String(OPERATION_ACTIONS.size)}`);
  for (const [operationId, action] of OPERATION_ACTIONS) {
    assert.ok(POLICY[action], `${operationId} names an action with no policy entry: ${action}`);
  }
  const covered: PolicyAction[] = [...OPERATION_ACTIONS.values()];
  const notRouted = uncoveredActions(covered).filter((a) => !['instance.destroy', 'team.member.manage', 'team.invite'].includes(a));
  assert.deepEqual(notRouted, [], `actions in the table with no route yet: ${JSON.stringify(notRouted)}`);
});

test('a plain member may operate the platform but cannot share its capabilities (D42, D43)', async () => {
  const app = await start();
  try {
    const { instance } = await app.seed('role-lab');
    const read = await app.call(`/api/v1/instances/${instance.id}`, undefined as never, 'member-subject');
    assert.equal(read.status, 200, 'a member must be able to read their own team instance');

    const publish = await app.call(`/api/v1/instances/${instance.id}/capability`, { method: 'POST', body: JSON.stringify({ capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }) }, 'member-subject');
    assert.equal(publish.status, 200, `member should be able to publish on their own team's instance: ${publish.text}`);

    const share = await app.call(`/api/v1/instances/${instance.id}/capability/identity/shares`, { method: 'PUT', body: JSON.stringify({ toTeamId: 'someone-else' }) }, 'member-subject');
    assert.equal(share.status, 403, `sharing grants another team access; a plain member got ${String(share.status)} ${share.text.slice(0, 90)}`);
    assert.match(JSON.stringify(share.body), /requires the owner role/, 'the refusal must say what would be enough');

    const ownerShare = await app.call(`/api/v1/instances/${instance.id}/capability/identity/shares`, { method: 'PUT', body: JSON.stringify({ toTeamId: 'someone-else' }) }, 'owner-subject');
    assert.equal(ownerShare.status, 200, `the owner should succeed where the member was refused: ${ownerShare.text}`);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('an outsider is answered 404 on the same route the member was told 403 about (#173 continuity)', async () => {
  const app = await start();
  try {
    const { instance } = await app.seed('boundary-lab');
    await app.call(`/api/v1/instances/${instance.id}/capability`, { method: 'POST', body: JSON.stringify({ capability: 'identity', outputs: [{ output: 'issuer', kind: 'url' }] }) }, 'owner-subject');
    const stranger = await app.call(`/api/v1/instances/${instance.id}/capability/identity/shares`, { method: 'PUT', body: JSON.stringify({ toTeamId: 'x' }) }, 'stranger-subject');
    assert.equal(stranger.status, 404, `a non-member must not learn the instance exists (got ${String(stranger.status)})`);
    const member = await app.call(`/api/v1/instances/${instance.id}/capability/identity/shares`, { method: 'PUT', body: JSON.stringify({ toTeamId: 'x' }) }, 'member-subject');
    assert.equal(member.status, 403, 'and the two answers must be distinguishable to the person entitled to the advice');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('the destructive verb is owner-only at the policy layer before the route exists (D43)', () => {
  // No destroy route yet. Asserting the decision now means the route cannot ship looser than the decision,
  // which is the failure mode this whole table was written to close.
  assert.equal(POLICY['instance.destroy'], 'owner');
  assert.equal(POLICY['capability.share'], 'owner');
  assert.equal(POLICY['team.invite'], 'owner');
});
