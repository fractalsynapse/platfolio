import { validateRequestBody } from '@platfolio/api-contract';
import { EndpointKeySource, IdentityConfigSchema, JwksIdentityProvider, type HubSignInTrust } from '@platfolio/contracts';
import type { ExtensionDescriptor, KernelContext, Request } from '@platfolio/kernel';
import type { scoped } from './capabilities.ts';
import { badRequest, bearerToken, notFound, send, spec, unauthorized } from './respond.ts';

export const hubProofHeader = 'x-platfolio-hub-proof';
const requiredScope = 'platfolio.hub-sign-in';

export function hubSignInConfig(issuer: string | undefined, clientId: string | undefined): HubSignInTrust | undefined {
  if (!issuer && !clientId) return;
  const url = issuer && new URL(issuer);
  if (!url || !clientId || !/^[a-zA-Z0-9_.-]{1,128}$/.test(clientId) || ['platfolio-api', 'platfolio-web'].includes(clientId) ||
      !/^\/realms\/[a-zA-Z0-9_.-]+$/.test(url.pathname) || url.username || url.password || url.hash || url.search ||
      url.href !== issuer || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
    throw new Error('Configure an exact hub Keycloak issuer and a dedicated private sign-in client');
  }
  return { issuer: url.href, clientId };
}

/** Only route by this value. The configured verifier checks the signature and all authorization claims. */
function forIssuer(token: string, issuer: string): boolean {
  if (token.length > 16_384) return false;
  const payload = token.split('.')[1];
  if (!payload) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.iss === issuer; }
  catch { return false; }
}

