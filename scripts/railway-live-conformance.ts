#!/usr/bin/env node
/**
 * E26 — run the conformance suite against the **live** Railway API.
 *
 * This costs real things: it creates a project, deploys one service per environment (currently 2 of the
 * tenant's daily deploy ceiling), and deletes everything again. It is not part of `pnpm run verify` and
 * CI cannot run it. Nothing here is a substitute for the mock suite, and nothing there is proof of this.
 *
 *   RAILWAY_WORKSPACE_ID=... tsx scripts/railway-live-conformance.ts
 *
 * Reads the workspace token from `.secrets/railway-workspace.token` (untracked, and the credential-hygiene
 * gate refuses to track it). Never prints a token or a secret value.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  HttpRailwayTransport, MintingRailwayCredentials, RailwayInfraProvider, runConformance,
  type InfraPlan,
} from '../packages/contracts/src/index.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workspaceId = process.env.RAILWAY_WORKSPACE_ID ?? '';
const tokenFile = path.join(ROOT, '.secrets', 'railway-workspace.token');

if (!workspaceId) {
  console.error('error: set RAILWAY_WORKSPACE_ID (the workspace to create and delete a project in)');
  process.exit(1);
}
if (!fs.existsSync(tokenFile)) {
  console.error(`error: ${path.relative(ROOT, tokenFile)} not found; this run needs a workspace grant`);
  process.exit(1);
}

const WORKSPACE_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
// 25s per request; the API answers these in well under a second, and a hung call must surface as an
// error rather than as a run that never ends (measured the hard way).
const transport = new HttpRailwayTransport({ requestTimeoutMs: 25_000 });
const credentials = new MintingRailwayCredentials({
  workspaceCredential: { kind: 'workspace', token: WORKSPACE_TOKEN },
  transport,
});

/**
 * The live plan. Deliberately narrow: one service per environment so the run costs two deploys, a real
 * digest for the image, no secrets (the missing-secret path is exercised separately below without any
 * deploy), and ceilings inside a plausible range.
 */
function livePlan(): InfraPlan {
  // Must carry a tag: a tagless digest reference is accepted by Railway and then never deploys (E26).
  const image = 'docker.io/library/nginx:alpine';
  const digest = process.env.LIVE_IMAGE_DIGEST ?? '';
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    console.error('error: LIVE_IMAGE_DIGEST must be a real sha256:<64 hex> digest for docker.io/library/nginx:alpine');
    process.exit(1);
  }
  const service = (replicas: number, references: { variable: string; database: string; output?: string }[] = []) => ({
    name: 'web',
    image,
    digest,
    port: 80,
    healthPath: '/',
    replicas,
    limits: { cpu: 0.5, memoryMB: 512 },
    env: [{ name: 'NODE_ENV', literal: 'production' }],
    secrets: [],
    // A declared reference: the provider writes Railway's reference expression, never a value it chose.
    references,
  });
  return {
    instanceId: 'e26',
    teamId: 'team-e26',
    provider: 'railway',
    contract: '1.0.0',
    planHash: 'e26'.padEnd(16, '0'),
    manifestRef: { platform: 'livecheck', version: '0.0.0' },
    environments: [
      { name: 'production', services: [service(1, [{ variable: 'DATABASE_URL', database: 'e2e-db', output: 'DATABASE_URL' }])], domains: [{ host: 'web.up.railway.app', service: 'web', port: 80, verificationName: 'unused' }], databases: [{ name: 'e2e-db', kind: 'postgres' }], buckets: [] },
      { name: 'staging', cloneFrom: 'production', services: [service(1, [])], domains: [], databases: [], buckets: [] },
    ],
  };
}

function provider(deployBudget: number): RailwayInfraProvider {
  return new RailwayInfraProvider({
    credentials,
    transport,
    workspaceId,
    deployBudget,
    deployTimeoutMs: Number(process.env.LIVE_DEPLOY_TIMEOUT_MS ?? 300_000),
    pollIntervalMs: Number(process.env.LIVE_POLL_MS ?? 10_000),
  });
}

