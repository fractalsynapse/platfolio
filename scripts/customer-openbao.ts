import { constants, createHash, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface Recovery { shares: string[]; bootstrap: string }
export interface RailwayGrant { access: string; refresh: string; expires: number }
export interface RailwayOAuthClient { id: string; callback: string; managementUrl: string; managementToken: string }
export interface MarketplaceGrant { hub: string; installationId: string; credential: string; claimed: boolean }
type BaoState = 'unreachable' | 'uninitialized' | 'sealed' | 'setup-required' | 'ready';
const policy = 'platfolio-launcher';
const recoveryRole = 'platfolio-owner-recovery';
const recoveryAttempt = 'sys/generate-root-token/attempt';
const recoveryUpdate = 'sys/generate-root-token/update';
const recoveryPolicy = `path "${recoveryAttempt}" { capabilities = ["create", "read", "update", "delete", "sudo"] }\n` +
  `path "${recoveryUpdate}" { capabilities = ["update", "sudo"] }`;
const path = 'customer-launch/data/railway';
const marketplacePath = 'customer-launch/data/marketplace';
const clientPath = 'customer-launch/data/railway-client';
const identityPath = 'customer-launch/data/identity/';
const workerPolicy = [path, marketplacePath, clientPath].map((entry) =>
  `path "${entry}" { capabilities = ["create", "read", "update"] }`).concat([
  `path "${identityPath}providers/*" { capabilities = ["read"] }`,
  `path "${identityPath}consumers/*" { capabilities = ["read"] }`,
  `path "${identityPath}state/*" { capabilities = ["create", "read", "update"] }`,
  `path "${identityPath}clients/*" { capabilities = ["create", "read", "update"] }`,
  'path "customer-launch/metadata/identity/clients/*" { capabilities = ["delete"] }',
]).join('\n');
const settings = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

function privateOpenBaoRequest(origin: string) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || !/^[a-z0-9-]+\.railway\.internal$|^127\.0\.0\.1$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the private OpenBao origin');
  return async function request<T>(path: string, body?: object, credential?: string, method = body ? 'POST' : 'GET') {
    const init: RequestInit = {
      // A fresh Raft store waits for leader election before returning the only copy of the recovery material.
      method, redirect: 'error', signal: AbortSignal.timeout(path === 'sys/init' ? 30000 : 8000),
      headers: { ...(credential ? { 'x-vault-token': credential } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const response = await fetch(new URL('/v1/' + path, url), init);
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => undefined) as T | undefined };
  };
}

function recoverySecret(first: string, second: string) {
  return createHash('sha256').update('platfolio-openbao-owner-recovery\0').update([first, second].sort().join('\0')).digest('base64url');
}

export function customerOpenBao(origin: string, secretId: string, directory: string) {
  const request = privateOpenBaoRequest(origin);
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const openEnvelope = (value: string) => privateDecrypt({ key: keys.privateKey, ...settings }, Buffer.from(value, 'base64')).toString();
  const receipt = join(directory, 'encrypted-recovery.json');
  let changing = false;

  async function health() {
    return (await request<{ initialized: boolean; sealed: boolean }>('sys/health')).data;
  }
  async function waitForActiveStorage() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await request<{ initialized: boolean; sealed: boolean; standby: boolean }>('sys/health');
      if (response.status === 200 && response.data?.initialized && response.data.sealed === false && response.data.standby === false) return;
      await delay(250);
    }
    throw new Error('OpenBao storage is not ready. Wait for an active server and try again');
  }
  async function serviceToken() {
    const reply = await request<{ auth?: { client_token?: string } }>('auth/approle/login', { role_id: policy, secret_id: secretId });
    return reply.ok ? reply.data?.auth?.client_token : undefined;
  }
  async function identityPolicyReady(token: string) {
    // The reserved path holds no data. A 404 proves the worker may read this part of the mount.
    const reply = await request(identityPath + 'providers/_policy_check/staging', undefined, token);
    if (reply.status === 403) return false;
    if (reply.status !== 404) throw new Error('OpenBao did not return an empty policy check path');
    return true;
  }

  async function status(): Promise<BaoState> {
    try {
      const state = await health();
      if (!state || typeof state.initialized !== 'boolean' || typeof state.sealed !== 'boolean') return 'unreachable';
      if (!state.initialized) return 'uninitialized';
      if (state.sealed) return 'sealed';
      const token = await serviceToken();
      return token && await identityPolicyReady(token) ? 'ready' : 'setup-required';
    } catch { return 'unreachable'; }
  }

  async function initialize(ownerKey: string) {
    const owner = createPublicKey({ key: Buffer.from(ownerKey, 'base64'), format: 'der', type: 'spki' });
    if (owner.asymmetricKeyType !== 'rsa' || owner.asymmetricKeyDetails?.modulusLength !== 3072 || changing) throw new Error('Invalid recovery key');
    if (existsSync(receipt)) {
      const document = JSON.parse(readFileSync(receipt, 'utf8')) as { ownerKey: string; recovery: string };
      if (document.ownerKey !== ownerKey) throw new Error('Use the original recovery key file');
      return document.recovery;
    }
    changing = true;
    try {
      const reply = await request<{ keys_base64: string[]; root_token: string }>('sys/init', { secret_shares: 3, secret_threshold: 2 }, undefined, 'PUT');
      if (!reply.ok || reply.data?.keys_base64?.length !== 3 || !reply.data.root_token) throw new Error('OpenBao initialization did not complete');
      const data: Recovery = { shares: reply.data.keys_base64, bootstrap: reply.data.root_token };
      const recovery = publicEncrypt({ key: owner, ...settings }, Buffer.from(JSON.stringify(data))).toString('base64');
      writeFileSync(receipt + '.tmp', JSON.stringify({ ownerKey, recovery }), { mode: 0o600 });
      renameSync(receipt + '.tmp', receipt);
      return recovery;
    } finally { changing = false; }
  }

  async function configure(root: string, shares: readonly [string, string, string]) {
    const mounts = await request<Record<string, unknown>>('sys/mounts', undefined, root);
    if (!mounts.ok) throw new Error('OpenBao rejected bootstrap');
    const auth = await request<Record<string, unknown>>('sys/auth', undefined, root);
    if (!auth.ok) throw new Error('OpenBao rejected bootstrap');
    const put = async (path: string, body: object) => {
      if (!(await request(path, body, root)).ok) throw new Error('OpenBao rejected the worker policy');
    };
    if (!mounts.data?.['customer-launch/']) await put('sys/mounts/customer-launch', { type: 'kv', options: { version: '2' } });
    if (!auth.data?.['approle/']) await put('sys/auth/approle', { type: 'approle' });
    // Configure owner recovery before enabling the worker or revoking the initial administrator.
    await put('sys/policies/acl/' + recoveryRole, { policy: recoveryPolicy });
    await put('auth/approle/role/' + recoveryRole, { token_policies: [recoveryRole], token_no_default_policy: true, token_type: 'batch', token_ttl: '5m' });
    await put('auth/approle/role/' + recoveryRole + '/role-id', { role_id: recoveryRole });
    const [first, second, third] = shares;
    for (const [left, right] of [[first, second], [first, third], [second, third]] as const) {
      const secret = { secret_id: recoverySecret(left, right) };
      const login = await request('auth/approle/login', { role_id: recoveryRole, ...secret });
      if (!login.ok) await put('auth/approle/role/' + recoveryRole + '/custom-secret-id', secret);
    }
    await put('sys/policies/acl/' + policy, { policy: workerPolicy });
    await put('auth/approle/role/' + policy, { token_policies: [policy], token_no_default_policy: true, token_type: 'batch', token_ttl: '120s' });
    await put('auth/approle/role/' + policy + '/role-id', { role_id: policy });
    await put('auth/approle/role/' + policy + '/custom-secret-id', { secret_id: secretId });
  }

  async function unlock(envelope: string) {
    if (changing) throw new Error('The worker is completing setup');
    changing = true;
    try {
      const data = JSON.parse(openEnvelope(envelope)) as Recovery;
      if (!Array.isArray(data.shares) || data.shares.length !== 3 || data.shares.some((key) => typeof key !== 'string' || !/^[a-zA-Z0-9+/=]{40,64}$/.test(key)) ||
          typeof data.bootstrap !== 'string' || data.bootstrap.length > 100) throw new Error('Invalid recovery envelope');
      if ((await health())?.sealed) {
        for (const key of data.shares.slice(0, 2)) {
          const reply = await request<{ sealed: boolean }>('sys/unseal', { key }, undefined, 'PUT');
          if (!reply.ok) throw new Error('Invalid OpenBao recovery shares');
          if (reply.data?.sealed === false) break;
        }
      }
      await waitForActiveStorage();
      if (!await serviceToken()) await configure(data.bootstrap, [data.shares[0]!, data.shares[1]!, data.shares[2]!]);
      const token = await serviceToken();
      if (!token) throw new Error('OpenBao did not authorize the worker');
      if (!await identityPolicyReady(token)) {
        await restoreOpenBaoLauncherPolicy(origin, [data.shares[0]!, data.shares[1]!]);
        if (!await identityPolicyReady(token)) throw new Error('OpenBao did not authorize the worker’s identity paths');
      }
      const root = await request('auth/token/lookup-self', undefined, data.bootstrap);
      if (root.ok && !(await request('auth/token/revoke-self', {}, data.bootstrap)).ok) throw new Error('OpenBao did not retire the bootstrap credential');
    } finally { changing = false; }
  }

  async function read<T>(key: string) {
    const token = await serviceToken();
    if (!token) throw new Error('Unlock OpenBao before connecting providers');
    const stored = await request<{ data?: { data?: T; metadata?: { version?: number } } }>(key, undefined, token);
    if (stored.status === 404) return { version: 0, grant: undefined };
    if (!stored.ok || !stored.data?.data?.metadata?.version) throw new Error('OpenBao could not read the provider grant');
    return { version: stored.data.data.metadata.version, grant: stored.data.data.data };
  }

  async function write(key: string, grant: object, version: number) {
    const token = await serviceToken();
    if (!token || !(await request(key, { options: { cas: version }, data: grant }, token)).ok) {
      throw new Error('OpenBao could not save the provider grant');
    }
  }

  function identityKey(kind: 'providers' | 'consumers' | 'state' | 'clients', id: string, environment: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !['production', 'staging'].includes(environment)) {
      throw new Error('The identity binding did not match a customer environment');
    }
    return `${kind}/${id}/${environment}`;
  }

  return {
    publicKey, status, initialize, unlock, openEnvelope,
    readGrant: () => read<RailwayGrant>(path),
    writeGrant: (grant: RailwayGrant, version: number) => write(path, grant, version),
    readRailwayClient: () => read<RailwayOAuthClient>(clientPath),
    writeRailwayClient: (client: RailwayOAuthClient, version: number) => write(clientPath, client, version),
    readMarketplaceGrant: () => read<MarketplaceGrant>(marketplacePath),
    writeMarketplaceGrant: (grant: MarketplaceGrant, version: number) => write(marketplacePath, grant, version),
    identity: {
      read: <T>(kind: 'providers' | 'consumers' | 'state' | 'clients', id: string, environment: string) =>
        read<T>(identityPath + identityKey(kind, id, environment)),
      write: (kind: 'state' | 'clients', id: string, environment: string, value: object, version: number) =>
        write(identityPath + identityKey(kind, id, environment), value, version),
      async deleteClient(id: string, environment: string) {
        const token = await serviceToken();
        const key = identityKey('clients', id, environment);
        if (!token) throw new Error('Unlock OpenBao before revoking an identity client');
        const removed = await request('customer-launch/metadata/identity/' + key, undefined, token, 'DELETE');
        if (!removed.ok && removed.status !== 404) throw new Error('OpenBao could not remove the identity placement');
      },
    },
  };
}

