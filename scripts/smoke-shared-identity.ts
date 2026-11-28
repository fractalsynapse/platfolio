import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { constants, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createIdentityFixture, defaultIdentityConfig, GitScm, signToken, type StoreResult } from '../packages/contracts/src/index.ts';
import { createKernel, disposeKernel } from '../packages/kernel/src/index.ts';
import { readTemplate, SHARED_IDENTITY_RELEASE, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import { buildCapabilities } from '../apps/control-plane/src/capabilities.ts';
import { customerLaunch } from '../apps/control-plane/src/customer-launch.ts';
import { openBaoConfig, openBaoData, openBaoImage } from './customer-installation-topology.ts';
import { withReleaseSource } from './source-release-upload.ts';

const checkout = process.argv[2];
if (!checkout || process.argv.length !== 3) throw new Error('Pass the local Starter Web checkout as the only argument');
const starter = templateCatalogEntry('starter-web');
const source = resolve(checkout);
const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
assert.equal(git('remote', 'get-url', 'origin'), 'https://github.com/' + starter.repo + '.git');
assert.equal(git('status', '--porcelain'), '', 'Commit the local Starter Web candidate before testing');
const revision = git('rev-parse', 'HEAD');
const consumerName = 'starter-web';
const secret = () => randomBytes(36).toString('base64url');
const workDir = mkdtempSync(resolve(tmpdir(), 'platfolio-shared-identity-'));
const containers: string[] = [];
const processes: ChildProcess[] = [];
const docker = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync('docker', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240_000, ...(env ? { env: { ...process.env, ...env } } : {}),
}).trim();
function run(image: string, port: number, env: NodeJS.ProcessEnv = {}, ...command: string[]) {
  const id = docker(['run', '--detach', '--rm', '--publish', '127.0.0.1::' + port,
    ...Object.keys(env).flatMap((key) => ['-e', key]), image, ...command], env);
  containers.push(id);
  return 'http://' + docker(['port', id, port + '/tcp']);
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((closed) => server.close(() => closed()));
  return address.port;
}
async function waitFor(url: string, name: string) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(500);
  }
  throw new Error(name + ' did not become ready');
}
function value<T>(result: StoreResult<T>) {
  assert.ok(result.ok, 'A local Store operation failed');
  return result.value;
}
async function requireStatus(response: Response, expected: number, stage: string) {
  assert.equal(response.status, expected, stage + ' HTTP status');
  return response;
}
const http = (url: string, init?: RequestInit) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(120_000), ...init });

