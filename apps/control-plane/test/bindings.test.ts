import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { createIdentityFixture, defaultIdentityConfig, reasonOf, signToken, type StoreResult } from '@platfolio/contracts';
import { loadSpec, validateResponse, type SpecDocument } from '@platfolio/api-contract';
import { SHARED_IDENTITY_RELEASE, templateCatalogEntry } from '@platfolio/manifest';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const token = (subject: string) => signToken(fixture, { scope: 'platfolio.user', subject });
const build = { version: '9.9.9', commit: 'a'.repeat(40), buildTime: '2026-11-11T00:00:00.000Z' };

function must<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

async function start() {
  const ctx = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    ...(process.env.PLATFOLIO_LIVE_GIT === '1' ? { scm: { driver: 'git' as const } } : {}),
    extensions: buildCapabilities({ build }), requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const base = () => `http://127.0.0.1:${String(ctx.server.address.port)}`;
  const call = async (p: string, init: RequestInit = {}, subject = 'user-conformance') => {
    const response = await fetch(base() + p, { ...init, headers: { authorization: `Bearer ${token(subject)}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const text = await response.text();
    let body: unknown;
    try { body = response.status === 204 ? undefined : JSON.parse(text) as unknown; } catch { body = text; }
    return { status: response.status, body, text };
  };
  const againstSpec = (operationId: string, status: number, body: unknown) => {
    const check = validateResponse(spec, operationId, status, body);
    assert.ok(check.ok, `${operationId} ${String(status)} violates the spec: ${check.errors.join('; ')}\nbody: ${JSON.stringify(body).slice(0, 240)}`);
  };
  /** A team, its owner subject, and one instance in it. */
  const teamWithInstance = async (c: KernelContext, name: string, template: string) => {
    const team = must(await c.store.createTeam({ name }), 'createTeam');
    return { teamId: team.id, instance: must(await c.store.createInstance({ teamId: team.id, name: `${name}-app`, template }), 'createInstance') };
  };
  return { ctx, call, againstSpec, teamWithInstance };
}

test('the binding route table is declared and matches the document', () => {
  const routes = buildCapabilities({ build }).filter(({ id }) => id === 'bindings' || id === 'shared-identity-binding')
    .flatMap(({ routes }) => routes ?? []);
  assert.equal(routes.length, 10);
  for (const { method, path, operationId } of routes) assert.equal(spec.paths?.[path]?.[method.toLowerCase()]?.operationId, operationId);
});

test('in-team sharing works, and both sides can see the dependency', async () => {
  const app = await start();
  try {
    const provider = must(await app.ctx.store.createTeam({ name: 'platforms' }), 'team');
    const idp = must(await app.ctx.store.createInstance({ teamId: provider.id, name: 'idp', template: 'shared-identity' }), 'idp');
    const web = must(await app.ctx.store.createInstance({ teamId: provider.id, name: 'shop', template: 'starter-web' }), 'web');
    const owner = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'resolvePerson');
    must(await app.ctx.store.putTeamMember({ teamId: provider.id, personId: owner.person.id, role: 'owner' }), 'member');

    const published = await app.call(`/api/v1/instances/${idp.id}/capability`, { method: 'POST', body: JSON.stringify({ capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }, { output: 'client_secret', kind: 'secret' }] }) });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    app.againstSpec('publishCapability', 200, published.body);

    const available = await app.call('/api/v1/capabilities?capability=identity');
    app.againstSpec('listAvailableCapabilities', 200, available.body);
    assert.equal((available.body as unknown[]).length, 1, 'an own-team offer must be discoverable in-team');

    const bound = await app.call(`/api/v1/instances/${web.id}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: idp.id, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }] }) });
    assert.equal(bound.status, 200, JSON.stringify(bound.body));
    app.againstSpec('bindCapability', 200, bound.body);

    const consumers = await app.call(`/api/v1/instances/${idp.id}/consumers`);
    app.againstSpec('listConsumers', 200, consumers.body);
    const listed = consumers.body as Array<{ consumerInstanceId: string; capability: string }>;
    assert.equal(listed.length, 1, 'the provider side must answer "what depends on me" -- the question #176 exists to serve');
    assert.equal(listed[0]?.consumerInstanceId, web.id);

    const mine = await app.call(`/api/v1/instances/${web.id}/bindings`);
    app.againstSpec('listBindings', 200, mine.body);
    assert.equal((mine.body as Array<{ state: string }>)[0]?.state, 'bound');

    const unbound = await app.call(`/api/v1/instances/${web.id}/bindings/identity`, { method: 'DELETE' });
    assert.equal(unbound.status, 204, `204 expected, got ${String(unbound.status)} ${unbound.text.slice(0, 80)}`);
    assert.equal(unbound.text, '', 'a 204 with a body is a lie the client has to special-case');
    const gone = await app.call(`/api/v1/instances/${web.id}/bindings/identity`, { method: 'DELETE' });
    assert.equal(gone.status, 404);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('a cross-team bind needs a live share, and the refusal names the gate rather than leaking a record', async () => {
  const app = await start();
  try {
    // Two different principals own the two teams. With one user on both, "discoverable" and "not
    // discoverable" would describe the same row -- the first version of this test asserted a leak that was
    // correct behaviour seen from a team the caller also belongs to.
    const providerTeam = await app.teamWithInstance(app.ctx, 'identity-owners', 'shared-identity');
    const consumerTeam = await app.teamWithInstance(app.ctx, 'consumers', 'starter-web');
    const ownerA = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'team-a-owner' }), 'person A');
    const ownerB = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'person B');
    must(await app.ctx.store.putTeamMember({ teamId: providerTeam.teamId, personId: ownerA.person.id, role: 'owner' }), 'member A');
    must(await app.ctx.store.putTeamMember({ teamId: consumerTeam.teamId, personId: ownerB.person.id, role: 'owner' }), 'member B');
    must(await app.ctx.store.publishCapability({ instanceId: providerTeam.instance.id, teamId: providerTeam.teamId, capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }), 'publish');

    const refused = await app.call(`/api/v1/instances/${consumerTeam.instance.id}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: providerTeam.instance.id, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }] }) });
    assert.equal(refused.status, 400, 'a cross-team bind without a share must not succeed');
    assert.match(JSON.stringify(refused.body), /has not shared/, `the refusal should name the missing grant, got ${JSON.stringify(refused.body)}`);
    app.againstSpec('bindCapability', 400, refused.body);

    const notDiscoverable = await app.call('/api/v1/capabilities?capability=identity');
    assert.equal((notDiscoverable.body as unknown[]).length, 0, 'an offer never shared to this team must not appear in its discovery');

    const shared = await app.call(`/api/v1/instances/${providerTeam.instance.id}/capability/identity/shares`, { method: 'PUT', body: JSON.stringify({ toTeamId: consumerTeam.teamId }) }, 'team-a-owner');
    app.againstSpec('shareCapability', 200, shared.body);
    const discoverable = await app.call('/api/v1/capabilities?capability=identity');
    assert.equal((discoverable.body as unknown[]).length, 1, 'a shared offer should be discoverable by the target team');

    const bound = await app.call(`/api/v1/instances/${consumerTeam.instance.id}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: providerTeam.instance.id, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }] }) });
    assert.equal(bound.status, 200, JSON.stringify(bound.body));

    // Revoke ages rather than deletes (D42): the app keeps working, the intent is withdrawn.
    const revoked = await app.call(`/api/v1/instances/${providerTeam.instance.id}/capability/identity/shares/${consumerTeam.teamId}`, { method: 'DELETE' }, 'team-a-owner');
    app.againstSpec('revokeCapabilityShare', 200, revoked.body);
    const stale = await app.call(`/api/v1/instances/${consumerTeam.instance.id}/bindings`);
    const rows = stale.body as Array<{ state: string }>;
    assert.equal(rows.length, 1, 'revoking a share must not delete the binding record');
    assert.equal(rows[0]?.state, 'stale', 'the dependency stays visible: an invisible binding is the failure #176 exists to prevent');
    const afterRevoke = await app.call('/api/v1/capabilities?capability=identity');
    assert.equal((afterRevoke.body as unknown[]).length, 0, 'a revoked offer should withdraw from discovery');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('binding is refused when the destinations cannot be filled, and self-binding is refused', async () => {
  const app = await start();
  try {
    const team = await app.teamWithInstance(app.ctx, 'solo', 'shared-identity');
    const owner = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'resolvePerson');
    must(await app.ctx.store.putTeamMember({ teamId: team.teamId, personId: owner.person.id, role: 'owner' }), 'member');
    must(await app.ctx.store.publishCapability({ instanceId: team.instance.id, teamId: team.teamId, capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }), 'publish');

    const self = await app.call(`/api/v1/instances/${team.instance.id}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: team.instance.id, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }] }) });
    assert.equal(self.status, 400, 'an instance must not bind to its own capability');
    assert.match(JSON.stringify(self.body), /cannot bind to a capability it provides/);

    // A second instance in the same team, so this exercises the destination check rather than tripping the
    // self-binding guard again -- the mistake in the first version of this test.
    const consumer = must(await app.ctx.store.createInstance({ teamId: team.teamId, name: 'shop', template: 'starter-web' }), 'consumer');
    const missing = await app.call(`/api/v1/instances/${consumer.id}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: team.instance.id, destinations: [{ output: 'client_secret', into: ['OIDC_CLIENT_SECRET'] }] }) });
    assert.equal(missing.status, 400, 'binding an output the provider does not publish is a broken promise, not a partial success');
    assert.match(JSON.stringify(missing.body), /does not offer: client_secret/);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('binding routes honour team scope: an outsider gets 404 and learns nothing', async () => {
  const app = await start();
  try {
    const insider = await app.teamWithInstance(app.ctx, 'insiders', 'shared-identity');
    const insiderOwner = must(await app.ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'resolvePerson');
    must(await app.ctx.store.putTeamMember({ teamId: insider.teamId, personId: insiderOwner.person.id, role: 'owner' }), 'member');
    // A second user in no team at all.
    const outsider = 'user-alone';
    const paths: Array<[string, string, RequestInit]> = [
      ['GET', `/api/v1/instances/${insider.instance.id}/bindings`, {}],
      ['GET', `/api/v1/instances/${insider.instance.id}/consumers`, {}],
      ['POST', `/api/v1/instances/${insider.instance.id}/capability`, { method: 'POST', body: JSON.stringify({ capability: 'identity', outputs: [] }) }],
      ['PUT', `/api/v1/instances/${insider.instance.id}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: insider.instance.id, destinations: [] }) }],
    ];
    for (const [method, p, init] of paths) {
      const r = await app.call(p, { ...init, method }, outsider);
      assert.equal(r.status, 404, `${method} ${p} answered ${String(r.status)} to a caller with no membership`);
      assert.ok(!JSON.stringify(r.body).includes(insider.instance.id), `${method} ${p} echoed the foreign instance id`);
    }
    // Two different refusals, and they must not be conflated: no credentials at all is 401 (you do not know
    // who you are), credentials with no membership is 404 (you know who you are and there is nothing to see).
    const noAuth = await (async () => {
      const response = await fetch(`http://127.0.0.1:${String(app.ctx.server.address.port)}/api/v1/instances/${insider.instance.id}/capability/identity/shares`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ toTeamId: 'team-x' }) });
      return { status: response.status };
    })();
    assert.equal(noAuth.status, 401, 'an unauthenticated write must be refused as unauthenticated');
    const noMembership = await app.call(`/api/v1/instances/${insider.instance.id}/capability/identity/shares`, { method: 'PUT', body: JSON.stringify({ toTeamId: 'team-x' }) }, 'user-alone');
    assert.equal(noMembership.status, 404, 'a member of no team must not be told the instance exists');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('Shared Identity publishes the pinned contract and records a credential-free local dependency', async (t) => {
  const app = await start();
  t.after(() => disposeKernel(app.ctx));
  const { store, scm } = app.ctx;
  const release = SHARED_IDENTITY_RELEASE;
  const template = templateCatalogEntry(release.template);
  const owner = must(await store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'owner');
  const team = must(await store.createTeam({ name: 'private-workspace' }), 'team');
  must(await store.putTeamMember({ teamId: team.id, personId: owner.person.id, role: 'owner' }), 'membership');
  const source = { repo: template.repo, commitSha: release.revision };
  const provider = must(await store.createInstance({ teamId: team.id, name: 'shared-identity', template: release.template, templateRef: source, provider: 'fake' }), 'provider');
  const consumer = must(await store.createInstance({ teamId: team.id, name: 'starter-web', template: 'starter-web' }), 'consumer');
  const otherTeam = must(await store.createTeam({ name: 'other-workspace' }), 'other team');
  const otherProvider = must(await store.createInstance({ teamId: otherTeam.id, name: 'shared-identity', template: release.template, templateRef: source }), 'foreign provider');

  const compose = `
name: shared-identity
services:
  keycloak:
    image: ${release.image.split('@')[0]}
    command: ["start"]
    expose: ["8080"]
    x-platfolio: { public: true }
x-platfolio:
  metadata:
    name: shared-identity
    version: "${release.version}"
    title: Shared Identity
    summary: An application identity provider.
    kind: web
    mode: hosted
  provides:
    name: identity
    outputs:
      - { output: issuer, kind: url }
      - { output: jwks_uri, kind: url }
      - { output: client_id, kind: value }
      - { output: client_secret, kind: secret }
  resources:
    database: { name: keycloak-db, kind: postgres }
  environments:
    production: { enabled: true, branch: main }
    staging: { enabled: false }
    preview: { enabled: false }
`;
  const inventory = `
variables:
  - { name: KC_BOOTSTRAP_ADMIN_PASSWORD, kind: secret, secret: true, service: keycloak, environments: all }
`;
  if (process.env.PLATFOLIO_LIVE_GIT !== '1') {
    t.mock.method(scm, 'readFile', async (file: Parameters<typeof scm.readFile>[0]) => {
      assert.deepEqual({ repo: file.repo, commitSha: file.ref }, source);
      const content = file.path === 'compose.yaml' ? compose : inventory;
      return { path: file.path, sha: 'b'.repeat(40), size: Buffer.byteLength(content), content };
    });
  }

  const providerPath = '/api/v1/instances/' + provider.id;
  const offerPath = providerPath + '/capability/identity';
  const intentPath = '/api/v1/instances/' + consumer.id + '/bindings/identity/intent';
  const publicClient = { providerInstanceId: provider.id, clientType: 'public' };
  const request = (input: object) => app.call(intentPath, { method: 'PUT', body: JSON.stringify(input) });
  const denied = await request({ ...publicClient, providerInstanceId: otherProvider.id });
  assert.equal(denied.status, 404);
  assert.ok(!denied.text.includes(otherProvider.id));
  assert.equal((await app.call(offerPath, { method: 'PUT' }, 'outsider')).status, 404);
  assert.equal((await app.call(offerPath, { method: 'PUT', headers: { authorization: '' } })).status, 401);
  assert.equal((await request(publicClient)).status, 409);

  const offer = await app.call(offerPath, { method: 'PUT' });
  assert.equal(offer.status, 200, offer.text);
  app.againstSpec('publishSharedIdentityCapability', 200, offer.body);
  const offerRecord = must(await store.getCapabilityOffer(provider.id, 'identity'), 'recorded offer');
  assert.equal(offerRecord.outputs.length, 4);
  assert.ok(offerRecord.outputs.every((output) => output.state === 'not-issued'));
  const incomplete = offerRecord.outputs.filter(({ output }) => output !== 'client_id');
  must(await store.publishCapability({ ...offerRecord, outputs: incomplete }), 'publish an incomplete manual offer');
  assert.equal((await request(publicClient)).status, 409);
  assert.equal((await app.call(offerPath, { method: 'PUT' })).status, 409);
  assert.deepEqual(must(await store.getCapabilityOffer(provider.id, 'identity'), 'retained manual offer').outputs, incomplete);
  const placedOutputs = offerRecord.outputs.map((output) => ({ ...output, state: 'issued-and-placed' as const }));
  must(await store.publishCapability({ ...offerRecord, outputs: placedOutputs }), 'record placement');
  const retained = await app.call(offerPath, { method: 'PUT' });
  assert.equal(retained.status, 200, retained.text);
  assert.deepEqual((retained.body as typeof offerRecord).outputs, placedOutputs);

  const secret = 'binding-credential-must-never-be-reflected';
  const rejected = await request({ ...publicClient, clientSecret: secret });
  assert.equal(rejected.status, 400);
  assert.ok(!rejected.text.includes(secret));
  const first = await request(publicClient);
  assert.equal(first.status, 200, first.text);
  app.againstSpec('bindSharedIdentity', 200, first.body);
  const binding = must(await store.getBinding(consumer.id, 'identity'), 'recorded binding');
  assert.deepEqual(binding.destinations, [
    { output: 'issuer', into: ['OIDC_ISSUER'] },
    { output: 'jwks_uri', into: ['OIDC_JWKS_URI'] },
    { output: 'client_id', into: ['OIDC_CLIENT_ID'] },
  ]);
  const retry = await request(publicClient);
  assert.equal(retry.status, 200, retry.text);
  assert.deepEqual(retry.body, first.body);
  assert.equal((await request({ ...publicClient, clientType: 'confidential' })).status, 409);
  assert.equal((await store.listConsumers(provider.id)).length, 1);
  assert.equal((await app.call(providerPath, { method: 'DELETE' })).status, 409);
  assert.equal((await app.call(providerPath + '/hosting/removal', { method: 'POST', body: JSON.stringify({ data: 'keep' }) })).status, 409);
  assert.equal((await store.getInstance(provider.id)).ok, true);

  const removed = await app.call(intentPath.replace(/\/intent$/, ''), { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.equal((await store.listConsumers(provider.id)).length, 0);
  assert.equal((await request({ ...publicClient, clientType: 'confidential' })).status, 200);
  const confidential = must(await store.getBinding(consumer.id, 'identity'), 'confidential binding');
  assert.deepEqual(confidential.destinations.at(-1), { output: 'client_secret', into: ['OIDC_CLIENT_SECRET'] });
  const audit = await store.recentAudit();
  assert.ok(audit.some((entry) => entry.action === 'capability.bind' && entry.target === consumer.id));
  assert.ok(!JSON.stringify(audit).includes(secret));
});
