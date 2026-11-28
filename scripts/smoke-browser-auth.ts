/**
 * `pnpm run identity:pkce:smoke` -- the browser sign-in path, proven end to end without a browser.
 *
 *   docker compose -f compose.yaml -f compose.dev.yaml up -d
 *   pnpm run identity:seed
 *   KC_PEER_REALM=platfolio-staging pnpm run identity:pkce:smoke
 *
 *   (a plain run leaves one check NOT RUN -- the cross-realm one -- and therefore exits 1; seed the peer
 *   realm with `pnpm run identity:seed --realm=platfolio-staging` to run the whole list)
 *
 * Exit codes: 0 means every check RAN and passed. A check the environment would not allow (no peer realm, no
 * master-realm admin token) prints NOT RUN and exits 1, because "green" must never mean "the interesting
 * assertion stayed quiet" -- the same ruling identity:smoke applies to an unset KC_PEER_REALM. On the hosted
 * box section E is not-runnable today (#248) and that is the honest answer, not a failure of the flow.
 *
 * WHAT THIS IS NOT: a PKCE test that cheats. `smoke-identity.ts` mints its tokens with
 * `grant_type=password` (ROPC) because it is testing the verifier, and ROPC needs a client secret. A browser
 * cannot hold that secret, so the path a UI takes is authorization code + PKCE, and until something walks it
 * -- authorize, log in, follow the redirect, exchange with the verifier -- nobody knows whether the realm is
 * configured for it. Every token asserted below comes from a real authorization code. The two password-grant
 * calls in section D2 are negative controls: they must FAIL.
 *
 * ============================================================================
 * TOKEN LIFECYCLE -- the contract a platfolio browser client implements.
 * This header is the documentation; `packages/contracts/test/browser-auth.test.ts` is the machine check.
 * ============================================================================
 *
 * 1. WHAT THE BROWSER HOLDS, AND WHERE
 *    The exchange returns three things: an ACCESS token (`typ: Bearer`, short-lived, addressed to
 *    `platfolio-api`), an ID token (profile only; read at sign-in, never sent anywhere), and a REFRESH token
 *    (the long one).
 *
 *    RECOMMENDED DEFAULT: keep the access token and the refresh token IN MEMORY, in the SPA's module scope,
 *    and accept that a page reload signs the user in again. The reload is nearly free, because an OIDC
 *    round trip against a live Keycloak session needs no interaction -- a hidden iframe, or a top-level
 *    authorize that comes straight back with a code.
 *
 *    `localStorage` and every other persistent browser store (sessionStorage for a refresh token, IndexedDB,
 *    cookies the SPA sets itself) are OUT for the refresh token. Stated plainly because it is the point rather
 *    than a footnote: **a bearer refresh token in `localStorage` is readable by any script the page ends up
 *    running, and it is a bearer token, so reading it IS possessing it** -- no audience check, no origin check
 *    and no replay detection defeats a stolen one. XSS then becomes a silent impersonation lasting the refresh
 *    window instead of the one-page-load nuisance a stolen access token is. The corollary: platfolio's UI, when
 *    it arrives, must not "persist the session" by persisting a token. Cross-tab continuity belongs to the IdP
 *    session, which is what an OIDC provider is for.
 *
 * 2. EXPIRY AND REFRESH -- DERIVED, NEVER HARD-CODED
 *    The token response says how long everything lasts: `expires_in` for the access token,
 *    `refresh_expires_in` for the refresh token. Nothing may assume 300 seconds. The realm's
 *    `accessTokenLifespan` is a value an operator changes (this realm currently answers 300 and 1800; the
 *    checks below read them from the response rather than naming them), and a UI that hard-codes the number
 *    refreshes on the wrong schedule and discovers it at 03:00.
 *
 *      accessExpiresAt  = now + expires_in          (must equal the `exp` claim -- asserted per response)
 *      refreshExpiresAt = now + refresh_expires_in  (0 or absent means no refresh window: do not schedule)
 *      refreshAt(t)     = expiry(t) - skew(t) - jitter(t),   skew(t) = max(5, min(60, floor(t / 4)))
 *    with jitter up to 20% of the remaining window, subtracted, so a fleet of tabs that loaded together does
 *    not arrive at the token endpoint in lockstep. Use a refresh token exactly once, REPLACE BOTH TOKENS from
 *    the response, and cancel the scheduled refresh whenever a refresh fails.
 *
 *    `refresh_expires_in` tracks the client-session idle window -- Keycloak: "the refresh token requests bump
 *    the idle timeout" -- so an active UI does not expire it by using it, and an abandoned one dies with the
 *    SSO session.
 *
 *    ROTATION, AND WHAT PLATFOLIO CANNOT PROMISE. A refresh returns a NEW refresh token, so a client must
 *    replace its copy. Whether the OLD one dies is a realm switch (`revokeRefreshToken`), not a client choice:
 *    with it off, rotation buys hygiene but not theft detection, because a stolen refresh token keeps working
 *    beside the rotated one. Section D4 reports which way this realm actually answered instead of asserting
 *    one -- a UI must never assume reuse detection.
 *
 * 3. EXPIRED, REFUSED, OVER
 *    A 401 from the control plane on an expired access token means "refresh and retry ONCE". A second 401, or
 *    any 403, means stop: 403 is the API's answer to "you are who you say you are and you may not do this"
 *    (`insufficient-scope`), and refreshing cannot change it. A refresh refusal (400 `invalid_grant`: session
 *    gone, token revoked, IdP restarted) ends the session -- drop both tokens and re-authenticate. Never
 *    queue-and-hope across a refresh failure, and never send a refresh token anywhere but the IdP token
 *    endpoint.
 *
 * 4. LOGOUT
 *    Logout is an OIDC call, not a client-side wipe:
 *
 *      GET {end_session_endpoint}?id_token_hint={id_token}&post_logout_redirect_uri={registered redirect}
 *
 *    `id_token_hint` is what makes it provable -- it names the session to end. The deprecated
 *    `refresh_token`+`client_id` form is not the contract. Going to that URL with the user's cookies IS the
 *    revocation; measured here: refresh -> 400 `Session not active`, userinfo -> 401, and a fresh authorize
 *    asks for credentials again. THEN the client clears its own copies -- access token, refresh token, ID
 *    token, cached claims, and any scheduled refresh -- because a token nobody holds cannot be misused by the
 *    next person to touch this laptop.
 *
 *    What platfolio must also clear, and what it cannot: the UI clears its state; the API holds nothing, so
 *    there is nothing to clear there, and there is deliberately no server-side session table to delete from.
 *    The ACCESS token stays cryptographically valid until `exp` -- measured in D5, and stated as design rather
 *    than defended as a bug. An access token is a claim, not a lease; revoking one before its expiry would
 *    require a live-token table consulted on every request, which is the database D4 forbids here. That is the
 *    argument for a short access lifespan, not for a logout endpoint that cannot deliver instant revocation.
 *
 * 5. THE D4 LINE
 *    A refresh token's destination is the IdP's token endpoint and nowhere else. Never a request body, never a
 *    query parameter other than that form field, never a header the control plane reads, never an audit value,
 *    never a log line, never a database row. The control plane sees one thing: `Authorization: Bearer {ACCESS
 *    token}`, which it verifies against JWKS and discards -- no token column exists in the schema, `whoami`
 *    echoes an allow-listed projection rather than the token, and audit rows carry subject ids. Enforced here:
 *    a refresh token presented AS a bearer credential is refused (D3), and the token-shaped-string guard in
 *    `packages/contracts/test/browser-auth.test.ts` refuses any new audit detail key that could hold one.
 *
 * 6. THE BROWSER MUST NOT HAVE A CLIENT SECRET. Not a style rule. `platfolio-web` is a public client: its
 *    `client_id` is public information, and the realm refuses to authenticate it as a client at all. If a UI
 *    build ever seems to need a secret, the design has regressed; the fix is a backend channel, not a secret in
 *    a bundle.
 * ============================================================================
 */
