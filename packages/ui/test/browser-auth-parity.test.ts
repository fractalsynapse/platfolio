import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  CALLBACK_PATH,
  HANDOFF_KEYS,
  HANDOFF_STORAGE,
  LOGOUT_CLEAR,
  PKCE_METHOD,
  RECOMMENDED_STORE,
  REQUIRED_SCOPE,
  LOGIN_SCOPES,
  TOKEN_STORAGE,
  WEB_CLIENT_ID,
  codeChallenge,
  createPkcePair,
  endSessionUrl,
  isPkceVerifier,
  refreshAt,
  refreshSkewSeconds,
} from '../../../scripts/browser-auth.ts';
import {
  authPolicy,
  createBrowserAuthSource,
  createVerifierWith,
  endpointsForIssuer,
  pkceChallengeWith,
  type Digest,
  type HandoffStore,
  type IssuerResponse,
} from '../src/index.ts';

/**
 * The auth seam is one policy, not two (D65; `scripts/browser-auth.ts` is the single source of truth).
 *
 * `packages/ui/src/web/browser-auth.ts` implements `AuthSource` for a browser — the file this repository's history
 * tells you to distrust, because it is a second place a credential-shaped flow can be written down, inside a
 * package whose tests have never touched a network. Two defences, and they fail differently, so there are two:
 *
 * **One: the data has one home.** The browser module *imports* `WEB_CLIENT_ID`, `REQUIRED_SCOPE`, `PKCE_METHOD`,
 * `CALLBACK_PATH`, `TOKEN_STORAGE`, `RECOMMENDED_STORE`, `LOGOUT_CLEAR`, `refreshAt` (whose own maths calls
 * `endSessionUrl` and `isPkceVerifier`. "Imports" is checked here over the source text, in both directions: the
 * import list must still name them, and none of their *values* may appear as a literal in that file. A fork does
 * not announce itself — it is invisible to every other gate in the repository until someone renames a realm client
 * and the UI keeps sending the old name, so the assertion is on the spelling, not on the intent.
 *
 * **Two: the wire agrees.** Node and a browser reach the same primitives by different doors (`createHash` versus
 * `crypto.subtle.digest`, `randomBytes` versus `crypto.getRandomValues`), and only a test can say the answers are
 * equal. So the digest is an injected interface, and one verifier goes through both implementations: three fixed
 * inputs and 64 random ones, plus the endpoint paths and the refresh moment.
 *
 * **What is NOT proved, stated because the gap is the interesting part.** No Keycloak was contacted and no browser
 * ran. The exchange is driven by an injected requester returning canned bodies, so this file proves shape,
 * ordering and refusal semantics — never that a hosted realm accepts them. `pnpm run identity:pkce:smoke` is the
 * check that does the latter, and it needs a running issuer; `platfolio-web` exists in both hosted realms and has
 * never been exercised against a live UI (AGENTS.md, §identity).
 */

const ISSUER = 'https://auth.platfolio.example/realms/platfolio';
const ORIGIN = 'https://platfolio.example';
const WEB_SOURCE = fs.readFileSync(new URL('../src/web/browser-auth.ts', import.meta.url), 'utf8');

/** Node 22's WebCrypto, through the global: the same object a browser hands to `crypto.subtle`. */
const nodeDigest: Digest = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));

interface Harness {
  readonly source: ReturnType<typeof createBrowserAuthSource>;
  readonly requests: { url: string; form: Record<string, string> }[];
  readonly store: Map<string, string>;
}

