import { validateRequestBody } from '@platfolio/api-contract';
import type { RequestBodyOf } from '@platfolio/api-contract/generated/types';
import { SmtpEmailTransport } from '@platfolio/contracts';
import type { ExtensionDescriptor, RouteDefinition } from '@platfolio/kernel';
import { installationOwnerHash } from '../../../packages/ui/src/web/installation-owner-policy.ts';
import type { scoped } from './capabilities.ts';
import { badRequest, notFound, send, spec } from './respond.ts';

const clientId = 'platfolio-private-setup';
const verifiedMarker = 'platfolio.smtp-verified';
const exempt = new Set(['getPrivateSetup', 'configurePrivateSmtp', 'getCurrentPerson', 'getWhoami', 'getHealth', 'getStatus', 'getVersion', 'getReady']);
type Smtp = RequestBodyOf<'configurePrivateSmtp'>;
type Owner = { email?: string; requiredActions?: string[] };
type Realm = { resetPasswordAllowed?: boolean; attributes?: Record<string, string> };
type Configuration = { issuer: string; teamId: string; ownerSubject: string; clientSecret: string };
const blocked = { status: 503, body: { error: 'private-smtp-required', message: 'The private workspace owner must finish email setup.' } };

export function privateSetup(route: typeof scoped, config?: Configuration, request: typeof fetch = fetch,
  transport = (input: Smtp) => new SmtpEmailTransport({
    host: input.host, port: input.port, from: input.from, secure: input.port === 465,
    auth: { user: input.user, password: input.password }, startTls: 'require', timeoutMs: 4500,
  })) {
  let configured: { expires: number; value: boolean } | undefined;
  const issuer = config && new URL(config.issuer);
  const realmPath = issuer?.pathname.match(/^\/realms\/([a-zA-Z0-9_.-]+)$/)?.[1];
  if (config && !realmPath) throw new Error('Private email setup needs the local Keycloak realm URL');
  const adminPath = issuer && `${issuer.origin}/admin/realms/${realmPath}`;
  const fetchLocal: typeof fetch = (url, init) => request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(4500) });

  async function admin() {
    const tokenResponse = await fetchLocal(`${config!.issuer}/protocol/openid-connect/token`, {
      method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: config!.clientSecret }),
    });
    if (!tokenResponse.ok) throw new Error('Private Keycloak refused setup authentication');
    const { access_token } = await tokenResponse.json() as { access_token?: string };
    if (!access_token) throw new Error('Private Keycloak did not return a setup grant');
    return async (suffix: string, body?: object) => {
      const response = await fetchLocal(adminPath! + suffix, {
        headers: { authorization: `Bearer ${access_token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { method: 'PUT', body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error('Private Keycloak rejected the setup operation');
      return response;
    };
  }

  const readRealm = async (call: Awaited<ReturnType<typeof admin>>) => (await call('')).json() as Promise<Realm>;
  const readOwner = async (call: Awaited<ReturnType<typeof admin>>) =>
    (await call(`/users/${encodeURIComponent(config!.ownerSubject)}`)).json() as Promise<Owner>;
  const verified = (realm: Realm) => realm.resetPasswordAllowed === true && realm.attributes?.[verifiedMarker] === 'true';

  async function admitted() {
    if (!config) return true;
    if (configured && configured.expires > Date.now()) return configured.value;
    const value = verified(await readRealm(await admin()));
    configured = { value, expires: Date.now() + 5000 };
    return value;
  }

  const extension: ExtensionDescriptor = {
    id: 'private-setup', requires: ['identity', 'store'],
    routes: [
      { method: 'GET', path: '/api/v1/setup', operationId: 'getPrivateSetup', async handle() {
        if (!config) return send('getPrivateSetup', 200, { smtpRequired: false, smtpConfigured: false, temporaryPasswordActive: false });
        try {
          const call = await admin();
          const [realm, owner] = await Promise.all([readRealm(call), readOwner(call)]);
          return send('getPrivateSetup', 200, { smtpRequired: true, smtpConfigured: verified(realm),
            temporaryPasswordActive: owner.requiredActions?.includes(installationOwnerHash.requiredAction) === true });
        } catch { return blocked; }
      } },
      route('PUT', '/api/v1/teams/{teamId}/setup/smtp', 'configurePrivateSmtp', 'team.member.manage', async (scope, request) => {
        if (!config || scope.teamId !== config.teamId) return notFound('private email setup', '');
        if (scope.claims.issuer !== config.issuer || scope.claims.subject !== config.ownerSubject) {
          return { status: 403, body: { error: 'local-owner-required', message: 'Sign in as the original private owner to set up email.' } };
        }
        if (request.bodyError || !validateRequestBody(spec(), 'configurePrivateSmtp', request.body).ok) return badRequest('Enter valid SMTP settings.');
        const input = request.body as Smtp;
        if (!/^[^<>\s@]+@[^<>\s@]+$/.test(input.from) || /[\u0000\r\n]/.test(input.user)) return badRequest('Enter a plain sender address and SMTP user.');
        try {
          const call = await admin();
          const [realm, owner] = await Promise.all([readRealm(call), readOwner(call)]);
          if (!owner.email || owner.requiredActions?.includes(installationOwnerHash.requiredAction)) return badRequest('Finish changing the owner password first.');
          const smtp = transport(input);
          try {
            if (!(await smtp.send({ to: [owner.email], subject: 'Private Platfolio email setup',
              text: 'Your private Platfolio SMTP relay accepted this verification message.' })).accepted) return blocked;
          } finally { await smtp.close(); }
          await call('', {
            resetPasswordAllowed: true,
            ...(realm.attributes?.['platfolio.publicAccounts'] === 'true' ? { registrationAllowed: true, verifyEmail: true } : {}),
            attributes: { ...realm.attributes, [verifiedMarker]: 'true', 'actionTokenGeneratedByUserLifespan.reset-credentials': '900' },
            smtpServer: { host: input.host, port: String(input.port), from: input.from, user: input.user, password: input.password,
              auth: 'true', ssl: String(input.port === 465), starttls: String(input.port !== 465) },
          });
          configured = undefined;
          if (!await admitted()) return blocked;
          return { status: 204, body: undefined };
        } catch { return blocked; }
      }),
    ],
  };
  function guard(route: RouteDefinition): RouteDefinition {
    if (!config || exempt.has(route.operationId)) return route;
    return { ...route, async handle(request, params, context) {
      const allowed = await admitted().catch(() => false);
      return allowed ? route.handle(request, params, context) : blocked;
    } };
  }
  return { extension, guard };
}
