#!/usr/bin/env tsx
/**
 * Publish the platform templates into a tenant organization (option B: the maintainer creates the
 * repositories and adds them to the app installation; platfolio writes the scaffold into them).
 *
 * Dry run by default, because this writes into repositories. Two things it refuses to do, deliberately:
 *
 * - **Never create a repository.** #130 measured that a repository the app creates is invisible to the app
 *   afterwards, so "platfolio bootstraps the repo" is not a capability today and a script that pretended
 *   otherwise would fail at the second call with a confusing 404. Creation is the tenant's act, once per
 *   platform; everything after that is platfolio's.
 * - **Never delete one.** D36.
 *
 * An empty repository gets an initial commit with no parents; a repository that already has history gets a
 * branch and a pull request, so nothing is ever pushed onto a default branch without a human reviewing it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  GithubRepositoryWrites,
  createInstallationAccessToken,
  revokeInstallationAccessToken,
} from '../packages/contracts/src/index.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const apply = args.includes('--apply');
const org = args.find((_, i) => args[i - 1] === '--org') ?? 'fractalsynapse';
const branch = args.find((_, i) => args[i - 1] === '--branch') ?? 'main';

const TEMPLATES = [
  { dir: 'starter-web', repo: 'platfolio-starter-web', label: 'web service (public UI + API, managed Postgres)' },
  { dir: 'starter-worker', repo: 'platfolio-starter-worker', label: 'worker (no inbound, retained volume)' },
  { dir: 'shared-identity', repo: 'platfolio-shared-identity', label: 'shared identity (Keycloak, provides identity)' },
];

/** Everything under the template directory, including dotfiles -- `.platfolio/environment.yaml` is the point. */
function collect(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel)).sort()) {
      const full = join(dir, rel, entry);
      const key = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(key);
      else out[key] = readFileSync(full, 'utf8');
    }
  };
  walk('');
  return out;
}

const credsPath = resolve('.secrets/platfolio-app.json');
if (!existsSync(credsPath)) {
  console.error('  No app credentials. Run "pnpm run app:local -- --org <org>" first.');
  process.exit(1);
}
const creds = JSON.parse(readFileSync(credsPath, 'utf8')) as { appId: number; privateKeyPem: string; installationId?: number };
if (!creds.installationId) { console.error('  No installationId recorded; install the app, then re-run.'); process.exit(1); }

console.log(`  organization: ${org}   branch: ${branch}   ${apply ? 'APPLY' : 'DRY RUN (no writes)'}`);
const plans = TEMPLATES.map((t) => ({ ...t, files: collect(`platform-templates/${t.dir}`) }));
for (const p of plans) {
  console.log(`  ${p.repo}  <- platform-templates/${p.dir}  (${String(Object.keys(p.files).length)} files: ${p.label})`);
  console.log(`      ${Object.keys(p.files).sort().join(', ')}`);
}
if (!apply) {
  console.log('\n  DRY RUN. Re-run with --apply once the repositories exist and are added to the installation.');
  console.log('  Create them EMPTY and PRIVATE (no README, no .gitignore): a generated README would become a');
  console.log('  parent commit, and the first commit is where platfolio records what it published.');
  process.exit(0);
}

const token = await createInstallationAccessToken({
  appId: creds.appId, privateKeyPem: creds.privateKeyPem, installationId: creds.installationId,
  // pull_requests too: publishing into a repository with someone else's history must arrive as a review,
  // and a token without the grant answers 403 on POST /pulls -- measured, same family as workflows:write.
  permissions: { contents: 'write', pull_requests: 'write' },
});
const writes = new GithubRepositoryWrites({ token: token.token });
console.log(`\n  token minted (expires ${token.expiresAt}, selection ${token.repositorySelection})`);

try {
  for (const p of plans) {
    const repo = `${org}/${p.repo}`;
    if (!(await writes.repositoryVisible(repo))) {
      console.error(`  SKIPPED ${repo}: the installation cannot see this repository.`);
      console.error(`            Create it (private, empty) and add it to the app's repository selection, or`);
      console.error(`            set repository access to All repositories. #130 explains why creating it here`);
      console.error(`            would produce the same 404 on every later call.`);
      continue;
    }
    let exists = true;
    try { await writes.branchSha(repo, branch); } catch { exists = false; }
    if (!exists) {
      // Empty repository: the Git data API refuses to make the first object (409 "Git Repository is
      // empty"), so the branch is created through the contents endpoint and the rest follows as one commit.
      const { headSha, seeded } = await writes.seedAndCommit({
        repo,
        branch,
        seedFile: { path: 'README.md', content: `# ${p.repo}\n\nPublished by platfolio from \`platform-templates/${p.dir}\`. Fork it and make it yours.\n` },
        message: `chore(platfolio): publish the ${p.dir} template`,
        files: p.files,
      });
      console.log(`  ${repo}: ${seeded ? 'seeded empty repo, then ' : ''}initial content commit ${headSha.slice(0, 10)} on ${branch}`);
      continue;
    }
    // Distinguishing who owns the history decides how the write arrives. A repository whose only commits are
    // platfolio's is being *updated* -- a pull request against our own output would ask a human to approve a
    // no-op diff every publish. A repository with someone else's history is a contribution and gets reviewed,
    // which is what the pull_requests grant is for.
    const history = await writes.listCommits(repo, branch);
    const oursSoFar = history.length > 0 && history.every((m) => m.startsWith('chore(platfolio)'));
    if (oursSoFar) {
      const { headSha } = await writes.commitFiles({ repo, baseBranch: branch, branch, message: `chore(platfolio): update the ${p.dir} template`, files: p.files });
      console.log(`  ${repo}: republished onto ${branch} at ${headSha.slice(0, 10)}`);
    } else {
      const b = `platfolio/publish-${p.dir}`;
      const { headSha } = await writes.commitFiles({ repo, baseBranch: branch, branch: b, message: `chore(platfolio): publish the ${p.dir} template`, files: p.files });
      const pr = await writes.openPullRequest({
        repo, title: `Publish the ${p.dir} platform template`, base: branch, head: b,
        body: `Written by platfolio from \`platform-templates/${p.dir}\` in platfolio's own repository.\n\nThis is ${p.label}. The source of truth stays in platfolio; this repository is the artifact, so a team that wants a different starting point forks it and owns the result.`,
      });
      console.log(`  ${repo}: commit ${headSha.slice(0, 10)} -> PR #${String(pr.number)} ${pr.htmlUrl}`);
    }
  }
} finally {
  await revokeInstallationAccessToken({ token: token.token });
  console.log('  token revoked');
}
