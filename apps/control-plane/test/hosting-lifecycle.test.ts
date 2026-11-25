import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, FakeInfraProvider, samplePlan, signToken, type InfraPlan } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';

test('an additional hosting plugin runs a stored instance lifecycle through the scoped API', async (t) => {
  const identity = createIdentityFixture();
  const compute = new FakeInfraProvider({ name: 'compute-fixture' });
  const other = new FakeInfraProvider({ name: 'railway' });
  const ctx = await createKernel({
    infrastructure: [compute, other],
    identity: defaultIdentityConfig(identity),
    identityKeys: [identity.jwk],
    store: { driver: 'memory' },
    server: { port: 0 },
    extensions: buildCapabilities({ build: { version: null, commit: '0'.repeat(40), buildTime: new Date(0).toISOString() } }),
  });
  t.after(() => disposeKernel(ctx));
  const origin = `http://127.0.0.1:${ctx.server.address.port}`;
  const request = (path: string, method: string, body?: unknown, subject = 'owner') => fetch(origin + path, {
    method,
    headers: {
      authorization: 'Bearer ' + signToken(identity, { subject, scope: 'platfolio.user' }),
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const teamResponse = await request('/api/v1/teams', 'POST', { name: 'compute-team' });
  assert.equal(teamResponse.status, 201);
  const { teamId } = await teamResponse.json() as { teamId: string };
  const otherTeam = await request('/api/v1/teams', 'POST', { name: 'other-team' }, 'outsider');
  assert.equal(otherTeam.status, 201);
  const created = await request('/api/v1/instances', 'POST', { teamId, name: 'compute-app', template: 'starter-web', provider: 'compute-fixture' });
  assert.equal(created.status, 201);
  const { id, provider } = await created.json() as { id: string; provider: string };
  assert.equal(provider, 'compute-fixture');
  const base = `/api/v1/instances/${id}`;
  const plan: InfraPlan = { ...samplePlan(), instanceId: id, teamId, provider, planHash: 'b'.repeat(64) };
  assert.equal((await request(base + '/plan', 'PUT', { plan: { ...plan, provider: 'railway' } })).status, 200);
  assert.equal((await request(base + '/hosting/apply', 'POST')).status, 400);
  assert.equal((await request(base + '/plan', 'PUT', { plan })).status, 200);
  assert.equal((await request(base + '/hosting/apply', 'POST', undefined, 'outsider')).status, 404);

  const applied = await request(base + '/hosting/apply', 'POST');
  assert.equal(applied.status, 200, await applied.clone().text());
  assert.equal((await applied.json() as { verified: boolean }).verified, true);
  assert.equal((await request(base + '/hosting', 'GET')).status, 200);
  await assert.rejects(() => other.readState(id));
  assert.equal((await request(base + '/hosting/removal', 'POST', { data: 'wipe', confirmation: 'compute-app' }, 'outsider')).status, 404);
  assert.equal((await request(base + '/hosting/removal', 'POST', { data: 'keep', projectId: 'another-project' })).status, 400);
  assert.equal((await request(base + '/hosting/removal', 'POST', { data: 'keep' })).status, 200);
  assert.ok((await compute.readState(id)).services.every(({ status }) => status === 'stopped'));
  const resumed = await request(base + '/hosting/apply', 'POST');
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json() as { verified: boolean }).verified, true);
  assert.ok((await compute.readState(id)).services.every(({ status }) => status === 'live'));
  assert.equal((await request(base + '/hosting/removal', 'POST', { data: 'wipe' })).status, 400);
  assert.equal((await request(base + '/hosting/removal', 'POST', { data: 'wipe', confirmation: 'compute-app' })).status, 200);
  await assert.rejects(() => compute.readState(id));
});
