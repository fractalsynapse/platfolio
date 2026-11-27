import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, marketplacePlatformDescriptorDigest, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';

test('team-owned publications and exact acquisitions extend the same public platform catalog', async () => {
  const fixture = createIdentityFixture();
  const app = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 }, requiredServices: ['store', 'identity', 'server', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: 'a'.repeat(40), buildTime: '2026-11-27T00:00:00Z' }, marketplaceEnabled: true,
    }),
  });
  try {
    async function seedOwner(subject: string) {
      const person = await app.store.resolvePerson({ issuer: fixture.issuer, subject });
      assert.ok(person.ok);
      const team = await app.store.seedInstallationTeam({ id: randomUUID(), name: subject, personId: person.value.person.id });
      assert.ok(team.ok);
      return { teamId: team.value.id, token: signToken(fixture, { scope: 'platfolio.user', subject }) };
    }
    const publisher = await seedOwner('publisher');
    const buyer = await seedOwner('buyer');
    const member = await app.store.resolvePerson({ issuer: fixture.issuer, subject: 'member' });
    assert.ok(member.ok);
    assert.ok((await app.store.putTeamMember({ teamId: publisher.teamId, personId: member.value.person.id, role: 'member' })).ok);
    const memberToken = signToken(fixture, { scope: 'platfolio.user', subject: 'member' });
    const call = (path: string, auth?: string, body?: object) => fetch(`http://127.0.0.1:${app.server.address.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const publicPath = '/api/v1/marketplace/platforms';
    const teamPath = (teamId: string) => `/api/v1/teams/${teamId}/marketplace/platforms`;
    const draft = { title: 'Client portal', slug: 'client-portal', variant: 'hosted-application' };
    const outsider = await call(teamPath(publisher.teamId), buyer.token, draft);
    assert.equal(outsider.status, 404, await outsider.text());
    assert.equal((await call(teamPath(publisher.teamId), memberToken, draft)).status, 403);
    const initial = await (await call(publicPath)).json() as unknown[];
    const created = await call(teamPath(publisher.teamId), publisher.token, draft);
    assert.equal(created.status, 201, await created.clone().text());
    const platform = await created.json() as { id: string; publisherTeamId: string };
    assert.equal(platform.publisherTeamId, publisher.teamId);
    assert.deepEqual(await (await call(publicPath)).json(), initial);
    assert.equal((await call(teamPath(publisher.teamId), publisher.token, draft)).status, 409);
    assert.equal((await call(teamPath(buyer.teamId), buyer.token, draft)).status, 201, 'other publishers can use the same slug');

    const source = { repo: 'platfolio-fixtures/client-portal', revision: 'b'.repeat(40) };
    const image = `registry.example.test/apps/client-portal@sha256:${'c'.repeat(64)}`;
    const release = { version: '1.0.0', source, images: [image] };
    const releasePath = `${teamPath(publisher.teamId)}/${platform.id}/releases`;
    assert.equal((await call(`${teamPath(buyer.teamId)}/${platform.id}/releases`, buyer.token, release)).status, 404);
    assert.equal((await call(releasePath, publisher.token, { ...release, images: [] })).status, 400);
    assert.equal((await call(releasePath, publisher.token, { ...release, images: ['registry.example.test/apps/client-portal:latest'] })).status, 400);
    const published = await call(releasePath, publisher.token, release);
    assert.equal(published.status, 200, await published.clone().text());
    const descriptor = { ...release, platformId: platform.id, installer: 'compose-image@1' };
    const descriptorDigest = marketplacePlatformDescriptorDigest(descriptor);
    const summary = { version: release.version, platformId: platform.id, installer: descriptor.installer, images: [], descriptorDigest };
    assert.deepEqual(await published.json(), summary);
    assert.deepEqual(await (await call(releasePath, publisher.token, release)).json(), summary);
    assert.equal((await call(releasePath, publisher.token, { ...release, source: { ...source, revision: 'd'.repeat(40) } })).status, 409);
    assert.deepEqual(await (await call(`${publicPath}/${platform.id}/releases`)).json(), [summary]);

    for (const variant of ['starter-template', 'shared-service'] as const) {
      const { id } = await (await call(teamPath(publisher.teamId), publisher.token,
        { title: variant, slug: variant, variant })).json() as { id: string };
      const listing = await call(`${teamPath(publisher.teamId)}/${id}/releases`, publisher.token,
        { ...release, images: variant === 'starter-template' ? [] : [image] });
      assert.equal(listing.status, 200, await listing.clone().text());
      assert.equal((await listing.json() as { installer: string }).installer, variant === 'starter-template' ? 'compose-source@1' : 'compose-image@1');
    }
    const all = await (await call(publicPath)).json() as Array<{ id: string; variant: string }>;
    assert.deepEqual(new Set(all.map(({ variant }) => variant)), new Set(['starter-template', 'shared-service', 'hosted-application']));
    assert.ok(all.some(({ id, variant }) => id === platform.id && variant === 'hosted-application'));
    const legacy = await (await call('/api/v1/marketplace/catalog')).json() as unknown[];
    assert.equal(legacy.length, initial.length);

    async function enroll(teamId: string) {
      const installationId = randomUUID();
      const registry = randomBytes(32).toString('base64url');
      const digest = (s: string) => createHash('sha256').update(s).digest('hex');
      const code = randomUUID();
      assert.equal(await app.store.issueMarketplaceEnrollment(teamId, installationId, digest(code), '2099-01-01T00:00:00Z'), true);
      assert.equal(await app.store.redeemMarketplaceEnrollment(installationId, digest(code), digest(registry), '2026-11-27T00:00:00Z'), true);
      return { installationId, registry, path: `/api/v1/marketplace/installations/${installationId}/acquisitions` };
    }
    const connection = await enroll(buyer.teamId);
    const other = await enroll(publisher.teamId);
    const claim = { platformId: platform.id, version: release.version, descriptorDigest };
    assert.equal((await call(connection.path, other.registry, claim)).status, 404);
    assert.equal((await call(connection.path, connection.registry, { ...claim, descriptorDigest: '0'.repeat(64) })).status, 409);
    assert.equal((await call(connection.path, connection.registry, { ...claim, version: '2.0.0' })).status, 404);
    const acquired = await call(connection.path, connection.registry, claim);
    assert.equal(acquired.status, 200, await acquired.clone().text());
    assert.equal(acquired.headers.get('cache-control'), 'no-store');
    const receipt = await acquired.json() as { id: string; teamId: string; release: unknown };
    assert.equal(receipt.teamId, buyer.teamId);
    assert.deepEqual(receipt.release, { ...descriptor, descriptorDigest });
    const later = await call(releasePath, publisher.token, { ...release, version: '1.1.0' });
    assert.equal(later.status, 200);
    assert.deepEqual(await (await call(connection.path, connection.registry, claim)).json(), receipt);
    const otherInstallForBuyer = await enroll(buyer.teamId);
    assert.deepEqual(await (await call(otherInstallForBuyer.path, otherInstallForBuyer.registry, claim)).json(), receipt);
    const otherTeamReceipt = await (await call(other.path, other.registry, claim)).json() as { id: string; teamId: string };
    assert.equal(otherTeamReceipt.teamId, publisher.teamId);
    assert.notEqual(otherTeamReceipt.id, receipt.id);
    assert.equal(await app.store.disconnectMarketplaceInstallation(buyer.teamId, connection.installationId), true);
    assert.equal((await call(connection.path, connection.registry, claim)).status, 404);
  } finally {
    await disposeKernel(app);
  }
});
