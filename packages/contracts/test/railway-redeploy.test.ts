/**
 * The refresh verb (D48): asking a running service to pick up configuration it does not hold.
 *
 * WHY THIS FILE EXISTS, stated because the measurement is the argument. On Railway, 2026-11-15, against our own
 * staging service (`docs/research/railway-variable-value-redeploy-2026-11-15.md`):
 *
 *   A  value written with `skipDeploys: true`  -> NO new deployment in 120s
 *   B  value written with `skipDeploys` omitted, value CHANGED -> Railway started a deployment on its own
 *   C  explicit `serviceInstanceDeploy`        -> new deployment visible (the detector's control)
 *   D  the SAME value written again, no suppression -> NO new deployment
 *
 * B and D together say the provider diffs values server-side, so "did the value change" is a question Railway
 * can answer and we cannot (D4 forbids reading values back: `variables()` returns them, and
 * `environment.config` answers names with values redacted). The design follows the measurement rather than the
 * guess: no digest variable, no stored change signal, nothing in our database that could be a credential
 * shadow. Composition changes already redeploy, because `applyPlan` writes and then deploys deliberately. What
 * was missing was the verb for everything that is NOT an apply -- a secret delivered out of band, a variable
 * changed in the console, a reference that resolved only after first boot.
 *
 * The tradeoff accepted, and it is a real one: a refresh asked for when nothing changed still costs a container
 * bounce. That is deliberate -- the operator knows something the platform cannot, and the alternative (a stored
 * digest of a value we are forbidden to read) is worse than a needless restart.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { FakeInfraProvider, RailwayInfraProvider, physicalServiceName, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const INST = samplePlan().instanceId;
const IMAGE = 'docker.io/library/nginx:alpine';
const DIGEST = `sha256:${'b'.repeat(64)}`;

/**
 * A plan whose `planHash` FOLLOWS its content.
 *
 * `samplePlan()` carries a constant hash, and `applyPlan` decides idempotency purely from that string (the
 * provider's marker is `PLATFOLIO_PLAN:<hash>` in the project description; it never re-derives the hash from
 * the environments). So mutating a fixture plan without recomputing the hash describes a plan that has changed
 * while claiming not to have, and the assertion below would then be checking the fixture's arithmetic rather
 * than the provider's behaviour. The production path cannot make that mistake: `buildPlan` hashes
 * `{platform, version, environments}` (packages/manifest/src/build-plan.ts), so content and hash move
 * together by construction.
 */
function planWith(mutate: (plan: InfraPlan) => void = () => {}): InfraPlan {
  const plan = samplePlan();
  for (const environment of plan.environments) {
    environment.databases = [];
    environment.buckets = [];
    for (const service of environment.services) {
      service.image = IMAGE;
      service.digest = DIGEST;
    }
  }
  mutate(plan);
  return { ...plan, planHash: createHash('sha256').update(JSON.stringify(plan.environments)).digest('hex').slice(0, 16) };
}

function harness(budget = 20): { mock: RailwayMock; provider: RailwayInfraProvider } {
  const mock = new RailwayMock();
  return { mock, provider: new RailwayInfraProvider({ credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: budget, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {} }) };
}

const envId = (mock: RailwayMock, name: string) => [...mock.environments.values()].find((e) => e.name === name)!.id;
const row = (mock: RailwayMock, name: string) => [...mock.services.values()].find((s) => s.name === name);

/** Apply once so the project exists, then answer questions about the restart path. */
async function applied(budget = 20) {
  const h = harness(budget);
  const result = await h.provider.applyPlan(planWith());
  assert.equal(result.failures.length, 0, `setup apply failed: ${JSON.stringify(result.failures)}`);
  return h;
}

test('redeploy is advertised, so a handler can answer 501 from the contract rather than from a crash', async () => {
  const h = await applied();
  assert.ok(h.provider.describe().operations.includes('redeploy'), 'the railway driver must claim the verb it implements');
  const partial = new FakeInfraProvider({ without: ['redeploy'] });
  assert.equal(partial.describe().operations.includes('redeploy'), false, 'a double can model a provider that lacks it');
});

