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
    for (const service of environment.services) { service.image = IMAGE; service.digest = DIGEST; }
  }
  p.environments[1]!.cloneFrom = 'production';
  p.environments[1]!.domains = [];
  mutate?.(p);
  return p;
}

/** The three states #111 exists to keep apart: removed by us, taken along, still reachable. */
function harness(options: { buckets?: string[]; keepProjectAfterDelete?: boolean } = {}) {
  const mock = new RailwayMock(options);
  return { mock, provider: new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4_000, pollIntervalMs: 1 }) };
}

test('a bucket is reported as released with the project, not as something we deleted', async () => {
  const { provider } = harness({ buckets: ['bucket-1'] });
  const p = plan((x) => { x.environments[0]!.buckets = [{ name: 'bucket-1' }]; });
  await provider.applyPlan(p);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.ok((deleted.releasedWithProject ?? []).includes('bucket:bucket-1'), JSON.stringify(deleted));
  assert.ok(!deleted.removed.some((r) => r.startsWith('bucket:')), 'the provider never removed it individually -- projectDelete did');
  assert.deepEqual(deleted.orphans, [], 'and it is not an orphan, because nothing is reachable');
});

test('an empty orphan list no longer means "nothing was left": it means "nothing is reachable"', async () => {
  const { provider } = harness({ buckets: ['bucket-1'] });
  const p = plan((x) => { x.environments[0]!.buckets = [{ name: 'bucket-1' }]; });
  await provider.applyPlan(p);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.ok(deleted.releasedWithProject?.length, 'the unremoved resource is named somewhere, so a reader cannot mistake the clean list for a full accounting');
  assert.ok(deleted.removed.some((r) => r.startsWith('service:production/api')), 'what we did delete is still credited to us');
});

test('a resource that outlives a successful projectDelete IS an orphan, and the delete says so', async () => {
  const { provider } = harness({ keepProjectAfterDelete: true, buckets: ['bucket-1'] });
  const p = plan((x) => { x.environments[0]!.buckets = [{ name: 'bucket-1' }]; x.environments[1]!.buckets = []; });
  await provider.applyPlan(p);
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.ok(deleted.orphans.includes('bucket:bucket-1'), `survivor not named: ${JSON.stringify(deleted.orphans)}`);
  assert.ok((deleted.failures ?? []).some((f) => f.code === 'teardown-incomplete'), JSON.stringify(deleted.failures));
  assert.equal(deleted.releasedWithProject, undefined, 'nothing is quietly filed as "went with the project" when the project is still readable');
});

test('the snapshot is taken before the sweep, so a service deleted first is still accounted for', async () => {
  const { mock, provider } = harness();
  const p = plan();
  await provider.applyPlan(p);
  const before = mock.services.size;
  const deleted = await provider.deleteInstance(p.instanceId);
  assert.ok(before > 0, 'the instance had services to account for');
  assert.equal(deleted.orphans.length, 0, JSON.stringify(deleted.orphans));
  assert.ok(deleted.removed.length >= before, JSON.stringify(deleted.removed));
});