const harness = (options: { responses?: IssuerResponse[]; now?: () => number } = {}): Harness => {
  const store = new Map<string, string>();
  const requests: Harness['requests'] = [];
  const queue = [...(options.responses ?? [])];
  const source = createBrowserAuthSource(
    { issuerBaseUrl: ISSUER, siteOrigin: ORIGIN },
    {
      digest: nodeDigest,
      random: (length) => new Uint8Array(randomBytes(length)),
      handoff: {
        read: (key) => store.get(key),
        write: (key, value) => store.set(key, value),
        drop: (key) => { store.delete(key); },
      },
      request: async (url, form) => {
        requests.push({ url, form: { ...form } });
        return queue.shift() ?? { status: 200, body: JSON.stringify({ access_token: 'AT', expires_in: 300, refresh_token: 'RT', id_token: 'IT' }) };
      },
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
  return { source, requests, store };
};

/** Sign in through the harness and hand back the state the flow wrote, so a test can complete it honestly. */
const signIn = async (h: Harness): Promise<string> => {
  const url = new URL(await h.source.begin());
  const state = url.searchParams.get('state') ?? '';
  assert.equal(await h.source.complete(new URLSearchParams({ code: 'CODE', state })), 'signed-in');
  return state;
};

/* ------------------------------------------------------------------ one: one home for the data */

test('the browser module imports the policy and restates none of it', () => {
  const code = WEB_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const name of ['WEB_CLIENT_ID', 'REQUIRED_SCOPE', 'PKCE_METHOD', 'CALLBACK_PATH', 'TOKEN_STORAGE', 'RECOMMENDED_STORE', 'LOGOUT_CLEAR', 'refreshAt', 'endSessionUrl', 'isPkceVerifier', 'HANDOFF_KEYS']) {
    assert.ok(code.includes(name), `browser-auth.ts no longer mentions ${name}: either the policy moved again, or this file is now the second definition of it`);
  }
  assert.match(code, /from '\.\/browser-auth-policy\.ts'/, 'browser-auth.ts must read the policy module rather than a copy of it');
  assert.ok(!code.includes('scripts/browser-auth.ts'), 'the browser module must not import the operator script: that import reaches node:crypto, and the client bundle fails at the first honest astro build (measured, and the reason browser-auth-policy.ts exists)');

  // The literals are the tell. A value written here is a second spelling of something the realm is configured
  // from, and the pair drift one rename apart from a login that dies at the authorization endpoint.
  for (const literal of ["'platfolio-web'", "'platfolio.user'", "'S256'", "'/callback'", "'inMemory'", "'platfolio.pkce.verifier'", "'platfolio.pkce.state'"]) {
    assert.ok(!code.includes(literal), `browser-auth.ts carries the literal ${literal} — that value belongs to the policy module and is imported (one fact, one home)`);
  }
});

/**
 * D67: the handoff is a policy answer, not a local one.
 *
 * The two values that survive the redirect are the PKCE verifier and `state`. Before D67 the policy module
 * enumerated access, refresh and id tokens and said nothing about them, so the browser file decided the question
 * in a comment — the shape this repository keeps meeting: one fact, two owners, and the drift is invisible until
 * a login breaks. These assertions are the durable form of the decision: the *where* is data, and a test refuses
 * a widening of it, exactly as `TOKEN_STORAGE` is refused a widening above.
 */
test('the handoff policy says single-use sessionStorage, and nothing wider (D67)', () => {
  assert.deepEqual(HANDOFF_KEYS, { verifier: 'platfolio.pkce.verifier', state: 'platfolio.pkce.state' }, 'the key names are the policy\'s, and a rename here is a rename nobody can find');
  for (const field of ['verifier', 'state'] as const) {
    const places = HANDOFF_STORAGE[field];
    assert.equal(places.sessionStorage, true, `${field}: the handoff must survive the navigation, and sessionStorage is the only place it may`);
    for (const forbidden of ['localStorage', 'cookie', 'platfolioDatabase'] as const) {
      assert.equal(places[forbidden], false, `${field} may live in ${forbidden}: a store that outlives the session that minted the value is a replayable constant, and a cookie asks the platform to loosen a CORS posture it refuses on purpose`);
    }
    assert.equal(places.reads, 'once', `${field}: read-once is what makes the handoff spent rather than kept`);
    assert.equal(places.dropped, 'before the exchange', `${field}: dropped after the read means the retry has nothing to replay`);
  }

  // And the pair is not a token: the two tables answer different questions and must stay different.
  for (const kind of Object.keys(TOKEN_STORAGE) as (keyof typeof TOKEN_STORAGE)[]) {
    for (const field of ['verifier', 'state'] as const) {
      assert.notEqual(TOKEN_STORAGE[kind].sessionStorage, HANDOFF_STORAGE[field].sessionStorage,
        `TOKEN_STORAGE.${kind}.sessionStorage and HANDOFF_STORAGE.${field}.sessionStorage now agree, which means one of them stopped answering its own question`);
    }
  }
});

/**
 * The reload, modelled honestly: one tab, so the store survives; one page life, so the token bag does not.
 *
 * `sessionStorage` outlives a reload in the same tab, so the tempting sentence — "a reload discards the
 * verifier" — is false, and this test does not assert it. What is true, and what D67 accepts as the cost, is
 * that the *bag* is module scope (`TOKEN_STORAGE`: `inMemory` only), so a reload has no session to reuse and the
 * person signs in again. Both moments are pinned here: the reload that lands on `/callback` before the exchange
 * (the handoff must still work — that is the whole reason it is persisted) and the reload after it (nothing is
 * left to reuse, and a spent handoff cannot be redeemed a second time).
 */
test('a reload re-authenticates: the session never persisted, and the spent handoff cannot be redeemed twice (D67)', async () => {
  // One Map, shared by both page lives: the tab survives, the module does not.
  const store = new Map<string, string>();
  const handoff: HandoffStore = {
    read: (key) => store.get(key),
    write: (key, value) => { store.set(key, value); },
    drop: (key) => { store.delete(key); },
  };
  const requests: Record<string, string>[] = [];
  const overTheSameTab = () => createBrowserAuthSource(
    { issuerBaseUrl: ISSUER, siteOrigin: ORIGIN },
    {
      digest: nodeDigest,
      random: (length) => new Uint8Array(randomBytes(length)),
      handoff,
      request: async (_url, form) => {
        requests.push({ ...form });
        return { status: 200, body: JSON.stringify({ access_token: 'AT', expires_in: 300, refresh_token: 'RT', id_token: 'IT' }) };
      },
    },
  );

  // 1. Sign in, and note the two values the tab is holding.
  const before = overTheSameTab();
  const authorize = new URL(await before.begin());
  const state = authorize.searchParams.get('state') ?? '';
  assert.equal(store.get(HANDOFF_KEYS.verifier) === undefined, false, 'the verifier is in the tab before the redirect is answered');
  assert.equal(await before.complete(new URLSearchParams({ code: 'CODE', state })), 'signed-in');
  assert.equal(store.size, 0, 'a completed exchange leaves the tab holding nothing — not the verifier, not the state, and never a token');
  assert.equal(before.signedIn(), true);

  // 2. The reload: a new page life over the same tab. The session is gone because it was never persisted, so the
  // shell has to authenticate again rather than discover a credential it was told not to keep.
  const after = overTheSameTab();
  assert.equal(after.signedIn(), false, 'a reload does not silently reuse a session: the bag is module scope (TOKEN_STORAGE), so the person signs in again');
  await assert.rejects(() => after.token(), /not signed in/, 'the refusal is named, not a silent empty dashboard');
  assert.equal(await after.complete(new URLSearchParams({ code: 'CODE', state })), 'no-handoff', 'the spent handoff is gone, so a replayed callback redeems nothing');
  assert.equal(requests.length, 1, 'and the refusal above reached no endpoint: one exchange per earned code (the second request would be the replay this spends prevents)');

  // 3. A reload *mid-flow* — the case the persistence exists for. The handoff survives, the exchange runs once.
  const mid = overTheSameTab();
  const midAuthorize = new URL(await mid.begin());
  const midState = midAuthorize.searchParams.get('state') ?? '';
  const midVerifier = store.get(HANDOFF_KEYS.verifier);
  assert.ok(midVerifier !== undefined && isPkceVerifier(midVerifier), 'the verifier is in the tab while the person is at the issuer');
  const reloadedMidFlow = overTheSameTab();
  assert.equal(await reloadedMidFlow.complete(new URLSearchParams({ code: 'CODE2', state: midState })), 'signed-in', 'the page that comes back after a reload can still finish the flow it started');
  assert.equal(store.get(HANDOFF_KEYS.verifier), undefined, 'and it is spent on that read: the next reload re-authenticates instead of reusing it');
  assert.equal(reloadedMidFlow.signedIn(), true);
  assert.ok(requests.at(-1)!.code_verifier === midVerifier, 'the verifier that reached the realm is the one the tab was holding, read once');
});

test('the policy the browser exports is the operator policy, value for value', () => {
  assert.equal(authPolicy.webClient, WEB_CLIENT_ID);
  assert.equal(authPolicy.requiredScope, REQUIRED_SCOPE);
  assert.equal(authPolicy.callbackPath, CALLBACK_PATH);
  assert.deepEqual(authPolicy.storage, TOKEN_STORAGE);
  assert.equal(authPolicy.store, RECOMMENDED_STORE);
  assert.deepEqual([...LOGOUT_CLEAR], [...authPolicy.logoutClear]);

  for (const kind of authPolicy.kinds) {
    const places = TOKEN_STORAGE[kind];
    assert.equal(places.inMemory, true, `${kind}: inMemory is the one location a platfolio token may live in`);
    for (const forbidden of ['localStorage', 'sessionStorage', 'cookie', 'platfolioDatabase'] as const) {
      assert.equal(places[forbidden], false, `${kind} may live in ${forbidden}: D4/D53 and 11 §5 say a credential is not browser-persistent`);
    }
  }
});

/* ------------------------------------------------------------------ two: the wire agrees */

test('the browser S256 equals the operator S256, on fixed verifiers and on 64 random ones', async () => {
  for (const verifier of ['a'.repeat(48), 'B'.repeat(64), 'pQ3-_~rT'.repeat(8)]) {
    const viaWeb = await pkceChallengeWith(nodeDigest, verifier);
    assert.equal(viaWeb.challenge, codeChallenge(verifier), 'the two digest paths disagree — a browser that sends a challenge its own verifier does not produce fails at the realm, not here');
    assert.equal(viaWeb.method, PKCE_METHOD);
    assert.equal(viaWeb.verifier, verifier, 'the pair keeps the verifier it was given rather than inventing one');
  }
  for (let i = 0; i < 64; i++) {
    const verifier = Buffer.from(randomBytes(48)).toString('base64url');
    assert.equal((await pkceChallengeWith(nodeDigest, verifier)).challenge, codeChallenge(verifier));
  }
  // And the digest path is not quietly a no-op: a different verifier must give a different challenge.
  assert.notEqual((await pkceChallengeWith(nodeDigest, 'a'.repeat(48))).challenge, (await pkceChallengeWith(nodeDigest, 'b'.repeat(48))).challenge);
});

test('a verifier built from browser entropy satisfies the operator predicate, and the predicate still bites', () => {
  const random = (length: number): Uint8Array => new Uint8Array(randomBytes(length));
  for (let i = 0; i < 200; i++) {
    const verifier = createVerifierWith(random);
    assert.equal(verifier.length, 64);
    assert.ok(isPkceVerifier(verifier), `createVerifierWith produced something the operator predicate refuses: ${verifier}`);
  }
  assert.ok(isPkceVerifier(createPkcePair().verifier), 'the script pair and the browser pair are judged by one window, not two');
  assert.ok(!isPkceVerifier('a'.repeat(42)), 'the predicate stopped refusing a short verifier, so the check above is decoration');
  assert.ok(!isPkceVerifier('a'.repeat(129)), 'the predicate stopped refusing an over-long verifier, same reason');
  assert.throws(() => createVerifierWith(() => new Uint8Array(43)), /returned 43 bytes when 64 were asked for/, 'an entropy source that under-delivers must not be padded into a weak-but-valid-looking verifier');
});

test('the endpoints a realm URL determines are the OIDC paths the operator scripts use', () => {
  const endpoints = endpointsForIssuer(ISSUER);
  assert.equal(endpoints.authorize, `${ISSUER}/protocol/openid-connect/auth`);
  assert.equal(endpoints.token, `${ISSUER}/protocol/openid-connect/token`);
  assert.equal(endpoints.endSession, `${ISSUER}/protocol/openid-connect/logout`);
  assert.equal(endpointsForIssuer(`${ISSUER}/`).token, endpoints.token, 'a deploy that typed a trailing slash must not produce a different token endpoint');
  assert.throws(() => endpointsForIssuer('auth.platfolio.example/realms/platfolio'), TypeError, 'a relative issuer is a configuration failure, not something to resolve against the page');
});

/* ------------------------------------------------------------------ the flow, in the order it must happen */

test('sign-in writes the handoff, asks for the enrolled parameters, and opens no connection', async () => {
  const { source, requests, store } = harness();
  const authorize = new URL(await source.begin());

  assert.deepEqual(requests, [], 'begin() must not reach the token endpoint: a person is being sent to the issuer, not authenticated behind their back');
  assert.equal(`${authorize.origin}${authorize.pathname}`, `${ISSUER}/protocol/openid-connect/auth`, 'the authorize URL must be the realm path the operator scripts use');
  assert.equal(authorize.searchParams.get('client_id'), WEB_CLIENT_ID);
  assert.equal(authorize.searchParams.get('scope'), LOGIN_SCOPES);
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('code_challenge_method'), PKCE_METHOD);
  assert.equal(authorize.searchParams.get('redirect_uri'), `${ORIGIN}${CALLBACK_PATH}`, 'the realm admits <origin>/callback and nothing else (scripts/browser-auth.ts, seeded from PLATFOLIO_ALLOWED_ORIGINS)');
  assert.ok(isPkceVerifier(store.get(HANDOFF_KEYS.verifier) ?? ''), 'the handoff holds a verifier the realm will accept');
  assert.equal(authorize.searchParams.get('code_challenge'), codeChallenge(store.get(HANDOFF_KEYS.verifier) ?? ''), 'the challenge that leaves is the S256 of the verifier that stays');
  assert.ok((authorize.searchParams.get('state') ?? '').length >= 16);
});

