#!/usr/bin/env tsx
/**
 * Is what we publish the same as what we ship in `templates/`?
 *
 * The templates are bundled into this repository (D50: platfolio hosts itself the way a tenant's platform is
 * hosted, so the platform description lives at a root like theirs) but they are *consumed* from three separate
 * GitHub repositories. That split is a drift machine: nothing in the normal gates touches the network, so a
 * change to `templates/` is green the moment it merges while the published template -- the thing a tenant
 * actually forks -- keeps the old files. It did exactly that today: the registry consolidation (D58) deleted
 * `.platfolio/environment.yaml` here and left it live in all three published repositories, where
 * `applyInventory` would still merge it into the plan beside the new root registry. Two files, in the one place
 * users touch.
 *
 * So this command compares, per template, the blob SHA of every local file against the SHA of the same path in
 * the published repository, and reports three kinds of disagreement:
 *
 *   STALE    -- same path, different content (the published copy is behind)
 *   MISSING  -- we ship it, the published repository does not
 *   ORPHAN   -- the published repository ships it, we do not, and it is not a declared retirement
 *
 * An ORPHAN is the case a plain "push everything" publisher cannot see: the publisher adds and replaces, so a
 * file we stopped shipping survives forever unless it is named in `RETIRED_PATHS`. That asymmetry is deliberate
 * (a fork's own files must never be deleted by us) but it means retirement is only ever as complete as the list
 * -- which is precisely why the list is checked rather than trusted.
 *
 * Read-only: this needs the app installation token for read access and writes nothing.
 *
 *   pnpm run templates:check
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GithubRepositoryWrites, createInstallationAccessToken, revokeInstallationAccessToken } from '../packages/contracts/src/index.ts';
import { RETIRED_PATHS, TEMPLATES } from './template-manifest.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const org = args.find((_, i) => args[i - 1] === '--org') ?? 'fractalsynapse';
const branch = args.find((_, i) => args[i - 1] === '--branch') ?? 'main';

const credsPath = resolve('.secrets/platfolio-app.json');
if (!existsSync(credsPath)) {
  console.error('  No app credentials at .secrets/platfolio-app.json -- this check reads the published repositories.');
  process.exit(1);
}
const creds = JSON.parse(readFileSync(credsPath, 'utf8')) as { appId: number; privateKeyPem: string; installationId?: number };
if (!creds.installationId) { console.error('  No installationId recorded.'); process.exit(1); }

const token = await createInstallationAccessToken({
  appId: creds.appId, privateKeyPem: creds.privateKeyPem, installationId: creds.installationId,
  permissions: { contents: 'read' },
});
const writes = new GithubRepositoryWrites({ token: token.token });

/** `git hash-object` computes the same SHA-1 blob id GitHub stores, so both sides are directly comparable. */
const localBlob = (content: string): string =>
  execFileSync('git', ['hash-object', '--stdin'], { input: content, encoding: 'utf8' }).trim();

let problems = 0;
try {
  for (const t of TEMPLATES) {
    const repo = `${org}/${t.repo}`;
    const published = await writes.treeEntries(repo, branch);
    const remote = new Map(published.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
    const local = t.files();
    const drift: string[] = [];

    for (const [path, content] of Object.entries(local).sort()) {
      const sha = localBlob(content);
      const theirs = remote.get(path);
      if (theirs === undefined) drift.push(`MISSING  ${path} -- we ship it, ${repo} does not`);
      else if (theirs !== sha) drift.push(`STALE    ${path} -- published ${theirs.slice(0, 8)} != source ${sha.slice(0, 8)}`);
    }
    for (const path of [...remote.keys()].sort()) {
      if (local[path] !== undefined) continue;
      if (RETIRED_PATHS.includes(path)) continue; // retired on purpose; the publisher is allowed to leave it gone
      drift.push(`ORPHAN   ${path} -- published by ${repo}, not in templates/${t.dir}, and not a declared retirement`);
    }

    if (drift.length === 0) {
      console.log(`  ${repo}: in sync with templates/${t.dir} (${Object.keys(local).length} files, blob SHAs matched)`);
    } else {
      problems += drift.length;
      console.log(`  ${repo}: DRIFTS from templates/${t.dir}`);
      for (const d of drift) console.log(`      ${d}`);
    }
  }
} finally {
  await revokeInstallationAccessToken({ token: token.token }).catch(() => undefined);
}

if (problems > 0) {
  console.error(`\n  ${String(problems)} publication drift(s). Run: pnpm run templates:publish -- --apply`);
  console.error('  A green repository tells you nothing about what a tenant forks. This check is the only thing');
  console.error('  that closes that gap, so it must run wherever the network and credentials allow it.');
  process.exit(1);
}
console.log('\n  every published template matches its source, file for file, by blob SHA.');
