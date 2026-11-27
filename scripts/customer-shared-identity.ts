import { createHash } from 'node:crypto';
import type { IdentityClientPlacement, IdentityClientRequest } from '../packages/contracts/src/shared-identity-execution.ts';
import type { customerOpenBao } from './customer-openbao.ts';

type Provider = { issuer: string; clientId: string; clientSecret: string };
type Consumer = { redirectUri: string };
type Placement = {
  OIDC_ISSUER: string;
  OIDC_JWKS_URI: string;
  OIDC_CLIENT_ID: string;
  OIDC_REDIRECT_URI: string;
  OIDC_CLIENT_SECRET?: string;
};
type Checkpoint = { clientId: string; boundAt: string; phase: 'pending' | 'placed' | 'revoked'; issuer?: string; redirectUri?: string };
type Client = {
  id: string;
  clientId: string;
  enabled?: boolean;
  protocol?: string;
  publicClient?: boolean;
  redirectUris?: string[];
  standardFlowEnabled?: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  attributes?: Record<string, string>;
};

export class SharedIdentityWorkerError extends Error {}

function endpoint(raw: string) {
  const url = new URL(raw);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
      url.hostname.includes('*') || url.username || url.password || url.search || url.hash || url.href !== raw) {
    throw new SharedIdentityWorkerError('Configure exact HTTPS endpoints or IPv4 loopback for local development');
  }
  return url;
}

