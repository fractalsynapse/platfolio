import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const IMAGE = 'docker.io/library/nginx:alpine';
const DIGEST = `sha256:${'d'.repeat(64)}`;

function plan(mutate?: (p: InfraPlan) => void): InfraPlan {
  const p = samplePlan();
  for (const environment of p.environments) {
    environment.cloneFrom = undefined;
    environment.buckets = [];
    for (const service of environment.services) { service.image = IMAGE; service.digest = DIGEST; }
  }
  p.environments[1]!.cloneFrom = 'production';
  p.environments[1]!.domains = [];
  mutate?.(p);
  return p;
}

function harness(options: { templateRevealAfter?: number; templateNeverReveals?: boolean } = {}): { mock: RailwayMock; provider: RailwayInfraProvider } {
  const mock = new RailwayMock(options);
  return { mock, provider: new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4_000, pollIntervalMs: 1, sleep: async () => {} }) };
}

test('the provider waits for an asynchronous template deploy instead of declaring it missing (#77)', async () => {
  const { mock, provider } = harness({ templateRevealAfter: 3 });
  const p = plan((x) => { for (const e of x.environments) { e.databases = [{ name: 'app-db', kind: 'postgres' }]; } x.environments[1]!.databases = []; });
  const applied = await provider.applyPlan(p);
  assert.deepEqual(applied.failures.map((f) => f.code), [], JSON.stringify(applied.failures.map((f) => f.code)));
  assert.equal(applied.verified, true);
  assert.equal(mock.templateDeploys.length, 1, 'provisioned once for a database declared in both environments');
});

test('a template deploy that never surfaces is a timeout, not a missing resource (#79)', async () => {
  // Proven in both directions with the same plan: templateRevealAfter 2 verifies, never-reveals yields
  // database-provision-timeout. The double's option normalization used to drop this flag silently, which is
  // why an earlier version of this test passed while asserting nothing.
  const never = harness({ templateNeverReveals: true });
  const p = plan((x) => { x.environments[0]!.databases = [{ name: 'app-db', kind: 'postgres' }]; x.environments[1]!.databases = []; });
  const applied = await never.provider.applyPlan(p);
  const timeout = applied.failures.find((f) => f.code === 'database-provision-timeout');
  assert.ok(timeout, JSON.stringify(applied.failures.map((f) => f.code)));
  assert.equal(timeout.step, 'databases.app-db');
  assert.match(timeout.message, /accepted but surfaced no placed service/, 'slow is not the same as refused');
  assert.equal(never.mock.hiddenServiceCount(), 1, 'the service stayed hidden for the whole window');
  assert.equal(applied.verified, false);

  // Control: same plan, the service appears after a couple of reads -> verified, no timeout.
  const ok = harness({ templateRevealAfter: 2 });
  const p2 = plan((x) => { x.environments[0]!.databases = [{ name: 'app-db', kind: 'postgres' }]; x.environments[1]!.databases = []; });
  const applied2 = await ok.provider.applyPlan(p2);
  assert.deepEqual(applied2.failures.map((f) => f.code), [], JSON.stringify(applied2.failures.map((f) => f.code)));
  assert.equal(applied2.verified, true);
});

test('volumes are created attached to their service and verified against the project listing', async () => {
  const { mock, provider } = harness();
  const p = plan((x) => {
    x.environments[0]!.databases = [];
    x.environments[1]!.databases = [];
    x.environments[0]!.volumes = [{ name: 'blob-cache', service: 'api', mountPath: '/var/cache' }];
    x.environments[1]!.volumes = [];
  });
  const applied = await provider.applyPlan(p);
  assert.deepEqual(applied.failures.map((f) => f.code), [], JSON.stringify(applied.failures.map((f) => f.code)));
  assert.equal(mock.volumes.length, 1);
  assert.equal(mock.volumes[0]!.mountPath, '/var/cache');
  const note = (applied.notes ?? []).find((n) => n.code === 'volume-mount-unobservable');
  assert.ok(note, 'mount state is reported as unreadable rather than assumed correct');
});

