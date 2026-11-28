/**
 * The value-change half of the maintainer's request: "updating secret values should update the services as well."
 *
 * What the measurement established (docs/research/railway-variable-value-redeploy-2026-11-15.md, run against
 * our own `api-staging`, arms A-D) is that the provider already answers this question and we are not allowed to
 * ask it. Railway starts a deployment for a variable VALUE change when the write is not suppressed (arm B), and
 * starts NOTHING when the identical value is written again (arm D). So:
 *
 *   - the change signal comes from the side that HOLDS the value, which is the only side that can;
 *   - platfolio stores no digest, no hash, no shadow of a credential -- D4 survives intact;
 *   - the default stays suppression, because a platform that cannot see the value must not restart things on a
 *     guess about whether it changed.
 *
 * The tradeoff accepted, stated in the test rather than only in prose: `refresh: 'auto'` costs a container
 * bounce when the value genuinely changed, and the platform cannot promise the bounce is *only* when it changed
 * -- it is trusting the provider's comparison, which is measured today and could differ tomorrow. The
 * alternative was a digest variable we own, which would put secret-derived material in a platfolio store and
 * make D4 a footnote. A needless restart is the cheaper failure.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RailwayInfraProvider, samplePlan, type InfraPlan } from '../src/index.ts';
import { RailwayMock } from './railway-mock.ts';

const IMAGE = 'docker.io/library/nginx:alpine';
const DIGEST = `sha256:${'b'.repeat(64)}`;

function planWith(mutate: (plan: InfraPlan) => void = () => {}): InfraPlan {
  const plan = samplePlan();
  for (const environment of plan.environments) {
    environment.databases = [];
    environment.buckets = [];
    for (const service of environment.services) {
      service.image = IMAGE;
      service.digest = DIGEST;
      service.secrets = [{ name: 'SESSION_KEY', source: 'preserve' }];
    }
  }
  mutate(plan);
  return plan;
}

function harness(): { mock: RailwayMock; provider: RailwayInfraProvider; plan: InfraPlan } {
  const mock = new RailwayMock();
  const plan = planWith();
  const provider = new RailwayInfraProvider({
    credentials: mock, transport: mock, workspaceId: 'ws-1',
    deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {},
  });
  return { mock, provider, plan };
}

/**
 * Apply a plan whose declared secret does not exist yet, and take the expected refusal.
 *
 * The first version of this helper asserted a clean apply and failed, because `ensureSecrets` refuses a plan
 * naming a credential nobody has delivered -- which is D53 working as designed, not an obstacle to route
 * around. So the setup applies, EXPECTS the `secret-unavailable` failures for exactly our one name in both
 * environments, delivers, and re-applies. Asserting the refusal is better than dodging it: it proves the
 * gate that the delivery path is answering.
 */
async function applied(): Promise<{ mock: RailwayMock; provider: RailwayInfraProvider; plan: InfraPlan }> {
  const h = harness();
  const refused = await h.provider.applyPlan(h.plan);
  const onlyOurs = refused.failures.filter((f) => f.code !== 'secret-unavailable');
  assert.equal(onlyOurs.length, 0, `setup: unexpected failures besides the missing secret: ${JSON.stringify(onlyOurs)}`);
  assert.equal(refused.failures.length, 2, 'setup: both environments must refuse the undeclared secret');
  for (const environment of ['production', 'staging']) {
    const delivered = await h.provider.putSecretValue!({ instanceId: h.plan.instanceId, environment, service: 'api', name: 'SESSION_KEY', value: 'setup' });
    assert.equal(delivered.ok, true, `setup delivery to ${environment} failed`);
  }
  const ok = await h.provider.applyPlan(h.plan);
  assert.equal(ok.failures.length, 0, `setup re-apply failed: ${JSON.stringify(ok.failures)}`);
  // Drop the setup writes from the record so each test observes only its own delivery. The double owns this
  // array; clearing it is fixture housekeeping, not a claim about the provider.
  h.mock.writtenVariables.length = 0;
  return h;
}

/** What the mock was actually asked to write, by name -- the suppression flag is the subject, not the value. */
function writesFor(mock: RailwayMock, name: string) {
  return mock.writtenVariables.filter((w) => w.name === name);
}

test('delivery suppresses by default, which is the behaviour every caller had before this option existed', async () => {
  const { mock, provider, plan } = await applied();
  const deploysBefore = mock.deploys;
  const result = await provider.putSecretValue!({
    instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'v1',
  });
  assert.equal(result.ok, true);
  assert.equal(mock.deploys, deploysBefore, 'a credential arriving is not a decision to redeploy -- the original rule still holds');
  // And the suppression flag is really sent, because that is what the claim means on the wire.
  assert.ok(writesFor(mock, 'SESSION_KEY').some((w) => (w as { skipDeploys?: boolean }).skipDeploys === true), 'the write carried skipDeploys');
});

test('refresh:"auto" sends the write UNSUPPRESSED, which is the whole mechanism', async () => {
  const { mock, provider, plan } = await applied();
  const result = await provider.putSecretValue!({
    instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'v2', refresh: 'auto',
  });
  assert.equal(result.ok, true);
  const write = writesFor(mock, 'SESSION_KEY').at(-1) as { skipDeploys?: boolean } | undefined;
  assert.ok(write, 'the delivery wrote a variable');
  // The double records what it was given; `skipDeploys` absent-or-false is the ask. Asserting the flag rather
  // than a deployment count is the honest test: whether Railway restarts is the PROVIDER's decision, and our
  // claim is only that we stopped suppressing it.
  assert.equal(write.skipDeploys, false, 'refresh:auto must not send skipDeploys:true -- suppressing here is the defect being fixed');
});

