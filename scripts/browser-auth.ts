/**
 * The browser-authentication contract, in code.
 *
 * One definition, three consumers:
 *
 *  - `scripts/seed-identity.ts` writes the client shape from `browserClientShape()` / `browserClientMappers()`,
 *    so what the realm holds and what this file claims cannot drift apart;
 *  - `scripts/smoke-browser-auth.ts` drives the flow with `createPkcePair()` and reads the policy below;
 *  - `packages/contracts/test/browser-auth.test.ts` asserts the invariants inside `pnpm run test`, with no
 *    network and no Keycloak, so a shape regression fails a gate rather than a demo.
 *
 * Why it lives in `scripts/` and not `packages/contracts/src/`: that directory IS the published public surface
 * (`scripts/check-contracts.ts` baselines every declaration in it), and an operator script's notion of a realm
 * client is not a capability seam. Nothing a deployed service imports may depend on this file -- and the test
 * says so in the direction that matters, by refusing any token-shaped key in the API's own audit vocabulary.
 */
import { createHash, randomBytes } from 'node:crypto';

export const WEB_CLIENT_ID = 'platfolio-web';
export const API_CLIENT_ID = 'platfolio-api';
export const REQUIRED_SCOPE = 'platfolio.user';
/** The path the UI signs in from. Derived from the origin so seed, smoke and UI agree on one string. */
export const CALLBACK_PATH = '/callback';

/**
 * The field that makes PKCE MANDATORY is a client ATTRIBUTE, not a representation field.
 *
 * Measured on Keycloak 26.8.2: a `PUT /admin/realms/{realm}/clients/{id}` carrying a top-level
 * `pkceCodeChallengeMethod` is refused outright -- `Invalid json representation for ClientRepresentation.
 * Unrecognized field "pkceCodeChallengeMethod"` -- while `attributes["pkce.code.challenge.method"] = "S256"`
 * persists, reads back, and is enforced at `/auth`. The Server Administration Guide calls the control
 * "PKCE method" with values blank | S256 | plain, and blank means "PKCE is possible but not required" -- which
 * is exactly the bug this constant exists to make impossible.
 */
export const PKCE_CHALLENGE_ATTRIBUTE = 'pkce.code.challenge.method';
export const PKCE_METHOD = 'S256';

/* ------------------------------------------------------------------ the client shape */

export interface BrowserClientShape {
  clientId: string;
  name: string;
  description: string;
  enabled: boolean;
  protocol: 'openid-connect';
  publicClient: boolean;
  bearerOnly: boolean;
  standardFlowEnabled: boolean;
  implicitFlowEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  serviceAccountsEnabled: boolean;
  frontchannelLogout: boolean;
  redirectUris: string[];
  webOrigins: string[];
  attributes: Record<string, string>;
  fullScopeAllowed: boolean;
}

export interface ProtocolMapperShape {
  name: string;
  protocol: 'openid-connect';
  protocolMapper: string;
  consentRequired: boolean;
  config: Record<string, string>;
}

/** Origins must be origins, and only https or loopback http may receive an authorization code. */
export function normalizeUiOrigins(raw: readonly string[]): string[] {
  const origins = [...new Set(raw.flatMap((o) => o.split(',')).map((o) => o.trim().replace(/\/$/, '')).filter(Boolean))];
  for (const o of origins) {
    const url = new URL(o);
    const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !loopback) {
      throw new Error(`UI origin "${o}" is neither https nor loopback http: a redirect URI over cleartext hands the authorization code to anyone on the path`);
    }
    if (url.search || url.hash) {
      throw new Error(`UI origin "${o}" must be an origin (scheme://host[:port]); the redirect URI is derived as <origin>${CALLBACK_PATH}`);
    }
  }
  return origins;
}

