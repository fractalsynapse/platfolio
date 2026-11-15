/**
 * `pnpm run identity:seed` -- create platfolio's realm through Keycloak's Admin API.
 *
 * It writes TWO clients, and the difference between them is the point:
 *  - `platfolio-api`, confidential: the machine grant (`smoke-identity.ts` uses it) and the audience the
 *    control plane verifies. It holds a secret, so no browser may ever be given its client id.
 *  - `platfolio-web`, public: the browser's authorization-code + PKCE client. No secret, no ROPC, no implicit
 *    flow, no service account, `attributes["pkce.code.challenge.method"] = "S256"` so PKCE is mandatory rather
 *    than offered, and exact (never wildcarded) redirect URIs derived from `--ui-origin`.
 *    Shape and lifecycle: `scripts/browser-auth.ts`; proof: `pnpm run identity:pkce:smoke`.
 *
 * Idempotent by design: every step treats 409/already-exists as success and then READS BACK what the server
 * actually holds, so the command can be re-run after a partial boot (the normal way a local stack fails) and a
 * drifted client is repaired rather than reported as fine. The read-back is not ceremony -- this API answers
 * 204 to updates that change nothing, including an attribute removal (measured: omitting
 * `pkce.code.challenge.method` from a client PUT leaves `S256` in place; blanking it with `""` is what removes
 * it). The alternative (a realm file) is documented in docker-compose.yml and in #168 -- Keycloak 26.8.2's
 * import format rejected each shape of role assignment I tried, and `--import-realm` on an existing realm logs
 * "Import finished successfully" while seeding nothing.
 *
 * Dev-only credentials are hard-coded for the local stack. Against a non-loopback host the script refuses
 * without `--allow-remote`, and then refuses without its own strong `--client-secret` / `--user-password` /
 * `--ui-origin` -- so the development values are unusable against production by construction, and production's
 * browser origin is a fact the operator supplies rather than one this script invents.
 */
import { parseArgs } from 'node:util';
import { API_CLIENT_ID, PKCE_CHALLENGE_ATTRIBUTE, PKCE_METHOD, REQUIRED_SCOPE, WEB_CLIENT_ID, browserClientMappers, browserClientShape, normalizeUiOrigins } from './browser-auth.ts';

const { values: flags } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.KC_BASE ?? 'http://localhost:8081' },
    'admin-user': { type: 'string', default: process.env.KC_ADMIN_USER ?? 'platfolio-admin' },
    'admin-password': { type: 'string', default: process.env.KC_ADMIN_PASSWORD ?? 'platfolio-dev-only' },
    /**
     * This script refused non-loopback hosts because it is a local-stack tool, not a production provisioner.
     * Rather than delete that guard now that platfolio has a hosted realm, the refusal became a conditional
     * permission: a remote run must also supply its OWN client secret and user password. The development
     * credentials are therefore unusable against a public identity provider by construction -- which is the
     * property the original refusal was actually reaching for.
     */
    'allow-remote': { type: 'boolean', default: false },
    'client-secret': { type: 'string', default: process.env.KC_CLIENT_SECRET ?? '' },
    'user-password': { type: 'string', default: process.env.KC_USER_PASSWORD ?? '' },
    'api-origin': { type: 'string', default: process.env.PLATFOLIO_API_ORIGIN ?? '' },
    /**
     * Which realm to seed (D56). Default `platfolio` -- production -- because the existing command must not
     * change meaning. Staging gets its own realm on the SAME issuer host: one Keycloak, one certificate, and a
     * token that cannot cross the boundary, since the issuer path carries the realm.
     */
    realm: { type: 'string', default: process.env.PLATFOLIO_IDENTITY_REALM ?? 'platfolio' },
    /**
     * The browser origin that signs the user in -- `platfolio-web`, the public PKCE client. It is a SEPARATE
     * client from `platfolio-api` and that separation is the security property, not a tidy-up: the service
     * client is confidential and may hold a secret, the browser client is public and must never be given one.
     *
     * There is no default for a hosted realm, deliberately. `https://app.platfolio.dev` is not a fact anyone
     * has established; inventing one here is how a wildcard redirect URI reaches production, and [05 § Security
     * controls](../docs/design/05-identity.md) already forbids wildcard redirect URIs. So a hosted run either
     * names the origin or does not get a browser client at all.
     */
    'ui-origin': { type: 'string', default: process.env.PLATFOLIO_UI_ORIGIN ?? '' },
    /** Print the read-back client representation even when nothing changed (it is the evidence a reviewer asks for). */
    'show-shape': { type: 'boolean', default: false },
  },
});

