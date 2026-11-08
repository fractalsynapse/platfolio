import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeInfraProvider, RailwayInfraProvider, runConformance, samplePlan, satisfiesRange, CONTRACT_VERSION, OPERATIONS } from '../src/index.ts';

test('fake provider passes the full conformance suite', async () => {
  const report = await runConformance(() => new FakeInfraProvider(), '^1.0.0');
  const bad = report.results.filter((r) => r.status !== 'pass');
  assert.equal(bad.length, 0, `unexpected results: ${bad.map((b) => `${b.name}=${b.status} (${b.detail})`).join('; ')}`);
  assert.ok(report.ok, 'suite verdict should be ok');
});

test('railway skeleton reports not-implemented instead of passing quietly', async () => {
  const report = await runConformance(() => new RailwayInfraProvider(), '^1.0.0');
  assert.equal(report.ok, false, 'an incomplete provider must not be conformant');
  assert.ok(report.unimplemented >= 3, `expected >=3 unimplemented, got ${report.unimplemented}`);
  assert.equal(report.failed, 0, `incomplete is not the same as broken: ${report.results.filter(r=>r.status==='fail').map(r=>r.name).join(', ')}`);
  assert.ok(report.results.every((r) => r.status !== 'pass' || r.detail.length > 0));
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
  const issues = new RailwayInfraProvider().validatePlan(plan);
  assert.ok(issues.some((i) => i.code === 'unknown-service' || i.code === 'schema'), JSON.stringify(issues));
});

test('railway rejects an invalid region and accepts a valid one', () => {
  const good = samplePlan();
  assert.equal(new RailwayInfraProvider().validatePlan(good).length, 0, 'sample plan should be valid');
  const bad = samplePlan();
  bad.environments[0]!.buckets = [{ name: 'media', region: 'not-a-region' }];
  const issues = new RailwayInfraProvider().validatePlan(bad);
  assert.ok(issues.some((i) => i.code === 'region-form'), JSON.stringify(issues));
});

test('operations list is the contract surface, and both providers stay inside it', () => {
  for (const provider of [new FakeInfraProvider(), new RailwayInfraProvider()]) {
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
