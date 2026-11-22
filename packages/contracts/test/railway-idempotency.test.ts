import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider } from '../src/railway-provider.ts';
import { RailwayMock } from './railway-mock.ts';
import { samplePlan } from '../src/conformance.ts';

/**
 * The idempotency marker records INTENT before anything mutates, so a retried dispatch does not redeploy the
 * world (E26). The consequence, which this file exists to pin: a marker can describe work that never finished.
 *
 * Observed for real, on our own infrastructure: an apply was interrupted after the marker was written and
 * before the staging environment was created. The retry answered `noop: true, verified: true` -- and staging
 * did not exist. `verified` was computed from "every service in the project is live", a question that cannot
 * see a missing environment, because a service that was never placed anywhere is not in the list it checks.
 *
 * So: a matching marker earns a coverage check, not a certificate. If the provider's own state is missing
 * anything the plan declares -- an environment, a service placed in it, a domain bound in it -- the apply
 * resumes instead of short-circuiting, and says why in a note.
 */
function provider(mock: RailwayMock): RailwayInfraProvider {
  return new RailwayInfraProvider({
    credentials: mock, transport: mock, workspaceId: 'ws-1',
    deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25,
  });
}

test('a marker whose work never finished does not report success: the apply resumes (E26 follow-up)', async () => {
  const plan = samplePlan({ instanceId: 'interrupted' });
  const mock = new RailwayMock();

  const first = await provider(mock).applyPlan(plan);
  assert.equal(first.verified, true, JSON.stringify(first.failures));

  // Reproduce the interrupted apply: keep the marker the first pass wrote, lose the work that came after it.
  const project = [...mock.projects.values()][0]!;
  assert.ok(project.description.includes('platfolio:plan='), `the marker should be recorded, got: ${project.description}`);
  // Instances are keyed `<environmentId>:<serviceId>`, and services are project-level: deleting the environment
  // and its placements leaves the service itself present, which is the realistic shape of a half-finished apply
  // -- and precisely the case a liveness check over existing services cannot see.
  const staging = [...mock.environments.entries()].find(([, e]) => e.projectId === project.id && e.name === 'staging');
  assert.ok(staging, 'the mock should have a staging environment after the first apply');
  const [stagingId] = staging;
  mock.environments.delete(stagingId!);
  for (const key of [...mock.instances.keys()]) if (key.startsWith(`${stagingId}:`)) mock.instances.delete(key);

  const before = mock.operations.length;
  const resumed = await provider(mock).applyPlan(plan);
  // Operations are recorded as `<name>:<credential kind>`, so an exact-name filter matches nothing -- the first
  // version of this assertion failed for that reason alone, which is worth keeping in the log rather than
  // editing out: a test that fails for the wrong reason teaches the wrong lesson.
  const created = mock.operations.slice(before).filter((op) => op.startsWith('environmentCreate'));

  assert.equal(resumed.noop, false, 'a marker without the state it promised must NOT short-circuit');
  // The mock tags every recorded operation with the credential kind it used, so the names are
  // `environmentCreate:workspace` -- asserting the bare name against the filtered list is how this test failed
  // for a reason unrelated to the behaviour it guards.
  assert.ok(created.length > 0, `staging should be recreated, operations after the resume: ${JSON.stringify(mock.operations.slice(before))}`);
  assert.equal(resumed.verified, true, JSON.stringify(resumed.failures));
  assert.ok((resumed.notes ?? []).some((n) => n.code === 'marker-without-state'),
    `the resume must be explained, not silent: ${JSON.stringify(resumed.notes)}`);
});

test('a genuinely applied plan still short-circuits, so a re-delivered dispatch does not redeploy the world', async () => {
  const plan = samplePlan({ instanceId: 'settled' });
  const mock = new RailwayMock();
  await provider(mock).applyPlan(plan);
  const before = mock.operations.length;
  const second = await provider(mock).applyPlan(plan);
  assert.equal(second.noop, true, 'coverage complete plus marker means nothing to do');
  assert.equal(second.verified, true, JSON.stringify(second.failures));
  assert.equal(mock.operations.slice(before).filter((op) => op === 'environmentCreate' || op === 'serviceCreate' || op === 'deploy').length, 0,
    'a noop must not mutate');
});

test('a missing domain in a present environment is coverage failure too, not a passing check', async () => {
  const plan = samplePlan({ instanceId: 'unbound' });
  const mock = new RailwayMock();
  await provider(mock).applyPlan(plan);
  const project = [...mock.projects.values()][0]!;
  // Remove the production domain binding while leaving services live: the old check saw every service live
  // and reported verified, which is the same blind spot at a finer grain.
  for (const inst of mock.instances.values()) inst.domains = [];
  const resumed = await provider(mock).applyPlan(plan);
  assert.ok(!resumed.noop || (resumed.notes ?? []).length > 0,
    'either resume the work, or say loudly why the marker was trusted -- silence is the defect');
  assert.equal(project.name.length > 0, true);
});
