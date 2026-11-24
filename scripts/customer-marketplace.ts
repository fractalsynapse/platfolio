import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { GitScm } from '../packages/contracts/src/git-scm.ts';
import { FREE_STARTER_RELEASE, parseInventory, readTemplate, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import { customerRailway } from './customer-railway.ts';
import { parse as parseYaml } from 'yaml';

const { positionals: [action], values: args } = parseArgs({ allowPositionals: true, options: {
  hub: { type: 'string' }, team: { type: 'string' }, installation: { type: 'string' },
  'identity-file': { type: 'string' }, receipt: { type: 'string' }, project: { type: 'string' },
} });
const installation = args.installation;
if (!installation || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installation)) {
  throw new Error('Pass the customer installation UUID v4 as --installation');
}
const listing = FREE_STARTER_RELEASE;
const entry = templateCatalogEntry(listing.template);
const expected = { ...listing, installationId: installation, repo: entry.repo };

function verifyReceipt(value: unknown) {
  if (typeof value !== 'object' || !value || Object.keys(value).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, expectedValue]) => (value as Record<string, unknown>)[key] !== expectedValue)) {
    throw new Error('Claim receipt differs from the reviewed free template release or installation');
  }
}

async function marketplace(method: string, suffix = '') {
  if (!args.hub || !args.team || !args['identity-file']) throw new Error('Pass --hub, --team, and a private --identity-file with the owner access token');
  const hub = new URL(args.hub);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hub.hostname);
  if (hub.username || hub.password || hub.search || hub.hash || hub.pathname !== '/' ||
      (hub.protocol !== 'https:' && !(local && hub.protocol === 'http:'))) throw new Error('Use an HTTPS hub origin or a loopback proof origin');
  const permissions = await stat(args['identity-file']);
  if (!permissions.isFile() || (permissions.mode & 0o077)) throw new Error('Owner access token file must be private');
  const token = (await readFile(args['identity-file'], 'utf8')).trim();
  const url = new URL(`/api/v1/teams/${encodeURIComponent(args.team)}/marketplace/installations/${installation}${suffix}`, hub);
  return fetch(url, { method, headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
}

if (action === 'connect' || action === 'disconnect') {
  const response = await marketplace(action === 'connect' ? 'PUT' : 'DELETE');
  if (response.status !== 204) throw new Error(`Marketplace ${action} returned HTTP ${response.status}`);
  console.log(`Marketplace ${action} confirmed for ${installation}`);
} else if (action === 'claim') {
  if (!args.receipt) throw new Error('Pass --receipt for the new local claim receipt');
  const response = await marketplace('POST', '/claim');
  if (response.status !== 200) throw new Error(`Marketplace claim returned HTTP ${response.status}`);
  const receipt = await response.json();
  verifyReceipt(receipt);
  await writeFile(args.receipt, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`${listing.template} ${listing.version} claimed at ${listing.revision}`);
} else if (action === 'install') {
  if (!args.receipt || !args.project) throw new Error('Pass the acquired --receipt and customer Railway --project');
  verifyReceipt(JSON.parse(await readFile(args.receipt, 'utf8')));
  const scm = new GitScm();
  const source = await readTemplate((request) => scm.readRepositoryFile(request), entry, listing.revision);
  // This uses Railway's source builder. An image-based InfraPlan is only valid after an artifact is published.
  const compose = parseYaml(source.compose) as { services?: Record<string, { build?: { dockerfile?: string } }>; 'x-platfolio'?: { metadata?: { name?: string; version?: string }; resources?: { database?: { kind?: string } } } };
  const metadata = compose['x-platfolio']?.metadata;
  const inventory = parseInventory(source.inventory ?? '');
  const database = inventory.entries.find((variable) => variable.name === 'DATABASE_URL');
  if (metadata?.name !== listing.template || metadata.version !== listing.version || compose.services?.web?.build?.dockerfile !== 'Dockerfile' ||
      compose['x-platfolio']?.resources?.database?.kind !== 'postgres' || inventory.issues.length || database?.kind !== 'reference' ||
      database.service !== 'web' || database.database !== 'app-db' || database.output !== 'DATABASE_URL') {
    throw new Error('Pinned starter does not match the reviewed source-build and database placement');
  }
  const rail = await customerRailway(args.project);
  await rail.privatePostgres('app-db-staging');
  const web = await rail.ensureService('web-staging');
  await rail.setConfig(web, 'PORT', '8080');
  await rail.setConfig(web, 'DATABASE_URL', '${{app-db-staging.DATABASE_URL}}');
  await rail.configure(web, { numReplicas: 1, healthcheckPath: '/healthz', healthcheckTimeout: 120 });
  const archive = await mkdtemp(join(tmpdir(), 'platfolio-starter-build-'));
  try {
    for (const [path, content] of Object.entries(source.sources)) {
      const target = join(archive, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const deployment = rail.upload(web, archive, `Marketplace ${listing.template} at ${listing.revision}`);
    await rail.wait(web, deployment);
    console.log(JSON.stringify({ project: rail.project.id, service: web, deployment, template: listing.template, revision: listing.revision, blobs: source.blobs }));
  } finally {
    await rm(archive, { recursive: true, force: true });
  }
} else {
  throw new Error('Use connect, claim, install, or disconnect');
}