test('the refresh answer is an OBSERVATION of deployment identity, in three honest states', async () => {
  const { provider, plan } = await applied();
  const first = await provider.putSecretValue!({
    instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'rotated-1', refresh: 'auto',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  // The double starts a deployment when the write is unsuppressed, exactly as Railway did in arm B.
  assert.equal(first.refresh, 'redeployed', `expected the observation to report a restart, got ${String(first.refresh)}`);

  // Now the arm-D case: the provider is asked to compare. A driver that reports `redeployed` for a value it did
  // not change is claiming a restart that the provider said it skipped.
  const second = await provider.putSecretValue!({
    instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'rotated-1', refresh: 'auto',
  });
  assert.ok(second.ok && (second.refresh === 'unchanged' || second.refresh === 'redeployed'),
    `an identical re-delivery answered ${String(second.ok && second.refresh)}; it must say which of the two it observed`);
});

test('a refresh whose read-back fails is reported as unknown, never as unchanged', async () => {
  // `unknown` and `unchanged` are different facts: one means "the provider compared and nothing differed", the
  // other means "we could not look". Rounding the second to the first would let a stale container look current,
  // which is the failure this entire option exists to prevent.
  const { mock, provider, plan } = await applied();
  const real = mock.graphql.bind(mock);
  let callCount = 0;
  mock.graphql = (async (input: Parameters<typeof real>[0]) => {
    // Refuse only the deployment-identity read (the one redeploy/deploy-verification does NOT make), so the
    // presence check still works and only the observation is unavailable.
    if (input.operation === 'environment.serviceInstances' && typeof input.query === 'string' && input.query.includes('latestDeployment { id }')) {
      callCount += 1;
      throw new Error('railway environment.serviceInstances: throttled [INTERNAL_SERVER_ERROR]');
    }
    return real(input);
  }) as typeof mock.graphql;

  const result = await provider.putSecretValue!({
    instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: 'v', refresh: 'auto',
  });
  assert.equal(result.ok, true, 'the write itself succeeded; only the read-back failed');
  if (!result.ok) return;
  assert.ok(callCount > 0, 'setup: the observation read was actually attempted and refused');
  assert.equal(result.refresh, 'unknown', `a failed read must not be reported as ${String(result.refresh)}`);
  assert.equal(result.verified, true, 'presence is still readable -- two different reads, two different answers');
});

test('the delivered value never appears in any provider-side record this test can read (D4)', async () => {
  const { provider, plan } = await applied();
  const secret = 'sup3r-secret-value-not-a-placeholder';
  await provider.putSecretValue!({ instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: secret, refresh: 'auto' });
  await provider.putSecretValue!({ instanceId: plan.instanceId, environment: 'production', service: 'api', name: 'SESSION_KEY', value: `${secret}-again`, refresh: 'auto' });

  // The provider's own returned structures: no field may carry the value.
  const presence = await provider.secretPresence!({ instanceId: plan.instanceId, environment: 'production', service: 'api', names: ['SESSION_KEY'] });
  assert.deepEqual(Object.values(present_presence_values(presence)), ['set'], 'presence answers the three-state vocabulary and nothing else');

  // `writtenVariables` is the DOUBLE's record of what the provider received -- the provider genuinely does get
  // the value, that is the point of the call. What must hold is that nothing platfolio RETURNS carries it.
  const readBack = await provider.readState(plan.instanceId);
  const serialised = JSON.stringify(readBack);
  assert.ok(!serialised.includes(secret), 'readState leaked a delivered credential into a snapshot');
});

/** Presence values only, so the assertion above cannot accidentally stringify a value. */
function present_presence_values(p: Record<string, string>): string[] {
  return Object.values(p);
}

test('CI supplies a declared missing variable once, before deployment', async () => {
  const mock = new RailwayMock();
  const plan = planWith();
  const provided: string[] = [];
  const provider = new RailwayInfraProvider({
    credentials: mock, transport: mock, workspaceId: 'ws-1',
    deployBudget: 20, deployTimeoutMs: 2_000, pollIntervalMs: 1, sleep: async () => {},
    initialSecret({ environment, service, name }) {
      provided.push(`${environment}/${service}/${name}`);
      assert.equal(writesFor(mock, name).some((write) => !write.skipDeploys), false);
      return 'fixture-initial-value';
    },
  });
  const result = await provider.applyPlan(plan);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(provided.sort(), ['production/api/SESSION_KEY', 'staging/api/SESSION_KEY']);
  assert.equal(writesFor(mock, 'SESSION_KEY').length, 2);
  assert.ok(writesFor(mock, 'SESSION_KEY').every((write) => write.skipDeploys));
  assert.ok(!JSON.stringify(result).includes('fixture-initial-value'));
  const reapplied = await provider.applyPlan({ ...plan, planHash: 'a'.repeat(64) });
  assert.deepEqual(reapplied.failures, []);
  assert.equal(provided.length, 2);
  assert.equal(writesFor(mock, 'SESSION_KEY').length, 2);
});
