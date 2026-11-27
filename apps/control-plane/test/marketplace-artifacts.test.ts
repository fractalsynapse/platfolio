import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  createIdentityFixture, defaultIdentityConfig, MarketplaceArtifactGrantSchema, MarketplaceAcquisitionReceiptSchema, signToken,
} from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { verifyMarketplaceInstall } from '../../../scripts/customer-marketplace-install.ts';
import { createArtifactGateway } from '../src/artifact-gateway.ts';
import { buildCapabilities } from '../src/capabilities.ts';
import { registryAuthorization } from '../src/marketplace-artifacts.ts';

const hex = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const mediaType = 'application/vnd.oci.image.manifest.v1+json';
const configType = 'application/vnd.oci.image.config.v1+json';

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}

test('OCI delivery binds publication, checkout eligibility, and durable pulls to the exact release', async (t) => {
  const files = new Map<string, { content: Buffer; type: string }>();
  const backend = createServer((req, res) => {
    const object = files.get(req.url ?? '');
    if (!object) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': object.type, 'content-length': object.content.length });
    res.end(req.method === 'HEAD' ? undefined : object.content);
  });
  const backendOrigin = await listen(backend);
  t.after(() => { backend.closeAllConnections(); backend.close(); });
  const config = { origin: 'http://127.0.0.1:1', backend: backendOrigin, key: randomBytes(48).toString('base64url') };
  let advanceClock = 0;
  const gateway = createArtifactGateway(config, () => Date.now() + advanceClock);
  config.origin = await listen(gateway);
  t.after(() => { gateway.closeAllConnections(); gateway.close(); });
  const fixture = createIdentityFixture();
  const hub = await createKernel({
    provider: 'fake', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk], store: { driver: 'memory' },
    server: { port: 0 }, extensions: buildCapabilities({
      build: { version: null, commit: '0'.repeat(40), buildTime: new Date(0).toISOString() },
      marketplaceEnabled: true, artifacts: config,
    }),
  });
  t.after(() => disposeKernel(hub));

  async function owner(name: string) {
    const person = await hub.store.resolvePerson({ issuer: fixture.issuer, subject: name });
    assert.ok(person.ok);
    const team = await hub.store.seedInstallationTeam({ id: randomUUID(), name, personId: person.value.person.id });
    assert.ok(team.ok);
    return { id: team.value.id, token: signToken(fixture, { scope: 'platfolio.user', subject: name }) };
  }
  const seller = await owner('seller');
  const buyer = await owner('buyer');
  const other = await owner('other');
  const platform = await hub.store.createMarketplacePlatform(seller.id, {
    slug: 'gated-identity', title: 'Gated identity', variant: 'shared-service',
  });
  assert.ok(platform.ok);
  const platformId = platform.value.id;
  const sellerPath = `/api/v1/teams/${seller.id}/marketplace/platforms/${platformId}`;
  const call = (path: string, token?: string, body?: object, method = body ? 'POST' : 'GET') => fetch(
    `http://127.0.0.1:${hub.server.address.port}${path}`, {
      method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  async function connect(teamId: string) {
    const id = randomUUID();
    const registry = randomBytes(32).toString('base64url');
    const code = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    assert.ok(await hub.store.issueMarketplaceEnrollment(teamId, id, hex(code), '2099-01-01T00:00:00Z'));
    assert.ok(await hub.store.redeemMarketplaceEnrollment(id, hex(code), hex(registry), now));
    return (action: string, input: object) => call(`/api/v1/marketplace/installations/${id}/${action}`, registry, input);
  }
  const buyerCall = await connect(buyer.id);
  const otherCall = await connect(other.id);
  const versions = ['1.0.0', '1.1.0', '1.2.0'];
  const selections = [];
  let unlistedPath = '';
  let firstRepo = '';
  let firstDigest = '';
  let firstBlob = Buffer.alloc(0);
  for (const version of versions) {
    const namespace = `releases/${platformId}/${version}`;
    const repo = namespace + '/identity';
    const response = await call(sellerPath + '/uploads', seller.token, { version });
    assert.equal(response.status, 200, await response.clone().text());
    const publisherGrant = MarketplaceArtifactGrantSchema.parse(await response.json());
    assert.equal(publisherGrant.namespace, namespace);
    const blob = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', version }));
    const digest = 'sha256:' + hex(blob);
    const root = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType,
      config: { mediaType: configType, size: blob.length, digest }, layers: [],
    }));
    const rootDigest = 'sha256:' + hex(root);
    const image = new URL(config.origin).host + '/' + repo + ':release@' + rootDigest;
    const body = {
      version, images: [image],
      bundle: { offer: version === '1.2.0' ? 'free' : 'maintenance', inventory: `
variables:
  - name: DATABASE_URL
    kind: reference
    secret: false
    service: keycloak
    database: identity-db
    output: DATABASE_URL
  - name: OIDC_CLIENT_SECRET
    kind: secret
    secret: true
    service: keycloak
    environments: [production]
  - name: UI_BRAND
    kind: value
    secret: false
    service: keycloak
    default: Identity
`, compose: `
name: identity
services:
  keycloak:
    image: ${image}
    expose: ["8080"]
x-platfolio:
  metadata:
    name: identity
    version: "${version}"
    title: Identity service
    summary: Test the gated container delivery path.
    kind: web
    mode: development
  resources:
    database: { name: identity-db, kind: postgres }
  environments:
    production: { enabled: true, branch: main }
    staging: { enabled: true, branch: staging }
    preview: { enabled: false }
` },
    };
    const manifestPath = `/v2/${repo}/manifests/${rootDigest}`;
    const blobPath = `/v2/${repo}/blobs/${digest}`;
    files.set(manifestPath, { content: root, type: mediaType });
    const missing = await call(sellerPath + '/bundles', seller.token, body);
    assert.equal(missing.status, 400, await missing.clone().text());
    files.set(blobPath, { content: blob, type: 'application/octet-stream' });
    assert.equal((await call(sellerPath + '/bundles', other.token, body)).status, 404);
    const invalid = { ...body, bundle: { ...body.bundle, inventory: body.bundle.inventory.replace('database: identity-db', 'database: missing') } };
    assert.equal((await call(sellerPath + '/bundles', seller.token, invalid)).status, 400);
    const inlineSecret = { ...body, bundle: { ...body.bundle, inventory: body.bundle.inventory.replace('secret: true', 'secret: true\n    default: fixture-forbidden') } };
    assert.equal((await call(sellerPath + '/bundles', seller.token, inlineSecret)).status, 400);
    const published = await call(sellerPath + '/bundles', seller.token, body);
    assert.equal(published.status, 200, await published.clone().text());
    const summary = await published.json() as { platformId: string; version: string; descriptorDigest: string; images: []; bundle?: unknown; source?: unknown };
    assert.deepEqual(summary.images, []);
    assert.equal(summary.bundle, undefined);
    assert.equal(summary.source, undefined);
    selections.push({ platformId, version, descriptorDigest: summary.descriptorDigest });
    const publishedNamespace = await fetch(config.origin + manifestPath, { headers: { authorization: registryAuthorization(publisherGrant) } });
    assert.equal(publishedNamespace.status, 200);
    if (version === '1.0.0') {
      firstRepo = repo;
      firstDigest = rootDigest;
      firstBlob = blob;
      unlistedPath = `/v2/${repo}/blobs/sha256:${hex('unpublished')}`;
      files.set(unlistedPath, { content: Buffer.from('unpublished'), type: 'application/octet-stream' });
    }
  }

  const [first, second, free] = selections;
  assert.ok(first && second && free);
  assert.equal((await call(sellerPath + '/maintenance', other.token, { buyerTeamId: buyer.id, through: '2099-01-01T00:00:00Z' }, 'PUT')).status, 404);
  assert.equal((await (await buyerCall('acquisitions', first)).json() as { error: string }).error, 'artifact-delivery-required');
  assert.equal((await buyerCall('bundle-acquisitions', first)).status, 409);
  assert.equal((await buyerCall('pulls', first)).status, 404);
  assert.equal((await call(sellerPath + '/maintenance', seller.token, { buyerTeamId: buyer.id, through: '2099-01-01T00:00:00Z' }, 'PUT')).status, 204);
  const acquired = MarketplaceAcquisitionReceiptSchema.parse(await (await buyerCall('bundle-acquisitions', first)).json());
  assert.equal(acquired.teamId, buyer.id);
  assert.ok(acquired.release.bundle);
  assert.equal(acquired.release.source, undefined);
  assert.equal((await call(sellerPath + '/maintenance', seller.token, { buyerTeamId: buyer.id, through: '2000-01-01T00:00:00Z' }, 'PUT')).status, 204);
  assert.deepEqual(await (await buyerCall('bundle-acquisitions', first)).json(), acquired);
  assert.equal((await buyerCall('bundle-acquisitions', second)).status, 409);
  assert.equal((await buyerCall('pulls', second)).status, 404);
  assert.equal((await otherCall('pulls', first)).status, 404);
  assert.equal((await otherCall('bundle-acquisitions', free)).status, 200);
  assert.equal((await otherCall('pulls', free)).status, 200);

  const pull = async () => MarketplaceArtifactGrantSchema.parse(await (await buyerCall('pulls', first)).json());
  const installed = await verifyMarketplaceInstall(
    { id: 'inst-gated', teamId: 'private-team', name: 'identity', provider: 'railway' }, acquired,
    async () => { assert.fail('Publisher Git must stay private'); }, undefined, pull,
  );
  const production = installed.plan?.environments.find(({ name }) => name === 'production')?.services[0];
  const staging = installed.plan?.environments.find(({ name }) => name === 'staging')?.services[0];
  assert.equal(production?.digest, firstDigest);
  assert.equal(staging?.digest, firstDigest);
  assert.deepEqual(production?.references, [{ variable: 'DATABASE_URL', database: 'identity-db', output: 'DATABASE_URL' }]);
  assert.deepEqual(staging?.references, production.references);
  assert.deepEqual(production.secrets, [{ name: 'OIDC_CLIENT_SECRET', source: 'preserve' }]);
  assert.deepEqual(staging?.secrets, []);
  assert.deepEqual(staging?.env, [{ name: 'UI_BRAND', literal: 'Identity' }]);
  const ticket = await pull();
  const headers = { authorization: registryAuthorization(ticket) };
  assert.equal((await fetch(`${config.origin}/v2/${firstRepo}/manifests/release`, { headers })).headers.get('content-type'), mediaType);
  assert.equal((await fetch(`${config.origin}${unlistedPath}`, { headers })).status, 404);
  assert.equal((await fetch(`${config.origin}/v2/releases/${platformId}/1.1.0/identity/manifests/release`, { headers })).status, 404);
  const bytes = await fetch(`${config.origin}/v2/${firstRepo}/blobs/sha256:${hex(firstBlob)}`, { headers });
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), firstBlob);
  assert.equal((await fetch(`${config.origin}/v2/${firstRepo}/manifests/release`, { method: 'PUT', headers })).status, 404);
  advanceClock = 16 * 60 * 1000;
  assert.equal((await fetch(`${config.origin}/v2/${firstRepo}/manifests/release`, { headers })).status, 401);
});