const base = flags.base as string;
const loopback = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?/.test(base);
if (!loopback && flags['allow-remote'] !== true) {
  console.error(`identity:seed refuses to run against ${base} without --allow-remote.`);
  process.exit(1);
}
if (loopback && flags['allow-remote'] === true) {
  console.error('identity:seed: --allow-remote against loopback is a mistake, not a habit -- drop the flag');
  process.exit(1);
}
const remote = flags['allow-remote'] === true;
const apiSecret = remote ? (flags['client-secret'] as string) : 'platfolio-dev-only';
const userPassword = remote ? (flags['user-password'] as string) : 'platfolio-dev-only';
if (remote && (apiSecret.length < 32 || userPassword.length < 24)) {
  console.error(`identity:seed refuses a remote run without strong credentials: --client-secret needs >=32 characters and --user-password >=24 (got ${String(apiSecret.length)} and ${String(userPassword.length)}). Values are never printed.`);
  process.exit(1);
}
const realm = flags.realm as string;
// Client id, audience and role names are deliberately UNCHANGED between realms. Keycloak scopes them per
// realm, so `platfolio-api` in `platfolio-staging` is a different client from `platfolio-api` in `platfolio` --
// suffixing them would be naming the same thing twice. What separates the two environments is the ISSUER, which
// carries the realm in its path, and the control plane validates issuer and audience together.
//
// The staging realm's own control plane is a different host, so its web origins differ. Stated from the realm
// rather than from a flag someone has to remember.
const realmHosts: Record<string, string[]> = {
  platfolio: ['https://api.platfolio.dev'],
  'platfolio-staging': ['https://staging-api.platfolio.dev'],
};

const deployedHosts = realmHosts[realm] ?? [];
const origins = flags['api-origin']
  ? [flags['api-origin'] as string, ...deployedHosts]
  : ['http://localhost:8082', 'http://localhost:5173', ...deployedHosts];
const apiClientId = API_CLIENT_ID;
const audience = API_CLIENT_ID;
const role = REQUIRED_SCOPE;

/**
 * The identities this realm needs. `no-scope` is deliberate: the 403 path in the API needs a real principal to
 * demonstrate it, and `hire` exists so the invitation round trip has a second address a real IdP can assert.
 */
const users: Array<{ username: string; email: string; scoped: boolean }> = [
  { username: 'adrian', email: 'adrian@example.com', scoped: true },
  // Deliberately without the role: the 403 path in the API needs a real principal to demonstrate it.
  { username: 'no-scope', email: 'noscope@example.com', scoped: false },
  // A person to invite, for the live invitation round trip: a distinct verified address in the same realm, so
  // `hire` can sign in and claim an invitation that `adrian` created.
  { username: 'hire', email: 'hire@example.com', scoped: true },
];

/**
 * The browser client (public, PKCE, authorization code only).
 *
 * Redirect URIs are EXACT, one per configured UI origin, and there is no wildcard. Keycloak matches a
 * configured pattern with exact string comparison except for a trailing `/*`, so an exact URI is the strictest
 * thing the field can hold; `docs/design/05-identity.md` already lists "no wildcard redirect URIs" as a control
 * to implement, and a browser client is where that control earns its keep -- a wildcard here is an
 * authorization-code delivery oracle for any path on the host.
 */
