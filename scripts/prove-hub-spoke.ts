import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const state = resolve(root, '.tmp/hub-spoke');
const [hub, spoke] = ['hub', 'spoke'].map((name, index) => {
  const offset = index * 1000;
  // Cookies have host scope across ports. Give the two local issuers distinct loopback hosts.
  const host = index === 0 ? 'localhost' : '127.0.0.1';
  const port = { site: 18173 + offset, api: 18082 + offset, identity: 18081 + offset, bao: 18200 + offset };
  return {
    name,
    site: `http://${host}:${port.site}`,
    api: `http://${host}:${port.api}`,
    identity: `http://${host}:${port.identity}`,
    bao: `http://${host}:${port.bao}`,
    compose: (...args: string[]) => run('docker', ['compose', '-p', `platfolio-${name}-proof`,
      '-f', 'compose.yaml', '-f', 'compose.dev.yaml', '-f', 'compose.hub-spoke.yaml', ...args], {
      PROOF_HOST: host, PROOF_SITE_PORT: String(port.site), PROOF_API_PORT: String(port.api),
      PROOF_IDENTITY_PORT: String(port.identity), PROOF_BAO_PORT: String(port.bao),
    }),
  };
});
assert(hub && spoke);

type Installation = typeof hub;
type Recovery = { keys_base64: string[]; root_token: string };
type Seal = { initialized: boolean; sealed: boolean };
type Team = { teamId: string; name: string; role: string };

function run(command: string, args: string[], environment: NodeJS.ProcessEnv = {}): string {
  return execFileSync(command, args, { cwd: root, env: { ...process.env, ...environment }, encoding: 'utf8' }).trim();
}

async function waitFor(url: string, accepted: number[]): Promise<Response> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => undefined);
    if (response && accepted.includes(response.status)) return response;
    await response?.body?.cancel();
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function checked(response: Response, status: number, operation: string): Response {
  assert.equal(response.status, status, operation);
  return response;
}

async function bao(installation: Installation, path: string, status: number, token?: string, body?: unknown) {
  const response = await fetch(`${installation.bao}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'X-Vault-Token': token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  return checked(response, status, `${installation.name}: OpenBao ${path}`);
}

async function initialize(installation: Installation): Promise<Recovery> {
  const status = await waitFor(`${installation.bao}/v1/sys/seal-status`, [200]);
  const { initialized } = await status.json() as Seal;
  const file = resolve(state, `${installation.name}.json`);
  if (initialized) {
    const permissions = await stat(file).catch(() => undefined);
    assert(permissions?.isFile() && (permissions.mode & 0o077) === 0, `Recover ${installation.name} with its original private OpenBao file at ${file}`);
    return JSON.parse(await readFile(file, 'utf8')) as Recovery;
  }

  // Reserve the file before initializing to detect concurrent runs and stale recovery material.
  const handle = await open(file, 'wx', 0o600);
  try {
    const response = await fetch(`${installation.bao}/v1/sys/init`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret_shares: 1, secret_threshold: 1 }), signal: AbortSignal.timeout(60000),
    });
    const recovery = await checked(response, 200, `${installation.name}: initialize OpenBao`).json() as Recovery;
    await handle.writeFile(JSON.stringify(recovery));
    await handle.sync();
    return recovery;
  } finally {
    await handle.close();
  }
}

async function unseal(installation: Installation, recovery: Recovery) {
  const status = await bao(installation, 'sys/seal-status', 200);
  if (!(await status.json() as Seal).sealed) return;
  const response = await bao(installation, 'sys/unseal', 200, undefined, { key: recovery.keys_base64[0] });
  assert(!(await response.json() as Seal).sealed, `${installation.name}: unsealed using its own recovery key`);
  await (await waitFor(`${installation.bao}/v1/sys/health`, [200])).body?.cancel();
}

async function tokenFor(installation: Installation): Promise<string> {
  const issuer = `${installation.identity}/realms/platfolio`;
  const discovery = await waitFor(`${issuer}/.well-known/openid-configuration`, [200]);
  const metadata = await discovery.json() as { issuer: string };
  assert.equal(metadata.issuer, issuer);
  // A loopback-only test client seeded by identity:seed. The site uses PKCE instead.
  const token = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'platfolio-api',
      client_secret: 'platfolio-dev-only', username: 'adrian', password: 'platfolio-dev-only' }),
    signal: AbortSignal.timeout(5000),
  });
  const { access_token } = await checked(token, 200, `${installation.name}: issue local API token`).json() as { access_token: string };
  assert(typeof access_token === 'string' && access_token.length > 0);
  return access_token;
}

function api(installation: Installation, path: string, token: string, body?: unknown) {
  return fetch(`${installation.api}/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: installation.site },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
  });
}

const installations = [hub, spoke];
await mkdir(state, { recursive: true, mode: 0o700 });
assert(((await stat(state)).mode & 0o077) === 0, 'Recovery directory must be private');

for (const installation of installations) {
  installation.compose('up', '-d', '--no-build');
}
for (const service of ['api', 'site', 'identity', 'openbao', 'main']) {
  const images = installations.map((installation) => run('docker', ['inspect', '--format', '{{.Image}}', installation.compose('ps', '-q', service)]));
  assert.equal(images[0], images[1], `${service} uses the same image on both installations`);
}
console.log('Both installations use identical service images.');

