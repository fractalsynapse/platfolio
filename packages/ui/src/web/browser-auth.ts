/**
 * The browser's side of the `platfolio-web` PKCE flow, as the SDK's `AuthSource` (D65; 11 §6; 07 §identity).
 *
 * ## Why this file exists and what it refuses to be
 *
 * `packages/ui/src/sdk/transport.ts` declares `AuthSource { token(): Promise<string> }` and says the shell
 * injects it. Until now the only implementation of that seam in this repository was the operator's double in
 * `scripts/browser-auth.ts`, which is Node-only: it imports `node:crypto` for the S256 digest and `yaml` to read
 * the composition. A browser has neither, and a second definition of the same policy in `web/` would be exactly
 * the defect this repository names — "if a change would create a second copy of a fact, fix the ownership
 * instead of adding a file and keeping them in step" (AGENTS.md). So this file **imports the policy** from
 * `scripts/browser-auth.ts` — the client id, the scope, the callback path, `TOKEN_STORAGE`, `RECOMMENDED_STORE`,
 * `refreshSkewSeconds`, `refreshAt`, `endSessionUrl`, `LOGOUT_CLEAR`, `isPkceVerifier`, `PKCE_METHOD` — and
 * supplies only what a browser must supply itself: WebCrypto for the digest, and an injected requester for the
 * network. The parity test (`packages/ui/test/browser-auth-parity.test.ts`) proves the browser's S256 and the
 * script's S256 agree, and that none of the imported words changed meaning on the way.
 *
 * ## Three rules this file is written to keep
 *
 * **D4/D53 — platfolio holds no credential, and neither does this file.** Tokens live in a module-scope bag
 * because `TOKEN_STORAGE` says `inMemory: true` and `localStorage`/`sessionStorage`/`cookie` are all `false`, for
 * access, refresh and id tokens alike. The consequence is stated rather than hidden: a page reload loses the
 * session and the person signs in again. That is the policy's cost, chosen deliberately over the alternative
 * (`docs/design/07` and the smoke script's lifecycle section), and an island that quietly cached a token to avoid
 * it would be violating the single source this file is built on. `LOGOUT_CLEAR` is what `signOut()` empties,
 * item by item, and the list is imported, not retyped.
 *
 * **The verifier is a redirect handoff, not a store.** PKCE needs `code_verifier` to survive the navigation from
 * `/dashboard` to the issuer and back to `/callback`, and a module-scope bag cannot survive a navigation. So the
 * pair is written to `sessionStorage` — the *only* thing this file persists — read **once**, and deleted before
 * the exchange starts. It is not a token: it grants nothing without the single-use code that arrives beside it,
 * and it has no value after the exchange. `TOKEN_STORAGE` does not enumerate it, and this is the one place the
 * browser code decides something the policy file is silent about. Flagged for the maintainer in this change's
 * report rather than settled here.
 *
 * **§9.2 — no `fetch`, no timer, no ambient browser object in `packages/ui`.** This is inside the declared web
 * boundary, where `window`/`sessionStorage` are permitted by the gate; `fetch(` and `setTimeout(` are not
 * permitted *anywhere* in this package outside `sdk/poll.ts` and the freshness primitives (11 §9.2), and this
 * file does not use them. The token endpoint is reached through an injected `IssuerRequest`, and the refresh
 * schedule is *computed* by the imported `refreshAt` and *armed* by whoever holds a timer — the shell. So
 * `token()` answers from the bag, reports the moment it decided the bag was too old, and never schedules
 * anything. `test/no-polling-outside-freshness.test.ts` keeps that promise honest.
 *
 * ## What is NOT here
 *
 * No refresh-token rotation handling beyond storing what the realm returns; no silent-session iframe; no
 * custom-paths discovery document (Keycloak's realm URL determines the endpoints here, because the realm URL is
 * the configuration the deploy supplies). No UI: this file is auth plumbing, and `/callback` is its only caller.
 */
import {
  CALLBACK_PATH,
  LOGOUT_CLEAR,
  PKCE_METHOD,
  RECOMMENDED_STORE,
  REQUIRED_SCOPE,
  TOKEN_STORAGE,
  WEB_CLIENT_ID,
  endSessionUrl,
  isPkceVerifier,
  refreshAt,
  type PkcePair,
  type StorageLocation,
  type TokenKind,
} from './browser-auth-policy.ts';
/**
 * The three things a browser needs that the policy module cannot supply, because it deliberately performs no
 * I/O and touches no browser global. The rest of the policy comes from there, unchanged.
 */
/** The digest half of PKCE. `node:crypto` has it as `createHash`; a browser has it as `crypto.subtle.digest`. */
export type Digest = (bytes: Uint8Array) => Promise<Uint8Array>;