test('the callback compares state before it redeems, and spends the verifier exactly once', async () => {
  const { source, requests, store } = harness();
  await source.begin();
  const verifier = 'unused';
  assert.equal(await source.complete(new URLSearchParams({ code: 'CODE', state: 'forged' })), 'state-mismatch');
  assert.deepEqual(requests, [], 'a state mismatch must never reach the token endpoint — exchanging a code the browser did not ask for is the exact attack the comparison exists to stop');
  assert.equal(store.get(HANDOFF_KEYS.verifier), undefined, 'a refused callback still spends the handoff, or the next one has a replayable verifier');
  assert.equal(store.get(HANDOFF_KEYS.state), undefined);
  assert.equal(source.signedIn(), false);
  assert.equal(verifier, 'unused');
});

test('a handoff that was never written is a refusal, not a quiet signed-out', async () => {
  const { source, requests } = harness();
  assert.equal(await source.complete(new URLSearchParams({ code: 'CODE', state: 'x' })), 'no-handoff');
  assert.deepEqual(requests, []);
});

test('the accepted exchange posts the grant the realm expects, with a client id and no secret', async () => {
  const { source, requests } = harness();
  await signIn({ source, requests, store: new Map() } as never).catch(() => undefined);
  const fresh = harness();
  const state = await signIn(fresh);
  assert.equal(state.length > 0, true);
  const exchange = fresh.requests[0]!;
  assert.equal(exchange.url, endpointsForIssuer(ISSUER).token);
  assert.equal(exchange.form.grant_type, 'authorization_code');
  assert.equal(exchange.form.client_id, WEB_CLIENT_ID);
  assert.ok(!('client_secret' in exchange.form), 'platfolio-web is a public PKCE client: a secret in this body contradicts the realm configuration and D4');
  assert.ok(isPkceVerifier(exchange.form.code_verifier ?? ''), 'the verifier travels to the issuer as itself');
  assert.equal(exchange.form.redirect_uri, `${ORIGIN}${CALLBACK_PATH}`);
  assert.equal(fresh.source.signedIn(), true);
});