const webClientId = WEB_CLIENT_ID;
/** The declared UI origins. Loopback gets the Vite dev origin; a hosted realm is told, never guessed at. */
const uiOriginsRaw = loopback && !flags['ui-origin'] ? 'http://localhost:5173' : (flags['ui-origin'] as string);
if (!loopback && !uiOriginsRaw.trim()) {
  console.error(`identity:seed: realm "${realm}" is remote and --ui-origin / PLATFOLIO_UI_ORIGIN is empty.\n  Refusing to create ${webClientId} rather than seeding a browser client with no redirect URI -- and refusing to invent a production origin for you.\n  Pass the deployed UI origin, e.g. --ui-origin=https://app.platfolio.dev (comma-separated for more than one).`);
  process.exit(1);
}
let webOrigins: string[];
try {
  webOrigins = normalizeUiOrigins(uiOriginsRaw.split(','));
} catch (error) {
  console.error(`identity:seed: ${(error as Error).message}`);
  process.exit(1);
}
if (webOrigins.length === 0) {
  console.error(`identity:seed: no usable UI origin for realm "${realm}" -- ${webClientId} would have nowhere to send a code`);
  process.exit(1);
}

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
      redirectUris: origins.map((o) => `${o}/*`),
      webOrigins: origins,
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
    body: JSON.stringify({ username: spec.username, enabled: true, email: spec.email, emailVerified: true, firstName: spec.username, lastName: 'Operator', credentials: [{ type: 'password', value: userPassword, temporary: false }] }),
  }, token)).status;
  log(`user ${spec.username} -> ${String(status)} (201 created, 409 already present)`);

  // Converge the password even when the user already existed. Two bugs live here and both should stay named:
  // (1) this line used `apiSecret` as the USER password -- invisible on loopback because both were the same
  // dev string, and it only surfaced the first time a hosted realm used distinct secrets, which is the actual
  // argument for parameterizing them; (2) a 409 was treated as "nothing to do", so a re-seed could never fix
  // a credential it had previously written wrong. reset-password is idempotent and makes the seed converge.
  const uid = (await req<Array<{ id: string }>>(`/admin/realms/${realm}/users?username=${spec.username}`, {}, token)).body?.[0]?.id;
  if (uid === undefined) throw new Error(`user ${spec.username} was accepted but cannot be found -- the realm is in a state this script cannot repair`);
  // `reset-password` answered 404 on 26.8.2 through this grant, so the credential is written with the user
  // update -- the documented convergence path, and the reason this step exists at all: a re-seed must be able
  // to repair a password it previously got wrong.
  const reset = await req(`/admin/realms/${realm}/users/${uid}`, {
    method: 'PUT',
    body: JSON.stringify({ id: uid, username: spec.username, enabled: true, email: spec.email, emailVerified: true, firstName: spec.username, lastName: 'Operator', credentials: [{ type: 'password', value: userPassword, temporary: false }] }),
  }, token);
  if (reset.status !== 204) throw new Error(`password set for ${spec.username} failed (${String(reset.status)}): ${reset.text.slice(0, 160)}`);
  log(`  password for ${spec.username} converged (value never printed)`);
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

// 5. the browser client: public, authorization-code only, PKCE mandatory.
//
// Every field below is a claim about a security property, so every one is checked ON THE SERVER after the
// write. This API answers 204 to a PUT that changes nothing (measured repeatedly while writing this), and a
// seed that reports "converged" because it got a 2xx is a seed that lies. `convergeClient` returns the
// representation as Keycloak actually holds it, and `assertBrowserShape` refuses the run if any of it differs.
const webShape = browserClientShape(webOrigins);
const webRedirectUris = webShape.redirectUris;
const webMappers = browserClientMappers();

/**
 * A canonical snapshot of everything this section owns, so "converged" can also mean "and nothing needed
 * changing". Mapper config is included as the server stores it (it adds keys the seed never named), which is
 * what makes the comparison stable rather than permanently dirty.
 */
