import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, physicalServiceName, planIssues, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const IMAGE = 'docker.io/library/nginx:alpine';
const DIGEST = `sha256:${'b'.repeat(64)}`;

function planWith(mutate: (plan: InfraPlan) => void = () => {}): InfraPlan {
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

function environmentId(mock: RailwayMock, name: string): string {
  return [...mock.environments.values()].find((e) => e.name === name)!.id;
}

function serviceByNames(mock: RailwayMock, name: string) {
  return [...mock.services.values()].find((s) => s.name === name);
}

/** Rename the rows for ONE environment back to their bare logical names, leaving the other environment's suffix. */
function renameRowsBare(mock: RailwayMock, environment: string, mapping: Record<string, string>): void {
  const envId = environmentId(mock, environment);
  for (const [physical, bare] of Object.entries(mapping)) {
    const row = serviceByNames(mock, physical);
    assert.ok(row, `setup: no service named "${physical}"`);
    assert.ok(mock.instances.has(`${envId}:${row.id}`), `setup: "${physical}" has no instance in ${environment}`);
    row.name = bare;
  }
}

/**
 * The rule, as a function, separate from the provider: two arguments, no observation, and the same answer for
 * every environment. The rule it replaced asked the project what it held before deciding, which is why the
 * bare production names survived; this cannot, and that is the point.
 */
test('the naming rule is `{name}-{environment}` for every environment, with no exception and no observation (D57)', () => {
  assert.equal(physicalServiceName('api', 'production'), 'api-production', 'production is suffixed like every other environment');
  assert.equal(physicalServiceName('api', 'staging'), 'api-staging');
  assert.equal(physicalServiceName('main', 'production'), 'main-production');
  assert.equal(physicalServiceName('Main', 'QA'), 'Main-qa', 'the suffix is lowercased; the declared name is used as written');
  // The signature has no third parameter: nothing about the project can be consulted to decide a name.
  assert.equal(physicalServiceName.length, 2, 'the rule takes the logical name and the environment, nothing else');
});

/**
 * Both environments come from ONE plan and both are suffixed. Under the observational rule the first
 * environment to arrive kept the bare name, so the answer depended on creation order; it may no longer.
 */
test('production and staging both get suffixed names from the same plan -- nothing keeps a bare name (D57)', async () => {
  const { provider, mock } = harness();
  const applied = await provider.applyPlan(planWith());
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));

  assert.deepEqual(serviceNames(mock), ['api-production', 'api-staging'], 'both environments are named, neither borrows the bare name');
  assert.equal(mock.renames.length, 0, 'a fresh project has nothing to rename');

  const api = serviceByNames(mock, 'api-production')!;
  const apiStaging = serviceByNames(mock, 'api-staging')!;
  assert.notEqual(api.id, apiStaging.id, 'two names, two services');
  assert.ok(mock.instances.has(`${environmentId(mock, 'production')}:${api.id}`), "production's instance is production's service");
  assert.ok(mock.instances.has(`${environmentId(mock, 'staging')}:${apiStaging.id}`), "staging's instance is staging's own service");
  assert.equal(mock.instances.has(`${environmentId(mock, 'staging')}:${api.id}`), false, 'production’s service does not run in staging');

  assert.deepEqual(applied.services.map((s) => `${s.environment}/${s.name}`).sort(), ['production/api-production', 'staging/api-staging'], 'the state rows name what the provider calls them');
  assert.equal(mock.operations.filter((o) => o === 'serviceCreate:project').length, 2, 'each environment created its own');
});

/**
 * The re-apply is the case the observational rule existed to serve: it must not rename, replace or duplicate
 * anything. Determinism makes that a property of the rule rather than of the read.
 */
test('a re-apply resolves the same names, renames nothing and recreates nothing (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith();
  await provider.applyPlan(plan);
  const before = serviceNames(mock);
  const idsBefore = [...mock.services.values()].map((s) => `${s.name}=${s.id}`).sort();

  const again = planWith();
  again.planHash = 'b'.repeat(16);
  const second = await provider.applyPlan(again);
  assert.deepEqual(second.failures, [], JSON.stringify(second.failures));
  assert.deepEqual(serviceNames(mock), before);
  assert.deepEqual([...mock.services.values()].map((s) => `${s.name}=${s.id}`).sort(), idsBefore, 'the same names keep the same ids');
  assert.deepEqual(mock.renames, [], 'nothing was renamed by a plan that declares the names the project already holds');
  assert.equal(mock.operations.filter((o) => o === 'serviceDelete:workspace').length, 0, 'and nothing was deleted');
});

/**
 * The failure the naming rule exists to prevent, asserted where it would be visible: the reference expression
 * IS the database connection, and spelling another environment's database in this environment's configuration
 * is this environment writing data it does not own.
 */
