import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { boot } from '../apps/control-plane/src/index.ts';
import { hubProofHeader } from '../apps/control-plane/src/hub-sign-in.ts';
import { SHARED_IDENTITY_RELEASE } from '../packages/manifest/src/index.ts';
import { browserClientShape } from './keycloak-browser-client.ts';

// The two pinned Keycloak servers and the database are disposable and bound to loopback.
const containers: string[] = [];
const secret = () => randomBytes(36).toString('base64url');
const site = 'https://private.example.test';
const callback = site + '/callback';
const localAudience = 'platfolio-api';
const hubAudience = 'private-sign-in-fixture';
let stage = 'boot local containers';
let api: Awaited<ReturnType<typeof boot>> | undefined;

const docker = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, env: { ...process.env, ...env },
}).trim();

function run(image: string, port: number, env: NodeJS.ProcessEnv, ...args: string[]) {
  const id = docker(['run', '--rm', '--detach', '-p', '127.0.0.1::' + port,
    ...Object.keys(env).flatMap(key => ['-e', key]), image, ...args], env);
  containers.push(id);
  return { id, origin: 'http://' + docker(['port', id, port + '/tcp']) };
}

const request = (url: string, init: RequestInit = {}) => fetch(url, {
  redirect: 'manual', signal: AbortSignal.timeout(6000), ...init,
});
const status = (response: Response, code: number, label: string) => {
  assert.equal(response.status, code, label + ' (HTTP ' + response.status + ')');
  return response;
};
const form = (input: Record<string, string>) => ({ method: 'POST', body: new URLSearchParams(input) }) as const;

