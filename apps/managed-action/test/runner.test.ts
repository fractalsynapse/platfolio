import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApplyResultSchema, samplePlan, type ApplyResult, type Attestation, type InfraPlan } from '../../../packages/contracts/src/index.ts';
import { readIntent, runManagedAction, type RunnerDeps } from '../src/runner.ts';

const HASH = 'a'.repeat(64);
const intent = {
  instanceId: 'inst-1', teamId: 'team-1', dispatchId: 'disp-1', nonce: 'n'.repeat(16), planHash: HASH,
  action: 'apply' as const, environment: 'production',
  issuedAt: '2026-11-10T00:00:00Z', expiresAt: '2026-11-10T01:00:00Z',
};
const env = { INPUT_INSTANCE_ID: 'inst-1', INPUT_DISPATCH_ID: 'disp-1', INPUT_NONCE: intent.nonce, INPUT_PLAN_HASH: HASH, INPUT_ACTION: 'apply', INPUT_ENVIRONMENT: 'production', RAILWAY_TOKEN: 'rt', RAILWAY_WORKSPACE_ID: 'ws' };

function harness(over: Partial<RunnerDeps> & { applyResult?: ApplyResult } = {}) {
  const outputs = new Map<string, string>();
  const posted: Attestation[] = [];
  const logged: string[] = [];
  const applied: InfraPlan[] = [];
  let clock = 1_000;
  const deps: RunnerDeps = {
    env,
    fetchDispatch: async () => ({ plan: samplePlan(), planHash: HASH }),
    applyPlan: async (plan) => {
      applied.push(plan);
      return over.applyResult ?? {
        instanceId: 'inst-1', planHash: HASH, verified: true, noop: false, domains: [], failures: [],
        services: [{ name: 'api', environment: 'production', externalId: 'svc-1', status: 'live', image: 'ghcr.io/acme/api@sha256:' + 'c'.repeat(64), numReplicas: 1 }],
      };
    },
    postAttestation: async (a) => { posted.push(a); },
    setOutput: (name, value) => { outputs.set(name, value); },
    log: (line) => { logged.push(line); },
    now: () => (clock += 1_000),
    ...over,
  };
  // Validated against the real schema here, so a fixture that invents a field fails at build time instead of
  // teaching the runner to trust a shape the provider never returns.
  for (const candidate of [over.applyResult].filter(Boolean)) ApplyResultSchema.parse(candidate);
  return { deps, outputs, posted, logged, applied };
}

test('the dispatch inputs become an intent, and a missing one is a hard error', () => {
  assert.equal(readIntent(env).instanceId, 'inst-1');
  assert.equal(readIntent(env).planHash, HASH, 'the sha256: prefix is normalized on the way in');
  for (const name of ['INPUT_INSTANCE_ID', 'INPUT_DISPATCH_ID', 'INPUT_NONCE', 'INPUT_PLAN_HASH', 'INPUT_ACTION', 'INPUT_ENVIRONMENT']) {
    assert.throws(() => readIntent({ ...env, [name]: '' }), /is missing/, `${name} must be required`);
  }
  assert.throws(() => readIntent({ ...env, INPUT_PLAN_HASH: 'not-a-hash' }), /./, 'a malformed hash is refused, not truncated into acceptance');
});

test('a missing provider credential refuses before any plan is fetched or applied', async () => {
  const h = harness();
  const withoutToken = { ...env, RAILWAY_TOKEN: '' };
  const result = await runManagedAction({ ...h.deps, env: withoutToken });
  assert.equal(result.status, 'failed');
  assert.equal(h.applied.length, 0, 'no provider call was attempted');
  assert.match(String(result.attestation.errorCode), /credential-missing/);
  assert.ok(h.logged.some((l) => l.includes('no provider call attempted')));
  assert.equal(h.outputs.get('outcome'), 'failed');
});

