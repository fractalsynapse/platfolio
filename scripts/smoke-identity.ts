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
const realm = 'platfolio';
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

const flipped = `${scoped.slice(0, -1)}${scoped.endsWith('A') ? 'B' : 'A'}`;
const forged = await call('/api/v1/whoami', flipped);
check('a flipped signature is refused with 401', forged.status === 401, `${String(forged.status)} ${forged.text.slice(0, 120)}`);
check('the refusal names the failure mode', /signature|unknown-key/.test(forged.text), forged.text.slice(0, 100));

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
// boundary, not a claim the requester can name. What must be refused is a token from a different issuer:
// platfolio's own master-realm admin token, which is real, well-formed, signed by a different key set, and
// confers nothing here. That is D4's cross-tenant rule expressed as an HTTP assertion.
const foreign = await fetch(`${idp}/realms/master/protocol/openid-connect/token`, {
  method: 'POST',
  // The bootstrap admin from docker-compose.yml, not a secret this script invents.
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'platfolio-admin', password: process.env.KC_ADMIN_PASSWORD ?? 'platfolio-dev-only' }),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
if (foreign.ok) {
  const foreignToken = ((await foreign.json()) as { access_token: string }).access_token;
  const cross = await call('/api/v1/whoami', foreignToken);
  // Both codes are correct refusals of a foreign token, and which fires first is an implementation detail of
  // the verifier: the master realm's kid is unknown to this realm's key set, so that check answers before the
  // issuer comparison. Asserting on /issuer/ alone would have passed by accident on the first draft.
  const refusedAs = /unauthenticated:(unknown-key|issuer|signature)/.exec(cross.text)?.[1] ?? 'none';
  check('a token from another issuer (master realm) is refused', cross.status === 401 && refusedAs !== 'none', `${String(cross.status)} refused as ${refusedAs}`);
} else {
  check('a token from another issuer (master realm) is refused', false, `could not mint the foreign token (${String(foreign.status)}) -- the check did not run`);
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