/** The network half. The shell injects `fetch`, so this package never calls it (11 §9.2's transport rule). */
export interface IssuerResponse {
  readonly status: number;
  readonly body: string;
}
export type IssuerRequest = (url: string, form: Readonly<Record<string, string>>) => Promise<IssuerResponse>;

/** Entropy for the verifier and `state`. `crypto.getRandomValues` in a browser; the test injects a fixed one. */
export type RandomBytes = (length: number) => Uint8Array;

/** Where the one-use handoff lives. `sessionStorage` in a browser; a `Map` in a test. */
export interface HandoffStore {
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  drop(key: string): void;
}

export interface BrowserAuthConfig {
  /** `https://<issuer-host>/realms/<realm>` — for example Keycloak's realm URL. Never a committed value (D47). */
  readonly issuerBaseUrl: string;
  /** `https://<this site's origin>` — the redirect base, so the callback path stays one spelling (CALLBACK_PATH). */
  readonly siteOrigin: string;
  /** Defaults to the policy's `platfolio-web`. A deploy that renamed its client supplies the name, not a fork. */
  readonly clientId?: string;
  readonly scope?: string;
}

export interface TokenSet {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly refresh_expires_in?: number;
}

interface Held {
  access: string;
  /** Epoch ms at which `token()` stops trusting the access token, from the imported `refreshAt`. */
  refreshAtMs: number | undefined;
  /**
   * Epoch ms at which the realm itself says the access token dies (`expires_in` from its own response).
   *
   * This is not a second clock and not new policy: `refreshAtMs` is the *warning*, and without the deadline the
   * warning was the only bound — a realm answering `refresh_expires_in: 0` produced no schedule at all, so
   * `token()` would hand over an expired bearer forever and every API call came back 401 with the UI reporting an
   * outage. The deadline is the fact that closes that hole, and it is read from the response, never assumed.
   */
  expiresAtMs: number | undefined;
  idToken: string | undefined;
  refresh: string | undefined;
}

/** The bag `TOKEN_STORAGE` permits: memory, and nothing else. */
export interface TokenBag {
  readonly location: StorageLocation;
  get(): Held | undefined;
  set(tokens: TokenSet, nowMs: number): void;
  /** Empties the bag and reports the item names from `LOGOUT_CLEAR` that were cleared, for the caller's UI. */
  clear(): readonly string[];
}

/** The endpoints a Keycloak realm URL determines. Discovery would be nicer; the realm URL is what the deploy carries. */
export interface IssuerEndpoints {
  readonly authorize: string;
  readonly token: string;
  readonly endSession: string;
}

export function endpointsForIssuer(issuerBaseUrl: string): IssuerEndpoints {
  const base = new URL(issuerBaseUrl); // throws on a relative value, which is the configuration failure to report
  return {
    authorize: `${base.origin}${base.pathname.replace(/\/$/, '')}/protocol/openid-connect/auth`,
    token: `${base.origin}${base.pathname.replace(/\/$/, '')}/protocol/openid-connect/token`,
    endSession: `${base.origin}${base.pathname.replace(/\/$/, '')}/protocol/openid-connect/logout`,
  };
}

/**
 * The base64url of the S256 digest of the ASCII verifier — the same transformation
 * `scripts/browser-auth.ts`'s `codeChallenge` performs with `createHash`, computed with whatever digest the
 * caller has. `packages/ui/test/browser-auth-parity.test.ts` compares the two over fixed verifiers.
 */
export async function pkceChallengeWith(digest: Digest, verifier: string): Promise<PkcePair> {
  const bytes = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) bytes[i] = verifier.charCodeAt(i) & 0x7f; // ASCII, as RFC 7636 §4.2 says
  const hash = await digest(bytes);
  return { verifier, challenge: base64Url(hash), method: PKCE_METHOD };
}

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * A verifier from injected entropy, in the form the imported `isPkceVerifier` predicate accepts.
 *
 * The alphabet is the RFC 7636 unreserved set, so the browser and the script produce values the same predicate
 * judges. 64 characters is 48 bytes' worth of entropy over 66 symbols, and the predicate's floor is 43.
 */
