import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { buildCapabilities } from '../src/capabilities.ts';
import { boot, configFromEnv, describeBootFailure } from '../src/index.ts';
import { ALLOWED_ORIGINS_ENV, CorsOriginsRefused, parseAllowedOrigins, describeAllowedOriginsConfig } from '../src/cors.ts';

/**
 * The control plane callable from a browser on another origin.
 *
 * The header rules are asserted at the transport in `packages/kernel/test/cors.test.ts`. What this file adds is
 * the two things a transport test cannot show: that the **environment variable reaches the listener** (the
 * `scm`-not-forwarded bug class -- a decision computed in configuration and quietly dropped on the way into the
 * kernel), and that the behaviour is right over a **real socket, through the real request path**, with the real
 * capability routes mounted rather than a stand-in.
 *
 * `packages/kernel/test/cors.test.ts` owns the mechanism's unit behaviour; this file imports the composition
 * rather than faking it.
 */

const fixture = createIdentityFixture();
const UI = 'https://platfolio.dev';
const STAGING_UI = 'https://preview.platfolio.dev';
const STRANGER = 'https://not-authorized.example.net';
const build = { version: '9.9.9', commit: 'a'.repeat(40), buildTime: '2026-11-14T00:00:00.000Z' };

async function startApp(allowedOrigins: readonly string[] | undefined) {
  const ctx = await createKernel({
    provider: 'fake',
    custody: 'strict',
    identity: defaultIdentityConfig(fixture),
    identityKeys: [fixture.jwk],
    store: { driver: 'memory' },
    server: allowedOrigins === undefined
      ? { port: 0 }
      : { port: 0, cors: { allowedOrigins: [...allowedOrigins] } },
    extensions: buildCapabilities({ build }),
    requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const url = (p: string) => `http://127.0.0.1:${String(ctx.server.address.port)}${p}`;
  const token = signToken(fixture, { scope: 'platfolio.user' });
  return { ctx, url, token };
}

test(`the ${ALLOWED_ORIGINS_ENV} contract: shape, default, failure modes`, () => {
  // Unset and wholly-blank are the documented default: no cross-origin request is enabled. The blank case is
  // not decoration -- `PLATFOLIO_ALLOWED_ORIGINS=${PLATFOLIO_ALLOWED_ORIGINS:-}` in a Compose file is exactly
  // this, and reading it as a malformed list would refuse a correctly configured deployment.
  assert.deepEqual(parseAllowedOrigins(undefined), [], 'unset means same-origin only');
  assert.deepEqual(parseAllowedOrigins(''), []);
  assert.deepEqual(parseAllowedOrigins('   '), []);

  assert.deepEqual(parseAllowedOrigins(UI), [UI]);
  assert.deepEqual(parseAllowedOrigins(`${STAGING_UI}, ${UI}`), [STAGING_UI, UI],
    'comma-separated, spaces tolerated, canonicalized -- and the first entry kept in order');
  assert.deepEqual(parseAllowedOrigins('https://APP.dev/,https://app.dev'), ['https://app.dev'], 'one origin typed two ways is one origin');
  assert.deepEqual(parseAllowedOrigins('https://app.dev:8443'), ['https://app.dev:8443'], 'a non-default port is part of the origin');

  // Every failure names the variable, the position and the expectation. A silent drop here would mean the live
  // policy is not the typed policy, which is the failure this whole feature exists to make impossible.
  for (const [bad, why] of [
    ['*', 'a wildcard is refused outright: this API takes bearer tokens'],
    ['https://app.dev,*', 'even alongside a good entry'],
    ['app.dev', 'no scheme is not an origin'],
    ['https://app.dev/ui', 'a path is not an origin'],
    ['https://user:pass@app.dev', 'credentials are not an origin'],
    ['https://app.dev,,https://b.dev', 'an empty entry from a stray comma'],
    ['https://app.dev,', 'and an empty entry from a trailing comma'],
  ] as const) {
    assert.throws(() => parseAllowedOrigins(bad), (error: unknown) => {
      assert.ok(error instanceof CorsOriginsRefused, `${bad} threw ${String(error)}`);
      assert.match((error as Error).message, new RegExp(ALLOWED_ORIGINS_ENV), 'the message names the variable to fix');
      return true;
    }, `${bad} should have been refused -- ${why}`);
  }
  // The refusal names the position, because a list of four origins with one bad entry is otherwise a search.
  let position = '';
  try {
    parseAllowedOrigins(`https://a.dev,https://b.dev/x,https://c.dev`);
  } catch (error) {
    position = (error as Error).message;
  }
  assert.match(position, /entry 2 of 3/, position);

  // D4 applies to the refusal text itself. `https://user:password@host` is a DSN wearing an origin's clothes: it
  // is correctly refused, and the message that refuses it must not quote the password into a provider log.
  let refusedDsn = '';
  try {
    parseAllowedOrigins('https://app.dev,https://svc:sup3rs3cret@db.internal');
  } catch (error) {
    refusedDsn = (error as Error).message;
  }
  assert.match(refusedDsn, /entry 2 of 2/, refusedDsn);
  assert.ok(!refusedDsn.includes('sup3rs3cret'), `the refusal must not echo a credential: ${refusedDsn}`);
  assert.match(refusedDsn, /\[redacted\]/, 'and it says what it did to it, rather than quietly dropping the entry');
  assert.match(describeAllowedOriginsConfig([]), /cross-origin requests are not enabled/, 'the empty case is stated, not skipped');
  assert.match(describeAllowedOriginsConfig([UI, STAGING_UI]), /2 origin\(s\) accepted/, 'and the count is the first thing said');
});

test('configFromEnv carries the origin list into the boot config', () => {
  const base = { PLATFOLIO_IDENTITY_ISSUER: fixture.issuer, PLATFOLIO_IDENTITY_AUDIENCE: fixture.audience };
  assert.deepEqual(configFromEnv({ ...base }).cors?.allowedOrigins, [], 'unset: the safe default is carried explicitly');
  assert.deepEqual(configFromEnv({ ...base, [ALLOWED_ORIGINS_ENV]: `${UI},${STAGING_UI}` }).cors?.allowedOrigins, [UI, STAGING_UI]);
  // Loud, at configuration time, before anything is listening -- and the process's own boot failure printer
  // renders it readably on stderr, which is the only place an operator will ever see this refusal.
  let refused: Error | undefined;
  try {
    configFromEnv({ ...base, [ALLOWED_ORIGINS_ENV]: '*' });
  } catch (error) {
    refused = error as Error;
  }
  assert.ok(refused instanceof CorsOriginsRefused, 'a wildcard is a refused boot, not a warning');
  assert.match(describeBootFailure(refused), /PLATFOLIO_ALLOWED_ORIGINS.*wildcard/s, 'the boot failure line says which variable and why');
  assert.match(describeBootFailure(refused), /bearer tokens/, 'and repeats the reason the wildcard is not available');
  assert.throws(() => configFromEnv({ ...base, [ALLOWED_ORIGINS_ENV]: 'https://app.dev/x' }), CorsOriginsRefused, 'a path is not an origin');
});

/**
 * The container's own path: environment object -> `configFromEnv` -> `boot` -> listener.
 *
 * `boot()` wires identity through an `EndpointKeySource` and takes the fetch implementation as an argument, so
 * the one thing stubbed here is the JWKS HTTP call -- handed a fetch that throws, then replaced by
 * `ctx.identity.attachKeys`, which is the same seam the local stack and the conformance double use. The listener,
 * the router, the CORS policy, the capability routes and the socket are the production objects.
 */
async function startViaBoot(env: Record<string, string> = {}) {
  const neverFetched = (async () => { throw new Error('this test has no identity provider to fetch keys from'); }) as unknown as typeof fetch;
  const app = await boot(configFromEnv({
    PLATFOLIO_IDENTITY_ISSUER: fixture.issuer,
    PLATFOLIO_IDENTITY_AUDIENCE: fixture.audience,
    PLATFOLIO_IDENTITY_JWKS_URI: 'https://identity.invalid.test/realms/platfolio/protocol/openid-connect/certs',
    HOST: '127.0.0.1',
    PORT: '0',
    ...env,
  }), neverFetched);
  app.ctx.identity.attachKeys([fixture.jwk]);
  return {
    app,
    base: `http://127.0.0.1:${String(app.address.port)}`,
    token: signToken(fixture, { scope: 'platfolio.user' }),
  };
}

test('a listed origin can call the real API over a socket; a stranger cannot', async () => {
  const app = await startApp([UI, STAGING_UI]);
  try {
    const response = await fetch(app.url('/api/v1/whoami'), { headers: { origin: UI, authorization: `Bearer ${app.token}` } });
    assert.equal(response.status, 200, 'the authenticated call still works -- CORS did not eat the bearer path');
    assert.equal(response.headers.get('access-control-allow-origin'), UI, `expected the caller's own origin, got ${response.headers.get('access-control-allow-origin')}`);
    assert.equal(response.headers.get('vary'), 'origin');
    assert.equal(response.headers.get('access-control-allow-credentials'), null, 'no ambient credentials, ever: this API authenticates by bearer header');
    const body = await response.json() as { subject: string };
    assert.equal(body.subject, 'user-conformance', 'and the body is readable by the caller');

    const stranger = await fetch(app.url('/api/v1/whoami'), { headers: { origin: STRANGER, authorization: `Bearer ${app.token}` } });
    assert.equal(stranger.status, 200, 'the request is not refused -- the *grant* is withheld, so no browser hands it the answer');
    assert.equal(stranger.headers.get('access-control-allow-origin'), null, 'the rejection path: a non-listed origin receives nothing');
    assert.equal(stranger.headers.get('vary'), 'origin', 'even the refusal varies on Origin, or a shared cache can leak the listed answer');

    const noOrigin = await fetch(app.url('/api/v1/whoami'), { headers: { authorization: `Bearer ${app.token}` } });
    assert.equal(noOrigin.headers.get('access-control-allow-origin'), null, 'a curl is not a browser and gets no cross-origin claim');
    assert.equal(noOrigin.headers.get('vary'), 'origin');

    // A 401 the browser cannot read is worse than useless to an SPA: it sees a network error, not "re-authenticate".
    const anon = await fetch(app.url('/api/v1/whoami'), { headers: { origin: UI } });
    assert.equal(anon.status, 401);
    assert.equal(anon.headers.get('access-control-allow-origin'), UI, 'the error path carries the grant too');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('the browser preflight round-trips against the real route table', async () => {
  const app = await startApp([UI]);
  try {
    // Exactly what a browser sends before `fetch('/api/v1/instances', {method:'POST', headers:{authorization}})`.
    const preflight = await fetch(app.url('/api/v1/instances'), {
      method: 'OPTIONS',
      headers: { origin: UI, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(preflight.status, 204, 'granted, with no body');
    assert.equal(preflight.headers.get('access-control-allow-origin'), UI);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST', 'the methods /api/v1/instances really registers');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization, content-type');
    assert.equal(preflight.headers.get('access-control-max-age'), '600');
    assert.equal(preflight.headers.get('vary'), 'origin, access-control-request-method, access-control-request-headers');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);

    const thenTheCall = await fetch(app.url('/api/v1/instances'), {
      method: 'POST',
      headers: { origin: UI, authorization: `Bearer ${app.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: 'team-does-not-exist', name: 'marketing', template: 'starter-web' }),
    });
    assert.equal(thenTheCall.status, 404, 'the real handler answered (no such team for this person), not the preflight path');
    assert.equal(thenTheCall.headers.get('access-control-allow-origin'), UI);

    const stranger = await fetch(app.url('/api/v1/instances'), {
      method: 'OPTIONS',
      headers: { origin: STRANGER, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' },
    });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null, 'a stranger preflights and is granted nothing');
    assert.equal(stranger.headers.get('access-control-allow-methods'), null);

    const unregistered = await fetch(app.url('/api/v1/whoami'), {
      method: 'OPTIONS', headers: { origin: UI, 'access-control-request-method': 'DELETE' },
    });
    assert.equal(unregistered.headers.get('access-control-allow-methods'), null, 'whoami has no DELETE; a preflight cannot invent one');
    assert.equal(unregistered.headers.get('allow'), 'GET', 'and the answer names what the path does register');
  } finally {
    await disposeKernel(app.ctx);
  }
});

test('the whole wire: the environment variable reaches a response header through boot()', async () => {
  // `boot()`, not `createKernel`: this is the path the container takes, and the one place that can lose a
  // decision between `configFromEnv` and the transport. The `scm` bug was exactly this seam -- configuration
  // computed correctly and never forwarded, discovered only by running the real thing.
  // The JWKS fetch is the only thing faked here, and only because there is no identity provider on this loopback;
  // the listener, the router, the policy and the socket are all the production objects.
  const wired = await startViaBoot({ [ALLOWED_ORIGINS_ENV]: `${UI},${STAGING_UI}` });
  try {
    const listed = await fetch(`${wired.base}/healthz`, { headers: { origin: UI } });
    assert.equal(listed.headers.get('access-control-allow-origin'), UI, 'the value typed into the environment is the value on the response');
    const stranger = await fetch(`${wired.base}/healthz`, { headers: { origin: 'https://somewhere-else.example' } });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null, 'and an origin that was not typed gets nothing');
    const preflight = await fetch(`${wired.base}/api/v1/instances`, {
      method: 'OPTIONS', headers: { origin: STAGING_UI, 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 204, 'the preflight path is live too, off the real route table');
    assert.equal(preflight.headers.get('access-control-allow-origin'), STAGING_UI);
  } finally {
    await wired.app.stop();
  }
});

test('with the variable unset, the API behaves exactly as it did before CORS existed', async () => {
  // Through `boot()`, because that is the path an unset variable actually takes: `configFromEnv` yields the empty
  // list and `boot` forwards it, so the transport receives `cors.allowedOrigins: []` -- not an absent block.
  // Asserting only the absent-block spelling would leave the one the deployment really uses unchecked.
  const wired = await startViaBoot();
  try {
    const crossOrigin = await fetch(`${wired.base}/api/v1/whoami`, { headers: { origin: UI, authorization: `Bearer ${wired.token}` } });
    assert.equal(crossOrigin.status, 200, 'the request is still served to a caller bearing a valid token');
    assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null, 'but nothing is granted, which is what makes a browser refuse it');
    assert.equal(crossOrigin.headers.get('vary'), null, 'and no Vary is claimed, because the answer does not depend on Origin');
    const preflight = await fetch(`${wired.base}/api/v1/instances`, {
      method: 'OPTIONS', headers: { origin: UI, 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 404, 'a preflight is still not an operation -- no phantom OPTIONS surface');
  } finally {
    await wired.app.stop();
  }
});