export function customerSharedIdentity(bao: ReturnType<typeof customerOpenBao>['identity'], request: typeof fetch = fetch) {
  const busy = new Set<string>();

  async function call(url: URL | string, init: RequestInit = {}) {
    return request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) });
  }

  return async function run({ action, target, controlPlaneIssuer }: IdentityClientRequest): Promise<IdentityClientPlacement | undefined> {
    const { consumerInstanceId, providerInstanceId, teamId, environment, providerEnvironment, boundAt, clientType } = target;
    const slot = consumerInstanceId + '/' + environment;
    const digest = createHash('sha256').update(JSON.stringify([teamId, providerInstanceId, providerEnvironment, slot, boundAt])).digest('hex').slice(0, 32);
    const clientId = 'platfolio-app-' + digest;
    if (busy.has(slot)) return;
    busy.add(slot);
    try {
      const saved = await bao.read<Checkpoint>('state', consumerInstanceId, environment);
      const previous = saved.grant;
      if (previous && previous.clientId !== clientId && (previous.phase !== 'revoked' || boundAt <= previous.boundAt)) return;
      if (action === 'status') {
        return previous?.clientId === clientId ? { state: previous.phase, clientId } : { state: 'pending' };
      }
      if (previous?.clientId === clientId && previous.phase === 'revoked') {
        return { state: 'revoked', clientId };
      }
      if (action === 'revoke' && previous?.clientId !== clientId) {
        await bao.write('state', consumerInstanceId, environment, { clientId, boundAt, phase: 'revoked' }, saved.version);
        return { state: 'revoked', clientId };
      }

      const [provider, consumer] = await Promise.all([
        bao.read<Provider>('providers', providerInstanceId, providerEnvironment),
        bao.read<Consumer>('consumers', consumerInstanceId, environment),
      ]);
      if (!provider.grant || !consumer.grant) return { state: 'unconfigured' };
      const issuer = endpoint(provider.grant.issuer);
      const redirectUri = endpoint(consumer.grant.redirectUri);
      const realm = /^\/realms\/([A-Za-z0-9_-]{1,100})$/.exec(issuer.pathname)?.[1];
      if (!realm || realm.toLowerCase() === 'master' || issuer.href === controlPlaneIssuer ||
          redirectUri.pathname !== '/auth/callback' || issuer.origin === redirectUri.origin) {
        throw new SharedIdentityWorkerError('Configure a separate application realm and an exact Starter Web callback');
      }
      if (previous?.clientId === clientId && (previous.issuer !== issuer.href || previous.redirectUri !== redirectUri.href)) return;

      const protocol = issuer.href + '/protocol/openid-connect';
      const tokenEndpoint = protocol + '/token';
      const jwks = protocol + '/certs';
      const discovery = await call(issuer.href + '/.well-known/openid-configuration');
      if (!discovery.ok) throw new SharedIdentityWorkerError('Application issuer discovery failed');
      const metadata = await discovery.json() as { issuer?: string; jwks_uri?: string; token_endpoint?: string; authorization_endpoint?: string };
      if (metadata.issuer !== issuer.href || metadata.jwks_uri !== jwks || metadata.token_endpoint !== tokenEndpoint ||
          metadata.authorization_endpoint !== protocol + '/auth') throw new SharedIdentityWorkerError('Application issuer discovery did not match its configured realm');

      const token = await call(tokenEndpoint, { method: 'POST', body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: provider.grant.clientId, client_secret: provider.grant.clientSecret,
      }) });
      if (!token.ok) throw new SharedIdentityWorkerError('Keycloak did not authorize the realm client manager');
      const { access_token: access } = await token.json() as { access_token?: string };
      if (!access) throw new SharedIdentityWorkerError('Keycloak did not issue a client management grant');
      const clients = new URL('/admin/realms/' + realm + '/clients', issuer).href;
      const admin = (url: string, method = 'GET', body?: object) => call(url, {
        method, headers: { authorization: 'Bearer ' + access, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      async function find() {
        const response = await admin(clients + '?search=false&clientId=' + clientId);
        if (!response.ok) throw new SharedIdentityWorkerError('Keycloak could not find the application client');
        const found = (await response.json() as Client[]).filter((client) => client.clientId === clientId);
        if (found.length > 1 || (found[0] && (found[0].attributes?.['platfolio.binding'] !== digest ||
            !/^[A-Za-z0-9_-]+$/.test(found[0].id)))) throw new SharedIdentityWorkerError('The client ID is already used outside this binding');
        return found[0];
      }

      let client = await find();
      const checkpoint = { clientId, boundAt, issuer: issuer.href, redirectUri: redirectUri.href };
      if (action === 'revoke') {
        if (client?.enabled) {
          const result = await admin(clients + '/' + client.id, 'PUT', { enabled: false });
          if (!result.ok || (await find())?.enabled !== false) throw new SharedIdentityWorkerError('Keycloak could not verify client revocation');
        }
        await bao.deleteClient(consumerInstanceId, environment);
        if ((await bao.read<Placement>('clients', consumerInstanceId, environment)).grant) throw new SharedIdentityWorkerError('OpenBao still exposes the credential');
        await bao.write('state', consumerInstanceId, environment, { ...checkpoint, phase: 'revoked' }, saved.version);
        return { state: 'revoked', clientId };
      }

      let version = saved.version;
      if (previous?.clientId !== clientId) {
        if (client) throw new SharedIdentityWorkerError('The Keycloak client has no matching installation checkpoint');
        await bao.write('state', consumerInstanceId, environment, { ...checkpoint, phase: 'pending' }, version);
        version++;
      }
      const representation = {
        clientId, protocol: 'openid-connect', enabled: true, publicClient: clientType === 'public',
        standardFlowEnabled: true, directAccessGrantsEnabled: false, implicitFlowEnabled: false, serviceAccountsEnabled: false,
        redirectUris: [redirectUri.href], attributes: { 'platfolio.binding': digest, 'pkce.code.challenge.method': 'S256' },
      };
      if (!client) {
        const created = await admin(clients, 'POST', representation);
        if (!created.ok && created.status !== 409) throw new SharedIdentityWorkerError('Keycloak could not register the application client');
        client = await find();
      }
      if (!client?.enabled || client.protocol !== representation.protocol || client.publicClient !== representation.publicClient ||
          !client.standardFlowEnabled || client.directAccessGrantsEnabled || client.implicitFlowEnabled || client.serviceAccountsEnabled ||
          client.redirectUris?.length !== 1 || client.redirectUris[0] !== redirectUri.href ||
          client.attributes?.['pkce.code.challenge.method'] !== 'S256') throw new SharedIdentityWorkerError('Keycloak client settings did not match this binding');

      const stored = await bao.read<Placement>('clients', consumerInstanceId, environment);
      const configuration: Placement = {
        OIDC_ISSUER: issuer.href, OIDC_JWKS_URI: jwks, OIDC_CLIENT_ID: clientId, OIDC_REDIRECT_URI: redirectUri.href,
      };
      const matches = (value?: Placement) => value && Object.entries(configuration).every(([key, expected]) =>
        value[key as keyof Placement] === expected) && Boolean(value.OIDC_CLIENT_SECRET) === (clientType === 'confidential');
      if (!matches(stored.grant)) {
        if (clientType === 'confidential') {
          const result = await admin(clients + '/' + client.id + '/client-secret', 'POST');
          if (!result.ok) throw new SharedIdentityWorkerError('Keycloak could not issue a fresh client credential');
          const { value } = await result.json() as { value?: string };
          if (!value) throw new SharedIdentityWorkerError('Keycloak did not return the credential it issued');
          configuration.OIDC_CLIENT_SECRET = value;
        }
        await bao.write('clients', consumerInstanceId, environment, configuration, stored.version);
        if (!matches((await bao.read<Placement>('clients', consumerInstanceId, environment)).grant)) {
          throw new SharedIdentityWorkerError('OpenBao could not verify the credential placement');
        }
      }
      if (previous?.phase !== 'placed' || previous.clientId !== clientId) {
        await bao.write('state', consumerInstanceId, environment, { ...checkpoint, phase: 'placed' }, version);
      }
      return { state: 'placed', clientId };
    } finally { busy.delete(slot); }
  };
}