const fingerprint = async (): Promise<string | undefined> => {
  const found = (await req<Array<{ id: string }>>(`/admin/realms/${realm}/clients?clientId=${webClientId}`, {}, token)).body?.[0];
  if (!found) return undefined;
  const c = (await req<Record<string, unknown>>(`/admin/realms/${realm}/clients/${found.id}`, {}, token)).body;
  const ms = (await req<Array<{ name: string; protocolMapper: string; config?: Record<string, string> }>>(`/admin/realms/${realm}/clients/${found.id}/protocol-mappers/models`, {}, token)).body ?? [];
  const sm = (await req<Array<{ name: string }>>(`/admin/realms/${realm}/clients/${found.id}/scope-mappings/clients/${client.id}`, {}, token)).body ?? [];
  const keys = ['enabled', 'protocol', 'publicClient', 'bearerOnly', 'standardFlowEnabled', 'implicitFlowEnabled', 'directAccessGrantsEnabled', 'serviceAccountsEnabled', 'frontchannelLogout', 'fullScopeAllowed', 'redirectUris', 'webOrigins'] as const;
  return JSON.stringify({
    client: Object.fromEntries(keys.map((k) => [k, k === 'redirectUris' || k === 'webOrigins' ? [...new Set((c?.[k] as string[] | undefined) ?? [])].sort() : c?.[k]])),
    pkce: (c?.attributes as Record<string, string> | undefined)?.[PKCE_CHALLENGE_ATTRIBUTE],
    secret: typeof c?.secret === 'string' ? 'PRESENT' : 'absent',
    mappers: ms.map((m) => [m.name, m.protocolMapper, Object.entries(m.config ?? {}).sort()]).sort(),
    scope: sm.map((r) => r.name).sort(),
  });
};
const beforeShape = await fingerprint();

const webCreate = await req(`/admin/realms/${realm}/clients`, { method: 'POST', body: JSON.stringify(webShape) }, token);
if (webCreate.status === 201) log(`${webClientId} created`);
else if (webCreate.status === 409) log(`${webClientId} already exists (converging)`);
else throw new Error(`${webClientId} create failed (${String(webCreate.status)}): ${webCreate.text.slice(0, 200)}`);
const webClient = (await req<Array<{ id: string }>>(`/admin/realms/${realm}/clients?clientId=${webClientId}`, {}, token)).body?.[0];
if (!webClient?.id) throw new Error(`${webClientId} was accepted but cannot be found`);

// PUT with the merged representation: Keycloak's client update is a full replace of the fields it is given and
// leaves the others, so sending the shape alone would keep stale attributes. Measured: a PUT carrying only
// `attributes: {pkce...}` left the server-managed keys and the rest of the client intact -- but "intact" is
// what we then verify, not what we assume.
const current = (await req<Record<string, unknown>>(`/admin/realms/${realm}/clients/${webClient.id}`, {}, token)).body;
if (!current) throw new Error(`${webClientId} could not be read back before the update`);
const merged = { ...current, ...webShape, id: webClient.id };
delete (merged as Record<string, unknown>).secret;
const webPut = await req(`/admin/realms/${realm}/clients/${webClient.id}`, { method: 'PUT', body: JSON.stringify(merged) }, token);
if (webPut.status !== 204) throw new Error(`${webClientId} update failed (${String(webPut.status)}): ${webPut.text.slice(0, 200)}`);

// Protocol mappers: converge by name. An extra mapper that survived from an earlier design would widen the
// token, so removals are part of convergence, not a manual cleanup step.
const mappersNow = (await req<Array<{ id: string; name: string }>>(`/admin/realms/${realm}/clients/${webClient.id}/protocol-mappers/models`, {}, token)).body ?? [];
for (const m of webMappers) {
  const found = mappersNow.find((x) => x.name === m.name);
  const res = found
    ? await req(`/admin/realms/${realm}/clients/${webClient.id}/protocol-mappers/models/${found.id}`, { method: 'PUT', body: JSON.stringify({ id: found.id, ...m }) }, token)
    : await req(`/admin/realms/${realm}/clients/${webClient.id}/protocol-mappers/models`, { method: 'POST', body: JSON.stringify(m) }, token);
  if (res.status !== 201 && res.status !== 204) throw new Error(`mapper ${m.name} failed (${String(res.status)}): ${res.text.slice(0, 160)}`);
}
for (const stale of mappersNow.filter((x) => !webMappers.some((m) => m.name === x.name))) {
  const del = await req(`/admin/realms/${realm}/clients/${webClient.id}/protocol-mappers/models/${stale.id}`, { method: 'DELETE' }, token);
  if (del.status !== 204) throw new Error(`stale mapper ${stale.name} could not be removed (${String(del.status)})`);
  log(`  removed stale mapper ${stale.name}`);
}

