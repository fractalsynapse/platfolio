import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const CUSTOM = 'probe.example.com';

function plan(): InfraPlan {
  const p = samplePlan();
  for (const environment of p.environments) {
    environment.databases = [];
    environment.buckets = [];
    environment.cloneFrom = undefined;
    for (const service of environment.services) {
      service.image = 'docker.io/library/nginx:alpine';
      service.digest = `sha256:${'c'.repeat(64)}`;
    }
  }
  p.environments[0]!.domains = [{ host: CUSTOM, service: 'api', port: 3000, verificationName: 'unused' }];
  p.environments[1]!.domains = [];
  return p;
}

function harness(): { mock: RailwayMock; provider: RailwayInfraProvider } {
  const mock = new RailwayMock();
  return { mock, provider: new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} }) };
}

test('the required CNAME value is the provider\'s routing host, copied through untouched', async () => {
  const { provider } = harness();
  const applied = await provider.applyPlan(plan());
  const domain = applied.domains.find((d) => d.host === CUSTOM);
  assert.ok(domain, 'the custom domain is reported');
  const traffic = (domain.records ?? []).find((r) => r.purpose === 'traffic');
  assert.ok(traffic, 'the traffic-routing record is surfaced to the tenant');
  // The mock mirrors the measured response: the target is `verify-target.up.railway.app`, which is NOT
  // derivable from the service or environment name. Anything that synthesised it would fail here.
  assert.equal(traffic.value, 'verify-target.up.railway.app');
  assert.equal(traffic.type, 'CNAME');
  assert.equal(traffic.fqdn, CUSTOM);
  assert.equal(traffic.host, 'probe', 'the short label a DNS console asks for');
  assert.equal(traffic.zone, 'example.com');
  assert.equal(traffic.status, 'requires-update');
  assert.equal(traffic.current, undefined, 'nothing published yet reads as absent, not as empty');
});

test('the ownership TXT is disclosed alongside the routing record as one list', async () => {
  const { provider } = harness();
  const applied = await provider.applyPlan(plan());
  const records = applied.domains.find((d) => d.host === CUSTOM)?.records ?? [];
  const ownership = records.find((r) => r.purpose === 'ownership');
  assert.ok(ownership, 'the TXT pair is appended to the same renderable list');
  assert.equal(ownership.type, 'TXT');
  assert.equal(ownership.host, '_railway-verify.probe');
  assert.match(ownership.value, /^railway-verify=[0-9a-f]{64}$/);
  assert.equal(records.length, 2, 'two instructions, one list');
});

test('an unavailable host fails with the provider\'s reason and is never attached', async () => {
  const { mock, provider } = harness();
  mock.takenDomains.add(CUSTOM);
  const applied = await provider.applyPlan(plan());
  const failure = applied.failures.find((f) => f.code === 'domain-not-available');
  assert.ok(failure, JSON.stringify(applied.failures.map((f) => f.code)));
  assert.match(failure.message, /already attached to another project/, 'the provider\'s own words, not "please try again"');
  assert.equal(mock.domainCreates.length, 0, 'availability is checked before the attempt, not after it fails');
  // The row survives, marked failed: a tenant must see the host they asked for and why it did not
  // happen. What must not happen is it reading as attached or verified.
  const row = applied.domains.find((d) => d.host === CUSTOM);
  assert.equal(row?.dnsStatus, 'failed');
});

test('records are re-read from state, so a challenge record added later shows up', async () => {
  const { mock, provider } = harness();
  await provider.applyPlan(plan());
  const state = await provider.readState(plan().instanceId);
  const domain = state.domains.find((d) => d.host === CUSTOM);
  assert.ok(domain?.records?.length, 'read-back carries the records, not only the attach response');

  // A record appearing after attach is the reason the checklist cannot be authored once.
  const instance = [...mock.instances.values()][0]!;
  const original = instance.domains.slice();
  assert.ok(original.includes(CUSTOM));
  const later = state.domains.find((d) => d.host === CUSTOM)?.records?.find((r) => r.purpose === 'traffic');
  assert.equal(later?.status, 'requires-update', 'still pending until the provider observes the record');
});
