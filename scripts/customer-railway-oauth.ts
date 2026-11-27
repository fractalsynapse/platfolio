import { RAILWAY_AUTHORIZATION_CALLBACK } from '../packages/contracts/src/customer-hosting-commands.ts';
import { exchangeRailwayCode, railwayAuthorization, railwayIssuer as issuer, railwayToken, railwayAuthorizedWorkspaces } from '../packages/contracts/src/railway-oauth.ts';
import { HttpRailwayTransport } from '../packages/contracts/src/railway-transport.ts';
import { customerRailway, type CustomerRailwayGrant } from './customer-railway.ts';
import type { customerOpenBao, RailwayGrant, RailwayOAuthClient } from './customer-openbao.ts';

interface Options { clientId?: string; callback: string; workspaceId: string; projectId?: string }
type Vault = Pick<ReturnType<typeof customerOpenBao>, 'readGrant' | 'writeGrant' | 'readRailwayClient' | 'writeRailwayClient'>;

export function customerRailwayOAuth({ clientId, callback, workspaceId, projectId }: Options, bao: Vault, request: typeof fetch = fetch) {
  const providerScope = projectId ? 'project:admin' : 'workspace:admin';
  const scope = 'openid email profile ' + providerScope + ' offline_access';
  const forProvider = (access: string): CustomerRailwayGrant => ({ token: access, workspaceId, ...(projectId ? { projectId } : {}) });
  const redirect = new URL(callback);
  const localConfiguredClient = clientId && redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1';
  if ((redirect.protocol !== 'https:' && !localConfiguredClient) || redirect.hostname.includes('*') ||
      redirect.username || redirect.password || redirect.search || redirect.hash ||
      redirect.pathname !== RAILWAY_AUTHORIZATION_CALLBACK) throw new Error('Use the installation’s exact HTTPS Railway callback');
  let pending: { state: string; verifier: string; until: number } | undefined;
  let refreshing: Promise<CustomerRailwayGrant> | undefined;
  let registering: Promise<string> | undefined;
  let unpersisted: RailwayOAuthClient | undefined;
  let retryConnectionAfter = 0;

  async function register(): Promise<RailwayOAuthClient> {
    const response = await request(issuer + '/oauth/register', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Private Platfolio', redirect_uris: [callback], token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope }),
    });
    if (response.status !== 201) throw new Error('Railway could not register this installation’s callback');
    const data = await response.json() as { client_id?: string; registration_client_uri?: string; registration_access_token?: string;
      redirect_uris?: string[]; token_endpoint_auth_method?: string };
    const management = data.registration_client_uri ? new URL(data.registration_client_uri) : undefined;
    if (!data.client_id || !data.registration_access_token || data.token_endpoint_auth_method !== 'none' ||
        data.redirect_uris?.length !== 1 || data.redirect_uris[0] !== callback || management?.origin !== issuer ||
        management.username || management.password || management.search || management.hash || !/^\/oauth\/register\/[^/]+$/.test(management.pathname)) {
      throw new Error('Railway returned an invalid registration');
    }
    return { id: data.client_id, callback, managementUrl: management.href, managementToken: data.registration_access_token };
  }

  async function savedClientId() {
    const { version, grant } = await bao.readRailwayClient();
    if (grant) {
      if (unpersisted && unpersisted.id !== grant.id) {
        await request(unpersisted.managementUrl, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(4000),
          headers: { authorization: 'Bearer ' + unpersisted.managementToken } }).catch(() => undefined);
      }
      unpersisted = undefined;
      if (grant.callback !== callback) throw new Error('Railway is registered to a different callback');
      return grant.id;
    }
    const client = unpersisted ??= await register();
    await bao.writeRailwayClient(client, version);
    unpersisted = undefined;
    return client.id;
  }

  function resolveClientId() {
    if (clientId) return Promise.resolve(clientId);
    registering ??= savedClientId().finally(() => { registering = undefined; });
    return registering;
  }

  async function begin() {
    const id = await resolveClientId();
    const { state, verifier, url } = railwayAuthorization(id, callback, scope);
    pending = { state, verifier, until: Date.now() + 5 * 60_000 };
    return url;
  }

  async function complete(input: { code: string; state: string; issuer: string; error: string }) {
    if (!pending || pending.state !== input.state || pending.until < Date.now()) return false;
    const { verifier } = pending;
    pending = undefined;
    try {
      const exchanged = await exchangeRailwayCode(request, await resolveClientId(), callback, verifier, input, providerScope);
      if (!exchanged.refresh) return false;
      const grant: RailwayGrant = { ...exchanged, refresh: exchanged.refresh };
      const transport = new HttpRailwayTransport({ fetch: request });
      if (projectId) await customerRailway({ kind: 'app', name: 'starter-web', id: projectId }, undefined, forProvider(grant.access), transport);
      else if (!(await railwayAuthorizedWorkspaces(grant.access, transport)).some(({ id }) => id === workspaceId)) return false;
      await bao.writeGrant(grant, (await bao.readGrant()).version);
      retryConnectionAfter = 0;
      return true;
    } catch { return false; }
  }

  async function useGrant() {
    const { version, grant } = await bao.readGrant();
    if (!grant) throw new Error('Connect Railway before launching');
    if (grant.expires > Date.now() + 10 * 60_000) return forProvider(grant.access);
    const renewed = await railwayToken(request, await resolveClientId(), { grant_type: 'refresh_token', refresh_token: grant.refresh }, providerScope);
    const fresh = { ...renewed, refresh: renewed.refresh ?? grant.refresh };
    await bao.writeGrant(fresh, version);
    return forProvider(fresh.access);
  }

  function credential() {
    refreshing ??= useGrant().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  async function connection() {
    if (retryConnectionAfter > Date.now()) return 'connect';
    try {
      await credential();
      return 'connected';
    } catch {
      // The setup screen polls. Keep an explicit reconnect available without retrying a failed refresh on each poll.
      retryConnectionAfter = Date.now() + 30_000;
      return 'connect';
    }
  }

  return { begin, complete, credential, connection };
}