const sessions = await Promise.all(installations.map(async (installation) => {
  await waitFor(`${installation.identity}/realms/master/.well-known/openid-configuration`, [200]);
  run('pnpm', ['run', 'identity:seed', `--base=${installation.identity}`, `--ui-origin=${installation.site}`, `--api-origin=${installation.api}`]);
  await waitFor(`${installation.api}/readyz`, [200]);
  await waitFor(`${installation.site}/status`, [200]);
  const config = await (await waitFor(`${installation.site}/config.js`, [200])).text();
  assert(config.includes(installation.api) && config.includes(installation.identity));
  return { installation, token: await tokenFor(installation) };
}));
const [hubSession, spokeSession] = sessions;
assert(hubSession && spokeSession);
for (const [self, peer] of [[hubSession, spokeSession], [spokeSession, hubSession]] as const) {
  const allowed = checked(await api(self.installation, 'whoami', self.token), 200, 'local issuer accepted');
  assert.equal(allowed.headers.get('access-control-allow-origin'), self.installation.site);
  checked(await api(self.installation, 'whoami', peer.token), 401, 'peer issuer refused');
}
const issuerHash = createHash('sha256').update(`${hub.identity} ${spoke.identity}`).digest('hex').slice(0, 8);
const name = `northstar-proof-${issuerHash}`;
const created = await Promise.all(sessions.map(async ({ installation, token }) => {
  const listTeams = async () => await checked(await api(installation, 'teams', token), 200, 'local teams listed').json() as Team[];
  const existing = (await listTeams()).find((item) => item.name === name);
  if (!existing) checked(await api(installation, 'teams', token, { name }), 201, 'local team created');
  const list = await listTeams();
  const team = list.find((item) => item.name === name);
  assert(team?.role === 'owner');
  return { team, list };
}));
const [hubTeams, spokeTeams] = created;
assert(hubTeams && spokeTeams);
assert(!hubTeams.list.some(({ teamId }) => teamId === spokeTeams.team.teamId));
assert(!spokeTeams.list.some(({ teamId }) => teamId === hubTeams.team.teamId));
console.log('Both APIs accept their local issuer, reject the peer issuer (401), and keep team records separate.');

const vaults = await Promise.all(installations.map(async (installation) => {
  const recovery = await initialize(installation);
  await unseal(installation, recovery);
  const mounts = await (await bao(installation, 'sys/mounts', 200, recovery.root_token)).json() as { data: Record<string, unknown> };
  if (!mounts.data['proof/']) await bao(installation, 'sys/mounts/proof', 204, recovery.root_token, { type: 'kv', options: { version: '2' } });
  await (await bao(installation, 'sys/policies/acl/proof', 204, recovery.root_token, {
    policy: 'path "proof/data/installation" { capabilities = ["create", "update", "read"] }',
  })).body?.cancel();
  const lease = await bao(installation, 'auth/token/create', 200, recovery.root_token, {
    policies: ['proof'], ttl: '5m', no_default_policy: true,
  });
  const { auth: { client_token: token } } = await lease.json() as { auth: { client_token: string } };
  const marker = randomUUID();
  await bao(installation, 'proof/data/installation', 200, token, { data: { marker } });
  return { installation, recovery, token, marker };
}));
const [hubBao, spokeBao] = vaults;
assert(hubBao && spokeBao);
for (const [self, peer] of [[hubBao, spokeBao], [spokeBao, hubBao]] as const) {
  await bao(self.installation, 'proof/data/installation', 403, peer.token);
  await bao(self.installation, 'proof/data/outside-policy', 403, self.token);
  self.installation.compose('restart', 'openbao');
  await waitFor(`${self.installation.bao}/v1/sys/health`, [503]);
  await unseal(self.installation, self.recovery);
  const readback = await (await bao(self.installation, 'proof/data/installation', 200, self.token)).json() as { data: { data: { marker: string } } };
  assert(readback.data.data.marker === self.marker, 'Own marker survived restart and unseal');
}
console.log('Both OpenBao servers deny peer and out-of-policy access (403), seal on restart, and recover their own stored value.');

hub.compose('stop', 'site', 'api', 'identity');
try {
  const hubSite = await fetch(`${hub.site}/status`, { signal: AbortSignal.timeout(1500) }).catch(() => undefined);
  assert(hubSite === undefined, 'Hub site is offline during the independent operation check');
  const token = await tokenFor(spoke);
  const teamList = await checked(await api(spoke, 'teams', token), 200, 'private API works with the hub offline').json() as Team[];
  assert(teamList.some((team) => team.teamId === spokeTeams.team.teamId));
  await (await waitFor(`${spoke.site}/status`, [200])).body?.cancel();
  console.log('The private installation can sign in and read its teams while the hub endpoints are stopped.');
} finally {
  hub.compose('up', '-d', '--no-build');
  await (await waitFor(`${hub.identity}/realms/platfolio/.well-known/openid-configuration`, [200])).body?.cancel();
  await (await waitFor(`${hub.api}/readyz`, [200])).body?.cancel();
  await (await waitFor(`${hub.site}/status`, [200])).body?.cancel();
}
