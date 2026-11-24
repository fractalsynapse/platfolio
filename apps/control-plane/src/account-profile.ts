import type { ExtensionDescriptor, KernelContext, Request, Response_ } from '@platfolio/kernel';
import { badRequest, bearerToken, send, unauthorized } from './respond.ts';

export const OPERATOR_DISPLAY_NAME_ATTRIBUTE = 'platfolioDisplayName';

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

export function accountProfile(authorize: Authorize, issuer?: AccountIssuer): ExtensionDescriptor {
  const path = '/api/v1/me/profile';
  const accountPath = issuer && new URL(issuer.issuer.replace(/\/$/, '') + '/account/');

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
    return {
      ...send(operationId, 200, {
        username: account.username, displayName: displayName || account.username,
        email: account.email ?? '', emailVerified: account.emailVerified === true,
      }),
      headers: { 'cache-control': 'no-store' },
    };
  }

  return {
    id: 'account-profile',
    requires: ['identity'],
    routes: [
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

          const input = request.body as { username?: unknown; displayName?: unknown } | undefined;
          const username = typeof input?.username === 'string' ? input.username.trim() : '';
          const displayName = typeof input?.displayName === 'string' ? input.displayName.trim() : '';
          if (request.bodyError || !input || Object.keys(input).some((key) => key !== 'username' && key !== 'displayName') ||
              username.length < 3 || username.length > 255 || !displayName || displayName.length > 100) {
            return badRequest('Enter a username of 3 to 255 characters and a display name up to 100 characters');
          }
          const current = await read(credential);
          if (!current) return unavailable();
          const saved = await fetchAccount(credential, 'POST', {
            username,
            firstName: current.firstName, lastName: current.lastName, email: current.email,
            attributes: { ...current.attributes, [OPERATOR_DISPLAY_NAME_ATTRIBUTE]: [displayName] },
          });
          if (saved?.status === 400 || saved?.status === 409) return badRequest('The identity provider refused those details. Try a different username or check whether your account allows edits');
          if (!saved?.ok) return unavailable();
          const updated = await read(credential);
          if (!updated || updated.username !== username || updated.attributes?.[OPERATOR_DISPLAY_NAME_ATTRIBUTE]?.[0] !== displayName) return unavailable();
          return profile('updateAccountProfile', updated);
        },
      },
    ],
  };
}
