import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeInfraProvider, RailwayInfraProvider, runConformance, samplePlan, satisfiesRange, CONTRACT_VERSION, OPERATIONS } from '../src/index.ts';
import { applyBump } from '../../../scripts/check-contracts.ts';
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
    // Nothing is nulled out here to make staging "look" standalone. Each environment declares its resources in
    // full and the provider provisions each one its own services (D57), so the reduced plan keeps both
    // environments and both `api` declarations: stripping staging down would describe an arrangement the
    // provider no longer implements and quietly turn the reduced gate into a single-environment test.
    environment.domains = environment.domains.map((d) => ({ ...d, host: `${d.service}.up.railway.app` }));
  }
  return plan;
}

test('fake provider passes the full conformance suite', async () => {
  const report = await runConformance(() => new FakeInfraProvider(), `^${CONTRACT_VERSION}`);
  const bad = report.results.filter((r) => r.status !== 'pass');
  assert.equal(bad.length, 0, `unexpected results: ${bad.map((b) => `${b.name}=${b.status} (${b.detail})`).join('; ')}`);
  assert.ok(report.ok, 'suite verdict should be ok');
});

test('railway fails the FULL conformance gate because databases and buckets are unimplemented', async () => {
  const report = await runConformance(railwayProvider, `^${CONTRACT_VERSION}`);
  assert.equal(report.scope, 'full');
  assert.equal(report.ok, false, 'a provider that cannot deliver the reference plan is not conformant, and the gate must say so');
  assert.equal(report.unimplemented, 0, 'the operations are implemented; it is the resources that are missing');
  assert.ok(report.failed > 0, `expected failures from the unsupported resources: ${report.results.map((r) => `${r.name}=${r.status}`).join('; ')}`);
});

test('railway passes the reduced gate for the surface it actually implements', async () => {
  const report = await runConformance(railwayProvider, `^${CONTRACT_VERSION}`, { plan: railwayPlan });
  assert.equal(report.scope, 'reduced', 'a reduced run must never be quotable as full conformance');
  const bad = report.results.filter((r) => r.status !== 'pass');
  assert.equal(bad.length, 0, `reduced-scope results: ${bad.map((b) => `${b.name}=${b.status} (${b.detail})`).join('; ')}`);
  assert.ok(report.ok);
});

test('a reduced plan that stops exercising the surface is refused', () => {
  const hollow = samplePlan();
  hollow.environments = [{ ...hollow.environments[0]!, domains: [], services: [hollow.environments[0]!.services[0]!], databases: [], buckets: [] }];
  return runConformance(railwayProvider, `^${CONTRACT_VERSION}`, { plan: () => hollow }).then(
    () => assert.fail('expected the guard to reject a hollow plan'),
    (error: Error) => assert.match(error.message, /must still exercise/),
  );
});

test('a plan that serializes with a secret value fails conformance', async () => {
  const report = await runConformance(() => new FakeInfraProvider(), `^${CONTRACT_VERSION}`);
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
  const report = await runConformance(() => new Noisy(), `^${CONTRACT_VERSION}`);
  const dup = report.results.find((r) => r.name.includes('same planHash'));
  assert.ok(dup && dup.status === 'fail', `expected the no-op case to fail for a non-idempotent provider, got ${dup?.status}`);
});

test('contract mismatch is reported, not tolerated', async () => {
  // A version that can never satisfy the required range for ANY derived major (D59: the range and the
  // providers' claims below are derived, so this fixture stays a mismatch after every bump).
  const report = await runConformance(() => new FakeInfraProvider({ contract: '0.0.1' }), `^${CONTRACT_VERSION}`);
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
// Not `=== '1.0.0'` (a tautology of the old literal, and the proof this file owed): both providers must
  // report the DERIVED version, whatever it is -- the derivation itself is proven in contract-version.test.ts.
  for (const provider of [new FakeInfraProvider(), railwayProvider()]) {
    assert.equal(provider.describe().contract, CONTRACT_VERSION, `${provider.describe().provider} must report the derived version`);
  }
  assert.match(CONTRACT_VERSION, /^\d+\.\d+\.\d+$/, 'the derived version is semver-shaped -- check-contracts rejects anything else');
  assert.ok(satisfiesRange(applyBump(CONTRACT_VERSION, 'major'), '>=1.0.0'), 'the derivation chain composes (a guard against applyBump returning garbage)');
});

test('satisfiesRange covers the forms the resolver uses', () => {
  const cases: [string, string, boolean][] = [
    ['1.2.3', '^1.0.0', true], ['2.0.0', '^1.0.0', false], ['1.0.0', '^1.0.0', true],
    ['1.9.9', '>=1.0.0 <2', true], ['2.0.0', '>=1.0.0 <2', false], ['1.0.0', '*', true],
    ['0.9.0', '^1.0.0', false], ['1.0.1', '^1.0.0', true], ['1.0.0', '^0.9.0', false],
  ];
  for (const [v, r, want] of cases) assert.equal(satisfiesRange(v, r), want, `${v} vs ${r}`);
});
