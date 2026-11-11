#!/usr/bin/env tsx
/**
 * Open platfolio's install pull request against a tenant repository (runbook step 3).
 *
 * Default is a **dry run**: it prints exactly which files would be committed, their sizes, the environment
 * names it would create, and the body it would post. `--apply` is required to touch anything, because this is
 * the one moment platfolio writes to a tenant repository and a mistaken run should not be undoable by force.
 *
 * The PR is opened as a draft when `--draft` is passed. That flag exists for today's honest reason: the
 * workflow this renderer emits pins the managed action by commit SHA, and that action is not implemented yet,
 * so an install PR merged right now would produce a workflow that cannot run.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  GithubRepositoryWrites,
  createInstallationAccessToken,
  revokeInstallationAccessToken,
} from '../packages/contracts/src/index.ts';
import { applyInventory, parseCompose, parseInventory, renderInstallPullRequest } from '../packages/manifest/src/index.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1] : '') : fallback;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const credsPath = resolve('.secrets/platfolio-app.json');
const creds = JSON.parse(readFileSync(credsPath, 'utf8')) as { appId: number; privateKeyPem: string; installationId?: number; slug?: string };
if (!creds.installationId) {
  console.error('  No installationId in the credentials file. Install the app, then re-run.');
  process.exit(1);
}

const repo = flag('repo', 'fractalsynapse/platfolio')!;
// The base must be the repository's DEFAULT branch. Measured (#149): GitHub enumerates workflows from the
// default branch only, so a workflow that lives elsewhere is not listed, cannot be dispatched by name or by
// id, and answers 404 -- a silent "invisible", not an error about branches. An install PR based on a
// development branch therefore produces a platform that looks managed and never is.
const defaultBranch = execFileSync('gh', ['api', `repos/${repo}`, '--jq', '.default_branch'], { encoding: 'utf8' }).trim();
const base = flag('branch', defaultBranch || 'main')!;
if (base !== defaultBranch) console.log(`  warning: base ${base} is not the default branch (${defaultBranch}) -- the workflow will not be dispatchable there`);
const platformDir = flag('platform', 'platforms/platfolio')!;
const apply = has('apply');

const docs = ['compose.yaml', 'compose.prod.yaml'].filter((f) => existsSync(resolve(platformDir, f))).map((f) => readFileSync(resolve(platformDir, f), 'utf8'));
if (docs.length < 2) {
  console.error(`  ${platformDir} needs both compose.yaml and the generated compose.prod.yaml; an unpinned platform cannot be installed.`);
  process.exit(1);
}
const composed = parseCompose(docs);
if (!composed.manifest) {
  console.error('  Compose did not parse:', JSON.stringify(composed.issues.map((i) => `${i.code}@${i.path}`)));
  process.exit(1);
}
const invPath = resolve(platformDir, '.platfolio/environment.yaml');
const entries = existsSync(invPath) ? parseInventory(readFileSync(invPath, 'utf8')).entries : [];
const manifest = applyInventory(composed.manifest, entries);

// The action pin must be a real commit that contains the action. Until the managed action exists this names
// the commit we would pin to, and the PR says so rather than pretending the dependency is satisfied.
const actionSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const installed = renderInstallPullRequest(manifest, {
  actionRepo: 'fractalsynapse/platfolio',
  actionSha,
  platfolioUrl: flag('url', 'https://status-production-54d3.up.railway.app')!,
});

const environments = ['production', ...(manifest.spec.environments.staging.enabled ? ['staging'] : [])];
console.log(`  repo      : ${repo} (base ${base})`);
console.log(`  platform  : ${platformDir} -> ${manifest.metadata.name}@${manifest.metadata.version}`);
console.log(`  files     :`);
for (const [path, content] of Object.entries(installed.files).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`     ${path}  ${String(content.length)} bytes`);
  if (/(?:secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9+/_-]{12,}/i.test(content)) {
    console.error('     REFUSING: something in this file looks like a credential value.');
    process.exit(1);
  }
}
console.log(`  secrets   : ${installed.secrets.map((s) => `${s.service}/${s.name}`).join(', ') || 'none'} (names only)`);
console.log(`  perms     : ${JSON.stringify(installed.permissions)}`);
console.log(`  envs      : ${environments.join(', ')}`);
console.log(`  action pin: ${installed.actionPin.name}@${installed.actionPin.ref.slice(0, 12)}  (the managed action is not implemented yet, so this pin is unresolvable today)`);

if (!apply) {
  console.log('\n  DRY RUN -- nothing was written. Re-run with --apply to open the pull request.');
  process.exit(0);
}

const minted = await createInstallationAccessToken({
  appId: creds.appId,
  privateKeyPem: creds.privateKeyPem,
  installationId: creds.installationId,
  repositories: [repo.split('/')[1]!],
  // Measured: a tree containing a path under .github/workflows/ is refused with 403 -- the same message
  // "resource not accessible" that a permissions gap produces -- unless the token carries workflows:write.
  // An install PR without the workflow is not an install PR, so the grant is required, and it is requested
  // here rather than held longer-lived: this token is revoked at the end of the run.
  // D35 grants in use: environments cannot be created without administration, and the workflow path needs
  // workflows:write. Both are requested per operation and the token is revoked at the end of this run.
  permissions: { contents: 'write', workflows: 'write', pull_requests: 'write', environments: 'write', administration: 'write' },
});
console.log(`\n  installation token minted (expires ${minted.expiresAt}, selection ${minted.repositorySelection})`);

try {
  const writes = new GithubRepositoryWrites({ token: minted.token });
  // D35: platfolio creates the environments it manages. The grant that makes this possible
  // (administration: write) was the measured requirement; what platfolio still cannot do through the API is
  // attach required reviewers, so that gate is reported as the tenant's action rather than silently skipped.
  for (const name of environments) {
    const existed = await writes.environmentExists(repo, name);
    await writes.ensureEnvironment(repo, name);
        // Measured in #126: required reviewers ARE settable through the API (type User or Team; App refused). The
    // gate is not attached here because *which* humans approve production is the tenant's decision to make,
    // not a default platfolio should pick on their behalf.
    console.log(`  environment ${name}: ${existed ? 'already present' : 'created'} (reviewers can be attached by API; left to the tenant to choose)`);
  }

  const branch = `platfolio/install-${manifest.metadata.name}`;
  const { headSha, baseSha } = await writes.commitFiles({
    repo,
    baseBranch: base,
    branch,
    message: `chore(platfolio): install managed hosting for ${manifest.metadata.name}`,
    files: installed.files,
  });
  console.log(`  commit ${headSha.slice(0, 12)} on ${branch} (base ${baseSha.slice(0, 12)})`);

  const pr = await writes.openPullRequest({
    repo,
    title: `Install platfolio managed hosting (${manifest.metadata.name})`,
    head: branch,
    base,
    draft: has('draft'),
    body: [
      'Opened by platfolio. **This is the only write platfolio makes to this repository** -- after it is merged or',
      'closed, platfolio only dispatches the workflow below and never edits these files again.',
      '',
      `Files: ${Object.keys(installed.files).sort().join(', ')}`,
      `Environment secrets to fill in (names only; platfolio never stores or reads values): ${installed.secrets.map((s) => `${s.service}/${s.name}`).join(', ') || 'none'}`,
      `Workflow permissions requested: \`${Object.entries(installed.permissions).map(([k, v]) => `${k}: ${v}`).join(', ')}\``,
      '',
      '> **Do not merge yet.** The workflow pins the managed action by commit SHA, and that action is not',
      '> implemented. Merging today would add a workflow that cannot run. This PR exists to prove the install',
      '> path -- one reviewable commit, no secret values, environments present -- and to be closed or superseded',
      '> once the action lands.',
      '',
      'Refusing this PR is a valid outcome, and the reason the install ships as a pull request at all.',
    ].join('\n'),
  });
  console.log(`  pull request #${String(pr.number)}: ${pr.htmlUrl}${has('draft') ? ' (draft)' : ''}`);
} finally {
  await revokeInstallationAccessToken({ token: minted.token });
  console.log('  installation token revoked');
}