test('a stale plan hash is refused and nothing is applied', async () => {
  const h = harness({ fetchDispatch: async () => ({ plan: samplePlan(), planHash: 'b'.repeat(64) }) });
  const result = await runManagedAction(h.deps);
  assert.equal(result.attestation.result, 'failed');
  assert.match(String(result.attestation.errorCode), /stale-plan-hash/);
  assert.equal(h.applied.length, 0, 'the refusal is the point -- a queued dispatch must not apply a superseded plan');
  assert.ok(h.logged.some((l) => l.includes('nothing applied')));
  assert.equal(h.posted.length, 1, 'platfolio still learns what happened');
});

test('a clean apply attests ok, with the plan hash that actually ran', async () => {
  const h = harness();
  const result = await runManagedAction(h.deps);
  assert.equal(result.attestation.result, 'ok');
  assert.equal(result.attestation.planHash, HASH);
  assert.deepEqual(result.attestation.resources.map((r) => [r.kind, r.name, r.status]), [['service', 'api', 'live']]);
  assert.equal(h.outputs.get('outcome'), 'ok');
  assert.equal(h.outputs.get('changed'), '1');
  assert.ok(result.attestation.durationMs > 0);
});

test('partial is reported as partial, not folded into ok or failed', async () => {
  const h = harness({
    applyResult: {
      instanceId: 'inst-1', planHash: HASH, verified: false, noop: false,
      services: [{ name: 'api', environment: 'production', externalId: 'svc-1', status: 'live', image: 'ghcr.io/acme/api@sha256:' + 'c'.repeat(64), numReplicas: 1 }],
      domains: [],
      failures: [{ step: 'services.production.worker', code: 'deploy-timeout', message: 'deploy did not settle in 300s' }],
    },
  });
  const result = await runManagedAction(h.deps);
  assert.equal(result.attestation.result, 'partial');
  assert.match(String(result.attestation.errorCode), /deploy-timeout@services\.production\.worker/);
  assert.ok(result.attestation.resources.length >= 1, 'what landed is still reported');
});

test('a provider error that echoes a credential cannot carry it into the attestation', async () => {
  const leaky = {
    instanceId: 'inst-1', planHash: HASH, verified: false, noop: false, services: [], domains: [],
    failures: [{ step: 'env', code: 'variable-upsert-failed', message: 'rejected token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 for Authorization Bearer supersecretvalue123' }],
  };
  const h = harness({ applyResult: leaky });
  const result = await runManagedAction(h.deps);
  const json = JSON.stringify(result.attestation);
  assert.ok(!json.includes('ghp_ABCDEF'), `token reached the attestation: ${json}`);
  assert.ok(!json.includes('supersecretvalue123'), 'bearer value must not survive either');
  assert.match(String(result.attestation.errorCode), /variable-upsert-failed/);
  assert.ok(!h.logged.some((l) => l.includes('ghp_ABCDEF')), 'and not into the job log');
});

test('a plan that cannot be read is refused with an attestation, not left as a silent red X', async () => {
  const h = harness({ fetchDispatch: async () => { throw new Error('plan fetch failed (500); refusing to act on a plan we could not read'); } });
  const result = await runManagedAction(h.deps);
  assert.equal(result.attestation.result, 'failed');
  assert.match(String(result.attestation.errorCode), /plan-fetch-failed/);
  assert.equal(h.posted.length, 1, 'platfolio learns what happened without reading a log transcript');
  assert.equal(h.applied.length, 0);
});

test('a provider call that throws still surfaces as a rejected run', async () => {
  // Deliberate: once applyPlan has been called the outcome is unknown -- resources may have changed -- so a
  // swallowed exception would let platfolio believe the plan was applied. The job must go red.
  const h = harness({ applyPlan: async () => { throw new Error('transport exploded'); } });
  await assert.rejects(() => runManagedAction(h.deps));
  assert.equal(h.posted.length, 0, 'an unknown result cannot be attested as a known one');
});