test('each environment references its OWN database, spelled with its own suffix (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => {
    for (const environment of p.environments) {
      environment.databases = [{ name: 'app-db', kind: 'postgres' }];
      environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'app-db' }];
    }
  });
  const applied = await provider.applyPlan(plan);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));

  assert.deepEqual(mock.templateDeploys.map((d) => d.serviceName).sort(), ['app-db-production', 'app-db-staging'], 'one template deploy per environment that declares the database, both suffixed');
  const written = (environment: string, name: string) => mock.writtenVariables.filter((w) => w.environmentId === environmentId(mock, environment) && w.name === name).map((w) => w.value);
  assert.deepEqual(written('production', 'DATABASE_URL'), ['${{app-db-production.DATABASE_URL}}'], 'production references the service it owns');
  assert.deepEqual(written('staging', 'DATABASE_URL'), ['${{app-db-staging.DATABASE_URL}}'], 'and so does staging -- never the bare name');
  assert.ok(applied.verified, 'both environments reached live with their own database');
});

/* ------------------------------------------------------------------------------------ legacy migration */

/**
 * The migration the maintainer specified: a row that does not fit the convention is moved onto it. It is
 * moved with `serviceUpdate`, not by deletion, because deleting a Railway service destroys its environments
 * and its database volume -- and the captured schema says a name is a SERVICE field, so the move is a rename.
 */
test('a legacy bare row that runs in this environment is RENAMED into the convention, not replaced (D57)', async () => {
  const { provider, mock } = harness();
  await provider.applyPlan(planWith());
  const apiId = serviceByNames(mock, 'api-production')!.id;
  renameRowsBare(mock, 'production', { 'api-production': 'api' });
  mock.renames.length = 0;

  const again = planWith();
  again.planHash = 'c'.repeat(16);
  const applied = await provider.applyPlan(again);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));

  assert.deepEqual(mock.renames, [{ id: apiId, from: 'api', to: 'api-production', at: mock.renames[0]!.at }], 'the row that held production moved onto the convention -- same id, new name');
  assert.equal(serviceByNames(mock, 'api')?.id, undefined, 'the bare name is gone');
  assert.equal(serviceByNames(mock, 'api-production')!.id, apiId, 'the service is the SAME service, so its volume, instances, domains and network followed it');
  assert.ok((applied.notes ?? []).some((n) => n.code === 'legacy-service-renamed'), JSON.stringify(applied.notes));
  assert.equal(mock.operations.filter((o) => o === 'serviceDelete:workspace').length, 0, 'nothing was deleted to fix a name');
  assert.deepEqual(serviceNames(mock), ['api-production', 'api-staging'], 'two environments, two rows, no third');
});

/**
 * A legacy DATABASE row. This is the case the destructive reading of the brief would have destroyed: the row
 * holds platfolio's own database, and delete-and-recreate takes the volume and the data with it.
 */
test('a legacy bare database row is renamed and the note says the data survived (D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => {
    for (const environment of p.environments) {
      environment.databases = [{ name: 'main', kind: 'postgres' }];
      environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'main' }];
    }
  });
  await provider.applyPlan(plan);
  const mainId = serviceByNames(mock, 'main-production')!.id;
  renameRowsBare(mock, 'production', { 'main-production': 'main', 'api-production': 'api' });
  mock.renames.length = 0;
  // What a legacy project really holds: the referencing service was wired against the BARE name, and Railway
  // expanded that expression at write time, so the stored value spells the old name.
  await mock.graphql({
    operation: 'variableUpsert', credential: { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' },
    query: 'mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
    variables: { input: { projectId: [...mock.projects.keys()][0], environmentId: environmentId(mock, 'production'), serviceId: serviceByNames(mock, 'api')!.id, name: 'DATABASE_URL', value: '${{main.DATABASE_URL}}', skipDeploys: true } },
  });

  const again = planWith((p) => {
    for (const environment of p.environments) {
      environment.databases = [{ name: 'main', kind: 'postgres' }];
      environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'main' }];
    }
  });
  again.planHash = 'd'.repeat(16);
  // Everything the migration is allowed to write starts here: the journal already holds the ORIGINAL apply's
  // writes, which spelled the same physical name, and counting those would make the ordering assertion below
  // pass no matter what the migration did.
  const writesBeforeMigration = mock.writtenVariables.length;
  const applied = await provider.applyPlan(again);

  const rename = mock.renames.find((r) => r.id === mainId);
  assert.ok(rename, `the database row was not renamed: ${JSON.stringify(mock.renames)}`);
  assert.equal(rename.from, 'main');
  assert.equal(rename.to, 'main-production');
  assert.equal(serviceByNames(mock, 'main-production')!.id, mainId, 'the same service -- so the volume and its data were not replaced');
  assert.equal(mock.operations.filter((o) => o === 'serviceDelete:workspace').length, 0, 'serviceDelete was never called: a naming question was not answered by destroying a database');

  const note = (applied.notes ?? []).find((n) => n.code === 'legacy-database-renamed');
  assert.ok(note, JSON.stringify(applied.notes));
  assert.match(note.message, /volume and all the data on it were NOT destroyed/, 'the note has to say the data survived, in as many words');
  assert.equal((applied.notes ?? []).filter((n) => n.code === 'legacy-service-renamed' && n.step.includes('main-production')).length, 0, 'one note per rename, not the same row described twice');

  // The ordering, proven rather than reasoned about: a reference expression is expanded when it is WRITTEN,
  // so the rewrite is only correct if the rename landed first.
  const migrationWrites = mock.writtenVariables.slice(writesBeforeMigration);
  const dbWrite = migrationWrites.find((w) => w.environmentId === environmentId(mock, 'production') && w.value === '${{main-production.DATABASE_URL}}');
  assert.ok(dbWrite, `the migration never rewrote the reference with the new spelling: ${JSON.stringify(migrationWrites.map((w) => w.value))}`);
  assert.ok(rename.at < dbWrite.at, `rename (operation ${String(rename.at)}) must precede the FIRST rewrite (operation ${String(dbWrite.at)}): Railway expands the expression at write time, so a rewrite before the rename expands against a target that does not exist yet`);
  assert.equal(migrationWrites.filter((w) => w.environmentId === environmentId(mock, 'production') && w.name === 'DATABASE_URL').at(-1)!.value, '${{main-production.DATABASE_URL}}', 'and the last word in the provider is the new spelling');
});

