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

/**
 * The one thing a platfolio browser client may persist, and the one reason it may — **D67**.
 *
 * `TOKEN_STORAGE` answers where a *token* may live and its answer is `inMemory`, only. It said nothing about the
 * PKCE verifier and the `state` value, and those two cannot be answered the same way: PKCE requires
 * `code_verifier` to survive the navigation from `/dashboard` to the issuer and back to `/callback`, and a
 * module-scope bag does not survive a navigation. Before this declaration the silence was filled locally in
 * `web/browser-auth.ts`, which had picked `sessionStorage` on its own — a decision with no owner, which is the
 * shape this repository keeps meeting, and the one the maintainer was asked about and answered.
 *
 * **The shipped behaviour is the decision.** The pair is written to `sessionStorage`, read **once**, and deleted
 * **before the exchange is attempted**. Its cost is accepted here rather than discovered later: a person who
 * reloads mid-session signs in again, because the session was never in storage and the handoff that was is spent
 * — one extra round trip to the issuer. What it buys is the invariant: nothing credential-shaped persists in a
 * browser platfolio does not administer (D4, D53, rule 4), and a verifier that has been read grants nothing
 * without the single-use code that arrives beside it, which the realm has already spent.
 *
 * Two alternatives were refused, not deferred, and the refusals are mechanical rather than rhetorical:
 *
 *  - **A cookie — for the verifier, and a fortiori for a token.** The transport never emits
 *    `access-control-allow-credentials`, and that is tested on both sides of the seam
 *    (`packages/kernel/test/cors.test.ts`, `apps/control-plane/test/cors.test.ts`), because bearer-token auth must
 *    not admit a visitor's ambient cookies to every origin on the list. A cookie-holding client would be asking the
 *    platform to change its CORS posture to buy the UI a convenience, and a persisted `access_token`/`refresh_token`
 *    collides head-on with `TOKEN_STORAGE`, which is the invariant, not a default to route around.
 *  - **`localStorage`.** It outlives the tab. A single-use value in a store that survives the session that minted
 *    it is a replayable constant sitting where every extension on that origin can read it.
 *
 * The limit of the decision, stated because `sessionStorage` is still browser-persistent state: anything that can
 * run script on this origin can read the pair before it is spent. This choice bounds *lifetime* (one tab, one
 * navigation, spent on read) and *kind* (a handoff, never a token); it does not mitigate an injected script, and
 * the mitigation for that is rule 6's build-time registry and the refusal of runtime-loaded code, not a storage class.
 *
 * The key names live here so there is one spelling of them; `web/browser-auth.ts` used to own them locally.
 */
export const HANDOFF_KEYS = { verifier: 'platfolio.pkce.verifier', state: 'platfolio.pkce.state' } as const;

/** The policy as data, so a test can refuse a new spelling instead of reading a comment. */
export const HANDOFF_STORAGE = {
  verifier: { sessionStorage: true, localStorage: false, cookie: false, platfolioDatabase: false, reads: 'once', dropped: 'before the exchange' },
  state: { sessionStorage: true, localStorage: false, cookie: false, platfolioDatabase: false, reads: 'once', dropped: 'before the exchange' },
} as const;

export type HandoffField = keyof typeof HANDOFF_STORAGE;

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
 * D4, as a predicate over names: the names that would make an API field a place a token could arrive.
 *
 * The API may legitimately carry the words `token` in `livenessToken` (a build digest) and `not-before-policy`
 * (Keycloak's own), so the rule is on the SHAPE of the name rather than on the word: anything naming an access,
 * refresh or bearer token, or a client secret, is a place a credential is being asked to go.
 *
 * There is deliberately no *value* predicate beside this one, and the reason is measured rather than philosophical.
 * A test in `packages/ui/test/browser-auth-parity.test.ts` used to refuse any persisted value that looked like a
 * token by shape (`^eyJ`, or two 20-character base64url runs around a dot). PKCE verifiers are drawn from the
 * RFC 7636 unreserved set — `A–Z a–z 0–9 - . _ ~` — so a verifier *is* a dotted string: over 2,000 verifiers
 * generated by `createVerifierWith`, 1,084 contained a dot and **222 matched the old shape test** while being
 * perfectly valid verifiers (an example: `R.ets_BImSC3NzWd1XybK8YMRirkdi-GI683lwkAGH2fwr.X4t9ZjNEuFTTT2Yjy`).
 * That is an 11% false-refusal rate on the flow's own happy path, which is why the suite went red one run in
 * three with nothing changed. A rewrite that required three segments (`eyJ…\\.…\\.…`) was *worse* — 319 of 2,000 —
 * because the alphabet makes a JWT's shape a coincidence rather than a signal.
 *
 * What cannot be told apart by shape has to be pinned by identity, and that is what the test does now: the
 * handoff may hold only the two keys named below, what sits under the verifier key must satisfy
 * `isPkceVerifier`, what sits under the state key must be the opaque base64url value that was sent, and no value
 * in the store may equal a token the issuer handed back. `TOKEN_STORAGE` is still the reason a token has no
 * legal place in any browser store; this is the assertion that notices if one arrives anyway.
 */
export function isTokenShapedName(name: string): boolean {
  return /^(access_?token|refresh_?token|id_?token|bearer_?token|client_?secret|code_?verifier|token)$/.test(name.trim().toLowerCase());
}
