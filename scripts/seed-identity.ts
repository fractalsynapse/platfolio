/**
 * `pnpm run identity:seed` -- create platfolio's local realm through Keycloak's Admin API.
 *
 * Idempotent by design: every step treats 409/already-exists as success, so the command can be re-run after a
 * partial boot, which is the normal way a local stack fails. The alternative (a realm file) is documented in
 * docker-compose.yml and in #168 -- Keycloak 26.8.2's import format rejected each shape of role assignment I
 * tried, so the seed is code that works rather than a file that looks declarative and is not.
 *
 * Dev-only credentials are hard-coded here on purpose: this script talks to a local `start-dev` Keycloak whose
 * admin password is the one in docker-compose.yml. It refuses to run against a non-loopback host, so it cannot
 * be mistaken for a production provisioning tool.
 */
import { parseArgs } from 'node:util';

const { values: flags } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.KC_BASE ?? 'http://localhost:8081' },
    'admin-user': { type: 'string', default: process.env.KC_ADMIN_USER ?? 'platfolio-admin' },
    'admin-password': { type: 'string', default: process.env.KC_ADMIN_PASSWORD ?? 'platfolio-dev-only' },
  },
});

const base = flags.base as string;
if (!/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/.test(base)) {
  console.error(`identity:seed refuses to run against ${base} -- it is a local-stack tool, not a production provisioner`);
  process.exit(1);
}
const realm = 'platfolio';
const apiClientId = 'platfolio-api';
const apiSecret = 'platfolio-dev-only';
const audience = 'platfolio-api';
const role = 'platfolio.user';
const users: Array<{ username: string; email: string; scoped: boolean }> = [
  { username: 'adrian', email: 'adrian@example.com', scoped: true },
  // Deliberately without the role: the 403 path in the API needs a real principal to demonstrate it.
  { username: 'no-scope', email: 'noscope@example.com', scoped: false },
  // A person to invite, for the live invitation round trip: a distinct verified address in the same realm, so
  // `hire` can sign in and claim an invitation that `adrian` created.
  { username: 'hire', email: 'hire@example.com', scoped: true },
];

const log = (message: string): void => {
  process.stdout.write(`I ${message}\n`);
};

async function req<T = unknown>(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; body: T | undefined; text: string }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body: T | undefined;
  try { body = text ? (JSON.parse(text) as T) : undefined; } catch { body = undefined; }
  return { status: response.status, body, text };
}

const adminToken = async (): Promise<string> => {
  const form = new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: flags['admin-user'] as string, password: flags['admin-password'] as string });
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (response.ok) {
      const json = (await response.json()) as { access_token: string };
      return json.access_token;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`no admin token from ${base} after 120s -- is Keycloak up (docker compose up -d identity)?`);
};

const token = await adminToken();
log(`admin token obtained from ${base}`);

// 1. realm + the platfolio-api client in one create (the shape this project verified works through the API).
const created = await req(`/admin/realms`, {
  method: 'POST',
  body: JSON.stringify({
    realm,
    enabled: true,
    displayName: 'platfolio (local development)',
    sslRequired: 'external',
    registrationAllowed: false,
    accessTokenLifespan: 300,
    clients: [{
      clientId: apiClientId,
      name: 'platfolio control plane',
      enabled: true,
      protocol: 'openid-connect',
      publicClient: false,
      bearerOnly: false,
      serviceAccountsEnabled: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: true,
      redirectUris: ['http://localhost:8082/*', 'http://localhost:5173/*'],
      webOrigins: ['http://localhost:8082', 'http://localhost:5173'],
      secret: apiSecret,
      fullScopeAllowed: true,
      protocolMappers: [
        { name: 'platfolio-audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.client.audience': apiClientId, 'included.custom.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false' } },
        { name: 'platfolio-scopes', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-client-role-mapper', config: { 'claim.name': 'scope', 'jsonType.label': 'String', multivalued: 'true', 'access.token.claim': 'true', 'id.token.claim': 'false' } },
      ],
    }],
  }),
}, token);
if (created.status === 201) log('realm created');
else if (created.status === 409) log('realm already exists (continuing)');
else throw new Error(`realm create failed (${String(created.status)}): ${created.text.slice(0, 200)}`);

const client = (await req<Array<{ id: string }>>(`/admin/realms/${realm}/clients?clientId=${apiClientId}`, {}, token)).body?.[0];
if (!client) throw new Error('the platfolio-api client is missing -- was the realm created by an older seed? Recreate the realm (docker volume rm) and re-run.');

// 2. the role.
const roleCreate = await req(`/admin/realms/${realm}/clients/${client.id}/roles`, { method: 'POST', body: JSON.stringify({ name: role, description: 'A member of the team operating this platfolio instance.', composite: false }) }, token);
log(`role -> ${String(roleCreate.status)} (201 created, 409 already present)`);

// 3. users, with the password this local stack uses.
for (const spec of users) {
  const status = (await req(`/admin/realms/${realm}/users`, {
    method: 'POST',
    body: JSON.stringify({ username: spec.username, enabled: true, email: spec.email, emailVerified: true, firstName: spec.username, lastName: 'Operator', credentials: [{ type: 'password', value: apiSecret, temporary: false }] }),
  }, token)).status;
  log(`user ${spec.username} -> ${String(status)} (201 or 409)`);
}

// 4. role assignment -- verified by reading it back, because a silent 404 here would leave a user who cannot
// reach any authenticated endpoint and a stack that looks fine.
const roleObj = (await req<{ id: string }>(`/admin/realms/${realm}/clients/${client.id}/roles/${role}`, {}, token)).body;
if (!roleObj?.id) throw new Error(`role ${role} could not be read back after create`);
for (const spec of users) {
  if (!spec.scoped) continue;
  const uid = (await req<Array<{ id: string }>>(`/admin/realms/${realm}/users?username=${spec.username}`, {}, token)).body?.[0]?.id;
  if (!uid) throw new Error(`user ${spec.username} not found after create`);
  const mapped = await req(`/admin/realms/${realm}/users/${uid}/role-mappings/clients/${client.id}`, {
    method: 'POST',
    body: JSON.stringify([{ id: roleObj.id, name: role, composite: false, clientRole: true, containerId: client.id }]),
  }, token);
  if (mapped.status !== 204) throw new Error(`role mapping for ${spec.username} failed (${String(mapped.status)}): ${mapped.text.slice(0, 160)}`);
  const back = await req<Array<{ name: string }>>(`/admin/realms/${realm}/users/${uid}/role-mappings/clients/${client.id}`, {}, token);
  const names = (back.body ?? []).map((r) => r.name);
  if (!names.includes(role)) throw new Error(`mapping was accepted but is not present on read-back for ${spec.username}: ${JSON.stringify(names)}`);
  log(`user ${spec.username} carries ${role} (read back)`);
}
log('identity seeded');
