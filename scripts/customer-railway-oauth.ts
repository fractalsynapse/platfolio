import { createHash, randomBytes } from 'node:crypto';
import { customerRailway, type CustomerRailwayGrant } from './customer-railway.ts';
import type { customerOpenBao, RailwayGrant } from './customer-openbao.ts';

const issuer = 'https://backboard.railway.com';

export function customerRailwayOAuth(clientId: string, callback: string, workspaceId: string, bao: ReturnType<typeof customerOpenBao>, projectId?: string) {
  const providerScope = projectId ? 'project:admin' : 'workspace:admin';
  const scope = 'openid email profile ' + providerScope + ' offline_access';
  const forProvider = (access: string): CustomerRailwayGrant => ({ token: access, workspaceId, ...(projectId ? { projectId } : {}) });
  let pending: { state: string; verifier: string; until: number } | undefined;
  let refreshing: Promise<CustomerRailwayGrant> | undefined;
  function begin() {
    const verifier = randomBytes(32).toString('base64url');
    pending = { state: randomBytes(32).toString('base64url'), verifier, until: Date.now() + 5 * 60_000 };
    return issuer + '/oauth/auth?' + new URLSearchParams({
      client_id: clientId, redirect_uri: callback, response_type: 'code', scope, state: pending.state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'consent',
    });
  }

  async function token(body: Record<string, string>, previous?: string): Promise<RailwayGrant> {
    const response = await fetch(issuer + '/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), body: new URLSearchParams({ client_id: clientId, ...body }),
    });
    if (!response.ok) throw new Error('Railway authorization expired or was refused');
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    const refresh = data.refresh_token ?? previous;
    if (!data.access_token || !refresh || !(Number(data.expires_in) > 0) ||
        (data.scope && !data.scope.split(' ').includes(providerScope))) throw new Error('Railway did not authorize workspace deployment');
    return { access: data.access_token, refresh, expires: Date.now() + Number(data.expires_in) * 1000 };
  }

  async function complete(input: { code: string; state: string; issuer: string; error: string }) {
    if (!pending || pending.state !== input.state || pending.until < Date.now()) return false;
    const { verifier } = pending;
    pending = undefined;
    if (input.issuer !== issuer || !input.code || input.error) return false;
    try {
      const grant = await token({ grant_type: 'authorization_code', code: input.code, redirect_uri: callback, code_verifier: verifier });
      const target = projectId ? { kind: 'app' as const, name: 'starter-web', id: projectId } : { kind: 'installation' as const, name: 'platfolio' };
      await customerRailway(target, undefined, forProvider(grant.access));
      await bao.writeGrant(grant, (await bao.readGrant()).version);
      return true;
    } catch { return false; }
  }

  async function useGrant() {
    const { version, grant } = await bao.readGrant();
    if (!grant) throw new Error('Connect Railway before launching');
    if (grant.expires > Date.now() + 10 * 60_000) return forProvider(grant.access);
    const fresh = await token({ grant_type: 'refresh_token', refresh_token: grant.refresh }, grant.refresh);
    await bao.writeGrant(fresh, version);
    return forProvider(fresh.access);
  }

  return {
    begin, complete,
    credential() {
      refreshing ??= useGrant().finally(() => { refreshing = undefined; });
      return refreshing;
    },
  };
}
