import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

function plan(): InfraPlan {
  const p = samplePlan();
  for (const environment of p.environments) {
    environment.databases = [];
    environment.buckets = [];
    for (const service of environment.services) {
      service.image = 'docker.io/library/nginx:alpine';
      service.digest = `sha256:${'c'.repeat(64)}`;
    }
  }
  // A generated Railway host and a custom one, so both status sources are exercised.
  p.environments[0]!.domains = [
    { host: 'web.up.railway.app', service: 'api', port: 3000, verificationName: 'unused' },
    { host: 'api.example.com', service: 'api', port: 3000, verificationName: 'domain-verify' },
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

test('a domain binds to the environment’s own service, not to the first service carrying the plan name (D57)', async () => {
  // Both environments declare the same service name, and both declare a host. Attaching a domain resolves the
  // service id from THIS environment's placement -- if it resolved by name across the project, staging's host
  // would land on production's service and stage traffic would be served by production's container.
  const { mock, provider } = harness();
  const p = plan();
  p.environments[1]!.domains = [{ host: 'staging.example.com', service: 'api', port: 3000, verificationName: 'domain-verify' }];
  const applied = await provider.applyPlan(p);
  assert.deepEqual(applied.failures.map((f) => f.code), [], JSON.stringify(applied.failures));

  const production = [...mock.environments.values()].find((e) => e.name === 'production')!;
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const api = [...mock.services.values()].find((s) => s.name === 'api-production')!;
  const apiStaging = [...mock.services.values()].find((s) => s.name === 'api-staging')!;
  const boundTo = (host: string) => [...mock.instances.entries()].filter(([, i]) => i.domains.includes(host)).map(([k]) => k).sort();
  assert.deepEqual(boundTo('api.example.com'), [`${production.id}:${api.id}`], 'production’s host is on production’s service');
  assert.deepEqual(boundTo('staging.example.com'), [`${staging.id}:${apiStaging.id}`], 'staging’s host is on staging’s own service');
  // Reported back the same way: a domain's targetService is the provider's name for the service it is bound to,
  // so a tenant reading the state can tell the two environments' hosts apart.
  const custom = applied.domains.filter((d) => !d.host.endsWith('.up.railway.app')).map((d) => `${d.host}<-${d.targetService}`).sort();
  assert.deepEqual(custom, ['api.example.com<-api-production', 'staging.example.com<-api-staging'], JSON.stringify(applied.domains));
});

test('a failed private-registry deployment carries the tenant-only next action', async () => {
  const mock = new RailwayMock({ outcome: 'FAILED' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 1_000, pollIntervalMs: 1, sleep: async () => {} });
  const p = samplePlan();
  for (const environment of p.environments) {
    environment.databases = [];
    environment.buckets = [];
    for (const service of environment.services) { service.image = 'ghcr.io/acme/private-app:1.2.3'; service.digest = `sha256:${'e'.repeat(64)}`; }
  }
  const applied = await provider.applyPlan(p);
  const hint = (applied.notes ?? []).find((n) => n.code === 'image-pull-authorization-hint');
  assert.ok(hint, JSON.stringify(applied.notes ?? []));
  assert.match(hint.message, /does not hold such a credential/);
  assert.match(hint.message, /likely cause/, 'a hint, not a claimed diagnosis');

  // A public docker.io image must not be nagged about credentials it does not need.
  const mock2 = new RailwayMock({ outcome: 'FAILED' });
  const provider2 = new RailwayInfraProvider({ credentials: mock2, transport: mock2, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 1_000, pollIntervalMs: 1, sleep: async () => {} });
  const p2 = samplePlan();
  for (const environment of p2.environments) {
    environment.databases = [];
    environment.buckets = [];
    for (const service of environment.services) { service.image = 'docker.io/library/nginx:alpine'; service.digest = `sha256:${'e'.repeat(64)}`; }
  }
  const applied2 = await provider2.applyPlan(p2);
  assert.ok(!(applied2.notes ?? []).some((n) => n.code === 'image-pull-authorization-hint'), 'no credential hint for a public image');
});
