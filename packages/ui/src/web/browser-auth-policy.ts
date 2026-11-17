/**
 * The browser's authentication policy: the subset of `scripts/browser-auth.ts` a client bundle may carry.
 *
 * ## Why the split, and which line it follows
 *
 * `scripts/browser-auth.ts` is the operator's file. It opens with `node:crypto` and `yaml`, writes a realm client
 * and drives the flow from a shell, and its own header states the consequence: *"nothing a deployed service
 * imports may depend on this file."* Until D65 there was no deployed UI to test that sentence. The first
 * `astro build` of the dashboard island did, and it failed exactly where the sentence points: a client bundle
 * that reaches the operator script reaches `node:crypto`, and Vite refuses to answer for it
 * (`"createHash" is not exported by "__vite-browser-external"` — measured, and the reason this file exists).
 *
 * So the declarations divide along the line the dependency direction already drew. **What a browser must obey is
 * here** — the client's name, its scope, its callback path, the PKCE method, where a token may live, when to
 * refresh, what logout clears, which field names would mean a credential is arriving. **What an operator writes
 * into a realm stays in the script** — `BrowserClientShape`, the protocol mappers, the composition readers,
 * `createPkcePair`/`codeChallenge` with their `node:crypto`, and the audit allowlist. The script imports and
 * re-exports everything below, so its three existing consumers (the seeder, the smoke run,
 * `packages/contracts/test/browser-auth.test.ts`) still read one name for one fact, and `packages/contracts/test/
 * browser-auth-parity.test.ts` is the gate that refuses a fourth spelling.
 *
 * The direction matters twice over: a script may depend on a package (every script here already does), a package
 * may not depend on a script. That is why the policy moved rather than the import, and why `packages/ui` needed
 * no new workspace edge to get it.
 *
 * ## The rules these declarations keep
 *
 * `TOKEN_STORAGE` is the single answer to "where may a platfolio token live in a browser", and it says `inMemory`
 * and nothing else. `RECOMMENDED_STORE` is that answer as a default. `LOGOUT_CLEAR` is the enumeration behind
 * "clear the session", item by item, because the phrase without a list is a guess. `refreshSkewSeconds` and
 * `refreshAt` are the refresh window, floored and capped so neither a 3-second lifespan nor a 12-hour one produces
 * a nonsense timer. `isTokenShapedName` is D4 as a predicate: the names that would make a field a place a
 * credential is being asked to go.
 *
 * Nothing here performs I/O, holds a timer, or touches a browser global — 11 §9.2 refuses `fetch(`/`setTimeout(`
 * anywhere in this package outside `sdk/poll.ts` and the freshness primitives, and a policy file that needed them
 * would have to be excused, which is how an exception becomes a door. `endSessionUrl` builds a string; whoever
 * owns the navigation uses it.
 */

export const WEB_CLIENT_ID = 'platfolio-web';
export const API_CLIENT_ID = 'platfolio-api';
export const REQUIRED_SCOPE = 'platfolio.user';
/** The path the UI signs in from. Derived from the origin so seed, smoke and UI agree on one string. */
export const CALLBACK_PATH = '/callback';

/**
 * The PKCE method `platfolio-web` must be enrolled in.
 *
 * Its companion — the client *attribute* that makes the method mandatory, `pkce.code.challenge.method` — stays in
 * the operator's file. Measured on Keycloak 26.8.2: a top-level `pkceCodeChallengeMethod` on a client PUT is
 * refused outright, while `attributes["pkce.code.challenge.method"] = "S256"` persists and is enforced at `/auth`.
 * The browser does not write client representations, so it needs the method and not the field name.
 */
export const PKCE_METHOD = 'S256';

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: typeof PKCE_METHOD;
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
