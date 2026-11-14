import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const IMAGE = 'docker.io/library/nginx:alpine';
const DIGEST = `sha256:${'d'.repeat(64)}`;

function plan(mutate?: (p: InfraPlan) => void): InfraPlan {
  const p = samplePlan();
  for (const environment of p.environments) {
    environment.buckets = [];
    for (const service of environment.services) { service.image = IMAGE; service.digest = DIGEST; }
  }
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
  assert.equal(timeout.step, 'databases.app-db@production', 'a database failure names the environment it timed out in -- with one database service per environment (D57) the same plan name can fail in one and not the other');
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
  // #80's guarantee is unchanged: a real refusal is recorded with its reason. What #111 corrected is the
  // label -- after a successful projectDelete the resource is unreachable, so it is "released with the
  // project", not an orphan. Renaming must not be confused with relaxing: failures still carries the reason.
  assert.ok(deleted.failures?.some((f) => /TimeoutError|serviceDelete/.test(f.message)), JSON.stringify(deleted.failures ?? []));
  assert.ok((deleted.releasedWithProject ?? []).some((r) => r.includes('app-db')), `not accounted for: ${JSON.stringify(deleted)}`);
  assert.deepEqual(deleted.orphans, [], 'nothing is reachable, so nothing earns the name orphan');
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
  // Same shift as above: the refusal is still reported, and the service is still accounted for. A resource
  // that survives *individually deletable but refused* and a resource that goes with the project are
  // different claims, and #111 is precisely the distinction that used to be invisible.
  assert.ok(deleted.failures?.length, `no failures recorded: ${JSON.stringify(deleted)}`);
  assert.match(deleted.failures![0]!.message, /Bad Access for template-created service/);
  assert.ok((deleted.releasedWithProject ?? []).some((r) => r.includes('app-db')), JSON.stringify(deleted));
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

test('two environments declaring the same mount get two disks, not one shared one (D57)', async () => {
  // The hibernate reuse above matches on mount path, which is only safe because a volume INSTANCE belongs to one
  // environment (`VolumeInstance.environmentId` is NON_NULL in the captured schema). If that read ever widened
  // to the project, staging's apply would "reuse" production's disk at `/var/cache/app` and re-attach it --
  // silently sharing state between environments, which is the same failure the database had.
  const { mock, provider } = harness();
  const p = plan((x) => {
    for (const environment of x.environments) {
      environment.databases = [];
      environment.volumes = [{ name: 'state-cache', service: 'api', mountPath: '/var/cache/app' }];
    }
  });
  const applied = await provider.applyPlan(p);
  assert.deepEqual(applied.failures.map((f) => f.code), [], JSON.stringify(applied.failures));
  assert.equal(mock.volumes.length, 2, JSON.stringify(mock.volumes));
  assert.equal((applied.notes ?? []).filter((n) => n.code === 'volume-reused').length, 0, 'no environment reused another one’s volume');
  const production = [...mock.environments.values()].find((e) => e.name === 'production')!;
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  assert.equal(new Set(mock.volumes.map((v) => v.environmentId)).size, 2, 'one disk per environment');
  assert.notEqual(mock.volumes.find((v) => v.environmentId === production.id)!.serviceId, mock.volumes.find((v) => v.environmentId === staging.id)!.serviceId, 'and each is attached to that environment’s own service');
});

const withVolume = (p: InfraPlan, retention?: 'instance' | 'survive'): InfraPlan => {
  p.environments[0]!.volumes = [{ name: 'state-cache', service: 'api', mountPath: '/var/cache/app', ...(retention ? { retention } : {}) }];
  p.environments[0]!.databases = [];
  p.environments[1]!.databases = [];
  p.environments[1]!.volumes = [];
  return p;
};

test('a volume that outlived its service is re-attached, not duplicated', async () => {
  // The hibernate case exactly: compute was destroyed, the volume and its mount survived, and a new service
  // now declares the same mount. Matched on the mount because Railway names volumes itself and ignores the
  // plan's label, so the name can never be the identity. A second volume here would split state across two
  // disks with nothing to show for it.
  const { mock, provider } = harness();
  await provider.applyPlan(withVolume(plan()));
  assert.equal(mock.volumes.length, 1);
  const survivor = mock.volumes[0]!;
  assert.match(survivor.name, /-volume$/, 'the double names volumes the way Railway does, not after the plan label');

  // Simulate the service being destroyed while the volume stays.
  survivor.serviceId = 'service-that-no-longer-exists';

  // A re-apply of the same plan is a no-op by plan hash (measured live, and desirable), so reconciliation has
  // to be provoked with a real change -- otherwise this test would prove nothing about the volume path.
  const changed = withVolume(plan());
  // Reconciliation is gated on the plan's own declared hash, which `samplePlan` fixes -- an unchanged hash is
  // a no-op by design. A test that forgot this would quietly assert nothing.
  changed.planHash = 'b'.repeat(64);
  const applied = await provider.applyPlan(changed);
  assert.equal((applied.notes ?? []).filter((n) => n.code === 'volume-reused').length, 1, JSON.stringify(applied.notes));
  assert.equal(mock.volumes.length, 1, `re-attach created a second disk: ${JSON.stringify(mock.volumes)}`);
  assert.notEqual(mock.volumes[0]!.serviceId, 'service-that-no-longer-exists', 'the survivor was re-attached to the live service');
  assert.equal(mock.volumes[0]!.mountPath, '/var/cache/app');
});

test('deleteInstance retains what the plan said to keep, and reports it as retained', async () => {
  const { mock, provider } = harness();
  await provider.applyPlan(withVolume(plan(), 'survive'));
  assert.equal(mock.volumes.length, 1);

  const deleted = await provider.deleteInstance(plan().instanceId, { retainMounts: ['/var/cache/app'] });
  assert.equal(mock.volumes.length, 1, 'a retained volume is still there after teardown');
  assert.deepEqual(deleted.retained, ['api-volume (mounted at /var/cache/app)']);
  assert.ok(!deleted.removed.some((r) => r.startsWith('volume:')), 'and it is not claimed as removed');

  // Contrasting case with its own instance: omitting the option keeps today's behaviour. Retention must be a
  // decision someone made, not a default that strands storage and bills quietly.
  const plain = harness();
  await plain.provider.applyPlan(withVolume(plan()));
  const gone = await plain.provider.deleteInstance(plan().instanceId);
  assert.equal(plain.mock.volumes.length, 0, 'not retained, so removed with the instance');
  assert.ok(!('retained' in gone), 'no retained field when nothing was retained');
});
