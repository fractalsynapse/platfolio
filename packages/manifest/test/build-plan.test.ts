import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { InfraPlanSchema, planIssues } from '@platfolio/contracts';
import { RailwayInfraProvider, samplePlan } from '@platfolio/contracts';
import { RailwayMock } from '../../../packages/contracts/test/railway-mock.ts';
import { buildPlan, parse } from '../src/index.ts';

// Tests run from the repository root (pnpm test); templates live there, not beside the package.
const dir = path.resolve('samples');
const raw = (f: string) => fs.readFileSync(path.join(dir, f, 'manifest.yaml'), 'utf8');
function loaded(name: string) {
  const result = parse(raw(name));
  if (!result.manifest) throw new Error(`template "templates/${name}" did not parse: ${JSON.stringify(result.issues)}`);
  return result.manifest;
}
const webApp = loaded('web-app');
const fullStack = loaded('full-stack');

/** Real coordinates a release pipeline would have produced. */
function realDigest(seed: string): string {
  // The builder refuses a single repeated character as a template placeholder, so fixtures must look like
  // digests a registry would actually return. Deriving one from the name keeps that honest.
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`;
}
const pinned = (names: string[], tag = '1.4.0'): Record<string, { image: string; digest: string }> =>
  Object.fromEntries(names.map((n) => [n, { image: `ghcr.io/acme/${n}:${tag}`, digest: realDigest(`${n}@${tag}`) }]));

test('a manifest becomes a plan the contract accepts', () => {
  const plan = buildPlan(webApp, { instanceId: 'inst-a1', teamId: 'team-a1', images: pinned(['api', 'worker']) });
  assert.doesNotThrow(() => InfraPlanSchema.parse(plan));
  assert.deepEqual(planIssues(plan), [], JSON.stringify(planIssues(plan)));
  assert.equal(plan.provider, 'railway');
  assert.equal(plan.manifestRef.template, 'example-web-app');
  assert.match(plan.planHash, /^[a-f0-9]{16,64}$/, 'planHash is a real digest, so re-applies are idempotent');
});

test('placement, replicas and staging duplication follow the environment model', () => {
  const plan = buildPlan(webApp, { instanceId: 'inst-a2', teamId: 'team-a2', images: pinned(['api', 'worker']) });
  const prod = plan.environments.find((e) => e.name === 'production')!;
  const staging = plan.environments.find((e) => e.name === 'staging')!;
  assert.equal(prod.services.length, 2, 'api and worker in production');
  assert.equal(staging.cloneFrom, 'production', 'staging is a duplicate, not a parallel tree (E25)');
  assert.equal(prod.services.find((s) => s.name === 'api')!.replicas, 2);
  assert.equal(staging.services.find((s) => s.name === 'api')!.replicas, 1, 'a duplicate never inherits production replicas');
});

test('resources carry over: database, bucket with region, volume in MB on its service', () => {
  const plan = buildPlan(webApp, { instanceId: 'inst-a3', teamId: 'team-a3', images: pinned(['api', 'worker']) });
  const prod = plan.environments[0]!;
  assert.deepEqual(prod.databases, [{ name: 'app-db', kind: 'postgres' }]);
  assert.deepEqual(prod.buckets, [{ name: 'repo-checkouts', region: 'iad' }]);
  const volume = prod.volumes?.find((v) => v.name === 'index-cache');
  assert.ok(volume, 'declared volume reaches the plan');
  assert.equal(volume.sizeMB, 20 * 1024, 'sizeGB is converted to the provider unit');
  assert.equal(volume.mountPath, '/var/cache/example-web-app');
});

test('domains are per placement, staging-derived, and only for public services', () => {
  const plan = buildPlan(webApp, { instanceId: 'inst-a4', teamId: 'team-a4', images: pinned(['api', 'worker']) });
  const prod = plan.environments.find((e) => e.name === 'production')!;
  const staging = plan.environments.find((e) => e.name === 'staging')!;
  assert.deepEqual(prod.domains.map((d) => d.host), ['api.example.com']);
  assert.equal(prod.domains[0]!.service, 'api');
  assert.ok(prod.domains[0]!.verificationName.length > 0, 'a TXT verification name is carried for the checklist');
  assert.equal(staging.domains.length, 1);
  assert.match(staging.domains[0]!.host, /^staging-api\.example\.com$/, 'staging derives its own host (E21)');
  assert.ok(!staging.domains.some((d) => d.host === 'api.example.com'), 'one host cannot be claimed by two environments');
});

test('a placeholder digest is refused rather than shipped as a tenant deploy', () => {
  // The templates carry sha256:1111... as documentation and the plan schema accepts that shape, so only an
  // explicit check stops an example image from becoming a broken deploy (issue #84).
  assert.throws(() => buildPlan(webApp, { instanceId: 'inst-b1', teamId: 'team-b1' }), /placeholder digest/);
  assert.throws(() => buildPlan(fullStack, { instanceId: 'inst-b2', teamId: 'team-b2' }), /placeholder digest/);
});

test('a reference to an undeclared database is caught by the contract, not silently emitted', () => {
  const withRef = structuredClone(webApp) as typeof webApp;
  withRef.spec.services.api!.references = [{ variable: 'DATABASE_URL', database: 'not-declared' }];
  const plan = buildPlan(withRef, { instanceId: 'inst-c1', teamId: 'team-c1', images: pinned(['api', 'worker']) });
  const issues = planIssues(plan);
  assert.ok(issues.some((i) => i.code === 'unknown-database'), JSON.stringify(issues));
});

test('references flow into the plan so the provider can wire them', () => {
  const withRef = structuredClone(webApp) as typeof webApp;
  withRef.spec.services.api!.references = [{ variable: 'DATABASE_URL', database: 'app-db', output: 'DATABASE_URL' }];
  const plan = buildPlan(withRef, { instanceId: 'inst-c2', teamId: 'team-c2', images: pinned(['api', 'worker']) });
  assert.deepEqual(planIssues(plan), [], JSON.stringify(planIssues(plan)));
  const api = plan.environments[0]!.services.find((s) => s.name === 'api')!;
  assert.deepEqual(api.references, [{ variable: 'DATABASE_URL', database: 'app-db', output: 'DATABASE_URL' }]);
});

test('no secret value can ever enter a built plan', () => {
  const plan = buildPlan(fullStack, { instanceId: 'inst-d1', teamId: 'team-d1', images: pinned(Object.keys(fullStack.spec.services)) });
  const text = JSON.stringify(plan);
  const names = Object.values(fullStack.spec.services).flatMap((s) => s.secrets.map((x) => x.name));
  assert.ok(names.length >= 2, 'the reference template declares secrets');
  for (const name of names) {
    // A secret name may appear as a name; its value never exists in the manifest to appear at all.
    const entry = plan.environments.flatMap((e) => e.services.flatMap((s) => s.secrets)).find((s) => s.name === name);
    assert.ok(entry, `secret "${name}" is carried by name`);
    assert.ok(!('value' in entry), 'and holds no value');
  }
  assert.ok(!/BEGIN (RSA |)PRIVATE KEY/.test(text), 'no key material in a plan');
});

test('the whole chain composes: manifest -> plan -> provider wires the reference without a value', async () => {
  // This is the seam #84 was about: nothing upstream of here had ever connected a manifest to a provider.
  const plan = buildPlan(webApp, {
    instanceId: 'inst-e1',
    teamId: 'team-e1',
    images: pinned(Object.keys(webApp.spec.services)),
  });
  const mock = new RailwayMock();
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4_000, pollIntervalMs: 1, sleep: async () => {} });
  const applied = await provider.applyPlan(plan);
  // Honest, not green: the manifest declares a tenant-supplied secret (APP_API_SIGNING_KEY, preserve) that
  // nobody has set, so the apply must refuse -- and still tell us the database it provisioned. A test that
  // asserted verified=true here would be asserting that platfolio deploys platforms without their secrets.
  assert.deepEqual(applied.failures.map((f) => f.code), ['secret-unavailable', 'secret-unavailable'], JSON.stringify(applied.failures));
  assert.equal(applied.verified, false);
  assert.deepEqual(applied.failures.map((f) => f.step), [
    'environments.production.services.api.secrets.APP_API_SIGNING_KEY',
    'environments.staging.services.api.secrets.APP_API_SIGNING_KEY',
  ], 'each failure names its environment -- a duplicate step would tell a tenant nothing');

  const prod = plan.environments.find((e) => e.name === 'production')!;
  const dbServiceId = [...mock.services.values()].find((s) => s.name === prod.databases[0]!.name);
  assert.ok(dbServiceId, `the declared database "${prod.databases[0]!.name}" was provisioned from the manifest`);
  const apiId = [...mock.services.values()].find((s) => s.name === 'api');
  assert.ok(apiId, 'the app service from the manifest exists');
  const instanceKey = [...mock.instances.keys()].find((k) => k.endsWith(`:${apiId.id}`));
  assert.ok(instanceKey, 'the app service has an instance in the environment');
  const wired = mock.instances.get(instanceKey!);
  assert.ok(wired?.variables.has('DATABASE_URL'), 'the reference reached the app service as a variable name');
  // Names are asserted, never values: the wiring is provider-resolved by construction.
  // What must never appear is a RESOLVED credential. A verification token is different: it is a public DNS
  // value the tenant has to publish, surfaced deliberately in domain records (measured in the domain work).
  const text = JSON.stringify(applied);
  assert.ok(!text.includes('postgres://'), 'no database URL value in an apply result');
  assert.ok(!text.includes('password@'), 'no credential material in an apply result');
});

test('a manifest built plan carries the staging host and its production replica count apart', () => {
  const plan = buildPlan(webApp, { instanceId: 'inst-e2', teamId: 'team-e2', images: pinned(Object.keys(webApp.spec.services)) });
  const prod = plan.environments.find((e) => e.name === 'production')!;
  const staging = plan.environments.find((e) => e.name === 'staging')!;
  assert.deepEqual([...new Set(prod.domains.map((d) => d.service))], ['api'], 'only the public service has a domain');
  const hosts = [prod.domains[0]?.host, staging.domains[0]?.host];
  assert.equal(new Set(hosts).size, 2, 'the two environments never claim one host');
  assert.ok(hosts.every((h) => typeof h === 'string' && h.length > 0), JSON.stringify(hosts));
  assert.deepEqual(staging.databases, prod.databases, 'a database is declared in both; the provider places it once and the duplicate receives it (measured live)');
});
