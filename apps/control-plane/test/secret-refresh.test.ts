/**
 * `refresh` on secret delivery (D53 extended by the maintainer's request).
 *
 * The provider semantics are tested in `packages/contracts/test/railway-value-refresh.test.ts`. What matters at
 * this layer is that the CHOICE is expressible over HTTP, defaults to the old behaviour, is validated rather
 * than guessed at, and that its outcome lands in the audit row as a word and never as a value.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { CONTRACT_VERSION, createIdentityFixture, defaultIdentityConfig, reasonOf, signToken, type StoreResult } from '@platfolio/contracts';
import { loadSpec, type SpecDocument } from '@platfolio/api-contract';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const token = () => signToken(fixture, { scope: 'platfolio.user' });
const build = { version: '9.9.9', commit: 'b'.repeat(40), buildTime: '2026-11-15T00:00:00.000Z' };

function must<T>(r: StoreResult<T>, label: string): T {
  if (r.ok) return r.value;
  throw new Error(`${label} refused: ${reasonOf(r)}`);
}

/**
 * A delivered secret needs a registered plan to be declared in, because the handler refuses to choose a custody
 * location for a credential the platform description never named. So the fixture registers one that declares
 * APP_SESSION_KEY on the api service in production -- the same shape a real install writes.
 */
async function startApp() {
  // Short interval, like every other harness in this directory: the controller's timer is what keeps the
  // test process alive after the assertions finish, and a hung suite looks identical to a slow one.
  process.env.PLATFOLIO_RECONCILE_INTERVAL_MS = '120';
  const ctx = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 }, extensions: buildCapabilities({ build }),
    requiredServices: ['identity', 'server', 'store', 'extensions', 'infra'],
  });
  const teamId = must(await ctx.store.createTeam({ name: `sec-${Math.random().toString(36).slice(2, 7)}` }), 'createTeam').id;
  const person = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'user-conformance' }), 'resolvePerson');
  must(await ctx.store.putTeamMember({ teamId, personId: person.person.id, role: 'owner' }), 'putTeamMember');
  const instance = must(await ctx.store.createInstance({ teamId, name: 'creds', template: 'starter-web' }), 'createInstance');
  const planHash = 'c'.repeat(64);
  const plan = {
    // CONTRACT_VERSION, never a literal: D59 exists precisely because a hand-written version goes stale on the
  // next bump, and a fixture that pins one fails for a reason unrelated to what it is testing.
  instanceId: instance.id, teamId, provider: 'sample', contract: CONTRACT_VERSION, planHash,
    manifestRef: { template: 'starter-web', version: '0.1.0' },
    environments: [{
      name: 'production',
      databases: [], buckets: [], domains: [],
      services: [{
        name: 'api', image: 'ghcr.io/acme/api:1.0.0', digest: `sha256:${'d'.repeat(64)}`, port: 8080,
        healthPath: '/healthz', replicas: 1, limits: { cpu: 1, memoryMB: 512 },
        env: [{ name: 'NODE_ENV', literal: 'production' }],
        secrets: [{ name: 'APP_SESSION_KEY', source: 'preserve' as const }],
      }],
    }],
  };
  // (instanceId, plan, planHash) -- the third argument is the hash, and swapping them is a
  // `plan hash is not a bare 64-hex digest` refusal that looks like a store bug. Caught by reading the store
  // signature rather than guessing it, which is the cheaper order.
  must(await ctx.store.putPlan(instance.id, plan, planHash), 'putPlan');
  // The plan must also be APPLIED. `putSecretValue` on the fake refuses an instance it has never provisioned
  // (`no-instance` -> a 404 naming the instance), and delivery is a provider act on a real service, not a write
  // to a record. Registering a plan without applying it is the fixture mistake that made this look like a
  // handler bug.
  const applied = await ctx.infra.applyPlan(plan);
  if (applied.failures.length > 0) throw new Error(`setup apply failed: ${JSON.stringify(applied.failures)}`);
  const base = `http://127.0.0.1:${String(ctx.server.address.port)}`;
  const call = async (p: string, init: RequestInit = {}) => {
    const r = await fetch(base + p, init);
    const text = await r.text();
    let body: unknown; try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, body, text };
  };
  const asUser = () => ({ headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' } });
  return { ctx, call, asUser, instance };
}

const deliver = (app: Awaited<ReturnType<typeof startApp>>, body: Record<string, unknown>) =>
  app.call(`/api/v1/instances/${app.instance.id}/secrets/APP_SESSION_KEY`, { ...app.asUser(), method: 'PUT', body: JSON.stringify(body) });

test('refresh is a declared field of the delivery operation', () => {
  const doc = spec.paths['/api/v1/instances/{instanceId}/secrets/{name}'] as unknown as {
    put: { requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown>; required: string[] } } } } };
  };
  const schema = doc.put.requestBody.content['application/json'].schema;
  assert.ok('refresh' in schema.properties, 'the spec must be able to express the choice, or the handler has nowhere to read it from');
  assert.ok(!schema.required.includes('refresh'), 'refresh is optional: omitting it means the behaviour every caller had before it existed');
});

