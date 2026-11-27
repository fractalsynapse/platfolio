import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  createIdentityFixture, CustomerHostingCommandSchema, defaultIdentityConfig, FakeInfraProvider,
  GitScm, marketplacePlatformDescriptorDigest, signToken, type MarketplacePlatformAcquisition,
} from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { verifyMarketplaceInstall } from '../../../scripts/customer-marketplace-install.ts';
import { customerMarketplaceConnection } from '../../../scripts/customer-marketplace-connection.ts';
import { verifyMarketplaceImage } from '../../../scripts/marketplace-image-verification.ts';
import { buildCapabilities } from '../src/capabilities.ts';
import { customerLaunch } from '../src/customer-launch.ts';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const epoch = '2026-11-27T00:00:00Z';
const imageDocument = JSON.stringify({ schemaVersion: 2, manifests: [] });
const image = `ghcr.io/platfolio-fixtures/install:1.0.0@sha256:${digest(imageDocument)}`;
const build = { version: null, commit: 'c'.repeat(40), buildTime: epoch };
const workerKey = 'private-worker-key-for-test-only';

test('all marketplace variants follow an exact acquisition into a local private install', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'platfolio-marketplace-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const identity = createIdentityFixture();
  const hub = await createKernel({
    identity: defaultIdentityConfig(identity), identityKeys: [identity.jwk], provider: 'fake',
    store: { driver: 'memory' }, server: { port: 0 }, extensions: buildCapabilities({ build, marketplaceEnabled: true }),
  });
  t.after(() => disposeKernel(hub));
  const publisher = await hub.store.createTeam({ name: 'publisher' });
  const buyer = await hub.store.createTeam({ name: 'buyer' });
  assert.ok(publisher.ok && buyer.ok);
  const installationId = randomUUID();
  const credential = randomBytes(32).toString('base64url');
  assert.equal(await hub.store.issueMarketplaceEnrollment(buyer.value.id, installationId, digest('handoff'), '2099-01-01T00:00:00Z'), true);
  assert.equal(await hub.store.redeemMarketplaceEnrollment(installationId, digest('handoff'), digest(credential), epoch), true);
  let hubOnline = true;
  let acquisitionRequests = 0;
  const marketplace = customerMarketplaceConnection('https://hub.example.test', {
    async status() { return 'ready'; },
    async readMarketplaceGrant() { return { version: 1, grant: { installationId, hub: 'https://hub.example.test', credential, claimed: true } }; },
    async writeMarketplaceGrant() { assert.fail('Acquiring must not replace the enrolled grant'); },
  }, async (input, init) => {
    acquisitionRequests += 1;
    assert.ok(hubOnline, 'stored installs must work when the hub is unavailable');
    assert.equal(new URL(String(input)).origin, 'https://hub.example.test');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + credential);
    return fetch(`http://127.0.0.1:${hub.server.address.port}` + new URL(String(input)).pathname, init);
  });

  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q');
  const gitScm = new GitScm();
  let tamperImage = false;
  const readGit: GitScm['readRepositoryFile'] = ({ repo, ...input }) => {
    assert.match(repo, /^platfolio-fixtures\//);
    assert.match(input.ref, /^[a-f0-9]{40}$/);
    return gitScm.readRepositoryFile({ ...input, repo: pathToFileURL(root).href });
  };
  const privateTeam = 'private-team';
  const worker = customerLaunch({ teamId: privateTeam, siteOrigin: 'https://site.example.test', workerUrl: 'http://127.0.0.1:9091', workerKey },
    async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + workerKey);
      const command = CustomerHostingCommandSchema.parse(JSON.parse(String(init?.body)));
      assert.equal(command.action, 'marketplace-verify-install');
      try {
        const receipt = await marketplace.acquire(command.body.release);
        if (!receipt) return new Response(null, { status: 409 });
        return Response.json(await verifyMarketplaceInstall(command.body.target, receipt, readGit, (reference) =>
          verifyMarketplaceImage(reference, async (input) => {
            assert.equal(String(input), `https://ghcr.io/v2/platfolio-fixtures/install/manifests/sha256:${digest(imageDocument)}`);
            return new Response(tamperImage ? '{}' : imageDocument, {
              headers: { 'content-type': 'application/vnd.oci.image.index.v1+json', 'docker-content-digest': reference.split('@')[1]! },
            });
          })));
      } catch (error) {
        if (!tamperImage) t.diagnostic(String(error));
        return new Response(null, { status: 503 });
      }
    });
  const railway = new FakeInfraProvider({ name: 'railway' });
  const privateApp = await createKernel({
    identity: defaultIdentityConfig(identity), identityKeys: [identity.jwk], infrastructure: [railway],
    store: { driver: 'memory' }, server: { port: 0 }, extensions: buildCapabilities({ build, customerLaunch: worker }),
  });
  t.after(() => disposeKernel(privateApp));
  t.mock.method(privateApp.scm, 'readFile', readGit);
  const owner = await privateApp.store.resolvePerson({ issuer: identity.issuer, subject: 'private-owner' });
  assert.ok(owner.ok);
  assert.ok((await privateApp.store.seedInstallationTeam({ id: privateTeam, name: 'workspace', personId: owner.value.person.id })).ok);
  const token = signToken(identity, { scope: 'platfolio.user', subject: 'private-owner' });
  const request = (path: string, method: string, body?: object, auth = token) => fetch(`http://127.0.0.1:${privateApp.server.address.port}${path}`, {
    method, headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const path = `/api/v1/teams/${privateTeam}/marketplace/installs`;
  const inputs = [];
  for (const variant of ['starter-template', 'shared-service', 'hosted-application'] as const) {
    const starter = variant === 'starter-template';
    const slug = starter ? 'starter-web' : variant === 'shared-service' ? 'shared-identity' : 'hosted-portal';
    const compose = `name: ${slug}
services:
  web:
    ${starter ? 'build: .' : 'image: ' + image}
    expose: ["8080"]
    x-platfolio:
      public: true
      domains: [app.example.test]
x-platfolio:
  metadata:
    name: ${slug}
    version: 1.0.0
    kind: web
    mode: ${starter ? 'development' : 'hosted'}
    title: Marketplace fixture
    summary: A pinned fixture to verify acquisition and local provisioning.
  environments:
    production: { enabled: true, branch: main }
    staging: { enabled: false }
    preview: { enabled: false }
`;
    writeFileSync(join(root, 'compose.yaml'), compose);
    writeFileSync(join(root, 'environment.yaml'), 'variables: []\n');
    git('add', 'compose.yaml', 'environment.yaml');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', slug);
    const platform = await hub.store.createMarketplacePlatform(publisher.value.id, { slug, title: slug, variant });
    assert.ok(platform.ok);
    const descriptor = {
      platformId: platform.value.id, version: '1.0.0',
      installer: starter ? 'compose-source@1' : 'compose-image@1',
      source: { repo: `platfolio-fixtures/${slug}`, revision: git('rev-parse', 'HEAD') }, images: starter ? [] : [image],
    };
    assert.equal(await hub.store.publishMarketplacePlatformRelease(publisher.value.id, descriptor), 'created');
    const release = { platformId: descriptor.platformId, version: descriptor.version, descriptorDigest: marketplacePlatformDescriptorDigest(descriptor) };
    const input = { name: slug, release, ...(starter ? { sourceRepository: 'platfolio-fixtures/customer-starter' } : {}) };
    const outsider = signToken(identity, { scope: 'platfolio.user', subject: 'outsider' });
    const count = acquisitionRequests;
    assert.equal((await request(path, 'POST', input, outsider)).status, 404);
    assert.equal(acquisitionRequests, count);

    if (!starter) {
      tamperImage = true;
      assert.equal((await request(path, 'POST', input)).status, 503, 'a claimed digest header cannot authenticate different bytes');
      assert.equal(await privateApp.store.getMarketplaceInstall(privateTeam, slug), undefined);
      tamperImage = false;
    }
    const response = await request(path, 'POST', input);
    assert.equal(response.status, 200, `${variant}: ${await response.clone().text()}`);
    const installed = await response.json() as SuccessOf<'preparePrivateMarketplaceInstall'>;
    assert.equal(installed.variant, variant);
    assert.equal(installed.instance.templateRef?.commitSha, descriptor.source.revision);
    assert.equal(installed.instance.templateRef?.repo, input.sourceRepository ?? descriptor.source.repo);
    assert.equal(installed.instance.state, 'pending');
    await assert.rejects(() => railway.readState(installed.instance.id), 'prepare does not touch the provider');
    const instancePath = `/api/v1/instances/${installed.instance.id}`;
    const applyPath = instancePath + '/hosting/apply';
    if (starter) {
      assert.equal((await request(applyPath, 'POST')).status, 404, 'source CI supplies its own first artifact');
      writeFileSync(join(root, 'README.md'), 'Customer change\n');
      git('add', 'README.md');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Customer change');
      const [taggedImage, imageDigest] = image.split('@');
      const artifact = await request(instancePath + '/artifacts', 'POST', {
        service: 'web', image: taggedImage, digest: imageDigest, sourceRef: git('rev-parse', 'HEAD'),
      });
      assert.equal(artifact.status, 201, await artifact.clone().text());
      const plan = await request(instancePath + '/plan/from-repository', 'POST', {});
      assert.equal(plan.status, 200, await plan.clone().text());
      const applied = await request(applyPath, 'POST');
      assert.equal(applied.status, 200, await applied.clone().text());
      assert.equal((await applied.json() as { verified: boolean }).verified, true);
    } else {
      const plan = await privateApp.store.getPlan(installed.instance.id);
      assert.ok(plan.ok);
      assert.equal((await privateApp.store.putPlan(installed.instance.id, plan.value.plan, plan.value.planHash)).ok, false);
      const applied = await request(applyPath, 'POST');
      assert.equal(applied.status, 200, await applied.clone().text());
      assert.equal((await applied.json() as { verified: boolean }).verified, true);
      assert.ok((await railway.readState(installed.instance.id)).services.every(({ image: actual }) => actual === image));
      const second = await request(path, 'POST', { ...input, name: slug + '-copy' });
      assert.equal(second.status, 200);
      const copy = await second.json() as typeof installed;
      assert.notEqual(copy.instance.id, installed.instance.id);
      assert.equal(copy.receiptId, installed.receiptId);
    }
    assert.equal(await hub.store.publishMarketplacePlatformRelease(publisher.value.id, { ...descriptor, version: '2.0.0' }), 'created');
    const retained = await privateApp.store.getMarketplaceInstall(privateTeam, slug);
    assert.equal(retained?.receipt.release.version, '1.0.0');
    assert.equal(retained?.receipt.release.descriptorDigest, release.descriptorDigest);
    inputs.push({ input, installed, applyPath });
  }
  hubOnline = false;
  const requestCount = acquisitionRequests;
  for (const { input, installed, applyPath } of inputs) {
    const replay = await request(path, 'POST', input);
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json() as typeof installed).instance.id, installed.instance.id);
    assert.equal((await request(path, 'POST', { ...input, release: { ...input.release, version: '2.0.0' } })).status, 409);
    assert.equal((await request(applyPath, 'POST')).status, 200);
  }
  assert.equal(acquisitionRequests, requestCount);
});

