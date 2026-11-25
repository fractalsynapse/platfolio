import type { InstallationWorkspace } from './installation-provider.ts';
import { HttpRailwayTransport, type RailwayTransport } from './railway-transport.ts';
import { createHash, randomBytes } from 'node:crypto';

export const railwayIssuer = 'https://backboard.railway.com';

export interface OAuthCallback {
  code: string;
  state: string;
  issuer: string;
  error: string;
}

export interface RailwayAuthorizationRequest {
  state: string;
  verifier: string;
  url: string;
}

export function railwayAuthorization(clientId: string, callback: string, scope: string): RailwayAuthorizationRequest {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: callback, response_type: 'code', scope, state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'consent',
  });
  return { verifier, state, url: railwayIssuer + '/oauth/auth?' + params };
}

export async function railwayToken(request: typeof fetch, clientId: string, body: Record<string, string>, requiredScope: string) {
  const response = await request(railwayIssuer + '/oauth/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ client_id: clientId, ...body }),
  });
  if (!response.ok) throw new Error('Railway authorization expired or was refused');
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!data.access_token || !(Number(data.expires_in) > 0) || (data.scope && !data.scope.split(' ').includes(requiredScope))) {
    throw new Error('Railway did not authorize deployment');
  }
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + Number(data.expires_in) * 1000 };
}

export function exchangeRailwayCode(request: typeof fetch, clientId: string, callback: string, verifier: string, input: OAuthCallback, scope: string) {
  if (input.issuer !== railwayIssuer || !input.code || input.error) throw new Error('Railway authorization was not completed');
  return railwayToken(request, clientId, {
    grant_type: 'authorization_code', code: input.code, redirect_uri: callback, code_verifier: verifier,
  }, scope);
}

export async function railwayAuthorizedWorkspaces(token: string, transport: RailwayTransport = new HttpRailwayTransport()): Promise<InstallationWorkspace[]> {
  const data = await transport.graphql<{ me: { workspaces: InstallationWorkspace[] } }>({
    query: 'query { me { workspaces { id name } } }', operation: 'authorizedWorkspaces',
    credential: { kind: 'workspace', token },
  });
  return data.me.workspaces;
}
