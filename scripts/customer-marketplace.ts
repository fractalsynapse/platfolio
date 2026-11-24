import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { FREE_STARTER_RELEASE, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import { launchStarterApp } from './launch-starter-app.ts';

const { positionals: [action], values: args } = parseArgs({ allowPositionals: true, options: {
  hub: { type: 'string' }, team: { type: 'string' }, installation: { type: 'string' },
  'identity-file': { type: 'string' }, app: { type: 'string' }, receipt: { type: 'string' }, project: { type: 'string' },
  'enrollment-file': { type: 'string' }, bao: { type: 'string' }, 'bao-token-file': { type: 'string' },
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

function serviceOrigin(raw: string | undefined, name: string): URL {
  if (!raw) throw new Error(`Provide the ${name} origin`);
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error(`Use an HTTPS ${name} origin or a loopback proof origin`);
  return url;
}

async function readPrivateFile(path: string | undefined, name: string): Promise<string> {
  if (!path) throw new Error(`Provide the private ${name} file`);
  const permissions = await stat(path);
  if (!permissions.isFile() || (permissions.mode & 0o077)) throw new Error(`The ${name} file must be private`);
  return (await readFile(path, 'utf8')).trim();
}

async function marketplace(method: string, suffix = '') {
  if (!args.team) throw new Error('Pass the hub team as --team');
  const hub = serviceOrigin(args.hub, 'hub');
  const token = await readPrivateFile(args['identity-file'], 'owner access token');
  const url = new URL(`/api/v1/teams/${encodeURIComponent(args.team)}/marketplace/installations/${installation}${suffix}`, hub);
  return fetch(url, { method, headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
}

async function registryCredential(hub: URL, create = false): Promise<string> {
  const bao = serviceOrigin(args.bao, 'OpenBao');
  const token = await readPrivateFile(args['bao-token-file'], 'OpenBao access token');
  const path = new URL(`/v1/platfolio-registry/data/installation/${installation}`, bao);
  const headers = { 'X-Vault-Token': token, 'content-type': 'application/json' };
  const access = (method: string, body?: unknown) => fetch(path, {
    method, headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let response = await access('GET');
  if (response.status === 404 && create) {
    const credential = randomBytes(32).toString('base64url');
    const saved = await access('POST', { options: { cas: 0 }, data: { hub: hub.origin, credential } });
    if (!saved.ok && saved.status !== 400) throw new Error(`OpenBao could not save the registry credential (HTTP ${saved.status})`);
    response = await access('GET');
  }
  if (!response.ok) throw new Error(`OpenBao cannot read the installation credential (HTTP ${response.status})`);
  const { data } = await response.json() as { data?: { data?: { hub?: unknown; credential?: unknown } } };
  const record = data?.data;
  if (record?.hub !== hub.origin || typeof record.credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.credential)) {
    throw new Error('The installation credential is missing or belongs to another hub');
  }
  return record.credential;
}

function requestRegistry(hub: URL, endpoint: string, bearer: string, body?: unknown) {
  return fetch(new URL(`/api/v1/marketplace/installations/${installation}/${endpoint}`, hub), {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

if (action === 'connect' || action === 'disconnect') {
  const response = await marketplace(action === 'connect' ? 'PUT' : 'DELETE');
  if (response.status !== 204) throw new Error(`Marketplace ${action} returned HTTP ${response.status}`);
  console.log(`Marketplace ${action} confirmed for ${installation}`);
} else if (action === 'issue') {
  if (!args['enrollment-file']) throw new Error('Pass --enrollment-file for the new private handoff file');
  const response = await marketplace('POST', '/enrollment');
  if (response.status !== 201) throw new Error(`Marketplace enrollment authorization returned HTTP ${response.status}`);
  const { enrollmentCode } = await response.json() as { enrollmentCode?: string };
  if (!enrollmentCode || !/^[A-Za-z0-9_-]{43}$/.test(enrollmentCode)) throw new Error('The hub did not return an enrollment code');
  await writeFile(args['enrollment-file'], enrollmentCode + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Enrollment code saved to the private handoff file.');
} else if (action === 'enroll') {
  const hub = serviceOrigin(args.hub, 'hub');
  const code = await readPrivateFile(args['enrollment-file'], 'enrollment');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('The enrollment code has the wrong format');
  const credential = await registryCredential(hub, true);
  const response = await requestRegistry(hub, 'enrollment', code, { registryDigest: createHash('sha256').update(credential).digest('hex') });
  if (response.status !== 204) throw new Error(`Marketplace enrollment returned HTTP ${response.status}. Check your registration with claim-enrolled before requesting a new code.`);
  console.log(`Marketplace enrollment confirmed for ${installation}`);
} else if (action === 'claim' || action === 'claim-enrolled') {
  if (!args.receipt) throw new Error('Pass --receipt for the new local claim receipt');
  const hub = serviceOrigin(args.hub, 'hub');
  const response = action === 'claim'
    ? await marketplace('POST', '/claim') : await requestRegistry(hub, 'claim', await registryCredential(hub));
  if (response.status !== 200) throw new Error(`Marketplace claim returned HTTP ${response.status}`);
  const receipt = await response.json();
  verifyReceipt(receipt);
  await writeFile(args.receipt, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`${listing.template} ${listing.version} claimed at ${listing.revision}`);
} else if (action === 'install') {
  if (!args.receipt) throw new Error('Pass the acquired --receipt');
  verifyReceipt(JSON.parse(await readFile(args.receipt, 'utf8')));
  console.log(JSON.stringify(await launchStarterApp(args.app ?? listing.template, args.project)));
} else {
  throw new Error('Use issue, enroll, claim-enrolled, install, disconnect, or the pilot’s connect and claim commands');
}