/**
 * The public PKCE client, derived from the UI origins that may sign in.
 *
 * Every boolean here is a refusal the token endpoint later performs, and `smoke-browser-auth.ts` measures each
 * one rather than trusting this object:
 *  - `directAccessGrantsEnabled: false` -- ROPC hands a password to whoever holds the client credentials, and
 *    for a public client that is every visitor of the site. Measured refusal: `400 unauthorized_client /
 *    Client not allowed for direct access grants`.
 *  - `serviceAccountsEnabled: false` -- client credentials is a machine grant; a browser has no machine to
 *    assert. Measured: `401 Public client not allowed to retrieve service account`.
 *  - `implicitFlowEnabled: false` -- tokens in a URL fragment reach history, logs and referrers.
 *  - `fullScopeAllowed: false` plus one explicit role-scope mapping -- the token carries one capability instead
 *    of every role in the realm.
 *  - No `secret`, and `clientAuthenticatorType` is left at the server default: it is inert while
 *    `publicClient` is true (measured: the Admin API read-back carries no `secret` field at all, and
 *    `GET /clients/{id}/client-secret` answers `{"type":"secret"}` with no value).
 *
 * Redirect URIs are EXACT -- `<origin>${CALLBACK_PATH}`, never `<origin>/*`. Keycloak's pattern match honours a
 * trailing wildcard, which is why it must not be used here: a wildcard turns the client into an
 * authorization-code delivery oracle for any path on that host, and `docs/design/05-identity.md` already lists
 * "no wildcard redirect URIs" among the controls to implement.
 */
export function browserClientShape(uiOrigins: readonly string[]): BrowserClientShape {
  const origins = normalizeUiOrigins(uiOrigins);
  return {
    clientId: WEB_CLIENT_ID,
    name: 'platfolio web (browser)',
    description: `The platfolio browser UI. Public client: PKCE (${PKCE_METHOD}) is mandatory and there is no secret.`,
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    bearerOnly: false,
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    // No ROPC for a public client -- the point of this whole shape, said twice on purpose.
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    frontchannelLogout: true,
    redirectUris: origins.map((o) => `${o}${CALLBACK_PATH}`),
    webOrigins: origins,
    attributes: { [PKCE_CHALLENGE_ATTRIBUTE]: PKCE_METHOD },
    fullScopeAllowed: false,
  };
}

/**
 * The two claims that make a browser-minted token usable by the API.
 *
 * Audience is the RESOURCE (`platfolio-api`) while `azp` stays the browser client, and that asymmetry is the
 * security property: the control plane can tell a person's session from a machine's grant in every audit row,
 * and neither token substitutes for the other.
 */
export function browserClientMappers(): ProtocolMapperShape[] {
  return [
    {
      name: 'platfolio-web-audience',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      consentRequired: false,
      config: {
        // `included.client.audience` is deliberately absent: it resolves only when the user holds a role in
        // that client, which puts a second condition on a claim that must always hold. A custom audience is
        // unconditional.
        'included.custom.audience': API_CLIENT_ID,
        'access.token.claim': 'true',
        'id.token.claim': 'false',
      },
    },
    {
      name: 'platfolio-web-scopes',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-usermodel-client-role-mapper',
      consentRequired: false,
      config: {
        // Read the roles of the RESOURCE client. `platfolio.user` is one role, held once, asserted by both the
        // machine path and the browser path; a second role with a second name would be a second thing to
        // revoke. Measured: with `fullScopeAllowed: false` and the matching role-scope mapping, the access
        // token carries `scope: ["platfolio.user"]`.
        'usermodel.clientRoleMapping.clientId': API_CLIENT_ID,
        'claim.name': 'scope',
        'jsonType.label': 'String',
        multivalued: 'true',
        'access.token.claim': 'true',
        'id.token.claim': 'false',
      },
    },
  ];
}

/* ------------------------------------------------------------------ PKCE primitives */

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: typeof PKCE_METHOD;
}

/**
 * RFC 7636 §4.1: a verifier is 43..128 characters of the unreserved set. 48 random bytes base64url is 64
 * characters -- inside the window, with 384 bits behind it, and no padding characters.
 */
export function createPkcePair(rand: (n: number) => Uint8Array = randomBytes): PkcePair {
  const verifier = Buffer.from(rand(48)).toString('base64url');
  return { verifier, challenge: codeChallenge(verifier), method: PKCE_METHOD };
}

/** The S256 transformation, exactly as §4.2 defines it: BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(Buffer.from(verifier, 'ascii')).digest('base64url');
}

/** The verifier window, as a predicate rather than a comment, so a short verifier fails a check. */
export function isPkceVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/* ------------------------------------------------------------------ token lifecycle policy */

/**
 * Where a token may live in the browser. Data, not prose, so `docs`-free code can assert on it and a test can
 * refuse a new value that weakens it.
 */
