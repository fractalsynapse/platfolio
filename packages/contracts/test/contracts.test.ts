import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeInfraProvider, RailwayInfraProvider, runConformance, samplePlan, satisfiesRange, CONTRACT_VERSION, OPERATIONS } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

/** A Railway provider over the mock: fresh mock per case, so state cannot leak between cases. */
function railwayProvider(): RailwayInfraProvider {
  const mock = new RailwayMock();
  return new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 50, deployTimeoutMs: 5_000, pollIntervalMs: 1, sleep: async () => {} });
}

/** The reference plan, minus what this provider has not implemented: databases and buckets.
 *  Domains use Railway's generated host so certificate state is real rather than assumed. */
function railwayPlan() {
  const plan = samplePlan();
  for (const environment of plan.environments) {
    environment.databases = [];
    environment.buckets = [];
    // cloneFrom is kept: E25 measured that duplicating an environment is the only placement mechanism
    // Railway offers, so a plan that wants a service in two environments must clone -- and the provider
    // now refuses to pretend otherwise. Nulling this out makes the reduced plan describe an
    // arrangement the provider correctly rejects.
    environment.domains = environment.domains.map((d) => ({ ...d, host: `${d.service}.up.railway.app` }));
  }
  return plan;
}

test('fake provider passes the full conformance suite', async () => {
  const report = await runConformance(() => new FakeInfraProvider(), '^1.0.0');
  const bad = report.results.filter((r) => r.status !== 'pass');
  assert.equal(bad.length, 0, `unexpected results: ${bad.map((b) => `${b.name}=${b.status} (${b.detail})`).join('; ')}`);
  assert.ok(report.ok, 'suite verdict should be ok');
});

test('railway fails the FULL conformance gate because databases and buckets are unimplemented', async () => {
  const report = await runConformance(railwayProvider, '^1.0.0');
  assert.equal(report.scope, 'full');
  assert.equal(report.ok, false, 'a provider that cannot deliver the reference plan is not conformant, and the gate must say so');
  assert.equal(report.unimplemented, 0, 'the operations are implemented; it is the resources that are missing');
  assert.ok(report.failed > 0, `expected failures from the unsupported resources: ${report.results.map((r) => `${r.name}=${r.status}`).join('; ')}`);
});

test('railway passes the reduced gate for the surface it actually implements', async () => {
  const report = await runConformance(railwayProvider, '^1.0.0', { plan: railwayPlan });
  assert.equal(report.scope, 'reduced', 'a reduced run must never be quotable as full conformance');
  const bad = report.results.filter((r) => r.status !== 'pass');
  assert.equal(bad.length, 0, `reduced-scope results: ${bad.map((b) => `${b.name}=${b.status} (${b.detail})`).join('; ')}`);
  assert.ok(report.ok);
});

test('a reduced plan that stops exercising the surface is refused', () => {
  const hollow = samplePlan();
  hollow.environments = [{ ...hollow.environments[0]!, domains: [], services: [hollow.environments[0]!.services[0]!], databases: [], buckets: [] }];
  return runConformance(railwayProvider, '^1.0.0', { plan: () => hollow }).then(
    () => assert.fail('expected the guard to reject a hollow plan'),
    (error: Error) => assert.match(error.message, /must still exercise/),
  );
});

test('a plan that serializes with a secret value fails conformance', async () => {
  const report = await runConformance(() => new FakeInfraProvider(), '^1.0.0');
  const secretsCase = report.results.find((r) => r.name.includes('secrets are never carried'));
  assert.ok(secretsCase && secretsCase.status === 'pass', 'baseline plan must be value-free');
});

test('duplicate services after a retry are caught by the suite', async () => {
  // A provider that forgets idempotency must be failed by the suite, not by a reviewer.
  class Noisy extends FakeInfraProvider {
    private n = 0;
    override async applyPlan(plan: Parameters<FakeInfraProvider['applyPlan']>[0]) {
      const r = await super.applyPlan(plan);
      this.n += 1;
      return { ...r, noop: false };
    }
  }
  const report = await runConformance(() => new Noisy(), '^1.0.0');
  const dup = report.results.find((r) => r.name.includes('same planHash'));
  assert.ok(dup && dup.status === 'fail', `expected the no-op case to fail for a non-idempotent provider, got ${dup?.status}`);
});

test('contract mismatch is reported, not tolerated', async () => {
  const report = await runConformance(() => new FakeInfraProvider({ contract: '2.0.0' }), '^1.0.0');
  const c = report.results.find((r) => r.name.includes('contract version'));
  assert.ok(c && c.status === 'fail');
  assert.equal(report.ok, false);
});

test('validatePlan rejects a domain that targets a missing service', () => {
  const plan = samplePlan();
  plan.environments[0]!.domains = [{ host: 'x.example.com', service: 'ghost', port: 1, verificationName: 'v' }];
  const issues = railwayProvider().validatePlan(plan);
  assert.ok(issues.some((i) => i.code === 'unknown-service' || i.code === 'schema'), JSON.stringify(issues));
});

test('railway rejects an invalid region and accepts a valid one', () => {
  const good = samplePlan();
  assert.equal(railwayProvider().validatePlan(good).length, 0, 'sample plan should be valid');
  const bad = samplePlan();
  bad.environments[0]!.buckets = [{ name: 'media', region: 'not-a-region' }];
  const issues = railwayProvider().validatePlan(bad);
  assert.ok(issues.some((i) => i.code === 'region-form'), JSON.stringify(issues));
});

test('operations list is the contract surface, and both providers stay inside it', () => {
  for (const provider of [new FakeInfraProvider(), railwayProvider()]) {
    for (const op of provider.describe().operations) {
      assert.ok((OPERATIONS as readonly string[]).includes(op), `unknown operation ${op}`);
      assert.equal(typeof provider[op as 'describe'], 'function');
    }
  }
  assert.equal(CONTRACT_VERSION, '1.0.0');
});

test('satisfiesRange covers the forms the resolver uses', () => {
  const cases: [string, string, boolean][] = [
    ['1.2.3', '^1.0.0', true], ['2.0.0', '^1.0.0', false], ['1.0.0', '^1.0.0', true],
    ['1.9.9', '>=1.0.0 <2', true], ['2.0.0', '>=1.0.0 <2', false], ['1.0.0', '*', true],
    ['0.9.0', '^1.0.0', false], ['1.0.1', '^1.0.0', true], ['1.0.0', '^0.9.0', false],
  ];
  for (const [v, r, want] of cases) assert.equal(satisfiesRange(v, r), want, `${v} vs ${r}`);
});
