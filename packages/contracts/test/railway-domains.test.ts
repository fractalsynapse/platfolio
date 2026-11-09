import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

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
  // A generated Railway host and a custom one, so both status sources are exercised.
  p.environments[0]!.domains = [
    { host: 'web.up.railway.app', service: 'api', port: 3000, verificationName: 'unused' },
    { host: 'api.example.com', service: 'api', port: 3000, verificationName: 'treedx-verify' },
  ];
  p.environments[1]!.domains = [];
  return p;
}

function harness(): { mock: RailwayMock; provider: RailwayInfraProvider } {
  const mock = new RailwayMock();
  return { mock, provider: new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} }) };
}

test('service-domain state comes from syncStatus, not from the hostname', async () => {
  const { mock, provider } = harness();
  const applied = await provider.applyPlan(plan());
  const railwayDomain = applied.domains.find((d) => d.host.endsWith('.up.railway.app'));
  assert.ok(railwayDomain, 'a service domain was reported');
  assert.equal(railwayDomain.dnsStatus, 'verified', 'ACTIVE syncStatus after a settled deploy');
  assert.equal(railwayDomain.certificateStatus, 'issued');

  // Un-settle the domains behind the provider's back: if issuance were inferred from the hostname,
  // this read would still claim `issued`.
  for (const instance of mock.instances.values()) instance.settledDomains = false;
  const state = await provider.readState(plan().instanceId);
  const stillRailway = state.domains.find((d) => d.host.endsWith('.up.railway.app'));
  assert.equal(stillRailway?.dnsStatus, 'pending', 'CREATING must read as pending even for a Railway host');
  assert.equal(stillRailway?.certificateStatus, 'pending');
});

test('a custom domain reads as pending until ownership verifies, then issued', async () => {
  const { mock, provider } = harness();
  const applied = await provider.applyPlan(plan());
  const custom = applied.domains.find((d) => d.host === 'api.example.com');
  assert.ok(custom, 'the custom domain is reported');
  // Issuance is not a consequence of the call: the provider has to observe it.
  assert.ok(['issued', 'pending'].includes(custom.certificateStatus), custom.certificateStatus);

  for (const instance of mock.instances.values()) { instance.verifiedDomains = false; instance.settledDomains = true; }
  const state = await provider.readState(plan().instanceId);
  const pending = state.domains.find((d) => d.host === 'api.example.com');
  assert.equal(pending?.certificateStatus, 'pending', 'VALIDATING_OWNERSHIP is not issued');
  assert.equal(pending?.dnsStatus, 'pending', 'DNS ownership not yet proven by the tenant');
});

test('retryCertificate re-issues through the provider id, and the state then moves', async () => {
  const { mock, provider } = harness();
  await provider.applyPlan(plan());
  for (const instance of mock.instances.values()) instance.verifiedDomains = false;
  const before = await provider.readState(plan().instanceId);
  const failing = before.domains.find((d) => d.host === 'api.example.com');
  assert.equal(failing?.certificateStatus, 'pending');

  // The id is what the provider received from Railway, not something we fabricate.
  await provider.retryCertificate('cdom-api.example.com');
  assert.deepEqual(mock.certRetries, ['cdom-api.example.com']);

  const after = await provider.readState(plan().instanceId);
  assert.equal(after.domains.find((d) => d.host === 'api.example.com')?.certificateStatus, 'issued');
});

test('retryCertificate refuses an id that is not attached, rather than calling blindly', async () => {
  const { provider } = harness();
  await provider.applyPlan(plan());
  await assert.rejects(() => provider.retryCertificate('cdom-nope'), /no custom domain with id/);
});
