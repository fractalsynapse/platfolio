import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { EnvironmentPlanSchema, InfraPlanSchema, planIssues } from '@platfolio/contracts';
import { RailwayInfraProvider } from '@platfolio/contracts';
import { RailwayMock } from '../../../packages/contracts/test/railway-mock.ts';
import { buildPlan, parse, validateManifest } from '../src/index.ts';

// Tests run from the repository root (pnpm test); the fixtures live under this package's test tree, and they are
// fixtures -- not the published templates, which are repositories read through the source-control seam
// (packages/manifest/test/templates.test.ts).
const dir = path.resolve('packages/manifest/test/fixtures');
const raw = (f: string) => fs.readFileSync(path.join(dir, f + '-manifest.yaml'), 'utf8');
function loaded(name: string) {
  const result = parse(raw(name));
  if (!result.manifest) throw new Error(`fixture "packages/manifest/test/fixtures/${name}-manifest.yaml" did not parse: ${JSON.stringify(result.issues)}`);
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

test('placement and replicas follow the environment model, and no environment is declared as a copy of another', () => {
  const plan = buildPlan(webApp, { instanceId: 'inst-a2', teamId: 'team-a2', images: pinned(['api', 'worker']) });
  const prod = plan.environments.find((e) => e.name === 'production')!;
  const staging = plan.environments.find((e) => e.name === 'staging')!;
  assert.equal(prod.services.length, 2, 'api and worker in production');
  assert.equal(staging.services.length, 2, 'staging declares the services IT runs -- declared, not derived from production');
  assert.equal('cloneFrom' in staging, false, 'a built plan carries no clone source (D57)');
  // The assertion above alone is VACUOUS, and measuring it said so: re-emitting `cloneFrom` in the builder
  // changed nothing, because zod strips a key the schema does not declare. So the load-bearing check is on the
  // contract -- if the field comes back to the schema, a builder that emits it stops being a bug and becomes a
  // mechanism, which is exactly how staging got production's database in the first place.
  const environmentShape = (EnvironmentPlanSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.equal('cloneFrom' in environmentShape, false, 'the environment schema has no clone source to emit or honour (D57)');
  // And the consequence of stripping rather than rejecting is stated where it can be checked: an old plan
  // document carrying `cloneFrom` parses to a plan that has none, so the provider cannot act on it.
  const stale = InfraPlanSchema.safeParse({ ...plan, environments: [{ ...staging, cloneFrom: 'production' }, prod] });
  assert.equal(stale.success, true, 'a pre-D57 document still parses');
  assert.equal(stale.success && 'cloneFrom' in stale.data.environments[0]!, false, 'and arrives without the field');
  assert.equal(prod.services.find((s) => s.name === 'api')!.replicas, 2);
  assert.equal(staging.services.find((s) => s.name === 'api')!.replicas, 1, 'staging never inherits production’s replica count (D23)');
});

test('planHash describes the plan the provider receives, not the builder’s intermediate object (D57)', () => {
  // Why this belongs to a change that deleted a plan field: the hash is taken over the environments the builder
  // assembled and is then handed to a provider that receives the PARSED plan. A field the schema does not
  // declare -- `cloneFrom` until now, anything like it later -- would move the hash while changing nothing the
  // provider can see, which is an idempotency marker that disagrees with its own plan.
  const plan = buildPlan(webApp, { instanceId: 'inst-hash', teamId: 'team-hash', images: pinned(Object.keys(webApp.spec.services)) });
  const recomputed = createHash('sha256')
    .update(JSON.stringify({ platform: webApp.metadata.name, version: webApp.metadata.version, environments: plan.environments }))
    .digest('hex');
  assert.equal(plan.planHash, recomputed, 'the hash and the parsed plan agree -- an undeclarable field cannot ride in one and not the other');
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

  // The PLAN still carries the logical names -- that is the point of the deterministic rule -- but the
  // PROJECT holds `{name}-{environment}` for every environment, production included (D57).
  const prod = plan.environments.find((e) => e.name === 'production')!;
  const dbServiceId = [...mock.services.values()].find((s) => s.name === `${prod.databases[0]!.name}-production`);
  assert.ok(dbServiceId, `the declared database "${prod.databases[0]!.name}-production" was provisioned from the manifest`);
  const apiId = [...mock.services.values()].find((s) => s.name === 'api-production');
  assert.ok(apiId, 'the app service from the manifest exists');
  const instanceKey = [...mock.instances.keys()].find((k) => k.endsWith(`:${apiId.id}`));
  assert.ok(instanceKey, 'the app service has an instance in the environment');
  const wired = mock.instances.get(instanceKey!);
  assert.ok(wired?.variables.has('DATABASE_URL'), 'the reference reached the app service as a variable name');

  // ...and the other environment got its OWN pair of them. This is the property the manifest->provider chain
  // used to fail: staging declared the same names, the project could hold each name only once, and what staging
  // actually received was production's database (D57).
  const stagingDb = [...mock.services.values()].find((s) => s.name === 'app-db-staging');
  assert.ok(stagingDb, 'staging’s database was provisioned as its own service');
  assert.notEqual(stagingDb.id, dbServiceId.id, 'two environments, two databases');
  const stagingApi = [...mock.services.values()].find((s) => s.name === 'api-staging');
  assert.ok(stagingApi, 'staging’s app service is its own too');
  assert.notEqual(stagingApi.id, apiId.id);
  assert.deepEqual(
    [...new Set(mock.writtenVariables.filter((w) => w.name === 'DATABASE_URL').map((w) => w.value))].sort(),
    ['${{app-db-production.DATABASE_URL}}', '${{app-db-staging.DATABASE_URL}}'],
    'each environment’s connection reference names the database it owns -- never the other one’s',
  );
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
  assert.deepEqual(staging.databases, prod.databases, 'the same database is DECLARED in both environments, because each one gets its own service -- the provider provisions it per environment and never shares one (D57)');
});

/**
 * D56: a staging environment needs staging CONFIGURATION, not merely a staging copy. Before per-environment
 * values, `mode: development` bought a second environment whose values duplicated production's -- two
 * environments, one truth, and the arrangement that quietly pointed our staging control plane at production's
 * identity realm.
 */
test('per-environment overrides reach the plan for the environment they name, and only that one', () => {
  const api = webApp.spec.services.api!;
  const manifest = {
    ...webApp,
    spec: {
      ...webApp.spec,
      services: {
        ...webApp.spec.services,
        api: {
          ...api,
          environments: ['production', 'staging'],
          environmentValues: { staging: { PLATFOLIO_IDENTITY_ISSUER: 'https://auth.example.com/realms/platfolio-staging' } },
        },
      },
    },
  } as typeof webApp;

  const plan = buildPlan(manifest, { instanceId: 'inst-env', teamId: 'team-env', images: pinned(['api', 'worker']) });
  const serviceIn = (name: string) => plan.environments.find((e) => e.name === name)!.services.find((s) => s.name === 'api')!;
  const literal = (name: string, key: string) => serviceIn(name).env.find((e) => e.name === key)?.literal;

  assert.equal(literal('staging', 'PLATFOLIO_IDENTITY_ISSUER'), 'https://auth.example.com/realms/platfolio-staging',
    'the override is what staging gets');
  assert.equal(literal('production', 'PLATFOLIO_IDENTITY_ISSUER'), api.env.PLATFOLIO_IDENTITY_ISSUER,
    'production keeps the base value -- an override leaking into production is a downgrade wearing a feature');
  assert.doesNotThrow(() => InfraPlanSchema.parse(plan));
});

test('an override that changes what a deployment runs changes the plan hash', () => {
  const api = webApp.spec.services.api!;
  const manifest = {
    ...webApp,
    spec: { ...webApp.spec, services: { ...webApp.spec.services, api: { ...api, environmentValues: { staging: { PLATFOLIO_DB_SCHEMA: 'platfolio_stage' } } } } },
  } as typeof webApp;
  const options = { instanceId: 'inst-hash', teamId: 'team-hash', images: pinned(['api', 'worker']) };
  assert.notEqual(buildPlan(webApp, options).planHash, buildPlan(manifest, options).planHash,
    'configuration is part of the version decision; a hash that ignored it would let a release be pinned to a lie');
});

test('validate refuses an override for an environment the service is not placed in, and a credential name in a value map', () => {
  const api = webApp.spec.services.api!;
  const bad = {
    ...webApp,
    spec: {
      ...webApp.spec,
      services: {
        ...webApp.spec.services,
        api: {
          ...api,
          environments: ['production'],
          environmentValues: {
            // Not placed in staging: dead configuration that reads like a decision.
            staging: { PLATFOLIO_IDENTITY_ISSUER: 'https://auth.example.com/realms/ghost' },
            // Credential-shaped NAMES belong in `secrets` whatever the value -- D4 grants no exception to the
            // staging copy of a configuration map.
            production: { STRIPE_WEBHOOK_SECRET: 'whsec_this_is_not_a_real_value' },
          },
        },
      },
    },
  } as typeof webApp;
  const codes = validateManifest(bad).map((i) => i.code);
  assert.ok(codes.includes('environment-values-unplaced-environment'), JSON.stringify(codes));
  assert.ok(codes.includes('environment-value-is-secret-name'), JSON.stringify(codes));
});