/**
 * Write-time expansion has a second consequence the operator has to be told: the rewrite changes what the
 * provider STORED, not what the running container is USING. Silent here is how #242 became a 3am call.
 */
test('after a database rename the operator is told which services must be redeployed (D57, #242)', async () => {
  const { provider, mock } = harness();
  const plan = planWith((p) => {
    for (const environment of p.environments) {
      environment.databases = [{ name: 'main', kind: 'postgres' }];
      environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'main' }];
    }
  });
  await provider.applyPlan(plan);
  renameRowsBare(mock, 'production', { 'main-production': 'main', 'api-production': 'api' });

  const again = planWith((p) => {
    for (const environment of p.environments) {
      environment.databases = [{ name: 'main', kind: 'postgres' }];
      environment.services[0]!.references = [{ variable: 'DATABASE_URL', database: 'main' }];
    }
  });
  again.planHash = 'e'.repeat(16);
  const applied = await provider.applyPlan(again);

  const note = (applied.notes ?? []).find((n) => n.code === 'legacy-reference-redeploy-required');
  assert.ok(note, `the rewrite was reported without naming the services still running the old value: ${JSON.stringify(applied.notes)}`);
  assert.match(note.message, /api/, 'the referencing service is named');
  assert.match(note.message, /main-production\.DATABASE_URL/, 'and the new spelling is quoted, so the rewrite is checkable without reading a value');
  assert.match(note.message, /WRITE TIME|write time/, 'the note says WHY a redeploy is needed');
  assert.match(note.message, /--redeploy=/, 'and gives the command that does it');
});

/* --------------------------------------------------------------------------------- rows not ours to touch */

/**
 * A row that two environments run at once is the shape environment-cloning left behind. Renaming it for one
 * of them would leave the other free to provision a SECOND service over the same data, so the provider picks
 * neither.
 */
test('a legacy row shared by two environments is refused, never renamed (D57)', async () => {
  const { provider, mock } = harness();
  await provider.applyPlan(planWith());
  const apiId = serviceByNames(mock, 'api-production')!.id;
  renameRowsBare(mock, 'production', { 'api-production': 'api' });
  // Make it genuinely shared: staging's instance now hangs off the SAME bare row, and staging's own row is gone.
  const stagingRow = serviceByNames(mock, 'api-staging')!;
  const stagingId = environmentId(mock, 'staging');
  mock.instances.set(`${stagingId}:${apiId}`, mock.instances.get(`${stagingId}:${stagingRow.id}`)!);
  mock.instances.delete(`${stagingId}:${stagingRow.id}`);
  mock.services.delete(stagingRow.id);

  const again = planWith();
  again.planHash = 'f'.repeat(16);
  const applied = await provider.applyPlan(again);
  const ambiguous = applied.failures.filter((f) => f.code === 'legacy-service-ambiguous');
  // One row, two environments, and each environment that wants it reports: the refusal is per environment
  // because each one is separately tempted to rename it.
  assert.equal(ambiguous.length, 2, JSON.stringify(applied.failures));
  assert.deepEqual(ambiguous.map((f) => f.step).sort(), ['services.api@production', 'services.api@staging']);
  assert.match(ambiguous[0]!.message, /api/);
  assert.ok(ambiguous[0]!.message.includes(apiId), `the report names the service an operator has to split: ${ambiguous[0]!.message}`);
  assert.match(ambiguous[0]!.message, /Nothing was renamed and nothing was deleted/);
  assert.equal(mock.renames.length, 0, 'and that is true, not aspiration');
  assert.equal(serviceByNames(mock, 'api')!.id, apiId, 'the shared row keeps its name');
  assert.equal(applied.verified, false, 'an unresolved naming question cannot be reported as a finished apply');
});