// Role SCOPE mapping: which of the resource client's roles this client may put in a token. This is not a role
// assignment -- it does not grant anything to anybody -- and it is the reason `fullScopeAllowed: false` still
// yields a usable token. Converged the same way: read, add what is missing, remove what should not be there.
const scopeNow = (await req<Array<{ id: string; name: string }>>(`/admin/realms/${realm}/clients/${webClient.id}/scope-mappings/clients/${client.id}`, {}, token)).body ?? [];
if (!scopeNow.some((r) => r.name === role)) {
  const sm = await req(`/admin/realms/${realm}/clients/${webClient.id}/scope-mappings/clients/${client.id}`, { method: 'POST', body: JSON.stringify([roleObj]) }, token);
  if (sm.status !== 204) throw new Error(`scope mapping failed (${String(sm.status)}): ${sm.text.slice(0, 160)}`);
}
const extraScope = scopeNow.filter((r) => r.name !== role);
if (extraScope.length > 0) {
  const rm = await req(`/admin/realms/${realm}/clients/${webClient.id}/scope-mappings/clients/${client.id}`, { method: 'DELETE', body: JSON.stringify(extraScope) }, token);
  if (rm.status !== 204) throw new Error(`stale scope mappings could not be removed (${String(rm.status)})`);
  log(`  removed ${String(extraScope.length)} unexpected scope mapping(s)`);
}

// The read-back. `application/x-www-form-urlencoded` bodies are not accepted by `req`, so the client
// representation is fetched as JSON and compared field by field.
type ClientRep = {
  clientId?: string; enabled?: boolean; protocol?: string; publicClient?: boolean; bearerOnly?: boolean;
  standardFlowEnabled?: boolean; implicitFlowEnabled?: boolean; directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean; frontchannelLogout?: boolean; fullScopeAllowed?: boolean;
  redirectUris?: string[]; webOrigins?: string[]; attributes?: Record<string, string>; secret?: string;
  clientAuthenticatorType?: string;
};
const webBack = (await req<ClientRep>(`/admin/realms/${realm}/clients/${webClient.id}`, {}, token)).body;
if (!webBack) throw new Error(`${webClientId} could not be read back after the update -- nothing is verified`);
const shapeProblems: string[] = [];
const eq = (name: string, got: unknown, want: unknown): void => { if (JSON.stringify(got) !== JSON.stringify(want)) shapeProblems.push(`${name}: server holds ${JSON.stringify(got)}, seed requires ${JSON.stringify(want)}`); };
eq('publicClient', webBack.publicClient, true);
eq('standardFlowEnabled', webBack.standardFlowEnabled, true);
eq('directAccessGrantsEnabled', webBack.directAccessGrantsEnabled, false);
eq('implicitFlowEnabled', webBack.implicitFlowEnabled, false);
eq('serviceAccountsEnabled', webBack.serviceAccountsEnabled, false);
eq('bearerOnly', webBack.bearerOnly, false);
eq('enabled', webBack.enabled, true);
eq('protocol', webBack.protocol, 'openid-connect');
eq('fullScopeAllowed', webBack.fullScopeAllowed, false);
eq(PKCE_CHALLENGE_ATTRIBUTE, webBack.attributes?.[PKCE_CHALLENGE_ATTRIBUTE], PKCE_METHOD);
eq('redirectUris', [...(webBack.redirectUris ?? [])].sort(), [...webRedirectUris].sort());
eq('webOrigins', [...(webBack.webOrigins ?? [])].sort(), [...webOrigins].sort());
// A public client holding a secret is the exact thing `publicClient: true` is supposed to rule out. The field
// is absent on a client created as public (measured); a value surviving from an older confidential shape would
// be a credential sitting in the realm for a client whose "secret" is public knowledge.
if (typeof webBack.secret === 'string' && webBack.secret.length > 0) shapeProblems.push(`${webClientId} still carries a secret -- rotate/clear it in the realm, a public client must not have one`);
const mappersBack = (await req<Array<{ name: string; protocolMapper: string; config?: Record<string, string> }>>(`/admin/realms/${realm}/clients/${webClient.id}/protocol-mappers/models`, {}, token)).body ?? [];
for (const m of webMappers) {
  const got = mappersBack.find((x) => x.name === m.name);
  if (!got) { shapeProblems.push(`mapper ${m.name} is absent on read-back`); continue; }
  eq(`mapper ${m.name}.protocolMapper`, got.protocolMapper, m.protocolMapper);
  // Subset comparison, measured rather than assumed: Keycloak fills in the config keys a mapper has that the
  // seed never named (`introspection.token.claim`, `userinfo.token.claim`) with their server defaults. The
  // claim under test is "every key the seed asserted says what the seed asserted", not "the server added
  // nothing", so equality of the whole object would fail on the server's own defaults while still passing on
  // a genuinely wrong `claim.name`. What matters -- and what is checked -- is that no key was ignored.
  const missing = Object.entries(m.config).filter(([k, v]) => got.config?.[k] !== v);
  if (missing.length > 0) shapeProblems.push(`mapper ${m.name}: server holds ${JSON.stringify(Object.fromEntries(missing.map(([k]) => [k, got.config?.[k]])))}, seed requires ${JSON.stringify(Object.fromEntries(missing))}`);
}
if (mappersBack.length !== webMappers.length) shapeProblems.push(`mapper count: server holds ${JSON.stringify(mappersBack.map((m) => m.name))}, seed requires ${JSON.stringify(webMappers.map((m) => m.name))}`);
const scopeBack = (await req<Array<{ name: string }>>(`/admin/realms/${realm}/clients/${webClient.id}/scope-mappings/clients/${client.id}`, {}, token)).body ?? [];
if (!scopeBack.some((r) => r.name === role)) shapeProblems.push(`scope mapping ${role} is absent on read-back (the browser token would carry no scope and every call would 403)`);