test('a refused exchange leaves no half-built session', async () => {
  const { source, requests } = harness({ responses: [{ status: 400, body: '{"error":"invalid_grant"}' }] });
  const authorize = new URL(await source.begin());
  await assert.rejects(
    () => source.complete(new URLSearchParams({ code: 'CODE', state: authorize.searchParams.get('state') ?? '' })),
    /the issuer refused the token exchange \(400\)/,
  );
  assert.equal(source.signedIn(), false, 'a refused exchange must not leave a session the screen then renders as signed in');
  assert.equal(requests.length, 1);
});

/*
 * A verifier is a dotted string, so "does this look like a token?" cannot be answered by shape -- and the
 * suite said so one run in three.
 *
 * The assertion in the test below used to be `!/^eyJ/.test(value) && !/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/`,
 * on the theory that a JWT is recognizable and a verifier is not. Measured over 2,000 verifiers from
 * `createVerifierWith`: 1,084 contain a dot, and **222 matched the old shape test** -- an 11% false-refusal rate
 * on the flow's own happy path, because the RFC 7636 unreserved alphabet (`A–Z a–z 0–9 - . _ ~`) includes the
 * character that makes a JWT a JWT. Example, and it is a legitimate verifier:
 * `R.ets_BImSC3NzWd1XybK8YMRirkdi-GI683lwkAGH2fwr.X4t9ZjNEuFTTT2Yjy`.
 *
 * So the guard is by identity now, and this test pins the flake itself rather than the fix: it draws 2,000
 * verifiers and requires every one of them to pass the predicate the store asserts, and separately requires a
 * real three-segment JWT to be caught by the rule that actually catches it -- a value equal to one the issuer
 * handed back, or a key that is not one of the two handoff keys. If someone reintroduces a shape test here, the
 * 2,000-draw case goes red at about 11%, which is the point of drawing 2,000 instead of one.
 */
