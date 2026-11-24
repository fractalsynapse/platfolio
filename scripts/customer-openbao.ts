import { constants, createPublicKey, generateKeyPairSync, privateDecrypt, publicEncrypt } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Recovery { shares: string[]; bootstrap: string }
export interface RailwayGrant { access: string; refresh: string; expires: number }
export interface MarketplaceGrant { hub: string; installationId: string; credential: string; claimed: boolean }
type BaoState = 'unreachable' | 'uninitialized' | 'sealed' | 'setup-required' | 'ready';
const policy = 'platfolio-launcher';
const path = 'customer-launch/data/railway';
const marketplacePath = 'customer-launch/data/marketplace';
const workerPolicy = [path, marketplacePath].map((entry) =>
  `path "${entry}" { capabilities = ["create", "read", "update"] }`).join('\n');
const settings = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

export function customerOpenBao(origin: string, secretId: string, directory: string) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || !/^[a-z0-9-]+\.railway\.internal$|^127\.0\.0\.1$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use the private OpenBao origin');
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const receipt = join(directory, 'encrypted-recovery.json');
  let changing = false;

  async function request<T>(path: string, body?: object, credential?: string, method = body ? 'POST' : 'GET') {
    const init: RequestInit = {
      method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { ...(credential ? { 'x-vault-token': credential } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const response = await fetch(new URL('/v1/' + path, url), init);
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => undefined) as T | undefined };
  }

  async function health() {
    return (await request<{ initialized: boolean; sealed: boolean }>('sys/health')).data;
  }
  async function serviceToken() {
    const reply = await request<{ auth?: { client_token?: string } }>('auth/approle/login', { role_id: policy, secret_id: secretId });
    return reply.ok ? reply.data?.auth?.client_token : undefined;
  }
  async function status(): Promise<BaoState> {
    try {
      const state = await health();
      if (!state || typeof state.initialized !== 'boolean' || typeof state.sealed !== 'boolean') return 'unreachable';
      if (!state.initialized) return 'uninitialized';
      if (state.sealed) return 'sealed';
      return await serviceToken() ? 'ready' : 'setup-required';
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

  async function configure(root: string) {
    const mounts = await request<Record<string, unknown>>('sys/mounts', undefined, root);
    if (!mounts.ok) throw new Error('OpenBao rejected bootstrap');
    const auth = await request<Record<string, unknown>>('sys/auth', undefined, root);
    if (!auth.ok) throw new Error('OpenBao rejected bootstrap');
    const put = async (path: string, body: object) => {
      if (!(await request(path, body, root)).ok) throw new Error('OpenBao rejected the worker policy');
    };
    if (!mounts.data?.['customer-launch/']) await put('sys/mounts/customer-launch', { type: 'kv', options: { version: '2' } });
    if (!auth.data?.['approle/']) await put('sys/auth/approle', { type: 'approle' });
    await put('sys/policies/acl/' + policy, { policy: workerPolicy });
    await put('auth/approle/role/' + policy, { token_policies: [policy], token_no_default_policy: true, token_type: 'batch', token_ttl: '120s' });
    await put('auth/approle/role/' + policy + '/role-id', { role_id: policy });
    await put('auth/approle/role/' + policy + '/custom-secret-id', { secret_id: secretId });
  }

  async function unlock(envelope: string) {
    if (changing) throw new Error('The worker is completing setup');
    changing = true;
    try {
      const data = JSON.parse(privateDecrypt({ key: keys.privateKey, ...settings }, Buffer.from(envelope, 'base64')).toString()) as Recovery;
      if (!Array.isArray(data.shares) || data.shares.length !== 3 || data.shares.some((key) => typeof key !== 'string' || !/^[a-zA-Z0-9+/=]{40,64}$/.test(key)) ||
          typeof data.bootstrap !== 'string' || data.bootstrap.length > 100) throw new Error('Invalid recovery envelope');
      if ((await health())?.sealed) {
        for (const key of data.shares.slice(0, 2)) {
          const reply = await request<{ sealed: boolean }>('sys/unseal', { key }, undefined, 'PUT');
          if (!reply.ok) throw new Error('Invalid OpenBao recovery shares');
          if (reply.data?.sealed === false) break;
        }
      }
      if ((await health())?.sealed !== false) throw new Error('OpenBao is still sealed');
      if (!await serviceToken()) await configure(data.bootstrap);
      if (!await serviceToken()) throw new Error('OpenBao did not authorize the worker');
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

  async function write(key: string, grant: RailwayGrant | MarketplaceGrant, version: number) {
    const token = await serviceToken();
    if (!token || !(await request(key, { options: { cas: version }, data: grant }, token)).ok) {
      throw new Error('OpenBao could not save the provider grant');
    }
  }

  return {
    publicKey, status, initialize, unlock,
    readGrant: () => read<RailwayGrant>(path),
    writeGrant: (grant: RailwayGrant, version: number) => write(path, grant, version),
    readMarketplaceGrant: () => read<MarketplaceGrant>(marketplacePath),
    writeMarketplaceGrant: (grant: MarketplaceGrant, version: number) => write(marketplacePath, grant, version),
  };
}