let vaultVolume: string | undefined;
let api: Awaited<ReturnType<typeof createKernel>> | undefined;
let stage = 'start local services';
try {
  const kcAdminPassword = secret();
  const baoWorkerSecret = secret();
  const workerKey = secret();
  const kc = run(SHARED_IDENTITY_RELEASE.image, 8080, { KC_BOOTSTRAP_ADMIN_USERNAME: 'local-admin', KC_BOOTSTRAP_ADMIN_PASSWORD: kcAdminPassword }, 'start-dev');
  const vaultPort = await freePort();
  const marketplaceOrigin = 'https://127.0.0.1:' + await freePort();
  vaultVolume = docker(['volume', 'create']);
  const vaultConfig = { BAO_LOCAL_CONFIG: openBaoConfig('127.0.0.1', 'shared-identity-smoke') };
  function startVault() {
    const container = docker(['run', '--detach', '--rm', '--publish', '127.0.0.1:' + vaultPort + ':8200',
      '--volume', vaultVolume + ':' + openBaoData, '-e', 'BAO_LOCAL_CONFIG', openBaoImage, 'server'], vaultConfig);
    containers.push(container);
    return container;
  }
  let vaultContainer = startVault();
  const bao = 'http://127.0.0.1:' + vaultPort;
  async function expectVaultState(expected: number) {
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        if ((await http(bao + '/v1/sys/health')).status === expected) return;
      } catch {}
      await delay(500);
    }
    assert.fail('OpenBao did not reach status ' + expected);
  }
  await expectVaultState(501);
  const init = await requireStatus(await http(bao + '/v1/sys/init', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret_shares: 3, secret_threshold: 2 }),
  }), 200, 'initialize isolated Raft storage');
  const { keys_base64: shares, root_token: root } = await init.json() as { keys_base64: string[]; root_token: string };
  for (const key of shares.slice(0, 2)) {
    await requireStatus(await http(bao + '/v1/sys/unseal', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }),
    }), 200, 'unseal the fixture vault for initial placement');
  }
  await expectVaultState(200);
  const pgPassword = secret();
  const database = run('postgres:17.11', 5432, { POSTGRES_PASSWORD: pgPassword });
  const registry = run('registry:3', 5000);
  const workerPort = await freePort();
  const appPort = await freePort();
  const appOrigin = 'http://127.0.0.1:' + appPort;
  const workerOrigin = 'http://127.0.0.1:' + workerPort;
  const issuer = kc + '/realms/phase2-apps';
  const teamId = 'team-phase2-local';
  const managementId = 'phase2-client-manager';
  const managementSecret = secret();
  const testUser = 'starter-user';
  const testPassword = secret();

  await Promise.all([waitFor(kc + '/realms/master', 'Keycloak'), waitFor(bao + '/v1/sys/health', 'OpenBao'),
    waitFor(registry + '/v2/', 'OCI registry')]);

  stage = 'configure application realm and OpenBao';
  const token = await requireStatus(await http(kc + '/realms/master/protocol/openid-connect/token', {
    method: 'POST', body: new URLSearchParams({ client_id: 'admin-cli', grant_type: 'password', username: 'local-admin', password: kcAdminPassword }),
  }), 200, 'local fixture setup grant');
  const adminToken = (await token.json() as { access_token: string }).access_token;
  const keycloak = (path: string, body?: object, method = body ? 'POST' : 'GET') => http(kc + '/admin/realms' + path, {
    method, headers: { authorization: 'Bearer ' + adminToken, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  await requireStatus(await keycloak('', {
    realm: 'phase2-apps', enabled: true, sslRequired: 'none',
    clients: [{ clientId: managementId, enabled: true, secret: managementSecret, serviceAccountsEnabled: true, fullScopeAllowed: false,
      standardFlowEnabled: false, directAccessGrantsEnabled: false, publicClient: false, protocol: 'openid-connect' }],
    users: [
      { username: testUser, enabled: true, firstName: 'Local', lastName: 'Starter', email: 'starter-user@example.test',
        emailVerified: true, credentials: [{ type: 'password', value: testPassword, temporary: false }] },
    ],
  }), 201, 'import isolated application realm');
  const realmPath = '/phase2-apps';
  const clientUuid = async (name: string) => {
    const result = await requireStatus(await keycloak(realmPath + '/clients?clientId=' + name), 200, 'find fixture client');
    const rows = await result.json() as Array<{ id: string; clientId: string }>;
    const id = rows.find(({ clientId }) => clientId === name)?.id;
    assert.ok(id);
    return id;
  };
  const manager = await clientUuid(managementId);
  const roles = await clientUuid('realm-management');
  const account = await (await requireStatus(await keycloak(realmPath + '/clients/' + manager + '/service-account-user'), 200, 'find realm worker account')).json() as { id: string };
  const role = await (await requireStatus(await keycloak(realmPath + '/clients/' + roles + '/roles/manage-clients'), 200, 'find client-management role')).json() as object;
  await requireStatus(await keycloak(realmPath + '/users/' + account.id + '/role-mappings/clients/' + roles, [role]), 204, 'grant realm client management');
  await requireStatus(await keycloak(realmPath + '/clients/' + manager + '/scope-mappings/clients/' + roles, [role]), 204, 'include only realm client management in the worker scope');
  const scopes = await (await requireStatus(await keycloak(realmPath + '/client-scopes'), 200, 'read realm client scopes')).json() as Array<{ id: string; name: string }>;
  const adminScope = scopes.find(({ name }) => name === 'kc-admin-api');
  assert.ok(adminScope, 'The pinned Keycloak provides the Admin API audience scope');
  await requireStatus(await keycloak(realmPath + '/clients/' + manager + '/default-client-scopes/' + adminScope.id, undefined, 'PUT'), 204, 'attach the Admin API audience scope');
  const managementToken = await requireStatus(await http(issuer + '/protocol/openid-connect/token', {
    method: 'POST', body: new URLSearchParams({ client_id: managementId, client_secret: managementSecret, grant_type: 'client_credentials' }),
  }), 200, 'mint a scoped application realm credential');
  const { access_token: realmGrant } = await managementToken.json() as { access_token: string };
  await requireStatus(await http(kc + '/admin/realms' + realmPath + '/clients', {
    headers: { authorization: 'Bearer ' + realmGrant },
  }), 200, 'verify the scoped service account can list clients');
  const vault = (path: string, body?: object, credential = root, method = body ? 'POST' : 'GET') => http(bao + '/v1/' + path, {
    method, headers: { 'x-vault-token': credential, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const vaultPut = async (path: string, body: object) => requireStatus(await vault(path, body), 204, path.split('/').slice(0, 2).join('/'));
  await vaultPut('sys/mounts/customer-launch', { type: 'kv', options: { version: '2' } });
  await vaultPut('sys/auth/approle', { type: 'approle' });
  const mount = 'customer-launch/data/identity/';
  const policy = (placement: boolean) => [
    'path "customer-launch/data/marketplace" { capabilities = ["read"] }',
    'path "customer-launch/data/railway" { capabilities = ["read"] }',
    `path "${mount}providers/*" { capabilities = ["create", "read"] }`,
    `path "${mount}consumers/*" { capabilities = ["read"] }`,
    `path "${mount}inputs/*" { capabilities = ["create", "read"] }`,
    `path "${mount}state/*" { capabilities = ["create", "read", "update"] }`,
    `path "${mount}clients/*" { capabilities = [${placement ? '"create", "read", "update"' : '"read"'}] }`,
    'path "customer-launch/metadata/identity/clients/*" { capabilities = ["delete"] }',
  ].join('\n');
  await vaultPut('sys/policies/acl/platfolio-launcher', { policy: policy(false) });
  await vaultPut('auth/approle/role/platfolio-launcher', { token_policies: ['platfolio-launcher'], token_no_default_policy: true, token_type: 'batch' });
  await vaultPut('auth/approle/role/platfolio-launcher/role-id', { role_id: 'platfolio-launcher' });
  await requireStatus(await vault('auth/approle/role/platfolio-launcher/custom-secret-id', { secret_id: baoWorkerSecret }), 200, 'bootstrap app role');
  await requireStatus(await vault('customer-launch/data/marketplace', { data: { hub: marketplaceOrigin,
    installationId: '00000000-0000-4000-8000-000000000001', credential: secret(), claimed: true } }), 200, 'save fixture hub connection');
  await requireStatus(await vault('customer-launch/data/railway', { data: {
    access: 'fixture-workspace-access', refresh: 'fixture-workspace-refresh', expires: Date.now() + 3_600_000,
  } }), 200, 'save fixture provider connection');
  async function startWorker() {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/customer-installation-worker.ts'], {
      stdio: 'ignore',
      env: { ...process.env, PORT: String(workerPort), HOST: '127.0.0.1', PLATFOLIO_LAUNCH_TEAM: teamId,
        PLATFOLIO_LAUNCH_WORKER_KEY: workerKey, PLATFOLIO_LAUNCH_STATE_DIR: workDir, PLATFOLIO_OPENBAO_WORKER_SECRET: baoWorkerSecret,
        PLATFOLIO_OPENBAO_URL: bao, PLATFOLIO_RAILWAY_OAUTH_CALLBACK: 'https://private.example.test/api/v1/railway/callback',
        RAILWAY_WORKSPACE_ID: 'local-fixture', PLATFOLIO_REGISTRY_ORIGIN: marketplaceOrigin },
    });
    processes.push(child);
    await waitFor(workerOrigin + '/status', 'private worker');
    return child;
  }
  let worker = await startWorker();

  stage = 'build pinned Starter Web';
  const image = new URL(registry).host + '/starter-web:binding-local';
  const localGit = new GitScm();
  const readLocal: GitScm['readRepositoryFile'] = (file) => {
    assert.equal(file.repo, starter.repo);
    assert.equal(file.ref, revision);
    return localGit.readRepositoryFile({ ...file, repo: pathToFileURL(source).href });
  };
  const starterSource = await readTemplate(readLocal, starter, revision);
  await withReleaseSource(starterSource.sources, async (archive) => docker(['build', '--quiet', '--tag', image, archive]));
  const digest = docker(['push', image]).match(/digest: (sha256:[a-f0-9]{64})/)?.[1];
  assert.ok(digest, 'OCI registry returned the built manifest pin');
  const identity = createIdentityFixture();
  const controlToken = signToken(identity, { scope: 'platfolio.user', subject: 'owner' });
  const connectionString = 'postgresql://postgres:' + pgPassword + '@' + new URL(database).host + '/postgres';
  const apiPort = await freePort();
  async function startControlPlane() {
    const running = await createKernel({
      provider: 'fake', identity: defaultIdentityConfig(identity), identityKeys: [identity.jwk], scm: { driver: 'git' },
      store: { driver: 'postgres', connectionString, migrate: true }, server: { port: apiPort },
      extensions: buildCapabilities({ build: { version: null, commit: revision, buildTime: new Date().toISOString() },
        customerLaunch: customerLaunch({ teamId, workerUrl: workerOrigin, workerKey, siteOrigin: appOrigin }, fetch) }),
    });
    const fallback = running.scm.readFile.bind(running.scm);
    running.scm.readFile = async (file) => {
      if (file.repo !== starter.repo) return fallback(file);
      return readLocal(file);
    };
    return running;
  }
  api = await startControlPlane();
  const owner = value(await api.store.resolvePerson({ issuer: identity.issuer, subject: 'owner' }));
  value(await api.store.seedInstallationTeam({ id: teamId, name: 'workspace', personId: owner.person.id }));
  const provider = value(await api.store.createInstance({ teamId, name: 'shared-identity', template: 'shared-identity',
    templateRef: { repo: templateCatalogEntry('shared-identity').repo, commitSha: SHARED_IDENTITY_RELEASE.revision } }));
  const consumer = value(await api.store.createInstance({ teamId, name: consumerName, template: consumerName,
    templateRef: { repo: starter.repo, commitSha: revision } }));
  value(await api.store.putArtifact({ instanceId: consumer.id, service: 'web', image, digest, sourceRef: revision, reportedBy: 'local-build' }));
  const apiOrigin = 'http://127.0.0.1:' + api.server.address.port;
  const control = (path: string, method: string, body?: object, access = controlToken) => http(apiOrigin + '/api/v1/instances/' + path, {
    method, headers: { authorization: 'Bearer ' + access, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const bindingPath = consumer.id + '/bindings/identity';
  const environmentPath = bindingPath + '/environments/staging';
  const clientPath = mount + 'clients/' + consumer.id + '/staging';
  const providerPath = mount + 'providers/' + provider.id + '/production';
  await requireStatus(await control(provider.id + '/capability/identity', 'PUT'), 200, 'publish pinned contract');
  await requireStatus(await control(bindingPath + '/intent', 'PUT', { providerInstanceId: provider.id, clientType: 'confidential' }), 200, 'bind reviewed release');
  await requireStatus(await control(environmentPath, 'GET', undefined, realmGrant), 401, 'application realm credential is rejected by the control plane');

  stage = 'register, interrupt placement, and retry';
  const setupResponse = await requireStatus(await http(apiOrigin + '/api/v1/teams/' + teamId + '/starter-launch/setup', {
    headers: { authorization: 'Bearer ' + controlToken },
  }), 200, 'obtain the private worker sealing key');
  const { workerKey: sealingKey } = await setupResponse.json() as { workerKey: string };
  const key = createPublicKey({ key: Buffer.from(sealingKey, 'base64'), format: 'der', type: 'spki' });
  const sealedGrant = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(JSON.stringify({ clientId: managementId, clientSecret: managementSecret }))).toString('base64');
  const place = () => control(environmentPath, 'PUT', { providerEnvironment: 'production' });
  await requireStatus(await control(environmentPath, 'PUT', { providerEnvironment: 'production',
    setup: { issuer, redirectUri: appOrigin + '/auth/callback', realmGrant: sealedGrant } }), 503, 'OpenBao write interrupted after encrypted setup and registration');
  assert.ok(await api.store.getIdentityClient(consumer.id, 'staging'), 'The private API reserved the consumer binding before provisioning');
  const applicationClients = async () => {
    const response = await requireStatus(await keycloak('/phase2-apps/clients'), 200, 'observe Keycloak clients');
    return (await response.json() as Array<{ id: string; clientId: string; enabled: boolean }>).filter(({ clientId }) => clientId.startsWith('platfolio-app-'))
      .map(({ id, clientId, enabled }) => ({ id, clientId, enabled }));
  };
  const firstClients = await applicationClients();
  if (firstClients.length !== 1) {
    const target = await api.store.getIdentityClient(consumer.id, 'staging');
    const response = await http(workerOrigin + '/identity', { method: 'POST', headers: {
      authorization: 'Bearer ' + workerKey, 'content-type': 'application/json',
    }, body: JSON.stringify({ action: 'place', target, controlPlaneIssuer: identity.issuer }) });
    const failure = await response.json() as { message?: string };
    console.error('Local worker HTTP ' + response.status + ' ' + (failure.message ?? ''));
  }
  assert.equal(firstClients.length, 1);
  await requireStatus(await control(bindingPath, 'DELETE'), 409, 'pending reservation blocks detach');
  await requireStatus(await control(provider.id, 'DELETE'), 409, 'dependency blocks provider removal');
  await vaultPut('sys/policies/acl/platfolio-launcher', { policy: policy(true) });
  const ready = await requireStatus(await place(), 200, 'retry placement');
  const placementStatus = await ready.json() as { state: string; clientId: string };
  assert.deepEqual(placementStatus, { state: 'placed', clientId: firstClients[0]?.clientId });
  assert.deepEqual(await applicationClients(), firstClients);
  const oldWorker = worker;
  await new Promise<void>((stopped) => { oldWorker.once('exit', () => stopped()); oldWorker.kill(); });
  worker = await startWorker();
  assert.deepEqual(await (await requireStatus(await place(), 200, 'retry after worker restart')).json(), placementStatus);
  console.log('Keycloak registration and OpenBao placement survived a failed write and worker restart.');

  stage = 'sign in to the built Starter Web application';
  await vaultPut('sys/policies/acl/starter-web', { policy: `path "${clientPath}" { capabilities = ["read"] }` });
  const appToken = await requireStatus(await vault('auth/token/create-orphan', { policies: ['starter-web'], no_default_policy: true, ttl: '15m' }), 200, 'give app read access to its placement');
  const { auth } = await appToken.json() as { auth: { client_token: string } };
  await requireStatus(await vault(providerPath, undefined, auth.client_token), 403, 'application token has no access to realm administration');
  stage = 'recover private services with the marketplace unreachable';
  const teamPath = apiOrigin + '/api/v1/teams/' + teamId;
  const ownerRequest = (path: string, options: RequestInit = {}) => http(path, {
    ...options, headers: { authorization: 'Bearer ' + controlToken, ...(options.body ? { 'content-type': 'application/json' } : {}) },
  });
  const marketplace = async () => (await requireStatus(await ownerRequest(teamPath + '/marketplace/connection'), 200,
    'read the local connection status')).json() as Promise<{ state: string }>;
  assert.equal((await marketplace()).state, 'unavailable');
  await requireStatus(await http(apiOrigin + '/api/v1/marketplace/platforms'), 503, 'marketplace catalog unreachable');
  docker(['stop', vaultContainer]);
  vaultContainer = startVault();
  await expectVaultState(503);
  const store = api.store;
  await disposeKernel(api);
  await store.close();
  api = await startControlPlane();
  await new Promise<void>((stopped) => { worker.once('exit', () => stopped()); worker.kill(); });
  worker = await startWorker();
  const readSetup = async () => (await requireStatus(await ownerRequest(teamPath + '/starter-launch/setup'), 200,
    'read setup from the restarted private worker')).json() as Promise<{ openBao: string; railway: string; workerKey: string }>;
  const sealed = await readSetup();
  assert.equal(sealed.openBao, 'sealed');
  assert.equal((await marketplace()).state, 'openbao-required');
  assert.notEqual(sealed.workerKey, sealingKey);
  const workerPublicKey = createPublicKey({ key: Buffer.from(sealed.workerKey, 'base64'), format: 'der', type: 'spki' });
  const envelope = publicEncrypt({ key: workerPublicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(JSON.stringify({ shares, bootstrap: root }))).toString('base64');
  await requireStatus(await ownerRequest(teamPath + '/starter-launch/openbao/unlock', {
    method: 'POST', body: JSON.stringify({ recovery: envelope }),
  }), 204, 'recover OpenBao with owner shares');
  const restored = await readSetup();
  assert.equal(restored.openBao, 'ready');
  assert.equal(restored.railway, 'connected');
  await requireStatus(await vault('auth/token/lookup-self'), 403, 'verify bootstrap credential retirement');
  assert.equal((await marketplace()).state, 'unavailable');
  assert.deepEqual(await (await requireStatus(await place(), 200, 'reuse the existing client with the marketplace unavailable')).json(), placementStatus);
  assert.deepEqual(await applicationClients(), firstClients);
  console.log('The private API, worker and OpenBao recovered from disk while the marketplace stayed unavailable.');

  stage = 'cold-start the retained application and sign in';
  assert.ok((await api.store.listArtifacts(consumer.id)).some((artifact) =>
    artifact.service === 'web' && artifact.image === image && artifact.digest === digest && artifact.sourceRef === revision));
  const placed = await requireStatus(await vault(clientPath, undefined, auth.client_token), 200, 'load app credential');
  const { data: { data: env } } = await placed.json() as { data: { data: Record<string, string> } };
  assert.equal(env.OIDC_CLIENT_ID, placementStatus.clientId);
  assert.ok(env.OIDC_CLIENT_SECRET);
  assert.ok(!(JSON.stringify(await api.store.recentAudit())).includes(env.OIDC_CLIENT_SECRET), 'Control-plane audit carries no client secret');
  const runtime = { ...env, HOST: '127.0.0.1', PORT: String(appPort) };
  const startApp = () => {
    const id = docker(['run', '--detach', '--rm', '--network', 'host', '--pull=always',
      ...Object.keys(runtime).flatMap((key) => ['-e', key]), image + '@' + digest], runtime);
    containers.push(id);
    return id;
  };
  const appContainer = startApp();
  await waitFor(appOrigin + '/healthz', 'Starter Web');
  docker(['stop', appContainer]);
  assert.notEqual(startApp(), appContainer);
  await waitFor(appOrigin + '/healthz', 'Starter Web cold restart');
  const cookies = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
  const start = await requireStatus(await http(appOrigin + '/login'), 302, 'start application sign-in');
  const authorization = new URL(start.headers.get('location')!);
  assert.equal(authorization.origin, kc);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  const page = await requireStatus(await http(authorization.href), 200, 'display Keycloak login');
  const action = (await page.text()).match(/id="kc-form-login"[^>]*\saction="([^"]+)"/)?.[1];
  assert.ok(action, 'Keycloak served a username and password form');
  const loginAction = new URL(action.replaceAll('&amp;', '&'));
  assert.equal(loginAction.origin, kc);
  const login = await requireStatus(await http(loginAction.href, { method: 'POST', headers: { cookie: cookies(page) },
    body: new URLSearchParams({ username: testUser, password: testPassword }) }), 302, 'authentic application user');
  const callback = new URL(login.headers.get('location')!);
  assert.equal(callback.origin + callback.pathname, appOrigin + '/auth/callback');
  const signed = await requireStatus(await http(callback.href, { headers: { cookie: cookies(start) } }), 302, 'validate OIDC callback');
  const session = await requireStatus(await http(appOrigin + '/api/session', { headers: { cookie: cookies(signed) } }), 200, 'verify Starter Web session');
  const sessionBody = await session.json() as { signedIn: boolean; subject: string };
  assert.ok(sessionBody.signedIn && sessionBody.subject && sessionBody.subject !== 'owner');
  await requireStatus(await http(appOrigin + '/api/session', { headers: { authorization: 'Bearer ' + controlToken } }), 401, 'control-plane credential does not authenticate app users');
  console.log('Starter Web completed a confidential client authorization-code flow and established an application session.');

  stage = 'revoke Keycloak client and release binding';
  await requireStatus(await control(environmentPath, 'DELETE'), 200, 'revoke the application client');
  assert.deepEqual(await applicationClients(), [{ id: firstClients[0]?.id, clientId: placementStatus.clientId, enabled: false }]);
  await requireStatus(await vault(clientPath, undefined, auth.client_token), 404, 'revoked placement is absent');
  const afterRevoke = await requireStatus(await http(appOrigin + '/login'), 302, 'request a new sign-in after revocation');
  await requireStatus(await http(afterRevoke.headers.get('location')!), 400, 'Keycloak refuses a newly attempted sign-in for the revoked client');
  await requireStatus(await place(), 409, 'a delayed placement cannot re-enable the revoked client');
  await requireStatus(await control(bindingPath, 'DELETE'), 204, 'detach after client revocation');
  console.log('Revocation disabled the client, removed vault access, and allowed the binding to be detached.');
} catch (error) {
  console.error('Shared Identity smoke failed during ' + stage);
  if (error instanceof assert.AssertionError) console.error(error.message);
  else console.error(error instanceof Error ? error.name : 'Unexpected error');
  process.exitCode = 1;
} finally {
  if (api) {
    const store = api.store;
    await disposeKernel(api);
    await store.close();
  }
  for (const child of processes) child.kill();
  for (const id of containers.reverse()) { try { docker(['stop', id]); } catch {} }
  if (vaultVolume) try { docker(['volume', 'rm', vaultVolume]); } catch {}
  rmSync(workDir, { recursive: true, force: true });
}