test('naming one service restarts exactly that service, reported by its PHYSICAL name (D57)', async () => {
  const { mock, provider } = await applied();
  const deploysBefore = mock.deploys;
  const result = await provider.redeploy!({ instanceId: INST, environment: 'production', service: 'api' });

  assert.equal(result.environment, 'production');
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.budgetSkipped, []);
  // The caller said `api`; the answer names what was actually restarted. A tenant reading "api" back would
  // have no way to know whether the staging row or the production row moved.
  assert.deepEqual(result.services, [physicalServiceName('api', 'production')], 'the result carries the provider name, not the callers');
  assert.equal(mock.deploys, deploysBefore + 1, 'exactly one deploy');
  assert.equal(result.verified, true);
});

test('an acquired image sends provider registry credentials on create and renews them before redeploy', async () => {
  const mock = new RailwayMock();
  const real = mock.graphql.bind(mock);
  const writes: Array<{ operation: string; password?: string }> = [];
  mock.graphql = (async (input: Parameters<typeof real>[0]) => {
    const registry = (input.variables?.input as { registryCredentials?: { password: string } } | undefined)?.registryCredentials;
    if (registry || input.operation === 'serviceInstanceDeploy') {
      writes.push({ operation: input.operation, ...(registry ? { password: registry.password } : {}) });
    }
    return real(input);
  }) as typeof real;
  let password = 'first-fixture-pull-grant';
  const provider = new RailwayInfraProvider({
    credentials: mock, transport: mock, workspaceId: 'ws-1', deployBudget: 20, deployTimeoutMs: 2_000,
    pollIntervalMs: 1, sleep: async () => {},
    registryCredentials: (image) => image === `${IMAGE}@${DIGEST}` ? { username: 'platfolio', password } : undefined,
  });
  const applied = await provider.applyPlan(planWith());
  assert.deepEqual(applied.failures, []);
  assert.ok(writes.some((write) => write.operation === 'serviceCreate' && write.password === password));
  assert.ok(!JSON.stringify(applied).includes(password));

  writes.length = 0;
  password = 'renewed-fixture-pull-grant';
  const redeployed = await provider.redeploy({ instanceId: INST, environment: 'production', service: 'api' });
  assert.ok(redeployed.verified);
  assert.deepEqual(writes, [
    { operation: 'serviceInstanceUpdate', password },
    { operation: 'serviceInstanceDeploy' },
  ]);
  assert.ok(!JSON.stringify(redeployed).includes(password));
});

test('verified is an OBSERVATION of a new deployment id, not the mutation returning true', async () => {
  // The control for this whole file. `serviceInstanceDeploy` answers a bare boolean on Railway; a provider that
  // reported `verified` from that answer would say "restarted" for a call the provider coalesced, cancelled or
  // ignored. So: assert the deployment identity moved, and assert the negative case by refusing to let a
  // no-op deploy count.
  const { mock, provider } = await applied();
  const apiRow = row(mock, physicalServiceName('api', 'production'))!;
  const key = `${envId(mock, 'production')}:${apiRow.id}`;
  const priorId = mock.instances.get(key)!.deploymentId;
  assert.ok(priorId, 'setup: the apply recorded a deployment identity for the service');

  const result = await provider.redeploy!({ instanceId: INST, environment: 'production', service: 'api' });
  const afterId = mock.instances.get(key)!.deploymentId;
  assert.notEqual(afterId, priorId, 'a fresh deployment id must exist afterwards -- that is what `verified` means');
  assert.equal(result.verified, true);
});

