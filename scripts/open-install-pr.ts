#!/usr/bin/env tsx
/**
 * Open platfolio's install pull request against a tenant repository (runbook step 3).
 *
 * Default is a **dry run**: it prints exactly which files would be committed, their sizes, the environment
 * names it would create, and the body it would post. `--apply` is required to touch anything, because this is
 * the one moment platfolio writes to a tenant repository and a mistaken run should not be undoable by force.
 *
 * The PR is opened as a draft when `--draft` is passed. That claim used to read "the managed action is not
 * implemented yet, so an install PR merged today would produce a workflow that cannot run" -- true when the
 * flag was added, and left in the file long after it stopped being true. The reason now is ordinary: an
 * install PR writes into a tenant repository, so a human should read it before it lands.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  GithubRepositoryWrites,
  createInstallationAccessToken,
  revokeInstallationAccessToken,
} from '../packages/contracts/src/index.ts';
import { ACTION_PATH, applyInventory, parseCompose, parseInventory, renderInstallPullRequest } from '../packages/manifest/src/index.ts';

/**
 * The repository the managed action ships from. One constant, because the pin check and the rendered workflow
 * must agree on it: verifying the pin against the tenant repository -- what this script did first -- asks the
 * customer's repository to contain platfolio's action file, and no tenant ever will.
 */
const ACTION_REPO = process.env.PLATFOLIO_ACTION_REPO ?? 'fractalsynapse/platfolio';

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
const platformDir = flag('platform', '.')!;
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
const invPath = resolve(platformDir, 'environment.yaml');
const entries = existsSync(invPath) ? parseInventory(readFileSync(invPath, 'utf8')).entries : [];
const manifest = applyInventory(composed.manifest, entries);

// The action pin must be a real commit that contains the action. Until the managed action exists this names
// the commit we would pin to, and the PR says so rather than pretending the dependency is satisfied.
const actionSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// A pin is only a trust anchor if the commit it names actually contains the action. The first real run failed
// at "Set up job" because the install workflow was generated before .github/actions/platfolio-managed
// existed, so GitHub resolved a real, signed commit to a missing file -- D30 law 3 satisfied, and useless.
// Check it at the source of truth rather than trusting that HEAD is the right answer.

/** Does the pinned commit actually carry the action? Fails the run before a workflow can be opened against a
 * commit that GitHub will resolve to nothing. */
/**
 * Does the pinned commit actually carry the action? Fails the run before a workflow can be opened against a
 * commit that GitHub will resolve to nothing.
 *
 * Verified against `ACTION_REPO`, never the tenant. The first version passed the *tenant* repository here, so
 * the check asked "does the customer's repository contain platfolio's action file" -- which no tenant ever
 * will. It refused every real install (found by running it against a fresh tenant repo, where it told me to
 * "land the action on the repository default branch" of a repository that ships no actions at all) while
 * passing on platfolio's own repository, the only case it had ever been used for. A check that is right
 * exactly where it is never exercised is not a check.
 */
function refHasAction(sha: string): boolean {
  try {
    execFileSync('gh', ['api', `repos/${ACTION_REPO}/contents/${ACTION_PATH}/action.yml?ref=${sha}`, '--jq', '.name'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
if (!refHasAction(actionSha)) {
  console.error(`  refusing to pin ${actionSha.slice(0, 12)}: ${ACTION_REPO}@${actionSha.slice(0, 12)} does not contain ${ACTION_PATH}/action.yml.`);
  console.error('  the tenant workflow would fail at "Set up job" with a missing-action error. Publish the action');
  console.error('  commit to the platfolio repository first -- the pin must name a commit that carries it.');
  process.exit(1);
}

const workspaceId = flag('workspace', process.env.RAILWAY_WORKSPACE_ID ?? '82ba4aff-61f3-4b19-b863-8b650ebb66b2')!;
const installed = renderInstallPullRequest(manifest, {
  workspaceId,
  actionRepo: ACTION_REPO,
  actionSha,
  // D47: no default control-plane host. A committed default silently points every install this tool opens at
// whoever wrote it first -- which is exactly how a generated Railway hostname reached a workflow file.
platfolioUrl: requireControlPlaneUrl(),
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
console.log(`  action pin: ${installed.actionPin.name}@${installed.actionPin.ref.slice(0, 12)}  (verified to carry ${ACTION_PATH}/action.yml above)`);

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

/**
 * `--url=` or `PLATFOLIO_URL`, and nothing else. The message names both, because whoever runs this is usually
 * self-hosting and needs "where do I point it", not "argument missing".
 */
function requireControlPlaneUrl(): string {
  const url = flag('url') ?? process.env.PLATFOLIO_URL?.trim();
  if (!url) {
    console.error('open-install-pr: no control-plane URL. Pass --url=https://api.<your-domain> or set PLATFOLIO_URL.');
    console.error('  There is deliberately no default: a committed one makes every install PR point at the author\'s deployment.');
    process.exit(1);
  }
  return url;
}