// And the negative half of the read-back: the confidential service client must be untouched by this script's
// new section. If `platfolio-api` ever goes public, or ever gains direct access grants by some later edit, the
// seed fails here rather than shipping a realm where the machine credential and the browser credential are the
// same credential.
const apiBack = (await req<ClientRep>(`/admin/realms/${realm}/clients/${client.id}`, {}, token)).body;
if (!apiBack) throw new Error(`${apiClientId} could not be read back -- the confidential client is unverified`);
if (apiBack.publicClient !== false) shapeProblems.push(`${apiClientId} has drifted: publicClient is ${String(apiBack.publicClient)}; the machine client must stay confidential`);
if (apiBack.directAccessGrantsEnabled !== true) shapeProblems.push(`${apiClientId} has drifted: directAccessGrantsEnabled is ${String(apiBack.directAccessGrantsEnabled)}; smoke-identity's ROPC path depends on it (and no browser may hold this client)`);
if (typeof apiBack.secret !== 'string' || apiBack.secret.length === 0) shapeProblems.push(`${apiClientId} carries no secret; the confidential client is no longer usable as one`);

if (shapeProblems.length > 0) {
  for (const p of shapeProblems) console.error(`identity:seed: ${p}`);
  throw new Error(`${String(shapeProblems.length)} claim(s) about ${webClientId}/${apiClientId} were not true on the server after the write -- see above (a 2xx is not evidence)`);
}
log(`${webClientId} converged: public, standard flow only, no ROPC, no implicit, no service account, PKCE S256 mandatory, ${String(webRedirectUris.length)} exact redirect URI(s), ${role} in scope (read back)`);
log(`${apiClientId} unchanged: confidential, ${String((apiBack.webOrigins ?? []).length)} web origin(s) (read back)`);
const afterShape = await fingerprint();
if (beforeShape === undefined) log(`${webClientId} was created in this realm (was absent before this run)`);
else if (beforeShape !== afterShape) log(`${webClientId} was out of shape before this run and has been converged`);
else log(`${webClientId} already held the required shape; nothing changed`);
if (flags['show-shape'] === true || beforeShape === undefined || beforeShape !== afterShape) {
  // The full representation, secret-free by construction: this client has no secret to withhold, and the field
  // is scrubbed anyway so a future confidential change cannot print a credential into a terminal or a CI log.
  process.stdout.write(`${JSON.stringify({ ...webBack, secret: webBack.secret === undefined ? undefined : '<present, not printed>' }, null, 2)}\n`);
}

log('identity seeded');

if (remote) log('remote seed complete: the client secret and user password were supplied by the operator and are never printed here');