export function hubSignIn(
  route: typeof scoped, teamId?: string, trust?: HubSignInTrust, request: typeof fetch = fetch,
): ExtensionDescriptor {
  const config = trust && IdentityConfigSchema.parse({ issuer: trust.issuer, audience: trust.clientId, cacheTtlSeconds: 60 });
  const keyRequest: typeof fetch = (input, init) => request(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(4000) });
  const verifier = config && new JwksIdentityProvider({ config,
    keySource: new EndpointKeySource(config, keyRequest, config.issuer + '/protocol/openid-connect/certs') });

  async function enabled(context: KernelContext): Promise<HubSignInTrust | undefined> {
    if (!teamId || !trust || context.identity.config.issuer === trust.issuer) return;
    const saved = await context.store.getHubSignIn(teamId);
    if (saved && saved.issuer === trust.issuer && saved.clientId === trust.clientId) return trust;
  }

  async function verify(token: string) {
    if (!trust || !verifier || !forIssuer(token, trust.issuer)) return;
    const verified = await verifier.verifyAccessToken(token, { requiredScope });
    if (verified.ok && verified.claims.clientId === trust.clientId) return verified;
  }

  async function localMember(context: KernelContext, request: Request) {
    const token = bearerToken(request.headers.authorization);
    if (!token) return { response: unauthorized('no-credentials') };
    const verified = await context.identity.verifyAccessToken(token, { requiredScope: 'platfolio.user' });
    if (!verified.ok) return { response: unauthorized(verified) };
    if (!teamId) return { response: notFound('private sign-in workspace', '') };
    const local = await context.store.getPersonByIdentity(verified.claims.issuer, verified.claims.subject);
    if (!local.ok || local.value.kind !== 'human') return { response: notFound('local account', '') };
    const membership = await context.store.getTeamMember(teamId, local.value.id);
    return membership.ok ? { person: local.value } : { response: notFound('local account', '') };
  }

  const disabled = (operation: string) => send(operation, 409, {
    error: 'hub-sign-in-disabled', message: 'A private owner must enable the configured hub sign-in.',
  });
  return {
    id: 'hub-sign-in',
    requires: ['identity', 'store'],
    onBoot(context) {
      if (!teamId || !trust) return;
      if (trust.issuer === context.identity.config.issuer) throw new Error('Private and hub sign-in must use distinct issuers');
      context.identity.attachAlternateUserProof(async token => {
        if (!forIssuer(token, trust.issuer)) return;
        try {
          if (!await enabled(context)) return;
          const proof = await verify(token);
          if (!proof) return;
          const linked = await context.store.getPersonByIdentity(proof.claims.issuer, proof.claims.subject);
          if (!linked.ok || linked.value.kind !== 'human') return;
          const membership = await context.store.getTeamMember(teamId, linked.value.id);
          if (membership.ok) return { ...proof, person: linked.value };
        } catch {
          // Hub or store failure refuses alternate sign-in. The local verifier remains available.
        }
      });
    },
    routes: [
      {
        method: 'GET', path: '/api/v1/auth/hub', operationId: 'getHubSignIn',
        async handle(_request, _params, context) {
          try {
            const current = await enabled(context);
            return send('getHubSignIn', 200, current ? { enabled: true, ...current, scope: 'openid ' + requiredScope } : { enabled: false });
          } catch {
            return send('getHubSignIn', 503, { error: 'hub-sign-in-unavailable', message: 'Check the private installation database.' });
          }
        },
      },
      route('PUT', '/api/v1/teams/{teamId}/hub-sign-in', 'updateHubSignIn', 'team.member.manage',
        async (scope, request) => {
          if (!teamId || scope.teamId !== teamId) return notFound('private sign-in workspace', '');
          if (scope.claims.issuer !== scope.context.identity.config.issuer) {
            return send('updateHubSignIn', 403, { error: 'local-identity-required', message: 'Sign in with the private account to change hub access.' });
          }
          if (request.bodyError || !validateRequestBody(spec(), 'updateHubSignIn', request.body).ok) {
            return badRequest('Choose whether to enable hub sign-in.');
          }
          const { enabled: activate } = request.body as { enabled: boolean };
          if (activate && !trust) return disabled('updateHubSignIn');
          await scope.context.store.setHubSignIn(teamId, activate ? trust : undefined);
          await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'hub-sign-in.update', target: teamId, detail: { enabled: activate } });
          return { status: 204, body: undefined };
        }),
      {
        method: 'PUT', path: '/api/v1/me/hub-identity', operationId: 'linkMyHubIdentity',
        async handle(request, _params, context) {
          const local = await localMember(context, request);
          if (local.response) return local.response;
          if (!await enabled(context)) return disabled('linkMyHubIdentity');
          const token = bearerToken(request.headers[hubProofHeader]);
          const proof = token && await verify(token);
          if (!proof) return send('linkMyHubIdentity', 403, { error: 'hub-proof-refused', message: 'Sign in with the configured hub client to link your account.' });
          const linked = await context.store.linkIdentity({ issuer: proof.claims.issuer, subject: proof.claims.subject, personId: local.person.id });
          if (!linked.ok) return send('linkMyHubIdentity', 409, { error: 'identity-link-conflict', message: 'This hub identity could not be linked to this account.' });
          await context.store.appendAudit({ actorKind: 'user', actorRef: local.person.id, action: 'hub-identity.link', target: local.person.id, detail: {} });
          return { status: 204, body: undefined };
        },
      },
      {
        method: 'DELETE', path: '/api/v1/me/hub-identity/{subject}', operationId: 'unlinkMyHubIdentity',
        async handle(request, params, context) {
          const local = await localMember(context, request);
          if (local.response) return local.response;
          if (!trust || trust.issuer === context.identity.config.issuer) return notFound('hub sign-in', '');
          const subject = params.subject ?? '';
          const removed = await context.store.unlinkOwnedIdentity(trust.issuer, subject, local.person.id);
          if (removed.ok) {
            await context.store.appendAudit({ actorKind: 'user', actorRef: local.person.id, action: 'hub-identity.unlink', target: local.person.id, detail: {} });
          }
          return { status: 204, body: undefined };
        },
      },
    ],
  };
}