export function createVerifierWith(random: RandomBytes, length = 64): string {
  const bytes = random(length);
  if (bytes.length < length) {
    // Not a nitpick about the shape of the alphabet: with the padding this used to do (`bytes[i] ?? 0`), an entropy
    // source that handed back 43 bytes for a 64-byte request produced a verifier whose last 21 characters were
    // always `A`, and `isPkceVerifier` was delighted with it. A weak verifier is indistinguishable from a strong
    // one in every log and every gate, which is the flipped-signature lesson (11 §identity: a check that sometimes
    // tests nothing is worse than no check, because it is trusted). Refuse the RNG instead.
    throw new TypeError(`the entropy source returned ${String(bytes.length)} bytes when ${String(length)} were asked for`);
  }
  let out = '';
  for (let i = 0; i < length; i++) out += UNRESERVED[(bytes[i] ?? 0) % UNRESERVED.length];
  if (!isPkceVerifier(out)) throw new TypeError('the entropy produced a string that is not a PKCE verifier');
  return out;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createTokenBag(): TokenBag {
  let held: Held | undefined;
  return {
    // Read off the policy's own recommendation, so a change there is a change here (D47's one-spelling rule).
    location: RECOMMENDED_STORE,
    get: () => held,
    set: (tokens, nowMs) => {
      // `exactOptionalPropertyTypes` is why this branch exists rather than a one-line call: the realm omits
      // `refresh_expires_in` when it says nothing, and `refreshAt` reads an *absent* field as "no opinion" and a
      // present `0` as "the refresh window is closed". Passing `undefined` through would collapse those two
      // answers into one, and the second one is the case that must not schedule a timer.
      const window = tokens.refresh_expires_in === undefined
        ? { nowMs, expiresIn: tokens.expires_in }
        : { nowMs, expiresIn: tokens.expires_in, refreshExpiresIn: tokens.refresh_expires_in };
      held = {
        access: tokens.access_token,
        refreshAtMs: refreshAt(window),
        expiresAtMs: Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? nowMs + tokens.expires_in * 1000 : undefined,
        idToken: tokens.id_token,
        refresh: tokens.refresh_token,
      };
    },
    clear: () => {
      // `LOGOUT_CLEAR` is the enumeration of what a platfolio client must clear. Only the items this bag can
      // actually hold come back as cleared; the timer and the retry queue belong to whoever armed them.
      held = undefined;
      return LOGOUT_CLEAR.filter((item) => /token|claims/i.test(item));
    },
  };
}

export interface BrowserAuthSource {
  /** The `AuthSource` the SDK consumes. */
  readonly token: () => Promise<string>;
  readonly begin: () => Promise<string>;
  readonly complete: (params: URLSearchParams) => Promise<'signed-in' | 'no-handoff' | 'state-mismatch' | 'refused'>;
  readonly refresh: () => Promise<'refreshed' | 'no-refresh-token' | 'refused'>;
  readonly signedIn: () => boolean;
  /** The URL a person should land on after the issuer ends the session; the bag is emptied first. */
  readonly signOut: () => string | undefined;
  readonly clearedOnSignOut: () => readonly string[];
  readonly config: { readonly clientId: string; readonly scope: string; readonly callbackUrl: string };
}

/**
 * The `AuthSource` the island hands the SDK, built from the imported policy plus three injected capabilities.
 *
 * `token()` refuses to be optimistic: with no access token it asks the realm to refresh (the only silent path
 * there is), and when the bag says the token is at or past the imported `refreshAt` moment it refreshes before
 * handing it over. A refresh failure surfaces as a rejected promise, which the SDK turns into an `Error` result
 * with the age beside it — never a silent retry, and never a stale token handed out as if it were fresh.
 */
export function createBrowserAuthSource(
  config: BrowserAuthConfig,
  deps: { request: IssuerRequest; digest: Digest; random: RandomBytes; handoff: HandoffStore; now?: () => number },
): BrowserAuthSource {
  const clientId = config.clientId ?? WEB_CLIENT_ID;
  const scope = config.scope ?? REQUIRED_SCOPE;
  const endpoints = endpointsForIssuer(config.issuerBaseUrl);
  const now = deps.now ?? (() => Date.now());
  const bag = createTokenBag();
  const callbackUrl = `${config.siteOrigin.replace(/\/$/, '')}${CALLBACK_PATH}`;
  const HANDOFF = { verifier: 'platfolio.pkce.verifier', state: 'platfolio.pkce.state' } as const;
  let cleared: readonly string[] = [];

  const post = async (form: Readonly<Record<string, string>>): Promise<TokenSet> => {
    const response = await deps.request(endpoints.token, form);
    if (response.status !== 200) throw new Error(`the issuer refused the token exchange (${String(response.status)})`);
    return JSON.parse(response.body) as TokenSet;
  };

  /**
   * The refresh, hoisted out of the object below so `token()` can call it without reaching for `this`.
   *
   * A method on an object literal that calls `this.other()` is a promise about how the object is invoked: hand
   * `source.token` to the SDK as a bare function — which is exactly what `SdkContextValue.auth` is, an
   * `AuthSource` whose `token()` the transport calls — and `this` is undefined at the call site. The failure
   * would land as a `TypeError` inside a request rather than as an auth answer, in the one path a person cannot
   * retry their way out of. A closed-over function has no receiver to lose.
   */
  const refreshSession = async (): Promise<'refreshed' | 'no-refresh-token' | 'refused'> => {
    const held = bag.get();
    const refresh = held?.refresh;
    if (refresh === undefined) return 'no-refresh-token';
    try {
      const tokens = await post({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh });
      bag.set(tokens, now());
      return 'refreshed';
    } catch {
      // The realm said no. The bag keeps what it had, because an expired access token is still an *expired*
      // access token and reporting it as one is truer than reporting nothing at all.
      return 'refused';
    }
  };

  return {
    config: { clientId, scope, callbackUrl },
    begin: async () => {
      const verifier = createVerifierWith(deps.random);
      const pair = await pkceChallengeWith(deps.digest, verifier);
      const state = base64Url(deps.random(24));
      // The handoff is written, not kept: the navigation that follows discards this module's memory.
      deps.handoff.write(HANDOFF.verifier, pair.verifier);
      deps.handoff.write(HANDOFF.state, state);
      const authorize = new URL(endpoints.authorize);
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', callbackUrl);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('scope', scope);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('code_challenge_method', PKCE_METHOD);
      authorize.searchParams.set('code_challenge', pair.challenge);
      return authorize.toString();
    },
    complete: async (params) => {
      const state = params.get('state');
      const code = params.get('code');
      const storedState = deps.handoff.read(HANDOFF.state);
      deps.handoff.drop(HANDOFF.state);
      const verifier = deps.handoff.read(HANDOFF.verifier);
      deps.handoff.drop(HANDOFF.verifier); // read-once: the verifier is spent the moment it is read
      if (verifier === undefined || storedState === undefined) return 'no-handoff';
      if (state === null || state !== storedState) return 'state-mismatch';
      if (code === null || code === '') return 'refused';
      const pair = await pkceChallengeWith(deps.digest, verifier);
      const tokens = await post({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: callbackUrl,
        code_verifier: pair.verifier,
      });
      bag.set(tokens, now());
      return 'signed-in';
    },
    refresh: refreshSession,
    token: async () => {
      let held = bag.get();
      if (held === undefined) throw new Error('not signed in: the platfolio-web session bag is empty');
      // Two bounds, and they are not the same question. `refreshAtMs` is the warning the policy computes (a quarter
      // of the life, floored and capped), so a token that is merely *near* the end is replaced before the SDK's
      // request can fail on it. `expiresAtMs` is the realm's own deadline: past it the access token is dead, and
      // the warning is irrelevant — which is exactly the case a realm creates when it answers
      // `refresh_expires_in: 0` and the imported `refreshAt` therefore says "nothing to schedule". Without the
      // second bound `token()` would hand an expired bearer to the transport forever and every call would come back
      // 401, which a person reads as the platform being down rather than as their own session having ended.
      const expired = held.expiresAtMs !== undefined && now() >= held.expiresAtMs;
      const warned = held.refreshAtMs !== undefined && now() >= held.refreshAtMs;
      if (expired || warned) {
        const outcome = await refreshSession();
        if (outcome !== 'refreshed') {
          throw new Error(expired
            ? `the access token expired and the refresh returned ${outcome}`
            : `the access token aged out and the refresh returned ${outcome}`);
        }
        held = bag.get();
        if (held === undefined) throw new Error('the refresh cleared the session bag');
        // A refresh that produced a *still expired* answer is a realm telling us its own clock and ours disagree.
        // Saying so beats returning a token the very next call will reject.
        if (held.expiresAtMs !== undefined && now() >= held.expiresAtMs) {
          throw new Error('the issuer refreshed to a token that is already expired (check the realm clock against PLATFOLIO_IDENTITY_ISSUER)');
        }
        return held.access;
      }
      return held.access;
    },
    signedIn: () => bag.get() !== undefined,
    signOut: () => {
      const held = bag.get();
      cleared = bag.clear();
      if (held?.idToken === undefined) return undefined;
      return endSessionUrl({ endSessionEndpoint: endpoints.endSession, idToken: held.idToken, postLogoutRedirectUri: callbackUrl, clientId });
    },
    clearedOnSignOut: () => cleared,
  };
}

/** The policy this file imports, re-exported so a reviewer can see the shape of the rule at the import site. */
export const authPolicy = {
  webClient: WEB_CLIENT_ID,
  requiredScope: REQUIRED_SCOPE,
  callbackPath: CALLBACK_PATH,
  storage: TOKEN_STORAGE,
  store: RECOMMENDED_STORE,
  logoutClear: LOGOUT_CLEAR,
  kinds: Object.keys(TOKEN_STORAGE) as TokenKind[],
} as const;
