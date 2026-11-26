import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { MARKETPLACE_RELEASES, marketplaceCatalog } from '@platfolio/manifest';
import { buildCapabilities } from '../src/capabilities.ts';

test('a private installation can exchange an owner’s code for registry access only', async () => {
  const fixture = createIdentityFixture();
  const teamId = 'team-' + randomUUID();
  const installationOffer = { provider: 'fixture-host', revision: 'b'.repeat(40) };
  const app: KernelContext = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: 'a'.repeat(40), buildTime: '2026-11-24T00:00:00Z' },
      marketplaceEnabled: true, marketplacePublisherTeam: teamId,
      installation: { returnTo: 'https://hub.example.test', provider: {
        id: installationOffer.provider, revision: installationOffer.revision,
        authorize() { throw new Error('This test only reads the offer'); },
      } },
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
    const ownerPerson = await app.store.resolvePerson({ issuer: fixture.issuer, subject: 'owner' });
    assert.ok(ownerPerson.ok);
    assert.ok((await app.store.seedInstallationTeam({ id: teamId, name: 'hosted-pilot', personId: ownerPerson.value.person.id })).ok);
    const installationId = randomUUID();
    const collection = `/api/v1/teams/${teamId}/marketplace/installations`;
    const teamPath = collection + '/' + installationId;
    const offerPath = `/api/v1/teams/${teamId}/marketplace/installation-offer`;
    const registryPath = `/api/v1/marketplace/installations/${installationId}`;
    const memberPerson = await app.store.resolvePerson({ issuer: fixture.issuer, subject: 'member' });
    assert.ok(memberPerson.ok);
    assert.ok((await app.store.putTeamMember({ teamId, personId: memberPerson.value.person.id, role: 'member' })).ok);
    assert.equal((await call(collection, other, 'GET')).status, 404);
    assert.equal((await call(collection, member, 'GET')).status, 403);
    assert.equal((await call(offerPath, other, 'GET')).status, 404);
    assert.equal((await call(offerPath, member, 'GET')).status, 403);
    const offer = await call(offerPath, owner, 'GET');
    assert.equal(offer.status, 200);
    assert.deepEqual(await offer.json(), installationOffer);
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
    assert.equal(catalog.status, 200, await catalog.clone().text());
    assert.deepEqual(await catalog.json(), MARKETPLACE_RELEASES);
    assert.equal((await call(`${registryPath}/catalog`, enrollmentCode)).status, 404);
    const registryCatalog = await call(`${registryPath}/catalog`, registry);
    assert.equal(registryCatalog.status, 200);
    assert.deepEqual(await registryCatalog.json(), MARKETPLACE_RELEASES);
    const publish = `/api/v1/teams/${teamId}/marketplace/releases`;
    const baseline = MARKETPLACE_RELEASES.find(({ template }) => template === 'starter-worker')!;
    const { template, version, installer, revision } = baseline;
    const original = { template, version, installer, revision };
    assert.equal((await call(publish, other, 'POST', original)).status, 404);
    assert.equal((await call(publish, member, 'POST', original)).status, 403);
    assert.equal((await call(publish, registry, 'POST', original)).status, 401);
    assert.equal((await call(publish, owner, 'POST', original)).status, 204);
    assert.equal((await call(publish, owner, 'POST', { ...original, revision: '1'.repeat(40) })).status, 409);
    const published = { ...original, version: '0.1.2', revision: '2'.repeat(40) };
    assert.equal(await app.store.publishMarketplaceRelease(published), 'created');
    const updated = await call(`${registryPath}/catalog?format=releases`, registry);
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), marketplaceCatalog([published]));
    assert.deepEqual(await (await call(`${registryPath}/catalog`, registry)).json(), MARKETPLACE_RELEASES);
    assert.equal((await call(teamPath, owner, 'DELETE')).status, 204);
    assert.equal((await call(`${registryPath}/claim`, registry)).status, 404);
    assert.equal((await call(`${registryPath}/catalog`, registry)).status, 404);
    assert.deepEqual(await connections(), [{ installationId, state: 'disconnected' }]);
  } finally {
    await disposeKernel(app);
  }
});
