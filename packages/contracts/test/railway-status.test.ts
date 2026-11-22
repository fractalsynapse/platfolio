import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

/**
 * `SUCCESS` is a deployment outcome, not a process state.
 *
 * Measured on platfolio's own deployment (2026-11-12, #172): Keycloak's container exited, its latest
 * deployment read FAILED while an older SUCCESS one was still listed as active, and the Railway interface
 * called the service "completed". The provider mapped SUCCESS straight to `live`, so a service that had
 * stopped — including one that exited 0 — would be reported as running, counted as `verified`, and then
 * surfaced to a tenant as a healthy platform. This file is the falsification that was missing.
 */
function harness(options: ConstructorParameters<typeof RailwayMock>[0]) {
  const mock = new RailwayMock(options);
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 4000, pollIntervalMs: 10 });
  return { mock, provider };
}

test('a deployment that finished with nothing running is `stopped`, never `live`', async () => {
  const { provider } = harness({ completedOnly: true });
  const plan = samplePlan();
  const applied = await provider.applyPlan(plan);

  const statuses = applied.services.map((s) => `${s.name}=${s.status}`);
  assert.ok(applied.services.length > 0, 'the plan applied no services, so this proves nothing');
  assert.ok(applied.services.every((s) => s.status === 'stopped'), `expected every service stopped, got ${JSON.stringify(statuses)}`);
  assert.equal(applied.verified, false, 'a service that exited cannot be reported as configured');
  assert.ok(applied.failures.length > 0, 'the apply must fail, not settle into a green it did not earn');
  assert.ok(applied.failures.some((f) => /stopped|not live|unhealthy/i.test(`${f.code} ${f.message}`)), JSON.stringify(applied.failures));

  // The raw provider state is preserved alongside the normalized one, so `SUCCESS` is still visible when a
  // human asks what the platform actually said.
  const state = await provider.readState(plan.instanceId);
  const dead = state.services.find((s) => s.status === 'stopped');
  assert.ok(dead, `readState lost the stopped state: ${JSON.stringify(state.services.map((s) => [s.name, s.status]))}`);
  assert.equal(dead.rawStatus, 'SUCCESS', 'the exit-0 case is exactly the point: the deployment succeeded, the service is not running');
});

test('the same plan with something running behind it is live and verified', async () => {
  const { provider } = harness({});
  const plan = samplePlan();
  const applied = await provider.applyPlan(plan);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));
  assert.ok(applied.services.every((s) => s.status === 'live'), JSON.stringify(applied.services.map((s) => [s.name, s.status])));
  assert.equal(applied.verified, true, 'the healthy case must still be able to report success -- otherwise the fix is just pessimism');
});
