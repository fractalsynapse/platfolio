/**
 * The browser-authentication contract, machine-checked.
 *
 * `scripts/smoke-browser-auth.ts` proves the flow against a running Keycloak and documents the token lifecycle
 * in its header. Documentation rots; this file does not let it quietly. Everything here runs with no network and
 * no container, because the claims are about SHAPE: what a platfolio browser client may be configured as, where
 * a token may live, how a refresh schedule is derived, and which names would let a credential into a place
 * platfolio has decided it cannot keep one (D4).
 *
 * The rules live in `scripts/browser-auth.ts` -- one definition, read by the seed that writes the realm client,
 * by the smoke that exercises it, and by this file. A second copy of the shape would be a second thing to keep
 * in step, and the last time this project kept two copies of a fact it drifted.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  API_CLIENT_ID,
  AUDIT_DETAIL_KEYS_ALLOWLIST,
  CALLBACK_PATH,
  PKCE_CHALLENGE_ATTRIBUTE,
  PKCE_METHOD,
  RECOMMENDED_STORE,
  REQUIRED_SCOPE,
  TOKEN_STORAGE,
  WEB_CLIENT_ID,
  browserClientMappers,
  browserClientShape,
  codeChallenge,
  createPkcePair,
  endSessionUrl,
  isPkceVerifier,
  isTokenShapedName,
  normalizeUiOrigins,
  refreshAt,
  refreshSkewSeconds,
} from '../../../scripts/browser-auth.ts';
import { redactCredentialShaped } from '../src/managed-action.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const shape = browserClientShape(['https://app.platfolio.dev', 'http://localhost:5173/']);

test('the browser client is a DIFFERENT client from the service client, and that separation is the point', () => {
  assert.notEqual(WEB_CLIENT_ID, API_CLIENT_ID);
  assert.equal(shape.clientId, WEB_CLIENT_ID);
  assert.equal(shape.publicClient, true, 'a browser cannot keep a secret, so the client is public -- by definition');
  assert.equal('secret' in shape, false, 'the shape must not carry a secret field at all, not even an empty one');
  assert.equal(shape.bearerOnly, false, 'bearer-only clients cannot start a login; that is platfolio-api, not the UI');
});

test('no password grant, no implicit grant, no client credentials on a public client', () => {
  // ROPC hands a user's password to whoever holds the client credentials. For a public client those
  // credentials ship in a JavaScript bundle, so enabling it would make every visitor a holder of a client that
  // can take password grants. Measured refusal: `400 unauthorized_client / Client not allowed for direct
  // access grants` (scripts/smoke-browser-auth.ts, section D2).
  assert.equal(shape.directAccessGrantsEnabled, false);
  // Tokens in a URL fragment reach history, logs and referrers.
  assert.equal(shape.implicitFlowEnabled, false);
  // A browser has no machine identity to assert. Measured: `401 Public client not allowed to retrieve service
  // account`.
  assert.equal(shape.serviceAccountsEnabled, false);
  // The one flow a browser may use.
  assert.equal(shape.standardFlowEnabled, true);
  assert.equal(shape.enabled, true);
  assert.equal(shape.protocol, 'openid-connect');
});

test('PKCE is MANDATORY, as a client attribute named exactly as Keycloak stores it', () => {
  assert.equal(shape.attributes[PKCE_CHALLENGE_ATTRIBUTE], PKCE_METHOD);
  // The trap this guards: the Server Administration Guide calls the control "PKCE method" and its BLANK value
  // means "PKCE is possible but not required". A client that merely accepts PKCE accepts an intercepted
  // authorization code too.
  assert.notEqual(shape.attributes[PKCE_CHALLENGE_ATTRIBUTE], undefined);
  assert.equal(shape.attributes['pkceCodeChallengeMethod'], undefined,
    'a top-level field of that name does not exist: the Admin API refuses it with "Unrecognized field" (measured 26.8.2)');
  assert.equal(PKCE_METHOD, 'S256', 'plain is the other legal value and it is the weaker one');
});

test('redirect URIs are exact, webOrigins match them, and no wildcard survives', () => {
  assert.deepEqual(shape.redirectUris, [`https://app.platfolio.dev${CALLBACK_PATH}`, `http://localhost:5173${CALLBACK_PATH}`]);
  assert.deepEqual(shape.webOrigins, ['https://app.platfolio.dev', 'http://localhost:5173']);
  for (const uri of shape.redirectUris) assert.ok(!uri.includes('*'), `wildcard redirect URI: ${uri}`);
  for (const uri of shape.redirectUris) assert.ok(shape.webOrigins.some((o) => uri.startsWith(`${o}/`)), `${uri} is outside every declared origin`);
  // Trailing slashes and duplicates are the same origin said twice; one spelling, one entry.
  assert.deepEqual(normalizeUiOrigins(['https://a.test/', 'https://a.test', ' https://b.test ']), ['https://a.test', 'https://b.test']);
});

test('an origin that cannot carry a code securely is refused, not warned about', () => {
  assert.throws(() => normalizeUiOrigins(['http://app.platfolio.dev']), /neither https nor loopback http/);
  assert.throws(() => normalizeUiOrigins(['https://app.platfolio.dev/ui?next=1']), /must be an origin/);
  assert.throws(() => normalizeUiOrigins(['ftp://app.platfolio.dev']), /neither https nor loopback http/);
  // Loopback http stays legal: this is the development stack, and refusing it would stop the local smoke.
  assert.deepEqual(normalizeUiOrigins(['http://localhost:5173', 'http://127.0.0.1:4173']), ['http://localhost:5173', 'http://127.0.0.1:4173']);
  assert.deepEqual(normalizeUiOrigins([]), [], 'no origins is a legal (and useless) input -- the caller decides whether to proceed');
});

test('the two mappers are what make a browser token usable by the API, without making the two clients alike', () => {
  const mappers = browserClientMappers();
  const audience = mappers.find((m) => m.protocolMapper === 'oidc-audience-mapper');
  const scopes = mappers.find((m) => m.protocolMapper === 'oidc-usermodel-client-role-mapper');
  assert.ok(audience && scopes, 'both mappers must exist');
  // The access token's `aud` is the RESOURCE client...
  assert.equal(audience!.config['included.custom.audience'], API_CLIENT_ID);
  assert.equal(audience!.config['access.token.claim'], 'true');
  assert.equal(audience!.config['included.client.audience'], undefined,
    'the conditional form would make the audience depend on a role the user may not hold');
  // ...while `azp` stays the browser client, so the API can tell a person from a machine in every audit row.
  assert.equal(scopes!.config['usermodel.clientRoleMapping.clientId'], API_CLIENT_ID, 'one role, held once, asserted by both paths');
  assert.equal(scopes!.config['claim.name'], 'scope');
  assert.equal(scopes!.config['multivalued'], 'true');
  assert.equal(scopes!.config['id.token.claim'], 'false', 'the ID token is profile, not an authorization surface');
  assert.equal(shape.fullScopeAllowed, false, 'full scope would let this client assert any role in the realm');
});

test('codeChallenge is the S256 transformation from RFC 7636 Appendix B, vector and all', () => {
  // The published test vector from the specification. If this ever fails, every PKCE claim in the project is
  // built on a homegrown hash -- and a homegrown hash is not PKCE.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(codeChallenge(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(isPkceVerifier(verifier), true);
});

test('a generated verifier is random, in range, and never the same twice', () => {
  const a = createPkcePair();
  const b = createPkcePair();
  assert.notEqual(a.verifier, b.verifier, 'two calls returned the same verifier -- the randomness is not random');
  assert.equal(a.method, PKCE_METHOD);
  for (const p of [a, b]) {
    assert.ok(isPkceVerifier(p.verifier), `verifier outside the unreserved 43..128 window: ${p.verifier.length} chars`);
    assert.equal(p.challenge, codeChallenge(p.verifier), 'the challenge must be the hash of THIS verifier');
    assert.notEqual(p.challenge, p.verifier, 'a challenge equal to the verifier is `plain`, which this realm refuses');
  }
  // The window is a specification boundary, not a style preference -- check both edges and both outsides.
  assert.equal(isPkceVerifier('a'.repeat(42)), false, '42 characters is under the RFC 7636 minimum and must not pass');
  assert.equal(isPkceVerifier('a'.repeat(43)), true);
  assert.equal(isPkceVerifier('a'.repeat(128)), true);
  assert.equal(isPkceVerifier('a'.repeat(129)), false);
  assert.equal(isPkceVerifier(`${'a'.repeat(43)}+`), false, 'base64 standard alphabet is not the unreserved set');
});

test('the refresh schedule is DERIVED from expires_in, bounded, and never hard-coded', () => {
  // Monotonic in the lifetime, capped so a long-lived realm still refreshes near its end rather than hours
  // early, floored so a short one does not spin.
  assert.equal(refreshSkewSeconds(300), 60);
  assert.equal(refreshSkewSeconds(60), 15);
  assert.equal(refreshSkewSeconds(12), 5, 'the floor: below 20 seconds a quarter of the window is under 5s');
  assert.equal(refreshSkewSeconds(43_200), 60, 'the cap: a 12-hour token does not get a 3-hour warning');
  assert.equal(refreshSkewSeconds(0), 0, 'no lifetime means nothing to schedule');
  assert.equal(refreshSkewSeconds(-5), 0);
  assert.equal(refreshSkewSeconds(Number.NaN), 0);
  assert.ok(refreshSkewSeconds(120) < refreshSkewSeconds(600), 'the skew must grow with the lifetime');
  assert.ok(refreshSkewSeconds(600) <= refreshSkewSeconds(601), 'and never shrink as the token lives longer');
});

test('refreshAt fires inside the token window, earlier with jitter, and not at all without a refresh path', () => {
  const now = 1_700_000_000_000;
  const plain = refreshAt({ nowMs: now, expiresIn: 300 });
  assert.ok(plain !== undefined && plain > now && plain < now + 300_000, 'refresh must land inside the lifetime');
  assert.equal(plain, now + (300 - refreshSkewSeconds(300)) * 1000);
  const jittered = refreshAt({ nowMs: now, expiresIn: 300, jitterRatio: 0.2 });
  assert.ok(jittered !== undefined && plain !== undefined && jittered <= plain, 'jitter moves the refresh EARLIER, never later');
  // A response that says there is no refresh window must not schedule a call that is going to fail.
  assert.equal(refreshAt({ nowMs: now, expiresIn: 300, refreshExpiresIn: 0 }), undefined);
  assert.equal(refreshAt({ nowMs: now, expiresIn: 0 }), undefined);
  // A pathological lifespan must not schedule in the past: a negative timer fires immediately and loops.
  const tiny = refreshAt({ nowMs: now, expiresIn: 2 });
  assert.ok(tiny !== undefined, 'a 2-second lifespan still has a window, however short');
  assert.ok(tiny >= now, `scheduled ${String(now - tiny)}ms in the past -- that is a refresh loop`);
});

test('where a token may live: in memory, and nowhere persistent (a bearer refresh token in localStorage is XSS-readable)', () => {
  const kinds = Object.keys(TOKEN_STORAGE) as Array<keyof typeof TOKEN_STORAGE>;
  assert.ok(kinds.includes('access') && kinds.includes('refresh') && kinds.includes('idToken'));
  assert.equal(RECOMMENDED_STORE, 'inMemory', 'the recommended default is the volatile one');
  for (const kind of kinds) {
    for (const [place, allowed] of Object.entries(TOKEN_STORAGE[kind])) {
      if (place === 'inMemory') { assert.equal(allowed, true, `${kind} must be holdable in memory`); continue; }
      // The claim, stated for each place rather than one: `localStorage` (and sessionStorage, IndexedDB, an
      // SPA-set cookie, and platfolio's own database) may not hold a token. For the refresh token the reason is
      // that any script the page runs can read it, and a bearer token needs nothing else to be USED.
      assert.equal(allowed, false, `${kind} is allowed in ${place} -- it should not be`);
    }
  }
});

test('logout is an OIDC end-session call, and it names the session it is ending', () => {
  const url = endSessionUrl({
    endSessionEndpoint: 'https://auth.platfolio.dev/realms/platfolio/protocol/openid-connect/logout',
    idToken: 'a.b.c',
    postLogoutRedirectUri: 'https://app.platfolio.dev/callback',
    clientId: WEB_CLIENT_ID,
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('id_token_hint'), 'a.b.c', 'without id_token_hint the call cannot name a session');
  assert.equal(parsed.searchParams.get('post_logout_redirect_uri'), 'https://app.platfolio.dev/callback');
  assert.equal(parsed.searchParams.get('client_id'), WEB_CLIENT_ID);
  assert.ok(!url.includes('refresh_token'), 'the deprecated refresh_token+client_id logout is not the contract');
});

test('token-shaped names are recognised, and ordinary names are not', () => {
  for (const name of ['refresh_token', 'refreshToken', 'access_token', 'accessToken', 'id_token', 'bearer_token', 'client_secret', 'code_verifier', 'token']) {
    assert.equal(isTokenShapedName(name), true, `${name} must read as a credential`);
  }
  // The false-positive half, because a guard that flags everything teaches people to switch it off.
  for (const name of ['livenessToken', 'expiresAt', 'subject', 'template', 'planHash', 'not-before-policy']) {
    assert.equal(isTokenShapedName(name), false, `${name} is not a credential and must not be flagged`);
  }
});

test('D4: no control-plane audit detail key is token-shaped (the API has nowhere to put a refresh token)', () => {
  assert.ok(AUDIT_DETAIL_KEYS_ALLOWLIST.length > 0, 'an empty allowlist would make the subset check vacuously true');
  for (const key of AUDIT_DETAIL_KEYS_ALLOWLIST) assert.equal(isTokenShapedName(key), false, `the allowlist itself carries ${key}`);

  const dir = path.join(root, 'apps/control-plane/src');
  const keys = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/appendAudit\(\{[\s\S]{0,700}?detail:\s*\{([^}]*)\}/g)) {
      for (const part of m[1]!.split(',')) {
        const k = part.split(':')[0]!.trim();
        if (/^[A-Za-z_][\w$]*$/.test(k)) keys.add(k);
      }
    }
  }
  assert.ok(keys.size >= 20, `the scanner found ${String(keys.size)} audit detail keys in apps/control-plane/src -- it has stopped reading (a parser that sees nothing reports no problems)`);
  const offenders = [...keys].filter((k) => isTokenShapedName(k));
  assert.deepEqual(offenders, [], `audit detail keys that could hold a credential: ${offenders.join(', ')} -- D4: platfolio stores no token`);
  // New names are reported, not rejected: the gate is "no credential lands in an audit row", not "this file is
  // frozen. A benign new key belongs in the allowlist with a reason; a token-shaped one belongs nowhere.
  const unknown = [...keys].filter((k) => !AUDIT_DETAIL_KEYS_ALLOWLIST.includes(k as (typeof AUDIT_DETAIL_KEYS_ALLOWLIST)[number]));
  assert.deepEqual(unknown, [], `audit detail keys outside the allowlist (add them to scripts/browser-auth.ts and say why, or rename): ${unknown.join(', ')}`);
});

test('D4: the API surface accepts no token as data -- the only credential channel is the Authorization header', () => {
  const spec = fs.readFileSync(path.join(root, 'apps/control-plane/openapi.yaml'), 'utf8');
  const propertyNames = [...spec.matchAll(/^\s{2,}([A-Za-z_][\w-]*):/gm)].map((m) => m[1]!);
  assert.ok(propertyNames.length > 40, `the scan read ${String(propertyNames.length)} keys from openapi.yaml -- it has stopped reading`);
  const offenders = [...new Set(propertyNames)].filter((n) => isTokenShapedName(n));
  assert.deepEqual(offenders, [], `the public API declares a credential-bearing field: ${offenders.join(', ')}`);
  assert.ok(!/^\s*(name:\s*)(access_token|refresh_token|client_secret)\s*$/m.test(spec), 'no operation may take a token as a parameter');
});

test('redaction is a backstop, not the boundary: a bare JWT survives it, which is why none may enter a message', () => {
  // Measured, so the limitation is on the record rather than assumed away. `redactCredentialShaped` scrubs the
  // shapes platfolio actually leaks -- a `Bearer` header echoed in a provider error, an `access_token=` in a
  // callback URL, a DSN with userinfo -- and it does NOT recognise a bare compact JWS, which is what a refresh
  // token looks like. The rule therefore cannot be "redaction will catch it"; it is "a token never enters a
  // loggable string", and the audit-key and API-surface checks above are what hold that line.
  const jwt = 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJhZHJpYW4ifQ.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(redactCredentialShaped(`refresh failed: ${jwt}`), `refresh failed: ${jwt}`, 'documented gap: a bare JWT is not redacted');
  assert.match(redactCredentialShaped('Authorization: Bearer abcdef.ghijklmnop.QRSTUVWXYZ0123456789'), /Bearer \[redacted\]/);
  assert.match(redactCredentialShaped('https://x.test/cb?access_token=abcdef123456'), /access_token=\[redacted\]/);
  assert.match(redactCredentialShaped('postgresql://postgres:sup3rsecret@main:5432/platfolio'), /:\/\/postgres:\[redacted\]@/);
});

test('REQUIRED_SCOPE is the value the control plane actually checks', async () => {
  const capabilities = fs.readFileSync(path.join(root, 'apps/control-plane/src/capabilities.ts'), 'utf8');
  const declared = /const REQUIRED_SCOPE = '([^']+)'/.exec(capabilities)?.[1];
  assert.equal(declared, REQUIRED_SCOPE, 'the role name the realm seeds and the role name the API demand must be one string');
  assert.equal(shape.clientId, WEB_CLIENT_ID);
});

test('the smoke script exists and its header carries the lifecycle claims this file encodes', () => {
  const file = path.join(root, 'scripts/smoke-browser-auth.ts');
  assert.ok(fs.existsSync(file), 'scripts/smoke-browser-auth.ts is the behavioural half of this contract');
  const header = fs.readFileSync(file, 'utf8').slice(0, 12_000);
  const prose = header.toLowerCase();
  for (const topic of ['localstorage', 'in memory', 'end_session_endpoint', 'expires_in', 'refresh_expires_in', 'id_token_hint', 'd4']) {
    assert.ok(prose.includes(topic), `the lifecycle header no longer mentions "${topic}" -- either the contract changed or the documentation fell out of step with it`);
  }
  assert.ok(!/grant_type=password[^\n]*\bfor the browser\b/.test(header), 'the header must not describe ROPC as the browser path');
});
