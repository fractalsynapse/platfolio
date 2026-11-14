/**
 * `pnpm run identity:smoke` -- Slice 1's acceptance, as a command.
 *
 *   docker compose up -d && pnpm run identity:seed && pnpm run identity:smoke
 *
 * Asserts against the running stack rather than a fixture: a real Keycloak token is accepted, and the four
 * refusal shapes that matter are refused with the status the OpenAPI document promises. A green unit suite
 * proves the verifier; this proves the *wiring* -- issuer string, JWKS reachability, audience mapper, role
 * mapping -- which is exactly the layer where a local stack and a test diverge.
 */
const idp = process.env.KC_BASE ?? 'http://localhost:8081';
const api = process.env.CONTROL_PLANE_BASE ?? 'http://localhost:8082';
// The realm is a parameter (D56): platfolio runs ONE hosted Keycloak whose realms are per environment, so
// `platfolio` and `platfolio-staging` are both real and only one of them is production. Hard-coding the
// production realm meant the staging deployment could never be smoke-tested end to end -- its `/readyz` says
// `identity: ok`, which is a JWKS reachability check, not proof that a token from ITS realm is accepted here.
const realm = process.env.KC_REALM ?? 'platfolio';
// The dev client secret by default, overridable so this same suite can run against the hosted
// realm (KC_CLIENT_SECRET) -- acceptance is one list of checks, not a local-only ritual.
const secret = process.env.KC_CLIENT_SECRET ?? 'platfolio-dev-only';
const userPassword = process.env.KC_USER_PASSWORD ?? 'platfolio-dev-only';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  process.stdout.write(`S ${ok ? 'pass' : 'FAIL'}  ${name} -- ${detail}\n`);
};