test('a verifier is not distinguishable from a token by shape, so the guard is identity (the 1-in-3 flake, pinned)', async () => {
  const OLD_SHAPE = (v: string): boolean => /^eyJ/.test(v) || /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(v);
  let shapedLikeAToken = 0;
  const drawn = 2000;
  for (let i = 0; i < drawn; i += 1) {
    const v = createVerifierWith((n) => new Uint8Array(randomBytes(n)));
    assert.ok(isPkceVerifier(v), `draw ${String(i)}: createVerifierWith emitted something the policy itself refuses`);
    if (OLD_SHAPE(v)) shapedLikeAToken += 1;
  }
  assert.ok(shapedLikeAToken > 0, `${String(drawn)} verifiers and not one looked like a JWT by the old rule -- the rule under test changed meaning`);
  // The measured flake rate, stated as a bound rather than a number to match: any nonzero count means a green
  // suite is a coin flip, and this is the assertion that keeps a shape guard from coming back.
  assert.ok(shapedLikeAToken / drawn < 0.5, `${String(shapedLikeAToken)}/${String(drawn)} verifiers matched the shape rule`);

  // And the guard that does work, exercised on the real flow: the two handoff keys, no other, and nothing the
  // issuer returned sitting under either of them.
  const issued = { access_token: 'AT', expires_in: 300, refresh_token: 'RT', id_token: 'IT' };
  const store = new Map<string, string>();
  const keysWritten: string[] = [];
  const valuesWritten: string[] = [];
  const source = createBrowserAuthSource(
    { issuerBaseUrl: ISSUER, siteOrigin: ORIGIN },
    {
      digest: nodeDigest,
      random: (length) => new Uint8Array(randomBytes(length)),
      handoff: {
        read: (key) => store.get(key),
        write: (key, value) => { keysWritten.push(key); valuesWritten.push(value); store.set(key, value); },
        drop: (key) => { store.delete(key); },
      },
      request: async () => ({ status: 200, body: JSON.stringify(issued) }),
    },
  );
  const authorize = new URL(await source.begin());
  await source.complete(new URLSearchParams({ code: 'CODE', state: authorize.searchParams.get('state') ?? '' }));

  assert.deepEqual([...new Set(keysWritten)].sort(), [...Object.values(HANDOFF_KEYS)].sort(),
    'only the two handoff keys may be written; a third key is where a token would arrive');
  for (const value of valuesWritten) {
    for (const token of [issued.access_token, issued.refresh_token, issued.id_token]) {
      assert.notEqual(value, token, `a value the issuer handed back was written into the handoff: ${token}`);
    }
  }
  assert.equal(store.size, 0, 'a completed exchange leaves the tab holding nothing');
});