async function cleanup(): Promise<string[]> {
  const notes: string[] = [];
  try {
    const probe = provider(0);
    const state = await probe.readState('e26').then(() => true).catch(() => false);
    if (state) {
      const deleted = await provider(0).deleteInstance('e26');
      notes.push(`project deleted (removed ${deleted.removed.length}, orphans ${deleted.orphans.length})`);
      if (deleted.orphans.length) notes.push(`ORPHANS LEFT: ${deleted.orphans.join(', ')}`);
    }
  } catch (error) {
    notes.push(`cleanup failed: ${(error as Error).message.slice(0, 160)}`);
  }
  try {
    await credentials.revokeAll();
    notes.push(`revoked ${credentials.mintedNames.length} minted token(s)`);
  } catch (error) {
    notes.push(`token revocation failed: ${(error as Error).message.slice(0, 120)}`);
  }
  return notes;
}

const started = Date.now();
let exitCode = 1;
try {
  console.log('E26 live conformance — creating and destroying one project in the dev workspace');
  // A workspace allows one project creation per 30 seconds (measured), and previous runs in this session
  // created some, so start politely.
  await new Promise((resolve) => { setTimeout(resolve, 32_000); });
  // A wall-clock cap, because the provider can otherwise wait on deployments indefinitely.
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('E26 exceeded its wall-clock budget')), Number(process.env.LIVE_TOTAL_TIMEOUT_MS ?? 780_000));
  });
  const report = await Promise.race([runConformance(() => provider(6), '^1.0.0', { plan: livePlan }), deadline]);
  console.log(`\nscope=${report.scope} provider=${report.provider} contract=${report.contract}`);
  for (const result of report.results) {
    console.log(`  ${result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'N/I '} ${result.name}`);
    console.log(`       ${result.detail}`);
  }
  console.log(`\n  passed ${report.passed}  failed ${report.failed}  not-implemented ${report.unimplemented}  ok ${report.ok}`);

  // Measured 2026-11-08: a workspace allows **1 project creation per 30 seconds**. The suite created and
  // deleted one project above, so the probe below would otherwise fail for a reason that has nothing to do
  // with what it is testing. Recorded in docs/research as an operational constraint of the provider.
  console.log('\nwaiting 35s for the workspace project-creation rate limit (1 per 30s, measured):');
  await new Promise((resolve) => setTimeout(resolve, 35_000));

  // The missing-secret path, with a zero deploy budget so it costs nothing: placement and variable
  // writes still happen, and the presence check is the thing under test.
  console.log('\nsecret presence check (no deploys):');
  const withSecret = livePlan();
  withSecret.instanceId = 'e26b';
  withSecret.planHash = 'e26b'.padEnd(16, '0');
  for (const environment of withSecret.environments) {
    environment.services = environment.services.map((s) => ({ ...s, secrets: [{ name: 'NOT_SET_ANYWHERE', source: 'preserve' as const }] }));
  }
  const secretProbe = provider(0);
  try {
    const applied = await secretProbe.applyPlan(withSecret);
    const codes = applied.failures.map((f) => f.code);
    console.log(`  failures: ${JSON.stringify(codes)}`);
    console.log(`  secret-unavailable reported: ${codes.includes('secret-unavailable') ? 'yes' : 'NO — the presence check is not working against the live API'}`);
    console.log(`  notes: ${JSON.stringify((applied.notes ?? []).map((n) => n.code))}`);
  } catch (error) {
    console.log(`  probe threw: ${(error as Error).message.slice(0, 200)}`);
  }

  const second = provider(0);
  try {
    const removed = await second.deleteInstance('e26b');
    console.log(`  e26b removed: ${removed.removed.length}, orphans: ${removed.orphans.length}`);
  } catch (error) {
    console.log(`  e26b delete failed: ${(error as Error).message.slice(0, 160)}`);
  }

  exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error(`\nE26 aborted: ${(error as Error).message.slice(0, 400)}`);
  exitCode = 2;
} finally {
  const notes = await cleanup();
  console.log('\ncleanup:');
  for (const note of notes) console.log(`  ${note}`);
  console.log(`  elapsed ${Math.round((Date.now() - started) / 1000)}s`);
  const used = await transport.graphql<{ user?: { resourceUsage?: unknown } }>({
    operation: 'me',
    credential: { kind: 'workspace', token: WORKSPACE_TOKEN },
    query: '{ user { id } }',
  }).catch(() => null);
  void used;
  console.log('  (deploy counters are in the Railway dashboard; `me` is account-scoped and cannot be called with this token)');
}
process.exit(exitCode);