test('the private connection rejects a modified descriptor before fetching artifacts', async () => {
  const installationId = randomUUID();
  const descriptor = {
    platformId: 'portal', version: '1.0.0', installer: 'compose-image@1',
    source: { repo: 'platfolio-fixtures/portal', revision: 'b'.repeat(40) }, images: [image],
  };
  const selection = { platformId: descriptor.platformId, version: descriptor.version, descriptorDigest: marketplacePlatformDescriptorDigest(descriptor) };
  const receipt: MarketplacePlatformAcquisition = {
    id: 'receipt', teamId: 'hub-team', acquiredAt: epoch, variant: 'hosted-application',
    release: { ...descriptor, descriptorDigest: selection.descriptorDigest, source: { ...descriptor.source, revision: 'a'.repeat(40) } },
  };
  const vault = {
    async status() { return 'ready' as const; },
    async readMarketplaceGrant() { return { version: 1, grant: { installationId, hub: 'https://hub.example.test', credential: 'fixture-grant', claimed: true } }; },
    async writeMarketplaceGrant() {},
  };
  const marketplace = customerMarketplaceConnection('https://hub.example.test', vault, async () => Response.json(receipt));
  await assert.rejects(() => marketplace.acquire(selection), /approved release/);
});

test('the verifier refuses unsupported registry addresses before making any request', async () => {
  const pin = `@sha256:${digest(imageDocument)}`;
  for (const name of ['registry.example.test/app:1.0', 'localhost/app:1.0', 'ghcr.io/platfolio-fixtures/app']) {
    await assert.rejects(() => verifyMarketplaceImage(name + pin, async () => {
      assert.fail('The reference must be rejected before making a registry request');
    }), /registry/);
  }
});