export async function restoreOpenBaoLauncherPolicy(origin: string, shares: readonly [string, string]) {
  const [first, second] = shares;
  if (first === second || shares.some((share) => !/^[a-zA-Z0-9+/=]{40,64}$/.test(share))) {
    throw new Error('Use two distinct OpenBao shares');
  }
  const request = privateOpenBaoRequest(origin);
  const login = await request<{ auth?: { client_token?: string } }>('auth/approle/login', {
    role_id: recoveryRole, secret_id: recoverySecret(first, second),
  });
  const ownerToken = login.data?.auth?.client_token;
  if (!login.ok || !ownerToken) throw new Error('OpenBao did not accept owner recovery. Use an existing vault administrator if it was initialized before this feature.');
  const attempt = await request<{ data?: { nonce?: string; otp?: string } }>(recoveryAttempt, {}, ownerToken);
  const nonce = attempt.data?.data?.nonce;
  const otp = attempt.data?.data?.otp;
  if (!attempt.ok || !nonce) throw new Error('OpenBao could not start a recovery session. Check whether one is already in progress.');
  let root: string | undefined;
  try {
    if (!otp) throw new Error('OpenBao did not return the one-time recovery password');
    let encoded: string | undefined;
    for (const key of shares) {
      const submitted = await request<{ data?: { encoded_token?: string; complete?: boolean } }>(recoveryUpdate, { key, nonce }, ownerToken);
      if (!submitted.ok) throw new Error('OpenBao refused an owner share');
      if (submitted.data?.data?.complete) encoded = submitted.data.data.encoded_token;
    }
    if (!encoded) throw new Error('OpenBao did not reach its recovery threshold');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length !== otp.length) throw new Error('OpenBao returned an invalid recovery token');
    root = Buffer.from(bytes.map((byte, index) => byte ^ otp.charCodeAt(index))).toString('utf8');
    const target = 'sys/policies/acl/' + policy;
    const changed = await request(target, { policy: workerPolicy }, root);
    const confirmed = await request<{ data?: { policy?: string } }>(target, undefined, root);
    if (!changed.ok || confirmed.data?.data?.policy?.trim() !== workerPolicy.trim()) throw new Error('OpenBao could not verify the launcher policy');
  } finally {
    if (root) {
      const retired = await request('auth/token/revoke-self', {}, root);
      const rejected = await request('auth/token/lookup-self', undefined, root);
      if (!retired.ok || rejected.status !== 403) throw new Error('OpenBao could not verify retirement of the temporary recovery token');
    } else {
      const current = await request<{ data?: { nonce?: string } }>(recoveryAttempt, undefined, ownerToken);
      if (current.data?.data?.nonce === nonce) await request(recoveryAttempt, undefined, ownerToken, 'DELETE');
    }
  }
}