import { parseArgs } from 'node:util';
import { API_CLIENT_ID, LOGIN_SCOPES, LOOPBACK_UI_ORIGIN, PKCE_CHALLENGE_ATTRIBUTE, PKCE_METHOD, REQUIRED_SCOPE, WEB_CLIENT_ID, browserClientMappers, codeChallenge, createPkcePair, endSessionUrl, isPkceVerifier, refreshSkewSeconds } from './browser-auth.ts';
import { isLoopback } from './identity-credentials.ts';
import { OPERATOR_DISPLAY_NAME_ATTRIBUTE } from '../apps/identity/src/operator-profile.ts';

const { values: flags } = parseArgs({
  options: {
    base: { type: 'string', default: process.env.KC_BASE ?? 'http://localhost:8081' },
    realm: { type: 'string', default: process.env.KC_REALM ?? 'platfolio' },
    api: { type: 'string', default: process.env.CONTROL_PLANE_BASE ?? 'http://localhost:8082' },
    // The same variable the seed writes the realm's redirect URIs from, and the same one the API admits at boot:
    // one list, so this smoke cannot pass by testing an origin the realm was never told about. Loopback stays
    // the default because the local stack's UI is Vite on :5173 -- see `scripts/seed-identity.ts` and
    // `compose.dev.yaml`, which name the same origin.
    'ui-origin': { type: 'string', default: process.env.PLATFOLIO_ALLOWED_ORIGINS ?? LOOPBACK_UI_ORIGIN },
    'sign-in-only': { type: 'boolean' },
    'local-owner-profile': { type: 'boolean' },
    'expect-account-unavailable': { type: 'boolean' },
    'expect-verified-email': { type: 'boolean' },
    'expect-profile-attribute': { type: 'string' },
    user: { type: 'string', default: process.env.KC_PKCE_USER ?? 'adrian' },
    password: { type: 'string', default: process.env.KC_USER_PASSWORD ?? 'platfolio-dev-only' },
    'admin-user': { type: 'string', default: process.env.KC_ADMIN_USER ?? 'platfolio-admin' },
    'admin-password': { type: 'string', default: process.env.KC_ADMIN_PASSWORD ?? 'platfolio-dev-only' },
  },
});

const idp = flags.base as string;
const realm = flags.realm as string;
const api = flags.api as string;
// The first declared origin is the one this run drives; a realm may hold several, and a code can only land at
// one of them per round trip.
const uiOrigin = (flags['ui-origin'] as string).split(',')[0]!.trim().replace(/\/$/, '');
const redirectUri = `${uiOrigin}/callback`;
const WEB_CLIENT = WEB_CLIENT_ID;
const API_CLIENT = API_CLIENT_ID;
const issuer = `${idp}/realms/${realm}`;
const focusedSignIn = flags['sign-in-only'] || flags['local-owner-profile'];
if ((flags['expect-account-unavailable'] || flags['expect-verified-email'] || flags['expect-profile-attribute']) && !flags['local-owner-profile']) {
  throw new Error('Account expectations require --local-owner-profile');
}
if (flags['local-owner-profile'] && (!isLoopback(idp) || !isLoopback(uiOrigin))) {
  throw new Error('The owner profile write smoke runs only against a disposable loopback realm');
}
if (focusedSignIn && (!process.env.KC_PKCE_USER || !process.env.KC_USER_PASSWORD)) {
  throw new Error('The candidate sign-in check needs KC_PKCE_USER and KC_USER_PASSWORD for a smoke user');
}

type Status = 'pass' | 'fail' | 'not-run';
const results: Array<{ name: string; status: Status; detail: string }> = [];
const record = (name: string, status: Status, detail: string): void => {
  results.push({ name, status, detail });
  process.stdout.write(`S ${status === 'pass' ? 'pass' : status === 'fail' ? 'FAIL' : 'skip '}  ${name} -- ${detail}\n`);
};
const check = (name: string, ok: boolean, detail: string): void => record(name, ok ? 'pass' : 'fail', detail);
/** Something the environment would not let us test. Loud, and never counted as a pass. */
const notRun = (name: string, why: string): void => record(name, 'not-run', why);
const section = (title: string): void => { process.stdout.write(`S -- ${title}\n`); };

/** Never print a token. Length and segment count are evidence; the value is the credential. */
const shape = (token: string): string => (token ? `${String(token.length)} chars, ${String(token.split('.').length)} segments` : '(empty)');

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint: string;
  code_challenge_methods_supported: string[];
}

/* A cookie jar, because the authorization code flow is a browser session and `fetch` has none. Deleting on an
 * empty value or an expired date is what makes the logout assertions mean what they say. */
