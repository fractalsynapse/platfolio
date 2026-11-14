import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, physicalServiceName, previewPlacement, samplePlan, type InfraPlan } from '../src/index.ts';
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

/** Names the project ended up holding, sorted -- the provider's own vocabulary, not the plan's. */
function serviceNames(mock: RailwayMock): string[] {
  return [...mock.services.values()].map((s) => s.name).sort();
}

/**
 * The placement mechanism since D57: each environment is provisioned from its own declaration, and the physical
 * service name is decided by what the project already holds. This is the whole test of it -- production keeps
 * the bare names it was created with, staging gets its own services, and the two do not share an identity.
 */
test('every environment is provisioned from its own declaration, and a second one gets its OWN services (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith(() => {});
  const applied = await provider.applyPlan(plan);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));
  assert.equal(applied.services.length, 2, 'production and staging each configured their own service');

  assert.deepEqual(serviceNames(mock), ['api', 'api-staging'], 'the first environment keeps the bare name, the second is named after itself');
  const ids = [...mock.services.values()].map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'two names, two services: staging does not point at production');

  const production = [...mock.environments.values()].find((e) => e.name === 'production')!;
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const api = [...mock.services.values()].find((s) => s.name === 'api')!;
  const apiStaging = [...mock.services.values()].find((s) => s.name === 'api-staging')!;
  assert.ok(mock.instances.has(`${production.id}:${api.id}`), "production's instance is production's service");
  assert.ok(mock.instances.has(`${staging.id}:${apiStaging.id}`), "staging's instance is staging's own service");
  assert.equal(mock.instances.has(`${staging.id}:${api.id}`), false, 'production\'s service has no instance in staging -- that sharing was the bug');
  assert.equal(mock.instances.has(`${production.id}:${apiStaging.id}`), false, 'and staging\'s does not run in production');

  assert.equal(applied.services.find((s) => s.environment === 'staging')!.name, 'api-staging', 'the state row names what the provider calls it');

  // Two services in two environments means two creates, each with the environment-scoped token (measured: a
  // workspace grant is refused by serviceCreate).
  assert.equal(mock.operations.filter((o) => o === 'serviceCreate:project').length, 2, JSON.stringify(mock.operations));
});

/**
 * A plan may be applied many times. Nothing here may rename a service that is already where it belongs, because
 * for a database that is not a rename but a delete-and-create of the thing holding the tenant's data.
 */
test('a re-apply resolves the same physical names, so production is never renamed and staging is never doubled (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith(() => {});
  await provider.applyPlan(plan);
  const before = serviceNames(mock);
  const idsBefore = [...mock.services.values()].map((s) => `${s.name}=${s.id}`).sort();

  // A different planHash, so the idempotency marker cannot short-circuit the apply being observed.
  const again = planWith(() => {});
  again.planHash = 'b'.repeat(16);
  const second = await provider.applyPlan(again);
  assert.deepEqual(second.failures, [], JSON.stringify(second.failures));
  assert.deepEqual(serviceNames(mock), before, 'no third service appeared for a plan that declares two');
  assert.deepEqual([...mock.services.values()].map((s) => `${s.name}=${s.id}`).sort(), idsBefore, 'the same names keep the same ids -- nothing was recreated under a new one');
  assert.equal(mock.services.has('api-production') || [...mock.services.values()].some((s) => s.name === 'api-production'), false, 'production must not be pushed to a suffixed name by a later environment');
});

/**
 * The failure this whole change exists to prevent, asserted where it would be visible: the reference expression
 * IS the database connection, and naming production's service in staging's configuration is staging writing to
 * production's data.
 */