/**
 * A bare row that runs in ANOTHER environment is that environment's service. Applying staging must not
 * rename production's row -- it provisions its own and says what it left.
 */
test('a bare row running only in another environment is left alone while this one provisions its own (D57)', async () => {
  const { provider, mock } = harness();
  await provider.applyPlan(planWith());
  const apiId = serviceByNames(mock, 'api-production')!.id;
  renameRowsBare(mock, 'production', { 'api-production': 'api' });
  // Staging has nothing: its row and instance are gone, so only production's bare row is left in the project.
  const stagingRow = serviceByNames(mock, 'api-staging')!;
  mock.instances.delete(`${environmentId(mock, 'staging')}:${stagingRow.id}`);
  mock.services.delete(stagingRow.id);
  mock.renames.length = 0;

  // Same instanceId: the PROJECT is keyed on it, and the legacy row lives in that project. Dropping to a
  // staging-only environment list is what "applying only staging against the legacy project" means.
  const stagingOnly = planWith();
  stagingOnly.planHash = '0'.repeat(16);
  stagingOnly.environments = [stagingOnly.environments[1]!];
  const applied = await provider.applyPlan(stagingOnly);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));
  assert.equal(mock.renames.length, 0, `the provider renamed nothing: ${JSON.stringify(mock.renames)}`);
  assert.equal(serviceByNames(mock, 'api')!.id, apiId, 'and it is still there under its bare name');
  assert.ok(serviceByNames(mock, 'api-staging'), 'staging got its own row instead of borrowing one');
  const note = (applied.notes ?? []).find((n) => n.code === 'legacy-row-belongs-to-another-environment');
  assert.ok(note, JSON.stringify(applied.notes));
  assert.match(note.message, /production/, 'the note names the environment that actually runs it');
});

/**
 * The residue case, and the one place this provider chooses INACTION over a fix. A bare row that runs in no
 * environment cannot be renamed onto the target name: the captured schema has no `serviceInstanceCreate`, so
 * the only mutation that places an instance is `serviceCreate`, and that refuses a name the project already
 * holds. Renaming would install the name with nothing behind it and block the create forever. Deleting would
 * destroy a service whose volume may still hold a tenant's data and still be billing. So the apply provisions
 * its own row alongside and tells an operator, in as many words, what it declined to do and why.
 */
test('a bare row that runs in NO environment is left alone: not renamed, not deleted, reported in full (D57, D36/D43)', async () => {
  const { provider, mock } = harness();
  await provider.applyPlan(planWith());
  const apiId = serviceByNames(mock, 'api-production')!.id;
  // The residue of an interrupted apply: a row under the bare name with no instance anywhere.
  mock.instances.delete(`${environmentId(mock, 'production')}:${apiId}`);
  serviceByNames(mock, 'api-production')!.name = 'api';
  mock.renames.length = 0;

  const again = planWith();
  again.planHash = '1'.repeat(16);
  const applied = await provider.applyPlan(again);

  assert.equal(mock.operations.filter((o) => o.startsWith('serviceDelete')).length, 0, 'NOT one delete: the disk this row may own is the operator\'s to destroy, never a side effect of a successful apply');
  assert.deepEqual(mock.renames, [], 'and no rename either -- renaming an unplaced row onto the target would block the only mutation that can place an instance');
  assert.ok(serviceByNames(mock, 'api'), 'the residue row is still in the project, named as it was found');
  assert.ok(serviceByNames(mock, 'api-production'), 'the environment was still provisioned, alongside it');
  assert.ok(mock.operations.includes('serviceCreate:project'), 'by create, which is the only placer');

  const note = (applied.notes ?? []).find((n) => n.code === 'legacy-row-left-unplaced');
  assert.ok(note, `the row platfolio declined to touch was not reported: ${JSON.stringify(applied.notes)}`);
  assert.match(note.message, /NO instance in ANY environment/);
  assert.ok(note.message.includes(apiId), `the note names the service id an operator has to act on: ${note.message}`);
  assert.match(note.message, /did NOT delete it and did NOT rename it/);
  assert.match(note.message, /volume/, 'and that it may still own a volume, which costs money while it exists');
  assert.match(note.message, /destroy path|operator/, 'and who owns the destructive decision');
});

/**
 * The ownership rule, asserted by refusing to touch a row the plan does not name. Nothing is inferred from a
 * description or from a project marker: a row is only a candidate when its CURRENT name is a logical name this
 * plan declares.
 */