const jar = new Map<string, string>();
const saveCookies = (r: Response): void => {
  for (const c of r.headers.getSetCookie()) {
    const [pair] = c.split(';');
    if (!pair) continue;
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (value === '' || /max-age=0\b/i.test(c) || /expires=[^;]*1970/i.test(c)) jar.delete(name);
    else jar.set(name, value);
  }
};
const cookieHeader = (): Record<string, string> => (jar.size === 0 ? {} : { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') });

const getRaw = async (url: string): Promise<Response> => {
  const r = await fetch(url, { redirect: 'manual', headers: cookieHeader() });
  saveCookies(r);
  return r;
};
const postForm = async (url: string, form: Record<string, string>): Promise<Response> => {
  const r = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { ...cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  saveCookies(r);
  return r;
};
const asJson = async (r: Response): Promise<{ status: number; j: Record<string, unknown> }> => {
  const text = await r.text();
  let j: Record<string, unknown>;
  try { j = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { j = { error_description: text.slice(0, 120) }; }
  return { status: r.status, j };
};
const errOf = (j: Record<string, unknown>): string => `${String(j.error ?? '')} ${String(j.error_description ?? '')}`.trim();

const newVerifier = (): string => createPkcePair().verifier;
/** The S256 transformation from the shared contract module -- the same function the unit test pins to the RFC 7636 vector. */
const challengeFor = async (verifier: string): Promise<string> => codeChallenge(verifier);
const claimsOf = (token: string): Record<string, unknown> => {
  try { return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return {}; }
};

let disc: Discovery;

/**
 * Drive `/auth` for one authorization code, and hand back the verifier that goes with it -- a code is
 * single-use and bound to one verifier, so every test needs its own pair rather than a shared fixture.
 *
 * `loginPageShown` is the fact that this was a browser path and not a shortcut: Keycloak served a form and we
 * posted a credential to it. `state` is the CSRF check the UI owns, verified here rather than assumed.
 */
async function authorize(opts: {
  verifier?: string;
  challengeOverride?: string;
  methodOverride?: string;
  omitChallenge?: boolean;
  redirectOverride?: string;
  user?: string;
  password?: string;
  scope?: string;
} = {}): Promise<{ verifier: string; code?: string; params: Record<string, string>; loginPageShown: boolean; status: number; page?: string; stateMismatch?: string }> {
  const verifier = opts.verifier ?? newVerifier();
  const state = `st-${Math.random().toString(36).slice(2, 10)}`;
  const u = new URL(disc.authorization_endpoint);
  u.searchParams.set('client_id', WEB_CLIENT);
  u.searchParams.set('redirect_uri', opts.redirectOverride ?? redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', opts.scope ?? LOGIN_SCOPES);
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', `n-${Math.random().toString(36).slice(2, 10)}`);
  const challenge = opts.challengeOverride ?? (opts.omitChallenge ? undefined : await challengeFor(verifier));
  if (challenge) u.searchParams.set('code_challenge', challenge);
  if (!opts.omitChallenge) u.searchParams.set('code_challenge_method', opts.methodOverride ?? 'S256');

  let r = await getRaw(u.toString());
  let loginPageShown = false;
  let loc = r.headers.get('location');
  if (r.status === 200 && !loc) {
    const html = await r.text();
    // Keycloak serves either the login form (200) or its own error page (400) at this URL. Recording which one
    // we got is what stops a refusal from being read as a silent success.
    const action = /<form id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
    if (!action) return { verifier, params: {}, loginPageShown: false, status: 200, page: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) };
    if (focusedSignIn && new URL(action.replace(/&amp;/g, '&')).origin !== new URL(issuer).origin) {
      throw new Error('The candidate sign-in form points outside its configured issuer');
    }
    loginPageShown = true;
    r = await fetch(action.replace(/&amp;/g, '&'), {
      method: 'POST',
      redirect: 'manual',
      headers: { ...cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: opts.user ?? (flags.user as string), password: opts.password ?? (flags.password as string), credentialId: '', login: 'Sign In' }),
    });
    saveCookies(r);
    loc = r.headers.get('location');
  }
  if (!loc) return { verifier, params: {}, loginPageShown, status: r.status, page: '(no redirect and no login form)' };
  let target = new URL(loc, idp);
  // Follow chains only while they stay on the IdP. The redirect target is the UI's origin, and nothing is
  // listening there in this test -- fetching it would be a connection error dressed up as a protocol result.
  for (let hop = 0; hop < 3 && target.origin === new URL(idp).origin && !target.searchParams.has('code') && !target.searchParams.has('error'); hop += 1) {
    const next = await getRaw(target.toString());
    const l = next.headers.get('location');
    if (!l) break;
    target = new URL(l, target);
  }
  const params = Object.fromEntries(target.searchParams.entries());
  const stateMismatch = (focusedSignIn || params.state) && params.state !== state
    ? `sent ${state}, got ${params.state ?? '(missing)'}` : undefined;
  if (focusedSignIn && target.origin + target.pathname !== redirectUri) {
    throw new Error('The candidate sign-in did not redirect to its configured callback');
  }
  return { verifier, ...(params.code === undefined ? {} : { code: params.code }), params, loginPageShown, status: r.status, ...(stateMismatch === undefined ? {} : { stateMismatch }) };
}

const exchange = async (code: string, verifier: string, overrides: Record<string, string> = {}) => {
  const form: Record<string, string> = { grant_type: 'authorization_code', client_id: WEB_CLIENT, code, redirect_uri: redirectUri, code_verifier: verifier, ...overrides };
  // An empty override means "do not send this field at all" -- sending `code_verifier=` would be testing the
  // behaviour of a blank verifier, which is not the same claim as testing the absence of one.
  for (const k of Object.keys(form)) if (form[k] === '') delete form[k];
  return asJson(await postForm(disc.token_endpoint, form));
};

const refreshWith = async (token: string) =>
  asJson(await postForm(disc.token_endpoint, { grant_type: 'refresh_token', client_id: WEB_CLIENT, refresh_token: token }));

const callApi = async (path: string, token = '') => {
  const r = await fetch(`${api}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, text: await r.text() };
};

/* ------------------------------------------------------------------ A */
section('A. the realm advertises what this flow needs');
try {
  const r = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`HTTP ${String(r.status)}`);
  disc = (await r.json()) as Discovery;
} catch (error) {
  process.stdout.write(`S cannot read ${issuer}/.well-known/openid-configuration (${(error as Error).message}) -- is the stack up?\n  docker compose -f compose.yaml -f compose.dev.yaml up -d && pnpm run identity:seed\n`);
  process.exit(1);
}
check('discovery: issuer is the realm under test', disc.issuer === issuer, `${disc.issuer}`);
check('discovery: S256 is offered', disc.code_challenge_methods_supported.includes('S256'), JSON.stringify(disc.code_challenge_methods_supported));
check('discovery: an end_session_endpoint exists', typeof disc.end_session_endpoint === 'string' && disc.end_session_endpoint.length > 0, disc.end_session_endpoint);

if (focusedSignIn) {
  const origin = new URL(issuer).origin;
  if (disc.issuer !== issuer || [disc.authorization_endpoint, disc.token_endpoint].some((endpoint) => new URL(endpoint).origin !== origin)) {
    throw new Error('Candidate sign-in discovered endpoints outside its configured issuer');
  }
  const login = await authorize();
  check('candidate PKCE login returned a code with matching state', Boolean(login.code && login.loginPageShown && !login.stateMismatch), 'authorization code and redirect');
  if (!login.code || login.stateMismatch) report();
  const token = await exchange(login.code, login.verifier);
  const accessToken = token.j.access_token;
  check('candidate exchanged the code with its PKCE verifier', token.status === 200 && typeof accessToken === 'string', `HTTP ${token.status}`);
  if (typeof accessToken !== 'string' || token.status !== 200) report();
  if (flags['local-owner-profile']) {
    const account = `${issuer}/account/?userProfileMetadata=false`;
    const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
    const before = await fetch(account, { headers, redirect: 'error' });
    if (flags['expect-account-unavailable']) {
      check('the legacy account is unavailable before upgrade', before.status === 401 || before.status === 403, `HTTP ${before.status}`);
      report();
    }
    check('the initial owner can read their imported account', before.ok, `HTTP ${before.status}`);
    if (!before.ok) report();
    const profile = await before.json() as { username: string; firstName?: string; lastName?: string; email?: string;
      emailVerified?: boolean; attributes?: Record<string, string[]> };
    if (flags['expect-verified-email']) {
      check('the existing verified email is retained', Boolean(profile.email && profile.emailVerified), 'account response');
    }
    const displayName = 'Profile verification';
    const saved = await fetch(account, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ username: profile.username, firstName: profile.firstName, lastName: profile.lastName,
        email: profile.email, attributes: { ...profile.attributes, [OPERATOR_DISPLAY_NAME_ATTRIBUTE]: [displayName] } }) });
    check('the initial owner can save a display name', saved.ok, `HTTP ${saved.status}`);
    const after = await fetch(account, { headers, redirect: 'error' });
    const updated = await after.json().catch(() => undefined) as typeof profile | undefined;
    check('Keycloak persisted the display name', after.ok && updated?.attributes?.[OPERATOR_DISPLAY_NAME_ATTRIBUTE]?.[0] === displayName, `HTTP ${after.status}`);
    const attribute = flags['expect-profile-attribute'];
    if (attribute) {
      const original = profile.attributes?.[attribute];
      check('a pre-existing custom profile attribute survived', Boolean(original?.length &&
        JSON.stringify(updated?.attributes?.[attribute]) === JSON.stringify(original)), 'account read-back');
    }
    report();
  }
  const who = await fetch(`${api}/api/v1/whoami`, { headers: { authorization: `Bearer ${accessToken}` }, redirect: 'error' });
  check('candidate API accepted the browser access token', who.status === 200, `HTTP ${who.status}`);
  report();
}

/* ------------------------------------------------------------------ B */
section('B. PKCE is mandatory at the authorization endpoint, not "offered by a well-behaved client"');
{
  const noChallenge = await authorize({ omitChallenge: true });
  check('authorize WITHOUT code_challenge is refused', noChallenge.code === undefined && noChallenge.params.error !== undefined,
    noChallenge.params.error ? `${noChallenge.params.error}: ${noChallenge.params.error_description ?? ''}` : noChallenge.code ? 'a code was issued to a client that sent no challenge -- any interceptor of the code can redeem it' : `no error and no code (status ${String(noChallenge.status)}: ${String(noChallenge.page ?? '').slice(0, 90)})`);

  const plainVerifier = newVerifier();
  const plain = await authorize({ verifier: plainVerifier, methodOverride: 'plain', challengeOverride: plainVerifier });
  check('authorize with code_challenge_method=plain is refused', plain.code === undefined,
    plain.params.error ? `${plain.params.error}: ${plain.params.error_description ?? ''}` : 'plain was accepted: S256 is not enforced, so a leaked challenge leaks the verifier');

  const badRedirect = await authorize({ redirectOverride: 'https://not-registered.example.com/callback' });
  check('an unregistered redirect_uri is refused before any credential is taken', badRedirect.code === undefined && !badRedirect.loginPageShown,
    badRedirect.params.error ? `${badRedirect.params.error}: ${badRedirect.params.error_description ?? ''}` : `status ${String(badRedirect.status)}, login form served: ${String(badRedirect.loginPageShown)}, code: ${String(badRedirect.code !== undefined)}`);
}

/* ------------------------------------------------------------------ C */
section('C. the real round trip: authorize, log in, exchange with the verifier');
const auth = await authorize();
check('the browser reached a login form and came back with a code', auth.loginPageShown && auth.code !== undefined,
  auth.code ? (auth.stateMismatch ? `code received BUT ${auth.stateMismatch}` : `code received, state round-tripped, ${auth.loginPageShown ? 'login form served' : 'silent SSO'}`) : `no code: ${JSON.stringify(auth.params).slice(0, 160)}`);
check('the state parameter round-tripped (the CSRF check a UI owns)', auth.stateMismatch === undefined, auth.stateMismatch ?? 'echoed unchanged');
if (!auth.code) {
  process.stdout.write('S cannot continue without an authorization code\n');
  report();
}
const ex = await exchange(auth.code, auth.verifier);
const tokens = ex.j as Record<string, string>;
const at = tokens.access_token ?? '';
const idToken = tokens.id_token ?? '';
const refresh0 = tokens.refresh_token ?? '';
const atClaims = claimsOf(at);
const idClaims = claimsOf(idToken);

check('(a) the exchange returns an access token with the verifier and NO client secret', ex.status === 200 && at.length > 40, `HTTP ${String(ex.status)} ${ex.status === 200 ? shape(at) : errOf(ex.j)}`);
check('(a) the access token was issued by THIS realm', atClaims.iss === issuer, `iss=${String(atClaims.iss ?? '(absent)')}`);
check('it is a Bearer access token, not a refresh token wearing a hat', atClaims.typ === 'Bearer', `typ=${String(atClaims.typ)}`);
const audList = Array.isArray(atClaims.aud) ? (atClaims.aud as string[]) : [String(atClaims.aud)];
// Inclusion, not equality: measured on 26.8.2, a token with the audience mapper carries
// `["platfolio-web","platfolio-api"]` and one without it carries `"platfolio-api"`. The verifier's rule is
// "the audience set contains platfolio-api", so that is the rule asserted here -- an equality check would be a
// second, stricter contract the API does not enforce and the UI could never rely on.
check('the audience set includes the control plane while azp stays the browser client', audList.includes(API_CLIENT) && atClaims.azp === WEB_CLIENT,
  `aud=${JSON.stringify(atClaims.aud)} azp=${String(atClaims.azp)} -- the API can tell a person's session from a machine's grant`);
const scopes = typeof atClaims.scope === 'string' ? atClaims.scope.split(' ').filter(Boolean) : atClaims.scope;
check('the scope claim is exactly the one role, not the whole realm', JSON.stringify(scopes) === JSON.stringify([REQUIRED_SCOPE]), `scope=${JSON.stringify(atClaims.scope)}`);
check('the ID token is addressed to the browser client, not to the API', idClaims.aud === WEB_CLIENT, `id_token aud=${String(idClaims.aud ?? '(absent)')}`);
check('sub agrees between ID token and access token', typeof idClaims.sub === 'string' && idClaims.sub === atClaims.sub, `sub=${String(atClaims.sub)}`);
check('a refresh token came back too', refresh0.length > 40, shape(refresh0));
check('the PKCE verifier is inside the RFC 7636 window (43..128 unreserved chars)', isPkceVerifier(auth.verifier), `${String(auth.verifier.length)} chars`);
check('the response leaks no token into an unrelated field', !Object.entries(tokens).some(([k, v]) => k !== 'access_token' && v === at), `keys: ${Object.keys(tokens).join(', ')}`);

const expiresIn = Number(tokens.expires_in);
const refreshExpiresIn = Number(tokens.refresh_expires_in);
const exp = Number(atClaims.exp);
const iat = Number(atClaims.iat);
check('expires_in agrees with the token\'s own exp-iat (derive from claims, never hard-code)',
  Number.isFinite(expiresIn) && Number.isFinite(exp) && Math.abs((exp - iat) - expiresIn) <= 5, `expires_in=${tokens.expires_in}, exp-iat=${String(exp - iat)}`);
check('refresh_expires_in outlives expires_in, so there IS a refresh window', refreshExpiresIn > expiresIn, `refresh_expires_in=${tokens.refresh_expires_in} vs expires_in=${tokens.expires_in}`);
// The schedule a UI must run: derived from THIS response's expires_in, never from a number in a source file.
const skew = refreshSkewSeconds(expiresIn);
check('the derived refresh skew is inside the token window (a schedule that fires after expiry is no schedule)',
  skew > 0 && skew < expiresIn, `expires_in=${String(expiresIn)}s -> refresh ${String(skew)}s early (${String(PKCE_METHOD)} PKCE client, attribute "${PKCE_CHALLENGE_ATTRIBUTE}")`);

/* ------------------------------------------------------------------ D */
section('D. the refusals that make the code, the verifier and the audience mean something');
{
  const reuse = await exchange(auth.code!, auth.verifier);
  check('(b) the authorization code cannot be used twice', reuse.status >= 400 && !reuse.j.access_token, `HTTP ${String(reuse.status)} ${errOf(reuse.j) || '(no error named)'}`);

  const c2 = await authorize();
  const noVerifier = await exchange(c2.code ?? 'no-code', c2.verifier, { code_verifier: '' });
  check('(c) the exchange FAILS without the verifier -- PKCE is enforced, not decorative', noVerifier.status >= 400 && !noVerifier.j.access_token,
    c2.code ? `HTTP ${String(noVerifier.status)} ${errOf(noVerifier.j)}` : `could not mint a code: ${JSON.stringify(c2.params).slice(0, 120)}`);
  check('and the refusal names PKCE, so it is not some unrelated 400 passing the test', /PKCE|code verifier/i.test(errOf(noVerifier.j)), errOf(noVerifier.j));

  const c3 = await authorize();
  const wrong = await exchange(c3.code ?? 'no-code', newVerifier());
  check('the exchange fails with a DIFFERENT verifier', wrong.status >= 400 && !wrong.j.access_token, c3.code ? `HTTP ${String(wrong.status)} ${errOf(wrong.j)}` : 'could not mint a code');

  const c4 = await authorize();
  const wrongRedirect = c4.code ? await exchange(c4.code, c4.verifier, { redirect_uri: `${uiOrigin}/elsewhere` }) : { status: 0, j: {} as Record<string, unknown> };
  check('the exchange is bound to the redirect_uri the code was issued for', wrongRedirect.status >= 400 && !wrongRedirect.j.access_token,
    c4.code ? `HTTP ${String(wrongRedirect.status)} ${errOf(wrongRedirect.j)}` : 'could not mint a code');

  const c5 = await authorize();
  const asOtherClient = c5.code ? await asJson(await postForm(disc.token_endpoint, { grant_type: 'authorization_code', client_id: API_CLIENT, code: c5.code, redirect_uri: redirectUri, code_verifier: c5.verifier })) : { status: 0, j: {} as Record<string, unknown> };
  check('a code minted for platfolio-web cannot be redeemed as platfolio-api', asOtherClient.status >= 400 && !asOtherClient.j.access_token,
    c5.code ? `HTTP ${String(asOtherClient.status)} ${errOf(asOtherClient.j)}` : 'could not mint a code');

  const forged = (() => {
    const [h, p, s] = at.split('.');
    const mid = Math.floor((s ?? '').length / 2);
    const cand = (s ?? '').slice(0, mid) + ((s ?? '')[mid] === 'Q' ? 'R' : 'Q') + (s ?? '').slice(mid + 1);
    const dec = (x: string) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
    return { token: `${h}.${p}.${cand}`, changed: dec(s ?? '') !== dec(cand) };
  })();
  if (forged.changed) {
    const no = await callApi('/api/v1/whoami', forged.token);
    check('the SAME access token with a mid-signature byte flipped is refused', no.status === 401, `HTTP ${String(no.status)} ${no.text.slice(0, 90)}`);
  } else {
    notRun('the SAME access token with a mid-signature byte flipped is refused', 'the flip decoded to identical bytes -- no forgery existed to test (see smoke-identity.ts on why this is refused rather than passed)');
  }
}

section('D2. the public client is refused every grant that needs a secret');
{
  const ropc = await asJson(await postForm(disc.token_endpoint, { grant_type: 'password', client_id: WEB_CLIENT, username: flags.user as string, password: flags.password as string }));
  check('ROPC (grant_type=password) is REFUSED for the browser client', ropc.status >= 400 && !ropc.j.access_token, `HTTP ${String(ropc.status)} ${errOf(ropc.j)}`);
  const cc = await asJson(await postForm(disc.token_endpoint, { grant_type: 'client_credentials', client_id: WEB_CLIENT }));
  check('client_credentials is REFUSED for the browser client', cc.status >= 400 && !cc.j.access_token, `HTTP ${String(cc.status)} ${errOf(cc.j)}`);
  const secretAttempt = await authorize();
  const withSecret = secretAttempt.code ? await exchange(secretAttempt.code, secretAttempt.verifier, { client_secret: 'anything-at-all' }) : { status: 0, j: {} as Record<string, unknown> };
  // Asserted as the measured fact, not as a tautology. A bogus secret that CHANGED the outcome would mean the
  // realm treats the field as a credential for a public client -- which is how "just put the secret in the
  // bundle" starts to look reasonable again. It does not: the exchange behaves identically with and without it.
  check('a bogus client_secret changes nothing at the token endpoint (public clients are not authenticated)',
    secretAttempt.code !== undefined && withSecret.status === 200 && withSecret.j.access_token !== undefined,
    secretAttempt.code ? `HTTP ${String(withSecret.status)} with client_secret=anything-at-all -- ignored, not honoured` : `could not mint a code: ${JSON.stringify(secretAttempt.params).slice(0, 100)}`);
  const bogus = await exchange('not-a-real-code', newVerifier());
  check('an unknown code is refused', bogus.status >= 400, `HTTP ${String(bogus.status)} ${errOf(bogus.j)}`);
}

section('D3. the browser token is accepted by the real control plane (read-only cross-check)');
{
  const who = await callApi('/api/v1/whoami', at);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(who.text) as Record<string, unknown>; } catch { /* reported below */ }
  check('(e) /api/v1/whoami accepts a PKCE-minted token', who.status === 200, `HTTP ${String(who.status)} ${who.text.slice(0, 150)}`);
  check('whoami names the BROWSER client as the caller', body.clientId === WEB_CLIENT, `clientId=${String(body.clientId)}`);
  check('whoami reports the verified subject', body.subject === atClaims.sub, `subject=${String(body.subject)}`);
  check('whoami reports this realm as the issuer', body.issuer === issuer, `issuer=${String(body.issuer)}`);
  check('whoami carries the required scope through', JSON.stringify(body.scope) === JSON.stringify([REQUIRED_SCOPE]), `scope=${JSON.stringify(body.scope)}`);
  check('whoami asserts tenantAuthority false', body.tenantAuthority === false, `tenantAuthority=${String(body.tenantAuthority)}`);
  check('whoami echoes NO token material', !who.text.includes(at.slice(0, 20)) && !('access_token' in body) && !('refresh_token' in body), `keys: ${Object.keys(body).join(', ')}`);
  const asRefresh = await callApi('/api/v1/whoami', refresh0);
  check('(D4) a REFRESH token presented as a bearer credential is refused', asRefresh.status === 401, `HTTP ${String(asRefresh.status)} ${asRefresh.text.slice(0, 110)}`);
  const asId = await callApi('/api/v1/whoami', idToken);
  check('an ID token presented as a bearer credential is refused too', asId.status === 401, `HTTP ${String(asId.status)} ${asId.text.slice(0, 110)}`);

  // Same path, different principal: the browser client is not a way around the scope check.
  const saved = new Map(jar);
  jar.clear();
  const ns = await authorize({ user: 'no-scope' });
  const nsTok = ns.code ? await exchange(ns.code, ns.verifier) : { status: 0, j: {} as Record<string, unknown> };
  const nsAt = (nsTok.j as Record<string, string>).access_token;
  if (nsAt) {
    const denied = await callApi('/api/v1/whoami', nsAt);
    check('a PKCE token for a user WITHOUT the role is 403, not 200', denied.status === 403, `HTTP ${String(denied.status)} ${denied.text.slice(0, 100)}`);
    const scopeClaim = JSON.stringify(claimsOf(nsAt).scope ?? null);
    check('because the token genuinely lacks the scope (not because the API is arbitrary)', scopeClaim === 'null' || !scopeClaim.includes(REQUIRED_SCOPE), `scope=${scopeClaim}`);
  } else {
    notRun('a PKCE token for a user WITHOUT the role is 403, not 200', 'the no-scope user could not complete the PKCE flow -- run pnpm run identity:seed');
  }
  jar.clear();
  for (const [k, v] of saved) jar.set(k, v);
}

section('D4. refresh: it works, and what rotation ACTUALLY did in this realm');
{
  const r1 = await refreshWith(refresh0);
  const t1 = r1.j as Record<string, string>;
  check('(d) the refresh token renews the access token with no browser round trip', r1.status === 200 && typeof t1.access_token === 'string', `HTTP ${String(r1.status)} ${r1.status === 200 ? shape(t1.access_token ?? "") : errOf(r1.j)}`);
  const t1Claims = claimsOf(t1.access_token ?? '');
  check('the refreshed access token carries this realm and the API audience', t1Claims.iss === issuer && (Array.isArray(t1Claims.aud) ? (t1Claims.aud as string[]).includes(API_CLIENT) : t1Claims.aud === API_CLIENT), `iss=${String(t1Claims.iss)} aud=${JSON.stringify(t1Claims.aud)}`);
  check('the refreshed token keeps the scope (a refresh must not quietly narrow it)', JSON.stringify(t1Claims.scope) === JSON.stringify([REQUIRED_SCOPE]), `scope=${JSON.stringify(t1Claims.scope)}`);
  check('the refresh response re-states expires_in, so the schedule is re-derived every time', Number.isFinite(Number(t1.expires_in)) && Number(t1.expires_in) > 0, `expires_in=${String(t1.expires_in)}`);
  check('the refreshed access token is accepted by the control plane', (await callApi('/api/v1/whoami', t1.access_token ?? '')).status === 200, 'see (e) above for the shape');
  const rotated = typeof t1.refresh_token === 'string' && t1.refresh_token !== refresh0;
  check('(d) the refresh token ROTATES: the client must replace its copy on every refresh', rotated,
    rotated ? `new refresh token ${shape(t1.refresh_token ?? '')}` : 'the realm handed back the SAME refresh token -- rotation is off, so a stolen one is indistinguishable from the live one');
  if (rotated) {
    const oldAgain = await refreshWith(refresh0);
    record('reuse of the SUPERSEDED refresh token (reported, never assumed)', 'pass',
      oldAgain.status === 200
        ? `the OLD refresh token STILL WORKS: revokeRefreshToken is off -- rotation is hygiene, not theft detection (header §2). Re-enable it in the realm if the hosted box wants reuse detection`
        : `the old refresh token is refused (${errOf(oldAgain.j)}) -- one-time-use rotation is live`);
    const newAgain = await refreshWith(t1.refresh_token ?? '');
    check('the NEWEST refresh token still works whatever the old one did', newAgain.status === 200, `HTTP ${String(newAgain.status)} ${errOf(newAgain.j)}`);
  }
  const corrupt = await refreshWith('not.a.refresh');
  check('a corrupt refresh token is refused rather than tolerated', corrupt.status >= 400, `HTTP ${String(corrupt.status)} ${errOf(corrupt.j)}`);
  const wrongClient = await asJson(await postForm(disc.token_endpoint, { grant_type: 'refresh_token', client_id: 'some-other-client', refresh_token: refresh0 }));
  check('a refresh token cannot be presented under a different client_id', wrongClient.status >= 400, `HTTP ${String(wrongClient.status)} ${errOf(wrongClient.j)}`);
}

section('D5. logout: exercised end to end, including what it does NOT undo');
{
  const live = await callApi('/api/v1/whoami', at);
  const lo = await getRaw(endSessionUrl({ endSessionEndpoint: disc.end_session_endpoint, idToken, postLogoutRedirectUri: redirectUri, clientId: WEB_CLIENT }));
  const back = lo.headers.get('location');
  check('(f) the end_session call was accepted and returned to the registered redirect', (lo.status === 302 || lo.status === 200) && (back === null || back.startsWith(uiOrigin)),
    `HTTP ${String(lo.status)} location=${String(back)}`);
  const afterRefresh = await refreshWith(refresh0);
  check('(f) after logout the refresh token is DEAD', afterRefresh.status >= 400 && !afterRefresh.j.access_token, `HTTP ${String(afterRefresh.status)} ${errOf(afterRefresh.j)}`);
  const ui = await fetch(disc.userinfo_endpoint, { headers: { authorization: `Bearer ${at}` } });
  check('after logout the access token no longer reaches /userinfo (it is session-backed)', ui.status === 401, `HTTP ${String(ui.status)}`);
  const afterWho = await callApi('/api/v1/whoami', at);
  check('the ACCESS token still verifies until exp -- by design, and the reason the lifespan is short',
    afterWho.status === 200 && live.status === 200,
    `HTTP ${String(afterWho.status)}; an access token is a claim, not a lease. Instant revocation would need a live-token table on every request, which is the database D4 forbids here`);
  const reauth = await authorize();
  check('a new authorize after logout asks for credentials again (the IdP session really ended)', reauth.loginPageShown,
    reauth.loginPageShown ? 'login form served again' : `silent re-authentication: the session outlived end_session (code issued: ${String(reauth.code !== undefined)})`);
}

/* ------------------------------------------------------------------ E */
section('E. what the realm actually holds (Admin API read-back)');
{
  const adminResp = await asJson(await postForm(`${idp}/realms/master/protocol/openid-connect/token`, { grant_type: 'password', client_id: 'admin-cli', username: flags['admin-user'] as string, password: flags['admin-password'] as string }));
  const admin = (adminResp.j as Record<string, string>).access_token;
  if (!admin) {
    notRun('the realm holds platfolio-web in the shape the seed claims', `no master-realm admin token (HTTP ${String(adminResp.status)} ${errOf(adminResp.j)}) -- on the hosted box this is #248. The flow above still proves the BEHAVIOUR; this section proves the SHAPE`);
  } else {
    const AH = { authorization: `Bearer ${admin}` };
    const found = await (await fetch(`${idp}/admin/realms/${realm}/clients?clientId=${WEB_CLIENT}`, { headers: AH })).json() as Array<{ id: string }>;
    const webId = found[0]?.id;
    if (!webId) {
      check(`the realm holds ${WEB_CLIENT}`, false, `clientId=${WEB_CLIENT} not found -- run pnpm run identity:seed`);
    } else {
      const c = (await (await fetch(`${idp}/admin/realms/${realm}/clients/${webId}`, { headers: AH })).json()) as Record<string, unknown>;
      const attrs = (c.attributes ?? {}) as Record<string, string>;
      const redirects = (c.redirectUris ?? []) as string[];
      check('read-back: public client, standard flow, and nothing else', c.publicClient === true && c.standardFlowEnabled === true
        && c.directAccessGrantsEnabled === false && c.implicitFlowEnabled === false && c.serviceAccountsEnabled === false && c.bearerOnly === false,
        `public=${String(c.publicClient)} standard=${String(c.standardFlowEnabled)} ropc=${String(c.directAccessGrantsEnabled)} implicit=${String(c.implicitFlowEnabled)} sa=${String(c.serviceAccountsEnabled)} bearerOnly=${String(c.bearerOnly)}`);
      check('read-back: PKCE S256 is MANDATORY (attributes["pkce.code.challenge.method"])', attrs['pkce.code.challenge.method'] === 'S256',
        `attribute=${JSON.stringify(attrs['pkce.code.challenge.method'])} -- blank means "PKCE optional", which is the bug this guards`);
      check('read-back: redirect URIs are exact, one per UI origin, no wildcard', JSON.stringify([...redirects].sort()) === JSON.stringify([redirectUri]) && !redirects.some((u) => u.includes('*')),
        `redirectUris=${JSON.stringify(redirects)}`);
      check('read-back: webOrigins match the redirect origins', JSON.stringify(c.webOrigins) === JSON.stringify([uiOrigin]), `webOrigins=${JSON.stringify(c.webOrigins)}`);
      check('read-back: the browser client holds NO secret', typeof c.secret !== 'string' || c.secret.length === 0,
        typeof c.secret === 'string' ? 'A SECRET IS PRESENT -- a public client must not have one' : 'no secret field on the representation');
      check('read-back: fullScopeAllowed is off, so the token carries one role by construction', c.fullScopeAllowed === false, `fullScopeAllowed=${String(c.fullScopeAllowed)}`);
      const mappers = (await (await fetch(`${idp}/admin/realms/${realm}/clients/${webId}/protocol-mappers/models`, { headers: AH })).json()) as Array<Record<string, any>>;
      const wantMappers = browserClientMappers();
      for (const want of wantMappers) {
        const got = mappers.find((x) => x.name === want.name);
        check(`read-back: mapper ${want.name} says what the contract says`, got !== undefined && Object.entries(want.config).every(([k, v]) => got?.config?.[k] === v),
          got ? `server: ${JSON.stringify(got.config)}` : 'mapper absent on the client');
      }
      check('read-back: no mapper beyond the two the contract names', mappers.length === wantMappers.length,
        `server holds ${JSON.stringify(mappers.map((m) => m.name))}`);
      const apiLookup = (await (await fetch(`${idp}/admin/realms/${realm}/clients?clientId=${API_CLIENT}`, { headers: AH })).json()) as Array<{ id: string }>;
      const apiId = apiLookup[0]?.id;
      const scopeMap = apiId ? ((await (await fetch(`${idp}/admin/realms/${realm}/clients/${webId}/scope-mappings/clients/${apiId}`, { headers: AH })).json()) as Array<{ name: string }>) : [];
      check('read-back: the one role is in this client\'s role SCOPE (fullScopeAllowed is off)', scopeMap.some((r) => r.name === REQUIRED_SCOPE),
        `scope mappings: ${JSON.stringify(scopeMap.map((r) => r.name))}`);
      const apiFound = (await (await fetch(`${idp}/admin/realms/${realm}/clients?clientId=${API_CLIENT}`, { headers: AH })).json()) as Array<{ id: string }>;
      const apiRep = apiFound[0]?.id ? ((await (await fetch(`${idp}/admin/realms/${realm}/clients/${apiFound[0].id}`, { headers: AH })).json()) as Record<string, unknown>) : {};
      check('the confidential client is STILL confidential (untouched by the browser work)', apiRep.publicClient === false && apiRep.directAccessGrantsEnabled === true && typeof apiRep.secret === 'string',
        `public=${String(apiRep.publicClient)} ropc=${String(apiRep.directAccessGrantsEnabled)} secret=${typeof apiRep.secret === 'string' ? 'present, not printed' : 'ABSENT'} -- and no browser may ever hold it`);
    }
  }
}

/* ------------------------------------------------------------------ F */
section('F. cross-realm: a browser token from another realm is refused here');
{
  // Same client id, same redirect URI, same role name, different realm: Keycloak scopes clients per realm
  // (D56), so this is the shape of "one tenant's browser session arriving at another tenant's control plane".
  // The refusal must come from the issuer and its key set, not from a client id that happens to match.
  const peer = process.env.KC_PEER_REALM;
  if (!peer) {
    notRun('a platfolio-web token from ANOTHER realm is refused', 'KC_PEER_REALM is unset. Seed the peer realm (identity:seed --realm=…) and point this run at it; on the hosted box the credential that made this checkable is what #248 removed');
  } else {
    let peerDisc: Discovery | undefined;
    try {
      const pr = await fetch(`${idp}/realms/${peer}/.well-known/openid-configuration`);
      if (!pr.ok) throw new Error(`HTTP ${String(pr.status)}`);
      peerDisc = (await pr.json()) as Discovery;
    } catch (error) {
      notRun('a platfolio-web token from ANOTHER realm is refused', `the peer realm ${peer} served no discovery document (${(error as Error).message})`);
    }
    if (peerDisc) {
      jar.clear();
      const pv = newVerifier();
      const pu = new URL(peerDisc.authorization_endpoint);
      pu.searchParams.set('client_id', WEB_CLIENT);
      pu.searchParams.set('redirect_uri', redirectUri);
      pu.searchParams.set('response_type', 'code');
      pu.searchParams.set('scope', LOGIN_SCOPES);
      pu.searchParams.set('state', 'peer');
      pu.searchParams.set('code_challenge', await challengeFor(pv));
      pu.searchParams.set('code_challenge_method', 'S256');
      let pr = await getRaw(pu.toString());
      const html = await pr.text();
      const action = /<form id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
      if (action) {
        pr = await fetch(action.replace(/&amp;/g, '&'), { method: 'POST', redirect: 'manual', headers: { ...cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: process.env.KC_PEER_USER ?? (flags.user as string), password: process.env.KC_PEER_USER_PASSWORD ?? (flags.password as string), credentialId: '', login: 'Sign In' }) });
        saveCookies(pr);
      }
      const peerCode = pr.headers.get('location') ? new URL(pr.headers.get('location')!, idp).searchParams.get('code') : null;
      const peerTok = peerCode ? await asJson(await postForm(peerDisc.token_endpoint, { grant_type: 'authorization_code', client_id: WEB_CLIENT, code: peerCode, redirect_uri: redirectUri, code_verifier: pv })) : { status: 0, j: {} as Record<string, unknown> };
      const peerAt = (peerTok.j as Record<string, string>).access_token;
      if (!peerAt) {
        notRun('a platfolio-web token from ANOTHER realm is refused', `no PKCE token could be minted in ${peer}: ${peerCode ? `token endpoint HTTP ${String(peerTok.status)} ${errOf(peerTok.j)}` : 'no authorization code came back -- is platfolio-web seeded there with this redirect URI?'}`);
      } else {
        const cross = await callApi('/api/v1/whoami', peerAt);
        const refusedAs = /unauthenticated:([\w-]+)/.exec(cross.text)?.[1] ?? 'none';
        check('a platfolio-web token from ANOTHER realm is refused', cross.status === 401 && refusedAs !== 'none',
          `HTTP ${String(cross.status)} refused as ${refusedAs} (peer iss=${String(claimsOf(peerAt).iss)}; same client id, same role name, different realm -- D56)`);
      }
    }
  }
}

function report(): never {
  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'not-run');
  const passed = results.filter((r) => r.status === 'pass');
  process.stdout.write(`S ${String(passed.length)}/${String(results.length)} checks passed, ${String(failed.length)} failed, ${String(skipped.length)} not run\n`);
  // A check that could not run is not a pass, and it does not exit 0. Same ruling as identity:smoke on an
  // unset KC_PEER_REALM ("the check did not run, and is not skipped"): a suite that is green because the
  // interesting assertion stayed quiet is the exact failure mode this project keeps paying to remove.
  for (const s of skipped) process.stdout.write(`S NOT RUN: ${s.name} -- ${s.detail}\n`);
  if (skipped.length > 0) {
    process.stdout.write(`S to run everything locally: pnpm run identity:seed --realm=platfolio-staging && KC_PEER_REALM=platfolio-staging pnpm run identity:pkce:smoke\n`);
  }
  process.exit(failed.length === 0 && skipped.length === 0 ? 0 : 1);
}
report();