test('each environment references its OWN database service, never the one another environment created (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => {
    for (const environment of p.environments) {
      environment.databases = [{ name: 'app-db', kind: 'postgres' }];
      environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'app-db' }];
    }
  });
  const applied = await provider.applyPlan(plan);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));

  assert.deepEqual(mock.templateDeploys.map((d) => d.serviceName).sort(), ['app-db', 'app-db-staging'], 'one template deploy per environment that declares the database');
  assert.equal(new Set(mock.templateDeploys.map((d) => d.serviceName)).size, 2, 'the same plan name in two environments is two services');

  const production = [...mock.environments.values()].find((e) => e.name === 'production')!;
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const written = (environmentId: string, name: string) => mock.writtenVariables.filter((w) => w.environmentId === environmentId && w.name === name).map((w) => w.value);
  assert.deepEqual(written(production.id, 'DATABASE_URL'), ['${{app-db.DATABASE_URL}}'], 'production references the service it owns');
  assert.deepEqual(written(staging.id, 'DATABASE_URL'), ['${{app-db-staging.DATABASE_URL}}'], 'staging references its own -- the literal that used to point at production');

  const databases = [...mock.services.values()].filter((s) => s.name.startsWith('app-db'));
  assert.equal(databases.length, 2, JSON.stringify(databases));
  assert.ok(applied.verified, 'both environments reached live with their own database');
});

/**
 * E25's measurement stands and is not discarded by the new mechanism: service names are unique per project
 * (`serviceCreate` refuses a duplicate), and `serviceInstanceUpdate` against an environment with no instance
 * there answers true while placing nothing. The mechanism is now per-environment creation, which is exactly why
 * the naming rule exists -- so the only way to reach this state is a service row that exists under the name this
 * environment resolved to but has no instance here.
 *
 * That state splits in two, and they must not be treated the same way.
 */
test('a service row that runs nowhere is reclaimed so the environment can be provisioned, and the apply says so (D55 meets D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith(() => {});
  await provider.applyPlan(plan);

  // The residue of an interrupted apply: staging's environment is gone, its service row is not.
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const apiStaging = [...mock.services.values()].find((s) => s.name === 'api-staging')!;
  mock.instances.delete(`${staging.id}:${apiStaging.id}`);
  mock.environments.delete(staging.id);

  const again = planWith(() => {});
  again.planHash = 'c'.repeat(16);
  const applied = await provider.applyPlan(again);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));
  assert.ok((applied.notes ?? []).some((n) => n.code === 'service-row-reclaimed'), JSON.stringify(applied.notes));
  assert.deepEqual(serviceNames(mock), ['api', 'api-staging'], 'the row was replaced by one service, not by two');
  const fresh = [...mock.services.values()].find((s) => s.name === 'api-staging')!;
  assert.notEqual(fresh.id, apiStaging.id, 'a new row was created for the environment that now exists again');
  assert.equal(applied.verified, true, 'the resume converges instead of reporting the same absence forever');
});

test('a service that runs in ANOTHER environment is reported, never deleted to free the name (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith(() => {});
  await provider.applyPlan(plan);

  // The legacy shape the rule has to live with: one service instance shared across environments, which is what
  // a duplicated environment left behind. Staging wants `api-staging`, that row exists, and it is running in
  // production -- so it is somebody's compute and deleting it would take that environment down with it.
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const production = [...mock.environments.values()].find((e) => e.name === 'production')!;
  const apiStaging = [...mock.services.values()].find((s) => s.name === 'api-staging')!;
  const moved = mock.instances.get(`${staging.id}:${apiStaging.id}`)!;
  mock.instances.delete(`${staging.id}:${apiStaging.id}`);
  mock.instances.set(`${production.id}:${apiStaging.id}`, moved);

  const again = planWith(() => {});
  again.planHash = 'd'.repeat(16);
  const applied = await provider.applyPlan(again);
  const missing = applied.failures.filter((f) => f.code === 'instance-missing-in-environment');
  assert.equal(missing.length, 1, JSON.stringify(applied.failures));
  assert.match(missing[0]!.step, /staging/);
  assert.match(missing[0]!.message, /api-staging/, 'the report names the physical service an operator has to resolve');
  assert.match(missing[0]!.message, /deleting it would|no instance here/, 'and says why the provider will not fix it by force');
  assert.ok(mock.services.has(apiStaging.id), 'the running row was NOT deleted');
  assert.equal(applied.verified, false, 'a service that does not exist in an environment cannot be reported as configured');
});

