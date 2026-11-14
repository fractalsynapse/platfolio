import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const IMAGE = 'docker.io/library/nginx:alpine';
const DIGEST = `sha256:${'b'.repeat(64)}`;

function planWith(mutate: (plan: InfraPlan) => void): InfraPlan {
  const plan = samplePlan();
  for (const environment of plan.environments) {
    environment.databases = [];
    for (const service of environment.services) {
      service.image = IMAGE;
      service.digest = DIGEST;
    }
  }
  mutate(plan);
  return plan;
}

function harness(): { mock: RailwayMock; provider: RailwayInfraProvider } {
  const mock = new RailwayMock();
  return { mock, provider: new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} }) };
}

test('a service is placed in a cloned environment, because duplication is the mechanism (E25)', async () => {
  const { provider, mock } = harness();
  const plan = planWith(() => {});
  const applied = await provider.applyPlan(plan);
  const codes = applied.failures.map((f) => f.code);
  assert.deepEqual(codes, [], JSON.stringify(applied.failures));
  assert.equal(applied.services.length, 2, 'production and staging both configured');
  assert.ok(mock.operations.includes('environmentCreate:workspace'), 'the clone is created with the workspace grant');
  assert.ok(mock.operations.some((o) => o === 'serviceCreate:project'), 'service work uses the environment-scoped token');
});

test('a second environment that is not a clone is refused, not silently skipped (E25)', async () => {
  const { provider } = harness();
  const plan = planWith((p) => { p.environments[1]!.cloneFrom = undefined; });
  const applied = await provider.applyPlan(plan);
  const missing = applied.failures.filter((f) => f.code === 'instance-missing-in-environment');
  assert.equal(missing.length, 1, JSON.stringify(applied.failures));
  assert.match(missing[0]!.step, /staging/);
  assert.match(missing[0]!.message, /duplicated/, 'the message must name the real mechanism');
  assert.equal(applied.verified, false, 'a service that does not exist in an environment cannot be reported as configured');
});

test('buckets are created with the workspace grant and an unenforced region is disclosed (E28)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => { p.environments[0]!.databases = []; });
  const applied = await provider.applyPlan(plan);
  assert.ok(mock.operations.includes('bucketCreate:workspace'), JSON.stringify(mock.operations.filter((o) => o.startsWith('bucketCreate'))));
  assert.ok(applied.failures.every((f) => f.code !== 'bucket-create-failed'), JSON.stringify(applied.failures));
  const regionNote = (applied.notes ?? []).find((n) => n.code === 'bucket-region-ignored');
  assert.ok(regionNote, 'the plan asks for iad; the API takes no region, and that has to be said out loud');
});

test('databases are provisioned through the template path, once per project (OD13)', async () => {
  const { provider, mock } = harness();
  // planWith clears databases for the placement tests, so this one declares them explicitly.
  const plan = planWith((p) => { for (const environment of p.environments) environment.databases = [{ name: 'app-db', kind: 'postgres' }]; });
  const applied = await provider.applyPlan(plan);
  const dbFailures = applied.failures.filter((f) => f.code.startsWith('database-') || f.code === 'deployment-timeout');
  assert.deepEqual(dbFailures, [], JSON.stringify(applied.failures.map((f) => f.code)));
  assert.equal(applied.verified, true, 'an instance WITH its provisioned database is verified');

  // One template deploy for a database declared in both environments: service names are project-wide, so
  // staging receives it through duplication and only needs its deployment started.
  assert.equal(mock.templateDeploys.length, 1, JSON.stringify(mock.templateDeploys));
  assert.equal(mock.templateDeploys[0]!.serviceName, 'app-db', "the composed plan name, not the template's own");
  assert.equal(mock.templateDeploys[0]!.credentialKind, 'workspace', 'template deploys need the workspace grant');
  const placed = [...mock.instances.values()].filter((i) => i.image.includes('postgres'));
  assert.equal(placed.length, 2, 'an instance in each environment');
  assert.ok(placed.every((i) => i.status === 'SUCCESS'), placed.map((i) => i.status).join(','));
  assert.ok(mock.operations.includes('serviceInstanceDeploy:project'), 'the duplicated environment needs its own deploy started');
});