/* ------------------------------------------------------------------ refresh, storage, logout */

test('token() refreshes on the imported schedule and never on a window the browser invented', async () => {
  const nowMs = 1_700_000_000_000;
  let clock = nowMs;
  const { source, requests } = harness({ now: () => clock });
  await signIn({ source, requests, store: new Map() } as never).catch(() => undefined);

  const fresh = harness({ now: () => clock });
  await signIn(fresh);
  const afterExchange = fresh.requests.length;

  // 300s life, imported skew 60s => the refresh moment is nowMs + 240_000. Both numbers come from the policy.
  assert.equal(refreshSkewSeconds(300), 60);
  assert.equal(refreshAt({ nowMs, expiresIn: 300 }), nowMs + 240_000);

  clock = nowMs + 120_000;
  assert.equal(await fresh.source.token(), 'AT', 'a token inside its window is handed over as it is; refreshing early turns every page load into a round trip');
  assert.equal(fresh.requests.length, afterExchange);

  clock = nowMs + 240_001;
  assert.equal(await fresh.source.token(), 'AT', 'after the imported moment the SDK is handed a token from the refresh, and the refresh grant is what opened the connection');
  assert.equal(fresh.requests.length, afterExchange + 1);
  assert.equal(fresh.requests.at(-1)!.form.grant_type, 'refresh_token');
  assert.equal(fresh.requests.at(-1)!.form.refresh_token, 'RT');
  void clock;
});