test('a deploy the provider accepts but does not act on is reported, not claimed as a restart', async () => {
  // Fault injected at the transport, below the provider: the mutation says true, the instance keeps its old
  // deployment id. This is the shape of "202 accepted and nothing happened", and it must surface.
  const { mock, provider } = await applied();
  const real = mock.graphql.bind(mock);
  mock.graphql = (async (input: Parameters<typeof real>[0]) => {
    if (input.operation === 'serviceInstanceDeploy') return { serviceInstanceDeploy: true } as never;
    if (input.operation === 'environment.serviceInstances') {
      // Serve the instance read with the deployment id frozen at its pre-deploy value.
      const key = `${envId(mock, 'production')}:${row(mock, physicalServiceName('api', 'production'))!.id}`;
      const frozen = mock.instances.get(key)!.deploymentId;
      const out = await real(input);
      for (const edge of ((out as any)?.environment?.serviceInstances?.edges ?? [])) {
        if (edge.node.latestDeployment) edge.node.latestDeployment.id = frozen;
      }
      return out as never;
    }
    return real(input);
  }) as typeof mock.graphql;

  const result = await provider.redeploy!({ instanceId: INST, environment: 'production', service: 'api' });
  assert.equal(result.verified, false, 'a restart cannot be verified from a response boolean when the identity did not move');
  assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0]!.code, 'deployment-unchanged');
  assert.match(result.refused[0]!.reason, /did not change/);
});

test('omitting the service refreshes the whole environment and nothing outside it', async () => {
  const { mock, provider } = await applied();
  const before = mock.deploys;
  const result = await provider.redeploy!({ instanceId: INST, environment: 'production' });
  const productionRows = [...mock.instances.keys()].filter((k) => k.startsWith(`${envId(mock, 'production')}:`));
  assert.equal(result.services.length, productionRows.length, 'every instance placed in that environment');
  assert.equal(mock.deploys - before, productionRows.length);
  assert.ok(result.services.every((n) => n.endsWith('-production')), 'staging rows must not be touched by a production refresh');
  assert.equal(result.verified, true);
});

test('the deploy budget applies to refreshes, and what it suppressed is named', async () => {
  // A refresh is a deployment: it bills, it restarts, it queues. Inheriting the ceiling is what stops
  // "refresh everything" from becoming an unbounded burst against a workspace limit, and `budgetSkipped` is the
  // field that keeps "not done" from being confused with "done".
  //
  // The ceiling is PER PROVIDER INSTANCE, so the apply that creates the instance and the refresh that restarts
  // it are separate operations with separate budgets -- the same way one API request gets one provider object.
  // Sharing one counter across both would make the first refresh of a freshly applied instance fail on a
  // budget the apply spent, which is not a ceiling on the refresh at all.
  const setup = await applied(10);
  const provider = new RailwayInfraProvider({
    credentials: setup.mock, transport: setup.mock, workspaceId: 'ws-1',
    deployBudget: 1, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {},
  });
  const deploysBefore = setup.mock.deploys;
  const result = await provider.redeploy!({ instanceId: INST, environment: 'production' });
  assert.equal(result.services.length, 1, 'one deploy allowed');
  assert.equal(setup.mock.deploys - deploysBefore, 1, 'and exactly one happened');
  assert.equal(result.verified, true, 'what it did was verified; what it could not do is a separate field');
});