test('a service this plan does not declare is never renamed, even when it is the only candidate (D57)', async () => {
  // The ownership rule in one sentence: a row is a rename candidate only when its CURRENT name is a logical
  // name THIS plan declares. Asserted against the shape that would tempt a looser lookup -- a project with a
  // running row the plan knows nothing about, and no row at all under the name the plan wants. A "find any row
  // that is not already correct" rule would rename the hand-made service and destroy its identity.
  const { provider, mock } = harness();
  await provider.applyPlan(planWith());
  const projectId = [...mock.services.values()][0]!.projectId;
  const productionId = environmentId(mock, 'production');
  // Production's row is gone entirely (the shape a hand-cleaned project leaves), so `api-production` is free.
  const gone = serviceByNames(mock, 'api-production')!;
  mock.instances.delete(`${productionId}:${gone.id}`);
  mock.services.delete(gone.id);
  // A hand-made service, running in production, that no plan of ours names.
  mock.services.set('svc-hand-made', { id: 'svc-hand-made', projectId, name: 'metrics' });
  mock.instances.set(`${productionId}:svc-hand-made`, {
    instanceId: 'inst-hand', status: 'SUCCESS', image: 'x', numReplicas: 1, domains: [], polls: 99, variables: new Set(),
  });
  mock.renames.length = 0;

  const again = planWith();
  again.planHash = '3'.repeat(16);
  const applied = await provider.applyPlan(again);
  assert.deepEqual(applied.failures, [], JSON.stringify(applied.failures));
  assert.deepEqual(mock.renames, [], `the provider renamed a row this plan never declared: ${JSON.stringify(mock.renames)}`);
  assert.ok(mock.services.has('svc-hand-made'), 'the hand-made service survives untouched');
  assert.equal(serviceByNames(mock, 'metrics')!.id, 'svc-hand-made', 'still under its own name');
  assert.ok(serviceByNames(mock, 'api-production'), 'and the environment got its own row by CREATE, the only placer');
  assert.equal(mock.operations.includes('serviceUpdate:workspace'), false, 'no rename call was made at all');
});

/**
 * The other half of the ownership rule, asserted where it would be silently wrong: a row that DOES carry a
 * name the plan declares, but has no instance in this environment, is not delivered to. Writing a credential
 * onto a service that runs nowhere would report `verified` against a container that cannot receive it.
 */
test('a name the plan declares is not delivered to when the row runs nowhere in this environment (D57, D53)', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'unplaced-delivery' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const apiId = serviceByNames(mock, 'api-production')!.id;
  mock.instances.delete(`${environmentId(mock, 'production')}:${apiId}`);

  const result = await provider.putSecretValue!({ instanceId: 'unplaced-delivery', environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'abc123' });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal((result as { code: string }).code, 'not-found', 'a row with no instance here is not this environment’s service');
  assert.equal(mock.writtenVariables.some((w) => w.name === 'SESSION_KEY'), false, 'nothing was written to a service that cannot run it');
});

/**
 * D55 and D57 meet here: a matching marker buys a COVERAGE CHECK, not a certificate, and coverage asks with
 * the same deterministic rule the apply provisions by. If it asked by bare name it would certify a plan whose
 * staging was never built -- the exact false `noop` that made `verified` mean something it had not done.
 */
test('a matching marker still checks coverage by the deterministic rule and resumes instead of reporting noop (D55 meets D57)', async () => {
  const { provider, mock } = harness();
  const plan = planWith();
  await provider.applyPlan(plan);
  // staging's row exists but runs nowhere: an interrupted apply, or an environment deleted underneath it.
  const stagingRow = serviceByNames(mock, 'api-staging')!;
  mock.instances.delete(`${environmentId(mock, 'staging')}:${stagingRow.id}`);

  const again = planWith();
  // SAME planHash as the first apply, so the marker matches and the coverage path is the thing under test.
  const applied = await provider.applyPlan(again);
  assert.equal(applied.noop, false, 'a marker with missing state is not a no-op');
  const note = (applied.notes ?? []).find((n) => n.code === 'marker-without-state');
  assert.ok(note, `the resume was silent: ${JSON.stringify(applied.notes)}`);
  assert.match(note.message, /api-staging/, 'the coverage report names the physical row that is absent, not the logical one');
  assert.ok(mock.instances.has(`${environmentId(mock, 'staging')}:${serviceByNames(mock, 'api-staging')!.id}`), 'and the resume placed it');
});

/**
 * The rename is verified by read-back, not by the call answering. This API's measured habit is to answer truly
 * and change nothing (E25's `serviceInstanceUpdate` on an unplaced instance), and a rename believed from a 2xx
 * would provision a whole environment on top of a row that never moved.
 */
test('a rename the provider does not confirm is refused, not provisioned on top of (read-back, not 2xx)', async () => {
  const mock = new RailwayMock({ renameDoesNothing: true });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} });
  await provider.applyPlan(planWith());
  renameRowsBare(mock, 'production', { 'api-production': 'api' });
  mock.renames.length = 0;

  const again = planWith();
  again.planHash = '4'.repeat(16);
  const applied = await provider.applyPlan(again);
  const refused = applied.failures.filter((f) => f.code === 'legacy-service-rename-unverified');
  assert.equal(refused.length, 1, JSON.stringify(applied.failures));
  assert.match(refused[0]!.message, /instead of "api-production"/, 'the report says what came back and what was asked for');
  assert.equal(serviceByNames(mock, 'api')?.name, 'api', 'the row really did not move -- the double is not helping the provider look right');
  assert.equal(applied.verified, false, 'an unconfirmed rename cannot be reported as a finished apply');
});