export const TOKEN_STORAGE = {
  access: { inMemory: true, localStorage: false, sessionStorage: false, cookie: false, platfolioDatabase: false },
  refresh: { inMemory: true, localStorage: false, sessionStorage: false, cookie: false, platfolioDatabase: false },
  idToken: { inMemory: true, localStorage: false, sessionStorage: false, cookie: false, platfolioDatabase: false },
} as const;

export type TokenKind = keyof typeof TOKEN_STORAGE;
export type StorageLocation = keyof (typeof TOKEN_STORAGE)['access'];

/** The recommended default, stated once and pointed at from the smoke script's header. */
export const RECOMMENDED_STORE: StorageLocation = 'inMemory';

/**
 * How long before expiry to refresh, derived from the response's own `expires_in`.
 *
 * A quarter of the lifetime, floored at 5 seconds (never so early that a refresh on every page load becomes a
 * loop) and capped at 60 seconds (never so late that a slow token endpoint turns a refresh into an expired
 * call). The cap is what makes this safe to call on any realm: an operator who sets a 12-hour access lifespan
 * gets a 60-second warning, not a 3-hour one.
 */
export function refreshSkewSeconds(expiresIn: number): number {
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return 0;
  return Math.max(5, Math.min(60, Math.floor(expiresIn / 4)));
}

/**
 * When to refresh, in epoch milliseconds. `undefined` means "there is nothing to schedule": no refresh token,
 * or a response that says the refresh window is already closed (`refresh_expires_in: 0`).
 */
export function refreshAt(input: { nowMs: number; expiresIn: number; refreshExpiresIn?: number; jitterRatio?: number }): number | undefined {
  if (!Number.isFinite(input.expiresIn) || input.expiresIn <= 0) return undefined;
  if (input.refreshExpiresIn !== undefined && input.refreshExpiresIn <= 0) return undefined;
  const skew = refreshSkewSeconds(input.expiresIn);
  const jitter = Math.round(skew * (input.jitterRatio ?? 0));
  // Never schedule in the past: a realm with a 3-second access lifespan gets "refresh immediately", not a
  // negative timer that a naive setTimeout would fire on the next tick anyway.
  return input.nowMs + Math.max(0, input.expiresIn - skew - jitter) * 1000;
}

/** The OIDC RP-initiated logout call. `id_token_hint` is what makes the revocation provable. */
export function endSessionUrl(input: { endSessionEndpoint: string; idToken: string; postLogoutRedirectUri: string; clientId?: string }): string {
  const u = new URL(input.endSessionEndpoint);
  u.searchParams.set('id_token_hint', input.idToken);
  u.searchParams.set('post_logout_redirect_uri', input.postLogoutRedirectUri);
  if (input.clientId) u.searchParams.set('client_id', input.clientId);
  return u.toString();
}

/** What a platfolio client must clear on logout. Enumerated so "clear the session" is not left to interpretation. */
export const LOGOUT_CLEAR = ['access token', 'refresh token', 'id token', 'cached claims', 'pending refresh timer', 'pending retry queue'] as const;

/**
 * D4, as a predicate: the names that would make an API field a place a token could arrive.
 *
 * The API may legitimately carry the words `token` in `livenessToken` (a build digest) and `not-before-policy`
 * (Keycloak's own), so the rule is on the SHAPE of the name rather than on the word: anything naming an access,
 * refresh or bearer token, or a client secret, is a place a credential is being asked to go.
 */
export function isTokenShapedName(name: string): boolean {
  return /^(access_?token|refresh_?token|id_?token|bearer_?token|client_?secret|code_?verifier|token)$/.test(name.trim().toLowerCase());
}

/**
 * The audit detail keys the control plane writes today, and the only ones it may write without this test
 * failing. The list is deliberately explicit: an audit row is the one place a well-meaning handler could put
 * "the token that made this call", and D4 says platfolio holds no credential -- not for the moment, not
 * temporarily, not redacted.
 */
export const AUDIT_DETAIL_KEYS_ALLOWLIST = [
  'template', 'teamId', 'from', 'state', 'planHash', 'repo', 'commit', 'files', 'service', 'image', 'digest',
  'dispatchId', 'action', 'environment', 'ref', 'workflow', 'result', 'resources', 'to', 'environmentState',
  'capability', 'toTeamId', 'providerInstanceId', 'email', 'role', 'sent', 'personId', 'reason', 'name',
] as const;