async function createRealm(origin: string, password: string, name: string, clientId: string, scope: string, audience: string) {
  const issuer = origin + '/realms/' + name;
  for (let i = 0; i < 100; i++) {
    try { if ((await request(origin + '/realms/master')).ok) break; } catch {}
    await delay(500);
  }
  const admin = await status(await request(origin + '/realms/master/protocol/openid-connect/token',
    form({ grant_type: 'password', client_id: 'admin-cli', username: 'local-admin', password })),
  200, 'local Keycloak admin').json() as { access_token: string };
  const userPassword = secret();
  const client = {
    ...browserClientShape([site]), clientId, defaultClientScopes: [scope],
    protocolMappers: [
      { name: 'subject', protocol: 'openid-connect', protocolMapper: 'oidc-sub-mapper', config: { 'access.token.claim': 'true' } },
      { name: 'audience', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
        config: { 'included.custom.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false' } },
    ],
  };
  const headers = { authorization: 'Bearer ' + admin.access_token, 'content-type': 'application/json' };
  status(await request(origin + '/admin/realms', {
    method: 'POST', headers,
    body: JSON.stringify({
      realm: name, enabled: true, sslRequired: 'none', clients: [client],
      clientScopes: [{ name: scope, protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true' } }],
      users: [{
        username: 'same-user', enabled: true, firstName: 'Acceptance', lastName: 'Owner', email: 'owner@example.test',
        emailVerified: true, credentials: [{ type: 'password', value: userPassword, temporary: false }],
      }],
    }),
  }), 201, 'create isolated realm');
  const users = await status(await request(origin + '/admin/realms/' + name + '/users?username=same-user&exact=true', { headers }),
    200, 'read local user ID').json() as { id: string }[];
  assert.equal(users.length, 1);
  return { issuer, clientId, scope, userPassword, subject: users[0]!.id };
}

async function signIn(realm: Awaited<ReturnType<typeof createRealm>>) {
  const verifier = secret();
  const state = secret();
  const params = new URLSearchParams({
    client_id: realm.clientId, redirect_uri: callback, response_type: 'code', scope: 'openid ' + realm.scope,
    state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const page = status(await request(realm.issuer + '/protocol/openid-connect/auth?' + params), 200, 'authorization prompt');
  const rawAction = (await page.text()).match(/id="kc-form-login"[^>]*\saction="([^"]+)"/)?.[1];
  assert.ok(rawAction);
  const action = new URL(rawAction.replaceAll('&amp;', '&'));
  assert.equal(action.origin, new URL(realm.issuer).origin);
  const code = status(await request(action.href, {
    ...form({ username: 'same-user', password: realm.userPassword }),
    headers: { cookie: page.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') },
  }), 302, 'return an authorization code');
  const redirected = new URL(code.headers.get('location')!);
  assert.equal(redirected.origin + redirected.pathname, callback);
  assert.equal(redirected.searchParams.get('state'), state);
  const result = status(await request(realm.issuer + '/protocol/openid-connect/token', form({
    grant_type: 'authorization_code', client_id: realm.clientId, redirect_uri: callback,
    code: redirected.searchParams.get('code')!, code_verifier: verifier,
  })), 200, 'exchange PKCE code');
  return (await result.json() as { access_token: string }).access_token;
}

try {
  const localAdmin = secret();
  const hubAdmin = secret();
  const postgresPassword = secret();
  const local = run(SHARED_IDENTITY_RELEASE.image, 8080, {
    KC_BOOTSTRAP_ADMIN_USERNAME: 'local-admin', KC_BOOTSTRAP_ADMIN_PASSWORD: localAdmin,
  }, 'start-dev');
  const hub = run(SHARED_IDENTITY_RELEASE.image, 8080, {
    KC_BOOTSTRAP_ADMIN_USERNAME: 'local-admin', KC_BOOTSTRAP_ADMIN_PASSWORD: hubAdmin,
  }, 'start-dev');
  const database = run('postgres:17.11', 5432, { POSTGRES_PASSWORD: postgresPassword });
  process.env.PLATFOLIO_DB_URL = 'postgresql://postgres:' + postgresPassword + '@' + new URL(database.origin).host + '/postgres';
  process.env.PLATFOLIO_DB_MIGRATE = 'true';

  stage = 'seed independent Keycloak realms';
  const [localRealm, hubRealm] = await Promise.all([
    createRealm(local.origin, localAdmin, 'platfolio', 'platfolio-web', 'platfolio.user', localAudience),
    createRealm(hub.origin, hubAdmin, 'marketplace', hubAudience, 'platfolio.hub-sign-in', hubAudience),
  ]);
  const teamId = 'team-' + localRealm.subject;

  stage = 'start private API and prove the separate OIDC identities';
  api = await boot({
    issuer: localRealm.issuer, audience: localAudience, jwksUri: localRealm.issuer + '/protocol/openid-connect/certs',
    host: '127.0.0.1', port: 0, cors: { allowedOrigins: [site] },
    build: { version: null, commit: '0'.repeat(40), buildTime: new Date().toISOString() },
    customerLaunch: { teamId, siteOrigin: site, ownerSubject: localRealm.subject, workerKey: secret(), workerUrl: 'http://127.0.0.1:1' },
    hubIdentity: { issuer: hubRealm.issuer, clientId: hubAudience },
  });
  const base = 'http://127.0.0.1:' + api.address.port + '/api/v1';
  const call = (path: string, token: string, method = 'GET', body?: object, proof?: string) => request(base + path, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}),
      ...(proof ? { [hubProofHeader]: 'Bearer ' + proof } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const localProof = await signIn(localRealm);
  const hubProof = await signIn(hubRealm);
  const setting = '/teams/' + teamId + '/hub-sign-in';
  status(await call('/me', localProof), 200, 'private owner baseline');
  status(await call('/me', hubProof), 401, 'off by default');
  status(await call(setting, localProof, 'PUT', { enabled: true }), 204, 'owner explicitly opts in');
  status(await call('/me', hubProof), 401, 'hub account alone cannot sign in');
  status(await call('/teams', hubProof, 'POST', { name: 'unapproved-team' }), 401, 'hub account cannot create membership');
  status(await call('/me/hub-identity', localProof, 'PUT', undefined, hubProof), 204, 'link both verified identities');
  const linked = await status(await call('/me', hubProof), 200, 'linked hub sign-in').json() as { personId: string; teams: { role: string }[] };
  assert.deepEqual(linked.teams.map(({ role }) => role), ['owner']);
  status(await call(setting, hubProof, 'PUT', { enabled: false }), 403, 'linked hub identity cannot administer hub trust');

  stage = 'stop the isolated hub and sign in as the private owner';
  docker(['stop', hub.id]);
  await assert.rejects(() => request(hubRealm.issuer + '/protocol/openid-connect/certs'));
  const offlineLocal = await signIn(localRealm);
  const owner = await status(await call('/me', offlineLocal), 200, 'fresh local sign-in during hub outage').json() as { personId: string };
  assert.equal(owner.personId, linked.personId);
  status(await call(setting, offlineLocal, 'PUT', { enabled: false }), 204, 'opt out while hub is offline');
  status(await call('/me', hubProof), 401, 'opt-out revokes the existing hub credential');
  console.log('Real Keycloak PKCE passed: unlinked hub denied, linked hub admitted, and fresh local owner sign-in and opt-out worked with the hub offline.');
} catch (error) {
  console.error('Stopped during ' + stage + ': ' +
    (error instanceof assert.AssertionError ? error.message.split('\n')[0] : error instanceof Error ? error.name : 'Unknown error'));
  process.exitCode = 1;
} finally {
  if (api) {
    const store = api.ctx.store;
    await api.stop();
    await store.close();
  }
  for (const id of containers.reverse()) try { docker(['stop', id]); } catch {}
}
