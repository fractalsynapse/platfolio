import { parseArgs } from 'node:util';
import { API_CLIENT_ID, REQUIRED_SCOPE, WEB_CLIENT_ID } from './browser-auth.ts';
import { isLoopback, LOOPBACK_CREDENTIAL, resolveCredential } from './identity-credentials.ts';

const { values } = parseArgs({ options: {
  base: { type: 'string', default: process.env.KC_BASE ?? 'http://localhost:8081' },
  realm: { type: 'string', default: process.env.PLATFOLIO_IDENTITY_REALM ?? 'platfolio' },
  'allow-remote': { type: 'boolean' },
  'enable-self-service': { type: 'boolean' },
  'local-mailpit': { type: 'boolean' },
} });

const base = new URL(values.base);
const realm = values.realm;
const local = isLoopback(base.origin);
if (!realm || !/^[a-z0-9][a-z0-9-]*$/.test(realm) || realm === 'master') throw new Error('Select a Platfolio operator realm');
if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
    (!local && (base.protocol !== 'https:' || !values['allow-remote']))) throw new Error('Use a Keycloak origin. Hosted origins require HTTPS and --allow-remote.');
if (values['local-mailpit'] && (!local || !values['enable-self-service'])) throw new Error('--local-mailpit requires a loopback origin and --enable-self-service');

const credential = resolveCredential({
  label: 'Keycloak bootstrap administrator password', variable: 'KC_ADMIN_PASSWORD', fallback: LOOPBACK_CREDENTIAL,
  value: process.env.KC_ADMIN_PASSWORD ?? LOOPBACK_CREDENTIAL, base: base.origin, source: 'the operator’s credential store',
});
if (!credential.ok) throw new Error(credential.message);

const signIn = await fetch(new URL('/realms/master/protocol/openid-connect/token', base), {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
    username: process.env.KC_ADMIN_USER ?? 'platfolio-admin', password: credential.value }),
});
if (!signIn.ok) throw new Error(`Keycloak administrator sign-in failed (${signIn.status})`);
const { access_token: token } = await signIn.json() as { access_token: string };
const request = async (path: string, method = 'GET', value?: unknown): Promise<Response> => {
  const response = await fetch(new URL(`/admin${path}`, base), {
    method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, ...(value === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  if (!response.ok) throw new Error(`Keycloak refused ${method} ${path} (${response.status})`);
  return response;
};

const theme = 'platfolio';
const basePath = `/realms/${realm}`;
const server = await (await request('/serverinfo')).json() as { themes?: { login?: { name: string }[] } };
if (!server.themes?.login?.some(({ name }) => name === theme)) throw new Error('Deploy the themed Platfolio identity image before selecting the login theme');

interface RealmSettings {
  loginTheme?: string;
  registrationAllowed?: boolean;
  resetPasswordAllowed?: boolean;
  verifyEmail?: boolean;
  smtpServer?: Record<string, string>;
  defaultRole?: { id: string };
}
interface Client { id: string; enabled: boolean }
interface Role { id: string; name: string }
async function findClient(id: string): Promise<Client | undefined> {
  const [match] = await (await request(`${basePath}/clients?clientId=${id}`)).json() as Client[];
  return match;
}

async function client(id: string): Promise<Client> {
  const match = await findClient(id);
  if (!match) throw new Error(`Keycloak client ${id} was not found`);
  return match;
}

const current = await (await request(basePath)).json() as RealmSettings;
await client(WEB_CLIENT_ID);
const consoleClient = await findClient('account-console');
const patch: RealmSettings = { loginTheme: theme };
if (values['enable-self-service']) {
  if (values['local-mailpit']) patch.smtpServer = { host: 'mailpit', port: '1025', from: 'no-reply@platfolio.test' };
  const smtp = patch.smtpServer ?? current.smtpServer;
  if (!smtp?.host || !smtp.from) throw new Error('Configure Keycloak SMTP and verify mail delivery before enabling registration or password recovery');
  if (!current.defaultRole?.id) throw new Error('The realm default role is missing');
  const api = await client(API_CLIENT_ID);
  const role = await (await request(`${basePath}/clients/${api.id}/roles/${REQUIRED_SCOPE}`)).json() as Role;
  const composites = `${basePath}/roles-by-id/${current.defaultRole.id}/composites`;
  const roles = await (await request(composites)).json() as Role[];
  if (!roles.some(({ id }) => id === role.id)) await request(composites, 'POST', [role]);
  patch.registrationAllowed = true;
  patch.resetPasswordAllowed = true;
  patch.verifyEmail = true;
}

await request(basePath, 'PUT', patch);
if (consoleClient?.enabled) await request(`${basePath}/clients/${consoleClient.id}`, 'PUT', { enabled: false });
const readback = await (await request(basePath)).json() as RealmSettings;
if (readback.loginTheme !== theme || (await findClient('account-console'))?.enabled ||
    (values['enable-self-service'] && (!readback.registrationAllowed || !readback.resetPasswordAllowed || !readback.verifyEmail))) {
  throw new Error('Keycloak did not read back the expected authentication settings');
}
console.log(`Platfolio authentication theme enabled for realm ${realm}${values['enable-self-service'] ? ' with registration, verification, and password recovery' : ''}.`);