/* --------------------------------------------------------------------------------------- plan hygiene */

/**
 * The guard that replaced `placementCollisions`. With a deterministic rule two DIFFERENT logical names cannot
 * resolve to the same service, so the only way left to ask for one Railway service twice is to declare the
 * same logical name twice -- and `InfraPlan.services` is an ARRAY, so that is expressible at exactly the
 * boundary the API and `plan/from-repository` hand a provider. Asserted here rather than inherited from the
 * manifest renderer, whose keyed map makes it unrepresentable upstream.
 */
test('a plan that declares the same service twice is refused before a provider sees it (D57)', () => {
  const plan = planWith((p) => {
    const first = p.environments[1]!.services[0]!;
    p.environments[1]!.services = [{ ...first }, { ...first }];
  });
  const codes = planIssues(plan).map((i) => i.code);
  assert.ok(codes.includes('duplicate-service'), JSON.stringify(planIssues(plan)));

  const databases = planWith((p) => {
    p.environments[1]!.databases = [{ name: 'app-db', kind: 'postgres' }, { name: 'app-db', kind: 'postgres' }];
  });
  assert.ok(planIssues(databases).map((i) => i.code).includes('duplicate-database'), JSON.stringify(planIssues(databases)));

  const clean = planWith();
  assert.deepEqual(planIssues(clean).filter((i) => i.code === 'duplicate-service' || i.code === 'duplicate-database'), [], 'a two-environment plan that declares `api` once per environment is the normal case, not a duplicate');
});

/**
 * `applyPlan` refuses the same plan the validator does, so the guard cannot be skipped by calling the verb
 * directly instead of the check.
 */
test('applyPlan refuses a duplicate-name plan rather than provisioning one service twice (D57)', async () => {
  const { provider } = harness();
  const plan = planWith((p) => {
    const first = p.environments[1]!.services[0]!;
    p.environments[1]!.services = [{ ...first }, { ...first }];
  });
  // `applyPlan` throws the FIRST issue as `path: message`, so the assertion is on the message the operator
  // reads -- the `duplicate-service` code is asserted in the planIssues test above, where it is produced.
  await assert.rejects(() => provider.applyPlan(plan), /declared more than once/);
});

/* -------------------------------------------------------------------------- measured provider properties */

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
  // is why a deterministic per-environment suffix is the only naming scheme this API can host.
  await assert.rejects(
    () => mock.graphql({
      operation: 'serviceCreate', credential: projectToken,
      query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
      variables: { input: { projectId: project.projectCreate.id, environmentId: 'env-staging', name: 'api', source: { image: `${IMAGE}@${DIGEST}` } } },
    }),
    /already exists in this project/,
  );
});

test('the double refuses a rename onto a name the project already holds (derived from measured uniqueness)', async () => {
  // Service names are unique per project: measured for `serviceCreate` and `templateDeployV2`. Uniqueness is a
  // property of the project's service set rather than of the call that changes it, so the double enforces it
  // on rename too -- but NO platfolio behaviour depends on this refusal, because the provider checks the
  // target name itself and refuses first. It exists so that a future provider which leaned on the API to
  // arbitrate fails here instead of passing on an assumption.
  const mock = new RailwayMock();
  const workspace = { kind: 'workspace', token: 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA' } as const;
  const project = await mock.graphql<{ projectCreate: { id: string } }>({
    operation: 'projectCreate', credential: workspace,
    query: 'mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }',
    variables: { input: { name: 'rename-collision', workspaceId: 'ws-1' } },
  });
  const projectId = project.projectCreate.id;
  const make = async (name: string) => (await mock.graphql<{ serviceCreate: { id: string } }>({
    operation: 'serviceCreate', credential: { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' },
    query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
    variables: { input: { projectId, environmentId: [...mock.environments.values()][0]!.id, name, source: { image: `${IMAGE}@${DIGEST}` } } },
  })).serviceCreate.id;
  const first = await make('api-production');
  const second = await make('api');
  await assert.rejects(
    () => mock.graphql({
      operation: 'serviceUpdate', credential: workspace,
      query: 'mutation ($id: String!, $input: ServiceUpdateInput!) { serviceUpdate(id: $id, input: $input) { id name } }',
      variables: { id: second, input: { name: 'api-production' } },
    }),
    /already exists in this project/,
  );
  assert.equal(mock.services.get(second)!.name, 'api', 'the refused rename changed nothing');
  assert.equal(mock.services.get(first)!.name, 'api-production');
});

test('the double reproduces the silent no-op rather than helping the provider look right (E25)', async () => {
  // Kept as the measurement it was: `serviceInstanceUpdate` for a service with no instance in an environment
  // returns success and changes nothing. The provider does not rely on discovering this at write time -- the
  // placement check decides, and the naming rule is what keeps a second environment off the name in the first
  // place -- but a double that threw NOT_FOUND here would hide the whole class of bug.
  const mock = new RailwayMock();
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} });
  await provider.applyPlan(planWith());
  const staging = environmentId(mock, 'staging');
  const productionApi = serviceByNames(mock, 'api-production')!;
  assert.equal(mock.instances.has(`${staging}:${productionApi.id}`), false, 'staging does not hold production’s service');
  const updated = await mock.graphql<{ serviceInstanceUpdate: boolean }>({
    operation: 'serviceInstanceUpdate',
    credential: { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' },
    query: 'mutation ($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) }',
    variables: { environmentId: staging, serviceId: productionApi.id, input: { numReplicas: 3 } },
  });
  assert.equal(updated.serviceInstanceUpdate, true, 'the API says yes');
  assert.equal(mock.instances.has(`${staging}:${productionApi.id}`), false, 'and placed nothing');
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
  assert.deepEqual(serviceNames(mock), ['api-production', 'api-qa', 'api-staging'], 'each one gets its own service, named by the rule');
});