test('a refresh that cannot be completed because of the ceiling says which services were not restarted', async () => {
  // Two services in the environment, a budget of one: the second must appear in `budgetSkipped`, not vanish.
  // A silent omission is the shape that lets "202 accepted" mean nothing happened to half the stack.
  const setup = await applied();
  // A SECOND service placed in the same environment, so an environment-wide refresh has two things to do.
  // Added through the mock's own state (not a transport spoof): this is fixture setup, and the provider's read
  // of "what is in this environment" is exactly what the double is for.
  const production = envId(setup.mock, 'production');
  const projectId = [...setup.mock.projects.keys()][0]!;
  const row = { id: 'svc-second', name: physicalServiceName('worker', 'production') };
  setup.mock.services.set(row.id, { id: row.id, name: row.name, projectId } as never);
  setup.mock.instances.set(`${production}:${row.id}`, {
    instanceId: `inst-${row.id}`, status: 'SUCCESS', image: IMAGE, numReplicas: 1,
    domains: [], polls: 0, variables: new Set(), deploymentId: 'dep-pre',
  } as never);

  // A fresh provider instance whose budget is one: the ceiling is per operation, not per project.
  const provider = new RailwayInfraProvider({
    credentials: setup.mock, transport: setup.mock, workspaceId: 'ws-1',
    deployBudget: 1, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {},
  });
  const result = await provider.redeploy!({ instanceId: INST, environment: 'production' });
  assert.equal(result.services.length + result.budgetSkipped.length, 2, 'every service in the environment is accounted for, one way or the other');
  assert.equal(result.services.length, 1, 'exactly one restarted');
  assert.equal(result.budgetSkipped.length, 1, 'the suppressed one is NAMED');
  assert.ok(result.budgetSkipped.every((n) => n.endsWith('-production')), 'named by physical name, like the restarted ones');
});

test('a name that is not in this environment is refused with the physical name it looked for', async () => {
  const { provider } = await applied();
  const result = await provider.redeploy!({ instanceId: INST, environment: 'production', service: 'worker' });
  assert.equal(result.services.length, 0);
  assert.equal(result.verified, false);
  assert.equal(result.refused[0]!.code, 'no-service');
  // Saying "no service worker" when the rule names it `worker-production` is the confusion D57 was written to
  // end: an operator looks in the console, sees the row, and concludes the tool is lying.
  assert.match(result.refused[0]!.reason, /worker-production/);
});

test('an environment the instance does not have is refused rather than answered with an empty success', async () => {
  const { provider } = await applied();
  const result = await provider.redeploy!({ instanceId: INST, environment: 'preview' });
  assert.equal(result.verified, false);
  assert.equal(result.refused[0]!.code, 'no-environment');
  assert.match(result.refused[0]!.reason, /preview/);
});

test('an instance that was never applied is refused with its project name', async () => {
  const { provider } = await applied();
  const result = await provider.redeploy!({ instanceId: 'nonexistent-tenant', environment: 'production', service: 'api' });
  assert.equal(result.verified, false);
  assert.equal(result.refused[0]!.code, 'no-project');
});

test('composition changes reach the provider through applyPlan, and a plan-identical re-apply does not redeploy', async () => {
  // The half of the maintainer's question that was already true, asserted rather than assumed: a variable NAME
  // added to the composition is a plan change, the plan hash moves, and the apply deploys. A second apply of the
  // same plan is a NOOP -- which is correct for a re-delivered dispatch, and is precisely why the separate
  // refresh verb is needed for the value case.
  const a = await applied();
  const first = await a.provider.applyPlan(planWith());
  assert.equal(first.noop, true, 'same plan, already applied: no deploy, by design');

  const b = await applied();
  let deploysBefore = b.mock.deploys;
  const second = await b.provider.applyPlan(planWith((plan) => {
    plan.environments[0]!.services[0]!.env.push({ name: 'NEW_FLAG', literal: 'true' });
  }));
  assert.equal(second.noop, false, 'a variable added to the composition is a plan change');
  assert.ok(b.mock.deploys > deploysBefore, 'and it deploys');

  // And the same shape for a REMOVED name: the plan hash moves either way, because the plan is the description.
  deploysBefore = b.mock.deploys;
  const third = await b.provider.applyPlan(planWith());
  assert.equal(third.noop, false, 'removing a name is also a composition change');
  assert.ok(b.mock.deploys > deploysBefore);
});

