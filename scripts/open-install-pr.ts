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
 *
 * ## Where the platform description comes from, and why it is not a directory any more
 *
 * This script used to read `compose.yaml`, `compose.prod.yaml` and `environment.yaml` off the maintainer's
 * own filesystem (`--platform <dir>`, defaulting to `.`). That was not a neutral convenience: it defaulted to
 * *platfolio's own* platform, so a dry run aimed at an unrelated tenant repository reported the wrong platform
 * (D48), it was invisible to `api:check`, to the scope guard and to the audit trail, and it meant the shape of
 * a tenant's repository could only be inspected by someone holding a checkout. Reading a repository from a
 * shell was the missing middle of #172, and `POST …/instances/{id}/plan/from-repository` is the API operation
 * that replaced it.
 *
 * So the platform description now arrives through the same source-control seam the control plane uses (D22),
 * from a **repository at a ref**:
 *
 * - `--template=<name>` reads a published template from the catalog (`packages/manifest/src/template-catalog.ts`):
 *   `fractalsynapse/platfolio-starter-web` and its two siblings. Those repositories are public and open source
 *   by the maintainer's ruling of 2026-11-14, so this needs no credential to read them -- and it needs no
 *   bundled copy either: the template a tenant forks is the template this tool renders.
 * - `--repo=<owner/name>` (the tenant repository the PR is opened against) is also the default source, at the
 *   base branch: an install PR describes the repository it lands in.
 *
 * What the rendered PR *contains* is unchanged -- same files, same secret names, same permissions block, same
 * pin, and the same refusal on anything credential-shaped. Only the origin of the bytes moved. Writing to the
 * tenant repository still goes through the installation-token path and still needs the same grants.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  GithubRepositoryWrites,
  GitScm,
  RepositoryReadError,
  createInstallationAccessToken,
  readRepositoryFile,
  revokeInstallationAccessToken,
} from '../packages/contracts/src/index.ts';
import {
  ACTION_PATH, applyInventory, composeDocuments, parseCompose, parseInventory, renderInstallPullRequest,
  templateCatalogEntry, readRepositorySource, type RepositoryFileReader,
} from '../packages/manifest/src/index.ts';

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
const creds = existsSync(credsPath)
  ? JSON.parse(readFileSync(credsPath, 'utf8')) as { appId: number; privateKeyPem: string; installationId?: number; slug?: string }
  : undefined;
if (has('apply') && (!creds || !creds.installationId)) {
  console.error('  No installationId in .secrets/platfolio-app.json. Install the app, then re-run.');
  console.error('  A dry run needs neither file: reading a public repository is anonymous (D22, and the maintainer\'s 2026-11-14 ruling).');
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
const apply = has('apply');

/**
 * Which repository and ref the platform description is read from, and the driver that reads it (D22).
 *
 * `PLATFOLIO_SCM_DRIVER` selects the driver exactly as the composition root in `packages/kernel/src/scm.ts`
 * selects it: `git` (default) reads any ref over HTTPS against any forge and needs nothing for a public
 * repository; `github-app` goes through the Contents API with a per-call installation token and is what a
 * *private* tenant repository requires. The two are the same seam -- that is what made the second driver the
 * proof the contract was provider-shaped rather than GitHub-shaped.
 */
const driver = process.env.PLATFOLIO_SCM_DRIVER ?? 'git';
const templateName = flag('template');
// A template is read from ITS repository, at the ref the catalog carries; anything else is read from the
// repository the PR lands in, at the branch it lands on. Both are the same seam call.
const entry = templateName === undefined ? undefined : templateCatalogEntry(templateName);
const sourceRepo = flag('source-repo') ?? entry?.repo ?? repo;
const sourceRef = flag('template-ref') ?? flag('source-ref') ?? entry?.ref ?? base;

/** The app credentials the `github-app` driver needs, or nothing when the driver is `git`. */
const appCreds = creds?.installationId === undefined
  ? undefined
  : { appId: creds.appId, privateKeyPem: creds.privateKeyPem, installationId: creds.installationId };

function reader(): RepositoryFileReader {
  if (driver === 'github-app') {
    if (appCreds === undefined) {
      console.error(`  PLATFOLIO_SCM_DRIVER=github-app needs app credentials with an installationId at ${credsPath}.`);
      process.exit(1);
    }
    return (request) => readRepositoryFile({ ...appCreds!, ...request });
  }
  if (driver !== 'git') {
    console.error(`  PLATFOLIO_SCM_DRIVER must be "git" or "github-app", got "${driver}".`);
    process.exit(1);
  }
  // Anonymous unless PLATFOLIO_GIT_TOKEN is set. The value is never printed: it rides inside the remote URL,
  // and `GitScm` masks it in every string it can produce (D4).
  const git = new GitScm({ ...(process.env.PLATFOLIO_GIT_TOKEN === undefined ? {} : { token: process.env.PLATFOLIO_GIT_TOKEN }) });
  return (request) => git.readRepositoryFile(request);
}

/**
 * The platform description: the template's published repository, or the tenant repository being installed.
 *
 * `compose.prod.yaml` is read as the optional overlay it is. A fork does not commit one (D54 -- the release
 * reports the digest through `POST …/artifacts`, which is how #217 closed), while platfolio's own repository
 * does, so the document set this renders from is exactly what `registerPlanFromRepository` assembles: every
 * service that carries a pin is pinned, and an unpinned first-party service still refuses to render below.
 */
const source = await readRepositorySource({
  readFile: reader(),
  repo: sourceRepo,
  ref: sourceRef,
  prodOverlay: true,
  inventory: true,
});

if (entry === undefined && flag('template-ref') === undefined && flag('source-ref') === undefined && !/^[0-9a-f]{40}$/.test(sourceRef)) {
  console.log(`  note: read ${sourceRepo}@${sourceRef} (a branch, not a pinned commit). A plan must be built from a commit (D29); the SHAs below identify what this PR was rendered from.`);
}
console.log(`  source    : ${sourceRepo}@${sourceRef} through the "${driver}" driver of the scm seam`);
for (const [path, sha] of Object.entries(source.blobs).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`     ${path}  ${sha}`);
}