test('a volume targeting an undeclared service is rejected before any resource is created', async () => {
  const { mock, provider } = harness();
  const p = plan((x) => {
    x.environments[0]!.databases = [];
    x.environments[1]!.databases = [];
    x.environments[0]!.volumes = [{ name: 'orphan-vol', service: 'does-not-exist', mountPath: '/data' }];
  });
  // Cross-field validation rejects this at the plan boundary, so nothing is ever sent -- stricter than the
  // provider reporting a failure after resources were created.
  await assert.rejects(() => provider.applyPlan(p), /unknown service "does-not-exist"/);
  assert.equal(mock.projects.size, 0, 'no project was created for an invalid plan');
});

test('a slow database delete is retried and the orphan goes away (#80)', async () => {
  // Measured live: serviceDelete on a template-created database timed out at the transport deadline and left
  // an orphan; ordinary services deleted inside the window. The double fails the first attempt; the retry succeeds.
  const mock = new RailwayMock({ templateDeleteFailures: 1 });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4_000, pollIntervalMs: 1, sleep: async () => {} });
  const p = plan((x) => {
    x.environments[0]!.databases = [{ name: 'app-db', kind: 'postgres' }];
    x.environments[1]!.databases = [];
    x.environments[1]!.volumes = [];
  });
  await provider.applyPlan(p);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.deepEqual(deleted.orphans, [], JSON.stringify(deleted));
  assert.ok(deleted.removed.some((r) => r.includes('app-db')), JSON.stringify(deleted.removed));
});

test('when both delete attempts fail the orphan is reported with its reason (#80)', async () => {
  // The retry is two attempts; exceeding that must produce an orphan AND a reason, never silence.
  const mock = new RailwayMock({ templateDeleteFailures: 5 });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4_000, pollIntervalMs: 1, sleep: async () => {} });
  const p = plan((x) => {
    x.environments[0]!.databases = [{ name: 'app-db', kind: 'postgres' }];
    x.environments[1]!.databases = [];
    x.environments[1]!.volumes = [];
  });
  await provider.applyPlan(p);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.ok(deleted.orphans.some((o) => o.includes('app-db')), JSON.stringify(deleted));
  assert.ok(deleted.failures?.some((f) => /TimeoutError|serviceDelete/.test(f.message)), JSON.stringify(deleted.failures ?? []));
});

test('a refused database delete is reported WITH the reason, not as a bare orphan (#80)', async () => {
  const mock = new RailwayMock({ refuseTemplateServiceDelete: true });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4_000, pollIntervalMs: 1, sleep: async () => {} });
  const p = plan((x) => {
    x.environments[0]!.databases = [{ name: 'app-db', kind: 'postgres' }];
    x.environments[1]!.databases = [];
    x.environments[1]!.volumes = [];
  });
  await provider.applyPlan(p);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.ok(deleted.orphans.length, 'the template-created service survives, as it did live');
  assert.ok(deleted.failures?.length, `no failures recorded: ${JSON.stringify(deleted)}`);
  assert.match(deleted.failures![0]!.message, /Bad Access for template-created service/);
  assert.ok(deleted.failures![0]!.step.startsWith('service:'), deleted.failures![0]!.step);
});

test('deleteInstance removes volumes too, and reports any that survive', async () => {
  const { mock, provider } = harness();
  const p = plan((x) => {
    x.environments[0]!.databases = [];
    x.environments[1]!.databases = [];
    x.environments[0]!.volumes = [{ name: 'blob-cache', service: 'api', mountPath: '/var/cache' }];
  });
  await provider.applyPlan(p);
  assert.equal(mock.volumes.length, 1);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.equal(mock.volumes.length, 0, 'the volume is gone with the instance');
  assert.ok(deleted.removed.some((r) => r.startsWith('volume:')), JSON.stringify(deleted.removed));
  assert.deepEqual(deleted.orphans, [], JSON.stringify(deleted.orphans));
});