test('a realm that closes the refresh window yields no schedule, and the deadline is what refuses', async () => {
  assert.equal(refreshAt({ nowMs: 1000, expiresIn: 300, refreshExpiresIn: 0 }), undefined, 'refresh_expires_in: 0 means there is nothing to arm');
  const nowMs = 1_700_000_000_000;
  let clock = nowMs;
  const closed = harness({
    now: () => clock,
    responses: [
      { status: 200, body: JSON.stringify({ access_token: 'AT', expires_in: 300, refresh_expires_in: 0 }) },
      { status: 200, body: JSON.stringify({ access_token: 'SECOND', expires_in: 300, refresh_expires_in: 0 }) },
    ],
  });
  await signIn(closed);
  const opened = closed.requests.length;

  // Before the deadline the token is still what the realm issued. Refusing here would be inventing a failure the
  // issuer did not describe, and the screen would report an outage that has not happened.
  clock = nowMs + 299_000;
  assert.equal(await closed.source.token(), 'AT', 'a token inside its own lifetime is handed over as it is, refresh window closed or not');
  assert.equal(closed.requests.length, opened, 'and no request is opened on someone else\'s schedule');

  // Past it, the only honest answer is a refusal that says which bound it hit. This is the case the warning-only
  // design used to miss: with `refresh_expires_in: 0` the imported `refreshAt` schedules nothing at all, so a
  // deadline read from `expires_in` is the sole thing standing between the SDK and an endless stream of 401s.
  clock = nowMs + 300_001;
  await assert.rejects(() => closed.source.token(), /expired and the refresh returned no-refresh-token/);
  assert.equal(closed.requests.length, opened, 'the refusal is computed from the bag, not discovered by asking the realm a third time');
});