test('the mock reproduces the silent no-op rather than helping the provider look right', async () => {
  const mock = new RailwayMock();
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} });
  const plan = planWith((p) => { p.environments[1]!.cloneFrom = undefined; });
  await provider.applyPlan(plan);
  // The update call on the unplaced environment succeeded (returned data) yet placed nothing: that is
  // the measured API behaviour, asserted here so nobody "fixes" the mock to make the provider look good.
  assert.ok(mock.operations.includes('environment.serviceInstances:project'), 'placement is verified by reading instances back');
  const stillThere = await provider.readState(plan.instanceId);
  assert.equal(stillThere.services.filter((s) => s.environment === 'staging').length, 0, 'nothing was silently invented in staging');
});

/**
 * Shared-variable delivery, checked where the provider actually operates.
 *
 * A composition can declare a secret `source: shared-variable`, which in Railway means the value lives at
 * ENVIRONMENT scope and each service must be ATTACHED to see it. Two calls, and the schema is what says so:
 * `SharedVariableConfigureInput` carries only enabledServiceIds/disabledServiceIds/name/environmentId/projectId
 * -- there is no value field anywhere -- so it cannot create the variable, while an environment-scoped write
 * without attachment leaves a credential the declaring service cannot read that still "exists" in the
 * environment. A provider that called only the first would be describing a file left in the wrong room.
 */
test('a shared-variable secret is written at environment scope and attached to the declaring service', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'shared-delivery' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const environmentId = [...mock.environments.values()].find((e) => e.name === 'production')!.id;
  const apiId = [...mock.services.values()].find((s) => s.name === 'api')!.id;

  const result = await provider.putSecretValue!({
    instanceId: 'shared-delivery', environment: 'production', service: 'api',
    name: 'PLATFOLIO_GITHUB_APP_ID', value: '5694176', source: 'shared-variable',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true, 'delivery is not complete until the declaring service can read the name');

  assert.equal(mock.sharedVariables.get(`${environmentId}:PLATFOLIO_GITHUB_APP_ID`), '5694176', 'the value belongs to the environment');
  const apiInstance = mock.instances.get(`${environmentId}:${apiId}`)!;
  assert.equal(apiInstance.variables.has('PLATFOLIO_GITHUB_APP_ID'), false, 'a shared delivery must not be smuggled in as a service variable');
  assert.deepEqual([...(mock.sharedAttachments.get(`${environmentId}:PLATFOLIO_GITHUB_APP_ID`) ?? [])], [apiId], 'the attachment names exactly the declaring service');

  const presence = await provider.secretPresence!({ instanceId: 'shared-delivery', environment: 'production', service: 'api', names: ['PLATFOLIO_GITHUB_APP_ID', 'PLATFOLIO_GITHUB_PRIVATE_KEY'] });
  assert.equal(presence.PLATFOLIO_GITHUB_APP_ID, 'set');
  assert.equal(presence.PLATFOLIO_GITHUB_PRIVATE_KEY, 'missing', 'presence must distinguish delivered from absent, or the read is decoration');

  // The load-bearing part, shown rather than asserted about: undo the ATTACHMENT and presence flips back to
  // `missing` even though the variable is still written at environment scope. So `verified` means "the service
  // can read this", not "a value exists somewhere" -- the check depends on the second call.
  mock.sharedAttachments.delete(`${environmentId}:PLATFOLIO_GITHUB_APP_ID`);
  const detached = await provider.secretPresence!({ instanceId: 'shared-delivery', environment: 'production', service: 'api', names: ['PLATFOLIO_GITHUB_APP_ID'] });
  assert.equal(detached.PLATFOLIO_GITHUB_APP_ID, 'missing', 'attachment is what makes a shared variable visible, and the check must depend on it');
});

test('default-scope delivery writes the service, not the environment', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'service-delivery' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const environmentId = [...mock.environments.values()].find((e) => e.name === 'production')!.id;

  const result = await provider.putSecretValue!({ instanceId: 'service-delivery', environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'abc123' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(mock.sharedVariables.has(`${environmentId}:SESSION_KEY`), false, 'the default scope stays with the service');
  assert.equal((mock.sharedAttachments.get(`${environmentId}:SESSION_KEY`) ?? new Set()).size, 0, 'and nothing is attached that was never shared');
});