test('a delivery with refresh:"auto" is accepted and records the outcome as a word', async () => {
  const app = await startApp();
  try {
    const response = await deliver(app, { service: 'api', environment: 'production', value: 'a-real-session-key-value', refresh: 'auto' });
    assert.equal(response.status, 204, `delivery failed: ${response.text.slice(0, 240)}`);
    const audit = await app.ctx.store.recentAudit(10);
    const entry = audit.find((a) => a.action === 'secret.deliver');
    assert.ok(entry, 'the delivery must be audited');
    const detail = entry!.detail as Record<string, unknown>;
    assert.ok(['redeployed', 'unchanged', 'unknown'].includes(String(detail.refresh)), `refresh recorded as ${String(detail.refresh)}; the answer must be one of the three observed states`);
    // D4, the assertion that matters most here: the audit row carries the outcome WORD, not the credential and
    // not a digest of it.
    const serialised = JSON.stringify(detail);
    assert.ok(!serialised.includes('a-real-session-key-value'), `the audit row leaked the delivered credential: ${serialised.slice(0, 160)}`);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('omitting refresh keeps the old behaviour, which is the point of a default', async () => {
  const app = await startApp();
  try {
    const response = await deliver(app, { service: 'api', environment: 'production', value: 'another-real-value' });
    assert.equal(response.status, 204, response.text.slice(0, 200));
    const audit = await app.ctx.store.recentAudit(10);
    const detail = audit.find((a) => a.action === 'secret.deliver')!.detail as Record<string, unknown>;
    assert.equal(detail.refresh, undefined, 'a suppressed delivery must not claim a refresh outcome it did not ask for');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('an unrecognised refresh value is refused rather than defaulted', async () => {
  // "yes"/"true"/"restart" arriving at the default silently is how a restart that never happened gets reported
  // as one that did, three layers away.
  const app = await startApp();
  try {
    const response = await deliver(app, { service: 'api', environment: 'production', value: 'v-with-a-fake-secret', refresh: 'immediately' });
    assert.equal(response.status, 400, `expected 400, got ${String(response.status)}: ${response.text.slice(0, 200)}`);
    assert.match(JSON.stringify(response.body), /refresh/);
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('the delivery still answers 204 with no body, with or without the option (D4)', async () => {
  const app = await startApp();
  try {
    for (const refresh of [undefined, 'auto', 'suppress']) {
      const response = await deliver(app, { service: 'api', environment: 'production', value: `value-${String(refresh)}`, ...(refresh === undefined ? {} : { refresh }) });
      assert.equal(response.status, 204);
      assert.equal(response.text, '', `a body would be an echo, and an echo of a delivery is a leak vector: ${response.text.slice(0, 80)}`);
    }
  } finally {
    await disposeKernel(app.ctx);
  }
});