/* --------------------------------------------------------------------------------- secret addressing */

test('a shared-variable secret is written at environment scope and attached to the declaring service', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'shared-delivery' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const envId = environmentId(mock, 'production');
  const apiId = serviceByNames(mock, 'api-production')!.id;

  const result = await provider.putSecretValue!({
    instanceId: 'shared-delivery', environment: 'production', service: 'api',
    name: 'PLATFOLIO_GITHUB_APP_ID', value: '5694176', source: 'shared-variable',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true, 'delivery is not complete until the declaring service can read the name');

  assert.equal(mock.sharedVariables.get(`${envId}:PLATFOLIO_GITHUB_APP_ID`), '5694176', 'the value belongs to the environment');
  const apiInstance = mock.instances.get(`${envId}:${apiId}`)!;
  assert.equal(apiInstance.variables.has('PLATFOLIO_GITHUB_APP_ID'), false, 'a shared delivery must not be smuggled in as a service variable');
  assert.deepEqual([...(mock.sharedAttachments.get(`${envId}:PLATFOLIO_GITHUB_APP_ID`) ?? [])], [apiId], 'the attachment names exactly the declaring service');

  const presence = await provider.secretPresence!({ instanceId: 'shared-delivery', environment: 'production', service: 'api', names: ['PLATFOLIO_GITHUB_APP_ID', 'PLATFOLIO_GITHUB_PRIVATE_KEY'] });
  assert.equal(presence.PLATFOLIO_GITHUB_APP_ID, 'set');
  assert.equal(presence.PLATFOLIO_GITHUB_PRIVATE_KEY, 'missing', 'presence must distinguish delivered from absent, or the read is decoration');

  // The load-bearing part, shown rather than asserted about: undo the ATTACHMENT and presence flips back to
  // `missing` even though the variable is still written at environment scope.
  mock.sharedAttachments.delete(`${envId}:PLATFOLIO_GITHUB_APP_ID`);
  const detached = await provider.secretPresence!({ instanceId: 'shared-delivery', environment: 'production', service: 'api', names: ['PLATFOLIO_GITHUB_APP_ID'] });
  assert.equal(detached.PLATFOLIO_GITHUB_APP_ID, 'missing', 'attachment is what makes a shared variable visible, and the check must depend on it');
});