test('the fake provider answers the same questions the railway driver does (the rule of two)', async () => {
  // One contract, two implementations: if only the Railway double can pass, the interface is Railway-shaped and
  // the seam is a lie. Asserted on the fields the API handler actually branches on.
  const fake = new FakeInfraProvider();
  const plan = planWith();
  await fake.applyPlan(plan);
  const ok = await fake.redeploy!({ instanceId: plan.instanceId, environment: 'production', service: 'api' });
  assert.equal(ok.verified, true);
  assert.deepEqual(ok.services, ['api']);

  const missing = await fake.redeploy!({ instanceId: plan.instanceId, environment: 'production', service: 'nope' });
  assert.equal(missing.verified, false);
  assert.equal(missing.refused[0]!.code, 'no-service');

  // The ceiling, on a double that HAS an instance to refresh. Applying first is not ceremony: asserting
  // against an un-applied provider returned `no-instance` with an empty `budgetSkipped`, which reads exactly
  // like a broken budget guard and was a broken fixture. And the ceiling must NOT surface as `no-service` --
  // "there is nothing there by that name" and "I was not allowed to spend another deploy" are different facts,
  // and collapsing them sends an operator looking for a service that is sitting right there.
  const exhausted = new FakeInfraProvider({ deployBudget: 0 });
  await exhausted.applyPlan(plan);
  const limited = await exhausted.redeploy!({ instanceId: plan.instanceId, environment: 'production' });
  assert.deepEqual(limited.refused, [], 'the ceiling is not a missing service, and must not be reported as one');
  assert.equal(limited.services.length, 0);
  assert.deepEqual(limited.budgetSkipped, ['api'], 'the suppressed name is named, not dropped');
  assert.equal(limited.verified, false);
});

test('both implementations restart ONE environment and never the other (D57)', async () => {
  // The bug this exists to catch is one the fake had: `api` exists in production AND staging, and the flattened
  // state read gives two indistinguishable rows, so filtering by name restarted both from a one-environment
  // call. The Railway driver cannot make that mistake (instances are keyed per environment), which is exactly
  // why the double has to be forced to answer the same question -- otherwise the seam is only honest in the
  // implementation that nobody tests twice.
  const fake = new FakeInfraProvider();
  const plan = planWith();
  await fake.applyPlan(plan);
  assert.deepEqual(plan.environments.map((e) => e.name), ['production', 'staging'], 'setup: the fixture really has both, with the same service name in each');

  const prod = await fake.redeploy!({ instanceId: plan.instanceId, environment: 'production', service: 'api' });
  assert.deepEqual(prod.services, ['api'], 'one restart, not one per environment that holds the name');

  const all = await fake.redeploy!({ instanceId: plan.instanceId, environment: 'staging' });
  assert.equal(all.services.length, 1, 'an environment-wide staging refresh touches staging only');

  // And the same claim through the real driver, where the names are physical and the answer must be too.
  const { provider } = await applied();
  const staging = await provider.redeploy!({ instanceId: INST, environment: 'staging' });
  assert.ok(staging.services.every((n) => n.endsWith('-staging')), `a staging refresh touched other environments: ${staging.services.join(', ')}`);
  assert.equal(staging.services.length, 1);
});

test('redeploy never reads a variable value on any path (D4)', async () => {
  // The rule that constrains this whole design. `variables()` is the one query that returns values, and the mock
  // throws if it is touched; a red test here means someone added a value read to answer a question the provider
  // cannot ask.
  const { mock, provider } = await applied();
  const seen: string[] = [];
  const real = mock.graphql.bind(mock);
  mock.graphql = (async (input: Parameters<typeof real>[0]) => {
    seen.push(input.operation);
    return real(input);
  }) as typeof mock.graphql;

  const result = await provider.redeploy!({ instanceId: INST, environment: 'production', service: 'api' });
  assert.equal(result.verified, true);
  assert.ok(!seen.some((op) => /variables(ForService)?/.test(op)), `the refresh path read configuration values: ${seen.join(', ')}`);
  // Names are fine (config is value-redacted by the provider); values never are.
  assert.ok(seen.includes('serviceInstanceDeploy'), 'and it did ask for the restart');
});