const tokenFor = async (username: string): Promise<string | undefined> => {
  const form = new URLSearchParams({ grant_type: 'password', client_id: 'platfolio-api', client_secret: secret, username, password: userPassword });
  const response = await fetch(`${idp}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  if (!response.ok) return undefined;
  return ((await response.json()) as { access_token?: string }).access_token;
};

const call = async (path: string, token?: string) => {
  const response = await fetch(api + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await response.text();
  return { status: response.status, text };
};

let scoped: string | undefined;
try {
  scoped = await tokenFor('adrian');
} catch {
  process.stdout.write(`S cannot reach ${idp} -- is the stack up? (docker compose up -d && pnpm run identity:seed)\n`);
  process.exit(1);
}
if (!scoped) {
  check('token from Keycloak', false, `no access_token for adrian from ${idp}/realms/${realm}; the realm may not be seeded`);
  process.exit(1);
}
check('token from Keycloak', true, `${String(scoped.length)} chars, issuer ${idp}/realms/${realm}`);

const whoami = await call('/api/v1/whoami', scoped);
const claims = (() => { try { return JSON.parse(whoami.text) as Record<string, unknown>; } catch { return {}; } })();
check('whoami accepts a real scoped token', whoami.status === 200, `${String(whoami.status)} ${whoami.text.slice(0, 120)}`);
check('the response carries the verified subject', typeof claims.subject === 'string' && (claims.subject as string).length > 8, `subject=${String(claims.subject)}`);
check('tenantAuthority is asserted false', claims.tenantAuthority === false, `tenantAuthority=${String(claims.tenantAuthority)}`);
check('audience includes the required value', JSON.stringify(claims.audience ?? []).includes('platfolio-api'), `audience=${JSON.stringify(claims.audience)}`);

// FORGING A TOKEN IS EASIER TO TEST BADLY THAN TO TEST. This check used to flip the LAST character of the
// compact JWT and assert a 401. For an RS256 signature (256 bytes -> 342 base64url characters) the final
// character encodes two significant bits plus padding bits that decoders ignore -- so depending on the
// signature, changing it decodes to the SAME bytes and leaves a perfectly valid token. The assertion then
// "passes" against a token that was never forged, and in the other direction it reports a working verifier as
// broken. Staging returned 200 here today and production returned 401 from the same code, on nothing but luck.
//
// So: alter a character in the MIDDLE of the signature segment, where every bit is significant, and refuse to
// run the check at all unless the signature bytes genuinely changed. A security check that cannot prove it
// changed the input is not a check.
const forgeSignature = (token: string): { token: string; changed: boolean } => {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature || signature.length < 8) return { token, changed: false };
  const mid = Math.floor(signature.length / 2);
  const candidate = signature.slice(0, mid) + (signature[mid] === 'Q' ? 'R' : 'Q') + signature.slice(mid + 1);
  const decode = (s: string): string => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
  return { token: `${header}.${payload}.${candidate}`, changed: decode(signature) !== decode(candidate) };
};

const forgery = forgeSignature(scoped);
if (!forgery.changed) {
  check('a flipped signature is refused with 401', false, 'the forged token was byte-identical to the real one -- the check did not run');
  check('the refusal names the failure mode', false, 'skipped because the forgery did not change the signature bytes');
} else {
  const forged = await call('/api/v1/whoami', forgery.token);
  check('a flipped signature is refused with 401', forged.status === 401, `${String(forged.status)} ${forged.text.slice(0, 120)}`);
  check('the refusal names the failure mode', /signature|unknown-key/.test(forged.text), forged.text.slice(0, 100));
}

const anonymous = await call('/api/v1/whoami');
check('no credentials is 401, not 403 or 500', anonymous.status === 401, `${String(anonymous.status)} ${anonymous.text.slice(0, 100)}`);

const unscoped = await tokenFor('no-scope');
if (unscoped) {
  const denied = await call('/api/v1/whoami', unscoped);
  check('a verified token without the scope is 403', denied.status === 403, `${String(denied.status)} ${denied.text.slice(0, 100)}`);
} else {
  check('a verified token without the scope is 403', false, 'the no-scope user could not authenticate -- seed did not create it');
}

// The cross-boundary test that matters. My first draft asked Keycloak for a token "for another audience" and
// expected a refusal -- but the realm's audience mapper writes `platfolio-api` into every token minted for the
// platfolio-api client, so the claim stays correct and the token is genuinely valid. In OIDC the *client* is the
// boundary, not a claim the requester can name.
//
// What it used to present: a master-realm ADMIN token. That was always a weak proxy for the invariant, and it
// broke when the master admin credential became unrecoverable (#248). The 26.8 docs are explicit that
// `KC_BOOTSTRAP_ADMIN_*` creates the admin "only during the initial start of the Keycloak server when the master
// realm doesn't exist yet" -- so declaring the pair and rebooting cannot fix a lost admin; recovery is
// `kc.sh bootstrap-admin user` with all nodes stopped, and it yields a TEMPORARY account. A D4 proof that depends
// on an operator credential we might not be able to mint is a proof that depends on sand.
//
// The real threat is not an operator's admin token. It is one tenant's credential arriving at another tenant's
// control plane. platfolio runs ONE hosted Keycloak with a realm per environment (D56), so the peer realm is a
// genuine foreign issuer: same server, different realm, different key set, different `iss` -- and it needs only
// the peer's own client secret and user password. Both directions are testable, so this replaced the admin path.
const peerRealm = process.env.KC_PEER_REALM;
if (!peerRealm) {
  check('a token from another realm is refused', false, 'KC_PEER_REALM is unset -- the cross-issuer check cannot run, and is not skipped');
} else {
  const foreign = await fetch(`${idp}/realms/${peerRealm}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'platfolio-api',
      client_secret: process.env.KC_PEER_CLIENT_SECRET ?? '',
      username: process.env.KC_PEER_USER ?? 'adrian',
      password: process.env.KC_PEER_USER_PASSWORD ?? '',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (foreign.ok) {
    const foreignToken = ((await foreign.json()) as { access_token: string }).access_token;
    const cross = await call('/api/v1/whoami', foreignToken);
    // Which refusal fires first is an implementation detail of the verifier: the peer realm's kid is unknown to
    // this realm's key set, so that check usually answers before the issuer comparison. Asserting on /issuer/
    // alone would have passed by accident on the first draft.
    const refusedAs = /unauthenticated:(unknown-key|issuer|signature)/.exec(cross.text)?.[1] ?? 'none';
    check('a token from another realm is refused', cross.status === 401 && refusedAs !== 'none', `${String(cross.status)} refused as ${refusedAs} (peer realm "${peerRealm}")`);
  } else {
    // The reason matters more than the failure: "400 invalid_grant" means the peer credentials are wrong, while
    // "404" means the peer realm is not there at all. Both mean the check did not run, and neither is a pass.
    let reason = '(no body)';
    try {
      const text = await foreign.text();
      reason = String((JSON.parse(text) as { error?: string }).error ?? text.slice(0, 60));
    } catch {
      reason = '(body unreadable)';
    }
    check('a token from another realm is refused', false, `could not mint the peer-realm token (${String(foreign.status)} ${reason}) -- the check did not run; are the peer credentials supplied?`);
  }
}

// And the honest limit of the audience check, stated where someone can read it: any token minted by the
// platfolio-api client carries the required audience, so audience isolation depends on client credentials
// staying client-specific. Worth revisiting with a dedicated resource server when tenants arrive.
const laundered = await fetch(`${idp}/realms/${realm}/protocol/openid-connect/token`, {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'password', client_id: 'platfolio-api', client_secret: secret, username: 'adrian', password: secret, audience: 'some-other-api' }),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
if (laundered.ok) {
  const l = ((await laundered.json()) as { access_token: string }).access_token;
  const still = await call('/api/v1/whoami', l);
  check('a requested foreign audience does not strip the real one (documented behaviour, not a bug)', still.status === 200, `${String(still.status)} -- the mapper pins the audience; the client is the boundary`);
}

const health = await call('/healthz');
const version = await call('/version');
check('liveness and build identity respond', health.status === 200 && version.status === 200, `healthz=${String(health.status)} version=${String(version.status)}`);

const failed = results.filter((r) => !r.ok);
process.stdout.write(`S ${String(results.length - failed.length)}/${String(results.length)} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