test('default-scope delivery writes the service, not the environment', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'service-delivery' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const envId = environmentId(mock, 'production');

  const result = await provider.putSecretValue!({ instanceId: 'service-delivery', environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'abc123' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(mock.sharedVariables.has(`${envId}:SESSION_KEY`), false, 'the default scope stays with the service');
  assert.equal((mock.sharedAttachments.get(`${envId}:SESSION_KEY`) ?? new Set()).size, 0, 'and nothing is attached that was never shared');
});

/**
 * D53 and D57 meet here: a tenant addresses a secret by the name their description declares (`api`), and that
 * name belongs to a different service in each environment. Resolving it project-wide by name would write
 * staging's credential onto production's service and report it as delivered, because the read-back would be
 * looking at the same wrong service.
 */
test('a secret addressed by the plan name lands on that environment’s own service, not on the first match (D57)', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'per-environment-secret' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const productionId = environmentId(mock, 'production');
  const stagingId = environmentId(mock, 'staging');
  const apiStaging = serviceByNames(mock, 'api-staging')!;
  const apiProduction = serviceByNames(mock, 'api-production')!;

  const delivered = await provider.putSecretValue!({ instanceId: 'per-environment-secret', environment: 'staging', service: 'api', name: 'SESSION_KEY', value: 'staging-only' });
  assert.equal(delivered.ok, true, JSON.stringify(delivered));
  assert.equal(delivered.verified, true);
  const writes = mock.writtenVariables.filter((w) => w.name === 'SESSION_KEY').map((w) => ({ name: w.name, value: w.value, environmentId: w.environmentId, serviceId: w.serviceId }));
  assert.deepEqual(writes, [{ name: 'SESSION_KEY', value: 'staging-only', environmentId: stagingId, serviceId: apiStaging.id }], 'exactly one write: staging environment, staging service');
  assert.equal(mock.instances.get(`${productionId}:${apiProduction.id}`)!.variables.has('SESSION_KEY'), false, 'production’s service did not receive staging’s credential');

  const presence = await provider.secretPresence!({ instanceId: 'per-environment-secret', environment: 'staging', service: 'api', names: ['SESSION_KEY'] });
  assert.equal(presence.SESSION_KEY, 'set', 'and the read-back looks at the same environment the write did');
  const elsewhere = await provider.secretPresence!({ instanceId: 'per-environment-secret', environment: 'production', service: 'api', names: ['SESSION_KEY'] });
  assert.equal(elsewhere.SESSION_KEY, 'missing', 'the same name in the other environment is still absent');
});

/**
 * The consequence of dropping the observational fallback, asserted rather than glossed: a legacy row that has
 * not been renamed yet is NOT a target for delivery. Writing onto it would report success against a service
 * this plan does not name.
 */
test('a secret for a legacy row that has not been renamed yet reports not-found rather than guessing (D57)', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'legacy-secret' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  renameRowsBare(mock, 'production', { 'api-production': 'api' });

  const result = await provider.putSecretValue!({ instanceId: 'legacy-secret', environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'abc123' });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, 'not-found');
  assert.match((result as { reason: string }).reason, /api-production/, 'the reason names the name the rule produces, so the operator knows to apply');
  assert.equal(mock.writtenVariables.some((w) => w.name === 'SESSION_KEY'), false, 'nothing was written to the row that is about to be renamed');
});

test('the double refuses an attachment call that omits a NON_NULL field -- the mistake the live API caught', async () => {
  const mock = new RailwayMock();
  const plan = samplePlan({ instanceId: 'required-check' });
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 5_000, pollIntervalMs: 25 });
  await provider.applyPlan(plan);
  const envId = environmentId(mock, 'production');
  const projectId = [...mock.projects.keys()][0]!;

  // Exactly what my first implementation sent: enabledServiceIds without disabledServiceIds.
  await assert.rejects(
    () => mock.graphql({
      operation: 'sharedVariableConfigure',
      query: 'mutation ($input: SharedVariableConfigureInput!) { sharedVariableConfigure(input: $input) { id } }',
      variables: { input: { projectId, environmentId: envId, name: 'X', enabledServiceIds: ['svc-1'] } },
      credential: { kind: 'project', token: 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB' },
    }),
    /disabledServiceIds.*String!|is not defined\. Expected a value/i,
    'the double must reject the omission the real API rejects, or it is teaching the wrong lesson',
  );

  const ok = await provider.putSecretValue!({ instanceId: 'required-check', environment: 'production', service: 'api', name: 'X', value: 'v', source: 'shared-variable' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.verified, true, 'write plus attachment leaves the declaring service able to read the name');
});

/**
 * `serviceUpdate` returns `Service!`, so the real API rejects it without a sub-selection -- the same class of
 * validation failure that bit the marker write (E26). The double enforces it for this mutation too, so a
 * provider that ships a bare mutation fails here rather than on the first live migration.
 */
test('the double refuses a serviceUpdate with no sub-selection (the E26 class, extended by evidence)', async () => {
  const mock = new RailwayMock();
  const provider = new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} });
  await provider.applyPlan(planWith());
  const row = serviceByNames(mock, 'api-production')!;
  await assert.rejects(
    () => mock.graphql({
      operation: 'serviceUpdate',
      query: 'mutation ($id: String!, $input: ServiceUpdateInput!) { serviceUpdate(id: $id, input: $input) }',
      variables: { id: row.id, input: { name: 'renamed' } },
      credential: { kind: 'workspace', token: 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA' },
    }),
    /selection of subfields/,
  );
  // And the input has exactly the two fields the captured schema says it has.
  await assert.rejects(
    () => mock.graphql({
      operation: 'serviceUpdate',
      query: 'mutation ($id: String!, $input: ServiceUpdateInput!) { serviceUpdate(id: $id, input: $input) { id } }',
      variables: { id: row.id, input: { name: 'renamed', environmentId: environmentId(mock, 'production') } },
      credential: { kind: 'workspace', token: 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA' },
    }),
    /environmentName|environmentId.*is not defined/,
    'a rename that tried to pass an environment field is rejected, because the field does not exist on ServiceUpdateInput',
  );
});
