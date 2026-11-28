import type { ExtensionDescriptor, KernelContext, Request, Response_, RouteDefinition } from '@platfolio/kernel';
import { validateRequestBody } from '@platfolio/api-contract';
import type { RequestBodyOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import { badRequest, bearerToken, send, spec, unauthorized } from './respond.ts';
import { OPERATOR_AVATAR_ATTRIBUTE, OPERATOR_DISPLAY_NAME_ATTRIBUTE } from '../../identity/src/operator-profile.ts';

export { OPERATOR_DISPLAY_NAME_ATTRIBUTE };

export interface AccountIssuer {
  readonly issuer: string;
  readonly request: typeof fetch;
}

type Authorize = (context: KernelContext, request: Request) => Promise<{ ok: true } | { ok: false; response: Response_ }>;

interface KeycloakProfile {
  username: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string[]>;
}

const unavailable = (): Response_ => ({
  status: 503,
  body: { error: 'account-profile-unavailable', message: 'This installation could not access your account profile. Sign in again or ask an owner to check identity configuration.' },
  headers: { 'cache-control': 'no-store' },
});

function httpsAvatar(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function accountProfile(authorize: Authorize, issuer?: AccountIssuer): ExtensionDescriptor {
  const path = '/api/v1/me/profile';
  const accountPath = issuer && new URL(issuer.issuer.replace(/\/$/, '') + '/account/');
  const emailPath = issuer && new URL(issuer.issuer.replace(/\/$/, '') + '/platfolio-account-email');
  const addressPath = emailPath && new URL(emailPath.href + '/addresses');

  async function fetchAccount(credential: string, method: 'GET' | 'POST', body?: unknown) {
    if (!issuer || !accountPath) return;
    const url = new URL(accountPath);
    if (method === 'GET') url.searchParams.set('userProfileMetadata', 'false');
    return issuer.request(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: {
        authorization: `Bearer ${credential}`, accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).catch(() => undefined);
  }

  async function read(credential: string): Promise<KeycloakProfile | undefined> {
    const response = await fetchAccount(credential, 'GET');
    if (!response?.ok) return;
    const account = await response.json().catch(() => undefined) as KeycloakProfile | undefined;
    return typeof account?.username === 'string' ? account : undefined;
  }

  function profile(operationId: string, account: KeycloakProfile) {
    const displayName = account.attributes?.[OPERATOR_DISPLAY_NAME_ATTRIBUTE]?.[0] ?? [account.firstName, account.lastName].filter(Boolean).join(' ');
    const avatarUrl = account.attributes?.[OPERATOR_AVATAR_ATTRIBUTE]?.[0];
    return {
      ...send(operationId, 200, {
        username: account.username, displayName: displayName || account.username,
        email: account.email ?? '', emailVerified: account.emailVerified === true,
        ...(httpsAvatar(avatarUrl) ? { avatarUrl } : {}),
      }),
      headers: { 'cache-control': 'no-store' },
    };
  }

  function emailRequest(endpoint: URL | undefined, credential: string, body?: object) {
    if (!issuer || !endpoint) return;
    return issuer.request(endpoint, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${credential}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }).catch(() => undefined);
  }

  function emailAddresses(method: 'GET' | 'POST', operationId: 'getAccountEmails' | 'updateAccountEmails'): RouteDefinition {
    return {
      method, path: '/api/v1/me/emails', operationId,
      async handle(request, _params, context) {
        const auth = await authorize(context, request);
        if (!auth.ok) return auth.response;
        const credential = bearerToken(request.headers.authorization);
        if (!credential) return unauthorized('no-credentials');
        if (method === 'POST' && (request.bodyError || !validateRequestBody(spec(), operationId, request.body).ok)) {
          return badRequest('Enter a valid email address and verification code when required.');
        }
        const input = method === 'POST' ? request.body as RequestBodyOf<'updateAccountEmails'> : undefined;
        const response = await emailRequest(addressPath, credential, input);
        switch (response?.status) {
          case 200: {
            const body = await response.json().catch(() => undefined) as SuccessOf<'getAccountEmails'> | undefined;
            return { ...send(operationId, 200, body), headers: { 'cache-control': 'no-store' } };
          }
          case 400: return badRequest('The verification code is invalid or expired. Request a new one and try again.');
          case 401: return unauthorized('account-permission');
          case 403: return send(operationId, 403, { error: 'email-action-disabled', message: 'Multiple emails are disabled for this installation.' });
          case 409: return send(operationId, 409, { error: 'email-conflict', message: 'That address is unavailable for this action. Reload your addresses and try again.' });
          case 429: return { status: 429, body: { error: 'try-again', message: 'Check your inbox or try again in a minute.' } };
          default: return { status: 503, body: { error: 'identity-email-unavailable', message: 'Couldn’t update email. Ask an installation owner to check identity and SMTP settings.' } };
        }
      },
    };
  }

  return {
    id: 'account-profile',
    requires: ['identity'],
    routes: [
      emailAddresses('GET', 'getAccountEmails'),
      emailAddresses('POST', 'updateAccountEmails'),
      {
        method: 'POST', path: '/api/v1/me/email-actions', operationId: 'requestAccountEmailAction',
        async handle(request, _params, context) {
          const auth = await authorize(context, request);
          if (!auth.ok) return auth.response;
          const credential = bearerToken(request.headers.authorization);
          if (!credential) return unauthorized('no-credentials');
          if (request.bodyError || !validateRequestBody(spec(), 'requestAccountEmailAction', request.body).ok) {
            return badRequest('Choose an account email action.');
          }
          const input = request.body as RequestBodyOf<'requestAccountEmailAction'>;
          const response = await emailRequest(emailPath, credential, input);
          switch (response?.status) {
            case 204: return send('requestAccountEmailAction', 204, undefined);
            case 401: return unauthorized('account-permission');
            case 403: return send('requestAccountEmailAction', 403,
              { error: 'email-action-disabled', message: 'This installation has disabled this email action.' });
            case 409: return send('requestAccountEmailAction', 409, { error: 'email-status',
              message: input.action === 'reset-password' ? 'Verify your primary email before requesting a password reset.' : 'Your primary email is already verified or missing.' });
            case 429: return { status: 429, body: { error: 'try-again', message: 'A link was sent recently. Check your inbox or try again in a minute.' } };
            default: return { status: 503, body: { error: 'identity-email-unavailable', message: 'Couldn’t send email. Ask an installation owner to check SMTP settings.' } };
          }
        },
      },
      {
        method: 'GET', path, operationId: 'getAccountProfile',
        async handle(request, _params, context) {
          const auth = await authorize(context, request);
          if (!auth.ok) return auth.response;
          const credential = bearerToken(request.headers.authorization);
          if (!credential) return unauthorized('no-credentials');
          const account = await read(credential);
          return account ? profile('getAccountProfile', account) : unavailable();
        },
      },
      {
        method: 'PUT', path, operationId: 'updateAccountProfile',
        async handle(request, _params, context) {
          const auth = await authorize(context, request);
          if (!auth.ok) return auth.response;
          const credential = bearerToken(request.headers.authorization);
          if (!credential) return unauthorized('no-credentials');

          const input = request.body as { username?: unknown; displayName?: unknown; avatarUrl?: unknown } | undefined;
          const username = typeof input?.username === 'string' ? input.username.trim() : '';
          const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
          const avatar = typeof input?.avatarUrl === 'string' ? input.avatarUrl.trim() : input?.avatarUrl;
          if (request.bodyError || !input || Object.keys(input).some((key) => key !== 'username' && key !== 'displayName' && key !== 'avatarUrl') ||
              username.length < 3 || username.length > 255 || !displayName || displayName.length > 100) {
            return badRequest('Enter a username of 3 to 255 characters and a display name up to 100 characters');
          }
          if (avatar !== undefined && avatar !== '' && !httpsAvatar(avatar)) return badRequest('Enter an HTTPS image URL for your avatar.');
          const current = await read(credential);
          if (!current) return unavailable();
          const attributes: Record<string, string[]> = { ...current.attributes, [OPERATOR_DISPLAY_NAME_ATTRIBUTE]: [displayName] };
          if (avatar === '') delete attributes[OPERATOR_AVATAR_ATTRIBUTE];
          else if (httpsAvatar(avatar)) attributes[OPERATOR_AVATAR_ATTRIBUTE] = [avatar];
          const saved = await fetchAccount(credential, 'POST', {
            username,
            firstName: current.firstName, lastName: current.lastName, email: current.email,
            attributes,
          });
          if (saved?.status === 400 || saved?.status === 409) return badRequest('The identity provider refused those details. Try a different username or check whether your account allows edits');
          if (!saved?.ok) return unavailable();
          const updated = await read(credential);
          if (!updated || updated.username !== username || updated.attributes?.[OPERATOR_DISPLAY_NAME_ATTRIBUTE]?.[0] !== displayName) return unavailable();
          if (avatar !== undefined && (updated.attributes?.[OPERATOR_AVATAR_ATTRIBUTE]?.[0] ?? '') !== avatar) return unavailable();
          return profile('updateAccountProfile', updated);
        },
      },
    ],
  };
}