test('nothing token-shaped ever reaches the handoff store, and logout clears the enumerated items', async () => {
  const writes: string[] = [];
  const handoff = new Map<string, string>();
  // The stub issuer's own answer, held here so the spy can refuse it by identity. A name-shaped guard
  // (`isTokenShapedName`) cannot see a token under a neutral key; equality with what the realm actually
  // returned can, and that is the difference between a check and a heuristic.
  const tokens = { access_token: 'AT', expires_in: 300, refresh_token: 'RT', id_token: 'IT' };
  const spy: HandoffStore = {
    read: (key) => handoff.get(key),
    write: (key, value) => {
      writes.push(key);
      // Neither handoff value may be a token, and "is this a token?" is decided by identity, not by shape.
      //
      // This line used to read `!/^eyJ/.test(value) && !/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(value)`,
      // which is a coin flip: verifiers are drawn from the RFC 7636 unreserved set and that set *contains the
      // dot*, so ~11% of perfectly valid verifiers matched it (222 of 2,000 measured; see the test above this
      // one for the draw). The suite went red one run in three on unchanged code, and a security assertion that
      // fails at random is the flipped-signature defect arriving as an intermittent red instead of a vacuous
      // green -- same root, same reason it is written down rather than fixed silently.
      //
      // What refuses a token now: (1) the key set is exactly the two handoff keys, asserted after the flow runs;
      // (2) the value under the verifier key satisfies `isPkceVerifier`, and the value under the state key is the
      // opaque base64url that went out in the authorize URL -- so anything else is refused by *what it is*, not
      // by resemblance; and (3) no persisted value equals any token the stub issuer returned. The residual limit
      // is honest and unchanged from rule 4: a dot-free opaque token is not distinguishable from a verifier by
      // shape, which is why `TOKEN_STORAGE` -- inMemory for all three kinds -- is the invariant and this is the
      // tripwire beside it.
      // Widened on purpose, the way `placementProblem` widens `mustNotContain`: `HANDOFF_KEYS` is `as const`, so
      // `Object.values` gives a literal tuple and `.includes(key)` refuses the `string` the interface declares --
      // which is exactly the question this line asks, so the widening is the answer, not a suppression.
      assert.ok((Object.values(HANDOFF_KEYS) as readonly string[]).includes(key), `${key}: a value was written under a key that is not part of the PKCE handoff`);
      assert.notEqual(value, tokens.access_token, 'the access token was persisted');
      assert.notEqual(value, tokens.refresh_token, 'the refresh token was persisted');
      assert.notEqual(value, tokens.id_token, 'the id token was persisted');
      if (key === HANDOFF_KEYS.verifier) {
        assert.ok(isPkceVerifier(value), `${key}: what was persisted is not a PKCE verifier`);
      } else {
        assert.match(value, /^[A-Za-z0-9_-]{16,}$/, `${key}: the state must be the opaque base64url value, and that alphabet has no dot`);
      }
      handoff.set(key, value);
    },
    drop: (key) => { handoff.delete(key); },
  };
  const source = createBrowserAuthSource(
    { issuerBaseUrl: ISSUER, siteOrigin: ORIGIN },
    { digest: nodeDigest, random: (length) => new Uint8Array(randomBytes(length)), handoff: spy, request: async () => ({ status: 200, body: JSON.stringify(tokens) }) },
  );

  const authorize = new URL(await source.begin());
  await source.complete(new URLSearchParams({ code: 'CODE', state: authorize.searchParams.get('state') ?? '' }));
  assert.deepEqual([...new Set(writes)].sort(), [...Object.values(HANDOFF_KEYS)].sort(), 'the only browser-persisted values are the two single-use handoff fields; anything else in this list is a token in storage');

  const location = source.signOut();
  assert.ok(location !== undefined, 'a session with an id token must offer the provable logout (id_token_hint), not a clear-and-hope');
  assert.ok(location.startsWith(endpointsForIssuer(ISSUER).endSession));
  assert.equal(new URL(location).searchParams.get('post_logout_redirect_uri'), `${ORIGIN}${CALLBACK_PATH}`);
  assert.equal(new URL(location).searchParams.get('client_id'), WEB_CLIENT_ID);
  assert.deepEqual([...source.clearedOnSignOut()], [...LOGOUT_CLEAR.filter((item) => /token|claims/i.test(item))], 'logout clears the items this bag can actually hold, named from the policy (the timer and the retry queue belong to whoever arms them)');
  assert.equal(source.signedIn(), false);
  assert.equal(endSessionUrl({ endSessionEndpoint: endpointsForIssuer(ISSUER).endSession, idToken: 'IT', postLogoutRedirectUri: `${ORIGIN}${CALLBACK_PATH}`, clientId: WEB_CLIENT_ID }), location, 'the URL the browser builds is the operator function applied to the same inputs — no second logout shape');
  assert.equal(source.signOut(), undefined, 'signing out twice has nothing left to revoke, and must not invent an id_token_hint');
});

test('the browser never reaches for the network or a timer itself (§9.2, by construction and by text)', () => {
  const code = WEB_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bfetch\(/.test(code), 'a fetch in packages/ui outside sdk/poll.ts is gate §9.2\'s failure, and it would also be the second data path rule 1 refuses');
  assert.ok(!/setTimeout\(|setInterval\(/.test(code), 'the refresh schedule is computed by the imported refreshAt and armed by whoever owns a timer (11 §9.2: no timer-based polling outside the freshness primitive)');
  assert.ok(!/\bdocument\.|localStorage|\bnavigator\./.test(code), 'the handoff store is injected precisely so this file never names a storage API');
});