/**
 * Two declarations, one resolved identity. `api` in an environment that is not the first to claim it resolves
 * to `api-staging`, so a plan that ALSO declares a service literally called `api-staging` describes two
 * services that the rule cannot separate. Provisioning that would merge them silently.
 */
test('two plan names that resolve to one service are refused instead of merged (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => {
    p.environments[1]!.services = [
      { ...p.environments[1]!.services[0]!, name: 'api' },
      { ...p.environments[1]!.services[0]!, name: 'api-staging' },
    ];
    p.environments[1]!.domains = [];
  });
  const applied = await provider.applyPlan(plan);
  const collision = applied.failures.filter((f) => f.code === 'service-name-collision');
  assert.equal(collision.length, 1, JSON.stringify(applied.failures));
  assert.match(collision[0]!.message, /api-staging/);
  assert.deepEqual(serviceNames(mock), ['api'], 'neither colliding service was created -- the plan owns the ambiguity');
  assert.equal(applied.verified, false);
});

/**
 * The rule as a function, separate from the provider, because the deploy script previews it and a tenant reads
 * it: the three branches are the three things the measured API allows.
 */
test('the naming rule: absent means bare, placed-here means bare, present-but-not-here means suffixed (D57)', () => {
  assert.equal(physicalServiceName('api', 'staging', { projectHas: false, placedInEnvironment: false }), 'api', 'a name nobody holds yet is claimed as-is (branch 1)');
  assert.equal(physicalServiceName('api', 'production', { projectHas: true, placedInEnvironment: true }), 'api', 'a service already placed here is not renamed (branch 2)');
  assert.equal(physicalServiceName('api', 'staging', { projectHas: true, placedInEnvironment: false }), 'api-staging', 'a service that belongs to another environment is not borrowed (branch 3)');
  assert.equal(physicalServiceName('Main', 'QA', { projectHas: true, placedInEnvironment: false }), 'Main-qa', 'the suffix is the environment lowercased; the declared name is used as written');
});

/** What `--dry-run` shows: a plan applied to a project that has nothing yet. */
test('a fresh two-environment plan previews its own physical names, suffixed only where the name is taken (D57)', () => {
  const preview = previewPlacement(samplePlan());
  assert.deepEqual([...(preview.get('production') ?? new Map()).values()], ['api', 'app-db'], 'production keeps the bare names');
  assert.deepEqual([...(preview.get('staging') ?? new Map()).values()].sort(), ['api-staging', 'app-db-staging'], 'staging is named after itself, service and database both');
});

