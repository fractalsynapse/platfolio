import {
  attestationFromApply,
  parseDispatchIntent,
  redactCredentialShaped,
  staleIntent,
  type ApplyResult,
  type Attestation,
  type DispatchIntent,
  type InfraPlan,
} from '../../../packages/contracts/src/index.ts';

/**
 * The executor side of the actor/executor split (D30, #123).
 *
 * Everything here is a function of injected dependencies, and that is the design rather than a testing
 * convenience: this code runs inside a tenant's pipeline, on a tenant's runner, holding a tenant's
 * credential. The interesting decisions -- apply or refuse, what to report, what never to write down --
 * have to be checkable without a tenant, a runner or a provider. The wiring in `main.ts` is deliberately
 * thin for the opposite reason: it is the part that can only be proven by running.
 */

export interface RunnerDeps {
  env: Record<string, string | undefined>;
  /** Fetch the plan platfolio intends this dispatch to apply, with the digest platfolio computed for it. */
  fetchDispatch(intent: DispatchIntent): Promise<{ plan: InfraPlan; planHash: string }>;
  applyPlan(plan: InfraPlan): Promise<ApplyResult>;
  postAttestation(attestation: Attestation): Promise<void>;
  /** Set a step output. Real implementations write $GITHUB_OUTPUT; tests collect into an array. */
  setOutput(name: string, value: string): void;
  log(line: string): void;
  now: () => number;
}

export interface RunResult {
  status: Attestation['result'];
  attestation: Attestation;
}

const RELEASE = { version: process.env.PLATFOLIO_ACTION_VERSION ?? '0.0.0-dev', commitSha: process.env.PLATFOLIO_ACTION_SHA ?? '0'.repeat(40), imageDigest: `sha256:${'0'.repeat(64)}` };

/**
 * Read the dispatch inputs. Names mirror the workflow that GitHub hands us; every one is required, because a
 * missing `plan_hash` or `nonce` is the case where a runner would be applying something nobody authorised.
 */
export function readIntent(env: Record<string, string | undefined>): DispatchIntent {
  const get = (name: string): string => {
    // GitHub exposes `with:` inputs as INPUT_<NAME> upper-cased; reading the declared name verbatim
    // looked correct in a test that used the same lowercase keys and failed on the first real run.
    const value = env[`INPUT_${name.toUpperCase()}`]?.trim();
    if (!value) throw new Error(`managed action: required input ${name} is missing`);
    return value;
  };
  // Validated through the shared contract rather than trusted because it came from a workflow: a nonce short
  // enough to guess, or a hash that is not a digest, must fail here and not inside a comparison that happens
  // to disagree.
  return parseDispatchIntent({
    instanceId: get('instance_id'),
    // teamId is not needed to execute a dispatch and is not sent, so the action carries no tenant identity
    // beyond the instance it was told to act on.
    teamId: env.PLATFOLIO_TEAM_ID ?? 'tenant',
    dispatchId: get('dispatch_id'),
    nonce: get('nonce'),
    planHash: get('plan_hash').replace(/^sha256:/, ''),
    action: get('action') as DispatchIntent['action'],
    environment: get('environment'),
    issuedAt: env.PLATFOLIO_ISSUED_AT ?? new Date(Date.now() - 60_000).toISOString(),
    expiresAt: env.PLATFOLIO_EXPIRES_AT ?? new Date(Date.now() + 15 * 60_000).toISOString(),
  });
}

/**
 * One dispatch, start to finish. Refusals are returned, never thrown: an exception here becomes a red X with
 * no attestation, which leaves platfolio unable to tell "the runner refused" from "the runner caught fire".
 */
export async function runManagedAction(deps: RunnerDeps): Promise<RunResult> {
  const intent = readIntent(deps.env);
  const startedAt = deps.now();

  const missing = deps.env.RAILWAY_TOKEN ? [] : ['RAILWAY_TOKEN'];
  if (missing.length > 0) {
    const refusal = attestationFromApply({
      intent, appliedPlanHash: intent.planHash, durationMs: 0, finishedAt: new Date(deps.now()).toISOString(), release: RELEASE,
      result: {
        instanceId: intent.instanceId, planHash: intent.planHash, verified: false, noop: true, services: [], domains: [],
        failures: missing.map((name) => ({ step: 'credentials', code: 'credential-missing', message: `${name} is not available to this job; the environment secret may not be set, or the job did not run in that environment` })),
      },
    });
    deps.setOutput('outcome', refusal.result);
    deps.log(`refused: ${missing.join(', ')} unavailable (no provider call attempted)`);
    await deps.postAttestation(refusal);
    return { status: refusal.result, attestation: refusal };
  }

  let fetched: { plan: InfraPlan; planHash: string };
  try {
    fetched = await deps.fetchDispatch(intent);
  } catch (error) {
    // A fetch failure used to escape as an exception, which left platfolio with a red job and no
    // attestation -- indistinguishable from a runner that never started. "Could not read the plan" is a
    // result worth reporting, and it is the same argument as refusing rather than throwing everywhere else.
    const message = redactCredentialShaped((error as Error).message).slice(0, 200);
    const refusal = attestationFromApply({
      intent, appliedPlanHash: intent.planHash, durationMs: 0, finishedAt: new Date(deps.now()).toISOString(), release: RELEASE,
      result: {
        instanceId: intent.instanceId, planHash: intent.planHash, verified: false, noop: true, services: [], domains: [],
        failures: [{ step: 'plan', code: 'plan-fetch-failed', message }],
      },
    });
    deps.setOutput('outcome', refusal.result);
    deps.log(`refused: the plan could not be read (${message})`);
    await deps.postAttestation(refusal);
    return { status: refusal.result, attestation: refusal };
  }
  const stale = staleIntent({ intent, fetchedPlanHash: fetched.planHash, release: RELEASE, finishedAt: new Date(deps.now()).toISOString() });
  if (stale) {
    deps.setOutput('outcome', stale.result);
    deps.log(`refused: plan hash moved (${intent.planHash.slice(0, 12)}… -> ${fetched.planHash.replace(/^sha256:/, '').slice(0, 12)}…); nothing applied`);
    await deps.postAttestation(stale);
    return { status: stale.result, attestation: stale };
  }

  const result = await deps.applyPlan(fetched.plan);
  const changed = result.services.filter((s) => s.status === 'live').map((s) => `${s.environment ?? intent.environment}/${s.name}`);
  const attestation = attestationFromApply({
    intent,
    appliedPlanHash: result.planHash || fetched.planHash,
    result: { ...result, failures: result.failures.map((f) => ({ ...f, message: f.message.slice(0, 200) })) },
    release: RELEASE,
    durationMs: Math.max(0, deps.now() - startedAt),
    finishedAt: new Date(deps.now()).toISOString(),
  });
  deps.setOutput('outcome', attestation.result);
  deps.setOutput('changed', String(changed.length));
  // The output is a status word, not a transcript. Nothing from the provider's response text is put into an
  // output or a log line beyond the truncated failure reasons the attestation already carries, because the
  // runner's logs are readable by platfolio's designers and by anyone with repo access.
  deps.log(`outcome: ${attestation.result} (${String(changed.length)} live, ${String(result.failures.length)} failures, ${String(attestation.durationMs)}ms)`);
  await deps.postAttestation(attestation);
  return { status: attestation.result, attestation };
}
