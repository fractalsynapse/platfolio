import { parseArgs } from 'node:util';
import { API_CLIENT_ID, REQUIRED_SCOPE, WEB_CLIENT_ID } from './browser-auth.ts';
import { isLoopback, LOOPBACK_CREDENTIAL, resolveCredential } from './identity-credentials.ts';
import { OPERATOR_DISPLAY_NAME_ATTRIBUTE } from '../apps/control-plane/src/account-profile.ts';
import { passwordResetAttributes } from '../apps/identity/src/password-recovery.ts';

const { values } = parseArgs({ options: {
  base: { type: 'string', default: process.env.KC_BASE ?? 'http://localhost:8081' },
  realm: { type: 'string', default: process.env.PLATFOLIO_IDENTITY_REALM ?? 'platfolio' },
  'allow-remote': { type: 'boolean' },
  'enable-self-service': { type: 'boolean' },
  'enable-password-recovery': { type: 'boolean' },
  'enable-account-profile': { type: 'boolean' },
  'local-mailpit': { type: 'boolean' },
} });

const base = new URL(values.base);
const realm = values.realm;
const local = isLoopback(base.origin);
if (!realm || !/^[a-z0-9][a-z0-9-]*$/.test(realm) || realm === 'master') throw new Error('Select a Platfolio operator realm');
if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
    (!local && (base.protocol !== 'https:' || !values['allow-remote']))) throw new Error('Use a Keycloak origin. Hosted origins require HTTPS and --allow-remote.');
const enableRecovery = values['enable-self-service'] || values['enable-password-recovery'];
if (values['local-mailpit'] && (!local || !enableRecovery)) throw new Error('--local-mailpit requires a loopback origin and password recovery');

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
  editUsernameAllowed?: boolean;
  smtpServer?: Record<string, string>;
  attributes?: Record<string, string>;
  defaultRole?: { id: string };
}
interface Client { id: string; enabled: boolean }
interface Role { id: string; name: string }
interface Mapper {
  id?: string;
  name: string;
  protocol: 'openid-connect';
  protocolMapper: string;
  config: Record<string, string>;
}
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
const web = await client(WEB_CLIENT_ID);
const consoleClient = await findClient('account-console');
const patch: RealmSettings = { loginTheme: theme };
if (values['enable-account-profile']) {
  const account = await client('account');
  const scopePath = `${basePath}/clients/${web.id}/scope-mappings/clients/${account.id}`;
  const manage = await (await request(`${basePath}/clients/${account.id}/roles/manage-account`)).json() as Role;
  const mapped = await (await request(scopePath)).json() as Role[];
  if (!mapped.some(({ id }) => id === manage.id)) await request(scopePath, 'POST', [manage]);

  const mapperPath = `${basePath}/clients/${web.id}/protocol-mappers/models`;
  const existing = await (await request(mapperPath)).json() as Mapper[];
  const platfolioScope = existing.find(({ name }) => name === 'platfolio-web-scopes');
  if (!platfolioScope?.id) throw new Error('Seed the Platfolio web client before enabling its account profile');
  // Keycloak parses JWT scopes as a string for its own account API. Platfolio accepts either representation
  // while installations are migrated. This changes the representation of the same existing API role.
  await request(`${mapperPath}/${platfolioScope.id}`, 'PUT', {
    ...platfolioScope, config: { ...platfolioScope.config, multivalued: 'false' },
  });

  const common = { 'id.token.claim': 'false', 'access.token.claim': 'true', 'userinfo.token.claim': 'false' };
  const desired: Mapper[] = [
    { name: 'platfolio-account-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
      config: { ...common, 'included.client.audience': 'account' } },
    { name: 'platfolio-account-roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-client-role-mapper',
      config: { ...common, 'usermodel.clientRoleMapping.clientId': 'account', 'claim.name': 'resource_access.account.roles',
        'jsonType.label': 'String', multivalued: 'true' } },
  ];
  for (const mapper of desired) {
    const saved = existing.find(({ name }) => name === mapper.name);
    await request(saved?.id ? `${mapperPath}/${saved.id}` : mapperPath, saved?.id ? 'PUT' : 'POST',
      saved?.id ? { ...mapper, id: saved.id } : mapper);
  }

  const profilePath = `${basePath}/users/profile`;
  const profile = await (await request(profilePath)).json() as { attributes?: { name: string; permissions?: { edit?: string[]; view?: string[] } }[] };
  if (!Array.isArray(profile.attributes)) throw new Error('The realm did not return its user profile configuration');
  const displayName = profile.attributes.find(({ name }) => name === OPERATOR_DISPLAY_NAME_ATTRIBUTE);
  if (!displayName) await request(profilePath, 'PUT', {
    ...profile, attributes: [...profile.attributes, {
      name: OPERATOR_DISPLAY_NAME_ATTRIBUTE, displayName: 'Display name', validations: { length: { max: 100 } },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] }, multivalued: false,
    }],
  });
  else if (!displayName.permissions?.edit?.includes('user') || !displayName.permissions?.view?.includes('user')) {
    throw new Error('The installed display-name field needs user read and edit permission');
  }
  patch.editUsernameAllowed = true;
}
if (enableRecovery) {
  if (values['local-mailpit']) patch.smtpServer = { host: 'mailpit', port: '1025', from: 'no-reply@platfolio.test' };
  const smtp = patch.smtpServer ?? current.smtpServer;
  if (!smtp?.host || !smtp.from) throw new Error('Configure Keycloak SMTP and verify mail delivery before enabling registration or password recovery');
  patch.resetPasswordAllowed = true;
  patch.attributes = { ...current.attributes, ...passwordResetAttributes };
}
if (values['enable-self-service']) {
  if (!current.defaultRole?.id) throw new Error('The realm default role is missing');
  const api = await client(API_CLIENT_ID);
  const role = await (await request(`${basePath}/clients/${api.id}/roles/${REQUIRED_SCOPE}`)).json() as Role;
  const composites = `${basePath}/roles-by-id/${current.defaultRole.id}/composites`;
  const roles = await (await request(composites)).json() as Role[];
  if (!roles.some(({ id }) => id === role.id)) await request(composites, 'POST', [role]);
  patch.registrationAllowed = true;
  patch.verifyEmail = true;
}

await request(basePath, 'PUT', patch);
if (consoleClient?.enabled) await request(`${basePath}/clients/${consoleClient.id}`, 'PUT', { enabled: false });
const readback = await (await request(basePath)).json() as RealmSettings;
if (readback.loginTheme !== theme || (await findClient('account-console'))?.enabled ||
    (values['enable-account-profile'] && !readback.editUsernameAllowed) ||
    (enableRecovery && (!readback.resetPasswordAllowed ||
      Object.entries(passwordResetAttributes).some(([key, seconds]) => readback.attributes?.[key] !== seconds))) ||
    (values['enable-self-service'] && (!readback.registrationAllowed || !readback.verifyEmail))) {
  throw new Error('Keycloak did not read back the expected authentication settings');
}
console.log(`Platfolio authentication theme enabled for realm ${realm}${enableRecovery ? ' with password recovery' : ''}.`);
