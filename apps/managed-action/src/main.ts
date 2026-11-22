import { appendFileSync } from 'node:fs';
import { HttpRailwayTransport, MintingRailwayCredentials, RailwayInfraProvider, type ApplyResult, type Attestation, type DispatchIntent, type InfraPlan } from '../../../packages/contracts/src/index.ts';
import { runManagedAction } from './runner.ts';

/** Named per instance so a tenant can see which workflow minted what, in their own token list. */
const intentName = (env: Record<string, string | undefined>): string => (env.INPUT_INSTANCE_ID ?? 'dispatch').slice(0, 24).replace(/[^A-Za-z0-9_-]/g, '-');

/**
 * Wiring only, on purpose (D30).
 *
 * Every decision lives in `runner.ts` where it can be tested. This file's job is to exist at the boundary:
 * read the environment, hold the credential, make the two HTTP calls, write the step output. It is also the
 * part that cannot be proven without a run, which is why the OIDC exchange below is the only place in this
 * feature that carries an unverified assumption into production -- everything else has a test or a measurement.
 */

const url = (process.env.PLATFOLIO_URL ?? '').replace(/\/$/, '');
if (!url) { console.error('PLATFOLIO_URL is required'); process.exit(2); }

async function idToken(): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) throw new Error('no OIDC id token available; the workflow needs `id-token: write`');
  const audience = process.env.PLATFOLIO_AUDIENCE ?? 'platfolio.control-plane';
  const response = await fetch(`${requestUrl}&audience=${encodeURIComponent(audience)}`, { headers: { authorization: `Bearer ${requestToken}` } });
  if (!response.ok) throw new Error(`OIDC token request failed (${String(response.status)})`);
  const { value } = await response.json() as { value: string };
  return value;
}

// Two credentials, two purposes, and the distinction is the point. The shared dispatch token is what
// authenticates today; the OIDC id token is the runner's identity, sent so it can be recorded and -- once
// JWKS verification exists -- checked. Presenting only the OIDC token looked like the stronger design and
// answered 401, because nothing verifies it yet: an unverified identity is a claim, not a credential.
const idTokenValue = await idToken();
const dispatchToken = process.env.PLATFOLIO_DISPATCH_TOKEN;
if (!dispatchToken) throw new Error('PLATFOLIO_DISPATCH_TOKEN is not available to this job; set it as an environment secret');
const headers = {
  authorization: `Bearer ${dispatchToken}`,
  'x-platfolio-runner-token': idTokenValue,
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': 'platfolio-managed-action',
};

await runManagedAction({
  env: process.env as Record<string, string | undefined>,
  async fetchDispatch(intent: DispatchIntent): Promise<{ plan: InfraPlan; planHash: string }> {
    const response = await fetch(`${url}/api/v1/instances/${encodeURIComponent(intent.instanceId)}/dispatches/${encodeURIComponent(intent.dispatchId)}`, { headers });
    if (!response.ok) throw new Error(`plan fetch failed (${String(response.status)}); refusing to act on a plan we could not read`);
    const body = await response.json() as { plan: InfraPlan; planHash: string };
    return { plan: body.plan, planHash: String(body.planHash).replace(/^sha256:/, '') };
  },
  async applyPlan(plan: InfraPlan): Promise<ApplyResult> {
    const provider = new RailwayInfraProvider({
      // The workspace-tier credential is what the provider's provisioning path requires today; narrowing to
      // a per-environment project token is #135's remaining refactor, and this line is where that will change.
      credentials: new MintingRailwayCredentials({
        workspaceCredential: { kind: 'workspace', token: process.env.RAILWAY_TOKEN ?? '' },
        // The same transport the provider uses: environment-scoped project tokens are minted through it, so
        // the workspace credential is never sent on the per-service calls the plan actually makes.
        transport: new HttpRailwayTransport({ requestTimeoutMs: 25_000 }),
        tokenName: `platfolio-${intentName(process.env)}`,
      }),
      transport: new HttpRailwayTransport({ requestTimeoutMs: 60_000 }),
      workspaceId: process.env.RAILWAY_WORKSPACE_ID ?? '',
      deployBudget: Number(process.env.PLATFOLIO_DEPLOY_BUDGET ?? '12'),
      deployTimeoutMs: Number(process.env.PLATFOLIO_DEPLOY_TIMEOUT_MS ?? '600000'),
      pollIntervalMs: 10_000,
    });
    return await provider.applyPlan(plan);
  },
  async postAttestation(attestation: Attestation): Promise<void> {
    const response = await fetch(`${url}/api/v1/attestations`, { method: 'POST', headers, body: JSON.stringify(attestation) });
    if (!response.ok) console.error(`attestation post failed (${String(response.status)}); the step output still reports the outcome`);
  },
  setOutput(name: string, value: string): void {
    const file = process.env.GITHUB_OUTPUT;
    if (file) appendFileSync(file, `${name}=${value}\n`);
    console.log(`::set-output name=${name}::${value}`);
  },
  log: (line) => console.log(line),
  now: () => Date.now(),
}).then((result) => {
  // A partial apply is a successful *run* that needs attention, not a failed job: exiting non-zero there
  // would make GitHub's own status the only signal and hide the distinction the attestation carries.
  process.exitCode = result.status === 'failed' ? 1 : 0;
});
