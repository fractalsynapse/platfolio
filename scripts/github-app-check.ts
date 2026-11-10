#!/usr/bin/env tsx
/**
 * Report the state of platfolio's GitHub App credentials (runbook step 2 verification).
 *
 * Exists because the interesting questions after registration are all *reachability* questions -- does the
 * private key work, is the app installed, on which repositories -- and each one is answered by an API call
 * that either succeeds or explains itself. The alternative is a tenant being told "check the dashboard".
 *
 * Nothing here prints a credential. The app id, slug, installation ids and repository names are identifiers,
 * not secrets; the key, client secret and webhook secret are values, and they stay in the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAppJwt } from '../packages/contracts/src/index.ts';

const file = resolve(process.argv[2] ?? '.secrets/platfolio-app.json');
if (!existsSync(file)) {
  console.error(`  No credentials file at ${file}. Run "pnpm run app:local" first.`);
  process.exit(1);
}
const creds = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const keys = Object.keys(creds).sort();
console.log(`  file: ${file}`);
console.log(`  fields present: ${keys.join(', ')}`);
for (const required of ['appId', 'slug', 'clientId', 'clientSecret', 'privateKeyPem']) {
  if (creds[required] === undefined) console.log(`  MISSING required field: ${required}`);
}
if (typeof creds.privateKeyPem !== 'string' || typeof creds.appId !== 'number') {
  console.error('  Cannot continue without an app id and private key.');
  process.exit(1);
}

const call = async (path: string): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${createAppJwt({ appId: creds.appId as number, privateKeyPem: creds.privateKeyPem as string })}`, accept: 'application/vnd.github+json', 'user-agent': 'platfolio' },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

// The app-authenticated endpoints answer three separate questions, and conflating them is how a half-installed
// app gets reported as working.
const whoami = await call('/app');
console.log(`  GET /app (app JWT): ${String(whoami.status)}${whoami.status === 200 ? ` as ${JSON.stringify((whoami.body as { slug?: string }).slug)}` : ` -- ${(JSON.stringify(whoami.body) ?? '').slice(0, 120)}`}`);

type Installation = { id: number; account: { login: string }; repositories_selection?: string; suspended_at?: string | null };
const installations = await call('/app/installations');
// GitHub returns a bare array for this endpoint under app auth; the wrapped shape is what a paginated
// client would see, so both are handled and neither is assumed.
const wrapped = (installations.body as { installations?: unknown } | null)?.installations;
const list: Installation[] = Array.isArray(wrapped) ? wrapped as Installation[] : Array.isArray(installations.body) ? installations.body as Installation[] : [];
console.log(`  GET /app/installations: ${String(installations.status)} -> ${String(list.length)} installation(s)`);
for (const i of list) console.log(`    installation ${String(i.id)} on ${i.account.login}${i.suspended_at ? ' (SUSPENDED)' : ''}`);

if (list.length === 0) {
  console.log(`\n  Not installed yet: https://github.com/apps/${String(creds.slug)}/installations/new`);
  // Measured rule: a PRIVATE app can only be installed on the account that owns it. An app registered under a
  // personal account therefore cannot be installed on organization repositories at all -- no permission grant
  // changes that, and "make it public" would expose a development app holding contents/secrets write access.
  // The fix is to register it under the organization: pnpm run app:local -- --org <ORG>.
  if (whoami.status === 200) {
    const owner = (whoami.body as { owner?: { login?: string; type?: string }; public?: boolean } | null)?.owner;
    if (owner?.type === 'User' && (whoami.body as { public?: boolean }).public !== true) {
      console.log(`  Owner is ${String(owner.login)} (a personal account) and the app is private, so it can ONLY be installed on that account.`);
      console.log(`  For organization repositories, register it under the organization instead: pnpm run app:local -- --org <ORG>`);
    }
  }
  process.exit(0);
}

const first = list[0]!;
const repos = await call(`/installation/repositories`);
const repoList = (repos.body as { repositories?: { full_name: string }[] }).repositories ?? [];
console.log(`  GET /installation/repositories: ${String(repos.status)} -> ${String(repoList.length)} repository(ies)`);
for (const r of repoList.slice(0, 10)) console.log(`    ${r.full_name}`);

const recorded = { installationId: first.id, account: first.account.login };
console.log(`\n  Would record: ${JSON.stringify(recorded)}`);
if (!creds.installationId) {
  console.log('  The credentials file has no installationId yet -- re-run the registration poll, or write this value in.');
}
