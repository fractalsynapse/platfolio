import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';

test('a private installation can exchange an owner’s code for registry access only', async () => {
  const fixture = createIdentityFixture();
  const app: KernelContext = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: 'a'.repeat(40), buildTime: '2026-11-24T00:00:00Z' },
      marketplaceEnabled: true,
    }),
  });
  const owner = signToken(fixture, { scope: 'platfolio.user', subject: 'owner' });
  const other = signToken(fixture, { scope: 'platfolio.user', subject: 'other' });
  const member = signToken(fixture, { scope: 'platfolio.user', subject: 'member' });
  const call = (route: string, authorization: string, method = 'POST', body?: unknown) =>
    fetch(`http://127.0.0.1:${app.server.address.port}${route}`, {
      method, headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const team = await call('/api/v1/teams', owner, 'POST', { name: 'hosted-pilot' });
    assert.equal(team.status, 201);
    const { teamId } = await team.json() as { teamId: string };
    const installationId = randomUUID();
    const collection = `/api/v1/teams/${teamId}/marketplace/installations`;
    const teamPath = collection + '/' + installationId;
    const registryPath = `/api/v1/marketplace/installations/${installationId}`;
    const memberPerson = await app.store.resolvePerson({ issuer: fixture.issuer, subject: 'member' });
    assert.ok(memberPerson.ok);
    assert.ok((await app.store.putTeamMember({ teamId, personId: memberPerson.value.person.id, role: 'member' })).ok);
    assert.equal((await call(collection, other, 'GET')).status, 404);
    assert.equal((await call(collection, member, 'GET')).status, 403);
    const connections = async () => {
      const list = await call(collection, owner, 'GET');
      assert.equal(list.status, 200);
      return list.json();
    };
    assert.deepEqual(await connections(), []);
    assert.equal((await call(`${teamPath}/enrollment`, other)).status, 404);
    const response = await call(`${teamPath}/enrollment`, owner);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { enrollmentCode } = await response.json() as { enrollmentCode: string };
    assert.deepEqual(await connections(), [{ installationId, state: 'pending' }]);
    const registry = randomBytes(32).toString('base64url');
    const registryDigest = createHash('sha256').update(registry).digest('hex');
    assert.equal((await call(`${registryPath}/claim`, registry)).status, 404);
    const redeemed = await Promise.all([0, 1].map(() =>
      call(`${registryPath}/enrollment`, enrollmentCode, 'POST', { registryDigest })));
    assert.deepEqual(redeemed.map(({ status }) => status).sort(), [204, 404]);
    assert.deepEqual(await connections(), [{ installationId, state: 'connected' }]);
    assert.equal((await call(`${registryPath}/claim`, enrollmentCode)).status, 404);
    assert.equal((await call('/api/v1/teams', registry, 'GET')).status, 401);
    const claim = await call(`${registryPath}/claim`, registry);
    assert.equal(claim.status, 200);
    const receipt = await claim.json() as { installationId: string; template: string; priceMinor: number };
    assert.deepEqual([receipt.installationId, receipt.template, receipt.priceMinor], [installationId, 'starter-web', 0]);
    assert.equal((await call('/api/v1/templates', registry, 'GET')).status, 401);
    const catalog = await call('/api/v1/templates', owner, 'GET');
    assert.equal(catalog.status, 200);
    const { installationId: _scope, ...release } = receipt;
    assert.deepEqual(await catalog.json(), [release]);
    assert.equal((await call(teamPath, owner, 'DELETE')).status, 204);
    assert.equal((await call(`${registryPath}/claim`, registry)).status, 404);
    assert.deepEqual(await connections(), [{ installationId, state: 'disconnected' }]);
  } finally {
    await disposeKernel(app);
  }
});