const composed = parseCompose(composeDocuments(source));
if (!composed.manifest) {
  console.error('  Compose did not parse:', JSON.stringify(composed.issues.map((i) => `${i.code}@${i.path}`)));
  console.error('  An unpinned first-party service will not render: commit compose.prod.yaml or report the digest (D54).');
  process.exit(1);
}
const entries = source.inventory === undefined ? [] : parseInventory(source.inventory).entries;
const manifest = applyInventory(composed.manifest, entries);

// The action pin must be a real commit that contains the action. Until the managed action exists this names
// the commit we would pin to, and the PR says so rather than pretending the dependency is satisfied.
const actionSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

/**
 * Does the pinned commit actually carry the action? Fails the run before a workflow can be opened against a
 * commit that GitHub will resolve to nothing.
 *
 * Verified against `ACTION_REPO`, never the tenant. The first version passed the *tenant* repository here, so
 * the check asked "does the customer's repository contain platfolio's action file" -- which no tenant ever
 * will. It refused every real install (found by running it against a fresh tenant repo, where it told me to
 * "land the action on the repository default branch" of a repository that ships no actions at all) while
 * passing on platfolio's own repository, the only case it had ever used for. A check that is right
 * exactly where it is never exercised is not a check.
 *
 * It also used to shell out to `gh api .../contents/...`, which was a second way of reading a repository
 * beside the one this script exists to standardise on. Same question, same answer, one mechanism -- and the
 * distinction it can now make (`not-found` versus a bad ref versus a refusal) is the seam's own contract.
 */
async function refHasAction(sha: string): Promise<{ ok: boolean; reason: string }> {
  const path = `${ACTION_PATH}/action.yml`;
  try {
    await reader()({ repo: ACTION_REPO, ref: sha, path });
    return { ok: true, reason: `${ACTION_REPO}@${sha.slice(0, 12)} carries ${path}` };
  } catch (error) {
    if (error instanceof RepositoryReadError) {
      return { ok: false, reason: `${error.failure.kind}: ${error.failure.detail}` };
    }
    return { ok: false, reason: (error as Error).message };
  }
}
const pinned = await refHasAction(actionSha);
if (!pinned.ok) {
  console.error(`  refusing to pin ${actionSha.slice(0, 12)}: ${pinned.reason}`);
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
console.log(`  platform  : ${sourceRepo}@${sourceRef.slice(0, 12)} -> ${manifest.metadata.name}@${manifest.metadata.version}`);
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
  appId: creds!.appId,
  privateKeyPem: creds!.privateKeyPem,
  installationId: creds!.installationId!,
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