test('a single-environment plan keeps bare names, so the suffix is history and not a staging rule (D57)', () => {
  const only = samplePlan();
  only.environments = [only.environments[1]!];
  const preview = previewPlacement(only);
  assert.deepEqual([...(preview.get('staging') ?? new Map()).values()].sort(), ['api', 'app-db'], 'the first environment to arrive owns the bare name, whichever it is');
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

test('the double keeps a cloned environment on the source service ids -- the measured reason cloning is gone (D57)', async () => {
  // Not a platfolio behaviour: a provider fact. `environmentCreate` with a `sourceEnvironmentId` produced a
  // staging whose api had production's service id and therefore production's database configuration, which is
  // how staging came to fail `connect ETIMEDOUT` on a DSN it appeared to own. The double reproduces it so the
  // reason stays testable, and so nobody reintroduces the source field thinking it only copies layout.
  const mock = new RailwayMock();
  const workspace = { kind: 'workspace', token: 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA' } as const;
  const project = await mock.graphql<{ projectCreate: { id: string } }>({
    operation: 'projectCreate', credential: workspace,
    query: 'mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }',
    variables: { input: { name: 'clone-evidence', workspaceId: 'ws-1' } },
  });
  const projectId = project.projectCreate.id;
  const production = await mock.graphql<{ environmentCreate: { id: string } }>({
    operation: 'environmentCreate', credential: workspace,
    query: 'mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id } }',
    variables: { input: { projectId, name: 'production' } },
  });
  const productionId = production.environmentCreate.id;
  const projectToken = { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' } as const;
  const created = await mock.graphql<{ serviceCreate: { id: string } }>({
    operation: 'serviceCreate', credential: projectToken,
    query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
    variables: { input: { projectId, environmentId: productionId, name: 'api', source: { image: `${IMAGE}@${DIGEST}` } } },
  });
  const staged = await mock.graphql<{ environmentCreate: { id: string } }>({
    operation: 'environmentCreate', credential: workspace,
    query: 'mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id } }',
    variables: { input: { projectId, name: 'staging', sourceEnvironmentId: productionId } },
  });
  const duplicated = [...mock.instances.keys()].find((k) => k.startsWith(`${staged.environmentCreate.id}:`))!;
  assert.equal(duplicated.split(':')[1], created.serviceCreate.id, 'the duplicate points at the SAME service -- including when that service is a database');
});

test('the double refuses a serviceCreate for a name the project already holds (measured)', async () => {
  const mock = new RailwayMock();
  const workspace = { kind: 'workspace', token: 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA' } as const;
  const project = await mock.graphql<{ projectCreate: { id: string } }>({
    operation: 'projectCreate', credential: workspace,
    query: 'mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }',
    variables: { input: { name: 'unique-names', workspaceId: 'ws-1' } },
  });
  const projectToken = { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' } as const;
  const environments = ['production', 'staging'].map((name) => ({ name, id: `env-${name}` }));
  for (const environment of environments) {
    mock.environments.set(environment.id, { id: environment.id, projectId: project.projectCreate.id, name: environment.name });
  }
  await mock.graphql({
    operation: 'serviceCreate', credential: projectToken,
    query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
    variables: { input: { projectId: project.projectCreate.id, environmentId: 'env-production', name: 'api', source: { image: `${IMAGE}@${DIGEST}` } } },
  });
  // The refusal is per PROJECT, so asking for the same name in the OTHER environment is still refused -- which
  // is the whole reason a second environment needs a distinct physical name.
  await assert.rejects(
    () => mock.graphql({
      operation: 'serviceCreate', credential: projectToken,
      query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
      variables: { input: { projectId: project.projectCreate.id, environmentId: 'env-staging', name: 'api', source: { image: `${IMAGE}@${DIGEST}` } } },
    }),
    /already exists in this project/,
  );
});

test('the double reproduces the silent no-op rather than helping the provider look right (E25)', async () => {
  // Kept as the measurement it was: `serviceInstanceUpdate` for a service with no instance in an environment
  // returns success and changes nothing. The provider does not rely on discovering this at write time -- the
  // placement read decides, and the naming rule (D57) is what keeps a second environment off the name in the
  // first place -- but a double that threw NOT_FOUND here would hide the whole class of bug.
  const mock = new RailwayMock();
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} });
  await provider.applyPlan(planWith(() => {}));
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const productionApi = [...mock.services.values()].find((s) => s.name === 'api')!;
  assert.equal(mock.instances.has(`${staging.id}:${productionApi.id}`), false, 'staging does not hold production’s service');
  const updated = await mock.graphql<{ serviceInstanceUpdate: boolean }>({
    operation: 'serviceInstanceUpdate',
    credential: { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' },
    query: 'mutation ($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) }',
    variables: { environmentId: staging.id, serviceId: productionApi.id, input: { numReplicas: 3 } },
  });
  assert.equal(updated.serviceInstanceUpdate, true, 'the API says yes');
  assert.equal(mock.instances.has(`${staging.id}:${productionApi.id}`), false, 'and placed nothing');
});

test('the provider never creates an environment from a source (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => {
    p.environments.push({ ...p.environments[1]!, name: 'qa', domains: [], databases: [], buckets: [] });
  });
  await provider.applyPlan(plan);
  assert.deepEqual(mock.environmentCreates.map((e) => e.name).sort(), ['qa', 'staging'], 'every declared environment beyond the first is created');
  for (const created of mock.environmentCreates) {
    assert.equal(created.sourceEnvironmentId, undefined, `${created.name} was created from a source; a duplicated environment inherits the source's database (measured)`);
  }
  assert.deepEqual(serviceNames(mock), ['api', 'api-qa', 'api-staging'], 'each one gets its own service, named by the rule');
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

/**
 * D53 and D57 meet here: a tenant addresses a secret by the name their description declares (`api`), and that
 * name belongs to a different service in each environment. Resolving it project-wide by name -- which is what
 * the provider did before the naming rule -- would write staging's credential onto production's service and
 * then report it as delivered, because the read-back would be looking at the same wrong service.
 */
test('a secret addressed by the plan name lands on that environment’s own service, not on the first match (D57)', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'per-environment-secret' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const staging = [...mock.environments.values()].find((e) => e.name === 'staging')!;
  const production = [...mock.environments.values()].find((e) => e.name === 'production')!;
  const apiStaging = [...mock.services.values()].find((s) => s.name === 'api-staging')!;
  const api = [...mock.services.values()].find((s) => s.name === 'api')!;

  const delivered = await provider.putSecretValue!({ instanceId: 'per-environment-secret', environment: 'staging', service: 'api', name: 'SESSION_KEY', value: 'staging-only' });
  assert.equal(delivered.ok, true, JSON.stringify(delivered));
  assert.equal(delivered.verified, true);
  assert.deepEqual(
    mock.writtenVariables.filter((w) => w.name === 'SESSION_KEY'),
    [{ name: 'SESSION_KEY', value: 'staging-only', environmentId: staging.id, serviceId: apiStaging.id }],
    'exactly one write: staging environment, staging service',
  );
  assert.equal(mock.instances.get(`${production.id}:${api.id}`)!.variables.has('SESSION_KEY'), false, 'production’s service did not receive staging’s credential');

  const presence = await provider.secretPresence!({ instanceId: 'per-environment-secret', environment: 'staging', service: 'api', names: ['SESSION_KEY'] });
  assert.equal(presence.SESSION_KEY, 'set', 'and the read-back looks at the same environment the write did');
  const elsewhere = await provider.secretPresence!({ instanceId: 'per-environment-secret', environment: 'production', service: 'api', names: ['SESSION_KEY'] });
  assert.equal(elsewhere.SESSION_KEY, 'missing', 'the same name in the other environment is still absent');
});

test('the double refuses an attachment call that omits a NON_NULL field -- the mistake the live API caught', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'required-check' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const environmentId = [...mock.environments.values()].find((e) => e.name === 'production')!.id;
  const projectId = [...mock.projects.values()][0]!.id;

  // Exactly what my first implementation sent: enabledServiceIds without disabledServiceIds.
  await assert.rejects(
    () => mock.graphql({
      operation: 'sharedVariableConfigure',
      query: 'mutation ($input: SharedVariableConfigureInput!) { sharedVariableConfigure(input: $input) { id } }',
      variables: { input: { projectId, environmentId, name: 'X', enabledServiceIds: ['svc-1'] } },
      credential: { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' },
    }),
    /disabledServiceIds.*String!|is not defined\. Expected a value/i,
    'the double must reject the omission the real API rejects, or it is teaching the wrong lesson',
  );

  // And the provider now sends both, so the same call shape it produces goes through.
  const ok = await provider.putSecretValue!({ instanceId: 'required-check', environment: 'production', service: 'api', name: 'X', value: 'v', source: 'shared-variable' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.verified, true, 'write plus attachment leaves the declaring service able to read the name');
});
