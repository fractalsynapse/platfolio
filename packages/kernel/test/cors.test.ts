import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from 'cordis';
import { ServerService, ServerConfigSchema, type Request } from '../src/server.ts';
import { canonicalOrigin, corsPolicyOf, describeCorsPolicy, requestOrigin, WILDCARD_REFUSAL } from '../src/cors.ts';

/**
 * CORS at the layer that writes headers.
 *
 * These are dispatch-level assertions, not socket ones: `ServerService.dispatch` is the funnel every response
 * goes through (the listener calls it, and the test path calls the same function), so a rule checked here is a
 * rule the listener will apply. `apps/control-plane/test/cors.test.ts` repeats the pair over a real socket
 * through the composition root, because a rule proven only below the wiring does not prove the wiring.
 */

const LISTED = 'https://app.platfolio.dev';
const OTHER_UI = 'https://staging.platfolio.dev';
const NOT_LISTED = 'https://evil.example.net';
const listedCors = { allowedOrigins: [LISTED, OTHER_UI] };

const request = (over: Partial<Request>): Request => ({
  method: 'GET', path: '/api/v1/instances', url: '/api/v1/instances', query: new URLSearchParams(),
  headers: {}, body: undefined, raw: null as never, ...over,
});

async function serviceWith(cors: unknown): Promise<{ serve: ServerService; dispose: () => Promise<void> }> {
  const ctx = new Context();
  await ctx.plugin(ServerService, ServerConfigSchema.parse(cors === undefined ? { host: '127.0.0.1', port: 0 } : { host: '127.0.0.1', port: 0, cors }));
  const serve = ctx.server;
  // A 200, a 204 and a handler-authored 401 -- because the grant has to hold on all three, and the transport's
  // own 404 is reachable by asking for a path that is not here.
  serve.addRoute({ method: 'GET', path: '/api/v1/instances', operationId: 'listInstances', handle: async () => ({ status: 200, body: { ok: true } }) });
  serve.addRoute({ method: 'POST', path: '/api/v1/instances', operationId: 'createInstance', handle: async () => ({ status: 201, body: { ok: true } }) });
  serve.addRoute({ method: 'GET', path: '/api/v1/whoami', operationId: 'getWhoami', handle: async () => ({ status: 401, body: { error: 'unauthenticated:no-credentials' }, headers: { 'www-authenticate': 'Bearer realm="platfolio"' } }) });
  return { serve, dispose: () => ctx.fiber.dispose() };
}

test('an origin is scheme://host[:port] or it is not an origin', () => {
  assert.equal(canonicalOrigin('https://app.platfolio.dev'), 'https://app.platfolio.dev');
  assert.equal(canonicalOrigin('https://app.platfolio.dev/'), 'https://app.platfolio.dev', 'a typed trailing slash is the same origin');
  assert.equal(canonicalOrigin('HTTPS://APP.Platfolio.DEV'), 'https://app.platfolio.dev', 'scheme and host are case-insensitive');
  assert.equal(canonicalOrigin('https://app.platfolio.dev:8443'), 'https://app.platfolio.dev:8443', 'a non-default port survives');
  assert.equal(canonicalOrigin('https://app.platfolio.dev:443'), 'https://app.platfolio.dev', 'and a default port folds away, exactly as a browser sends it');
  // Each of these is a different mistake an operator can make, and each one silently widens or narrows a policy
  // if accepted: a path means the list is not a list of origins, userinfo means a DSN was typed where an origin
  // was meant, and a scheme but http(s) means the value came from somewhere else entirely.
  for (const bad of ['app.platfolio.dev', '//app.platfolio.dev', 'https://app.dev/path', 'https://app.dev/?a=1',
    'https://app.dev#frag', 'https://user:pass@app.dev', 'ftp://app.dev', 'chrome-extension://abcdef', 'null', '*', '']) {
    assert.equal(canonicalOrigin(bad), undefined, `${bad} must not read as an origin`);
  }
});

test('the request origin is canonicalized, and a listed origin matches however it was sent', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    assert.equal(requestOrigin({ origin: 'https://App.Platfolio.DEV/' }), LISTED);
    assert.equal(requestOrigin({}), undefined);
    const response = await serve.dispatch(request({ headers: { origin: 'HTTPS://APP.PLATFOLIO.DEV' } }));
    assert.equal(response.headers?.['access-control-allow-origin'], LISTED, 'the canonical form is echoed, not the raw bytes');
  } finally {
    await dispose();
  }
});

test('a listed origin gets its own origin back; nothing ever gets a wildcard or credentials', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    const mine = await serve.dispatch(request({ headers: { origin: OTHER_UI } }));
    assert.equal(mine.headers?.['access-control-allow-origin'], OTHER_UI, `the grant names the request's origin, got ${JSON.stringify(mine.headers)}`);
    const response = await serve.dispatch(request({ headers: { origin: LISTED } }));
    assert.equal(response.status, 200, 'the handler ran');
    assert.equal(response.headers?.['access-control-allow-origin'], LISTED);
    assert.notEqual(response.headers?.['access-control-allow-origin'], '*', 'never a wildcard');
    assert.equal(response.headers?.['access-control-allow-credentials'], undefined,
      'this API authenticates with a bearer header, so ambient credentials are never admitted (see packages/kernel/src/cors.ts)');
    assert.equal(response.headers?.vary, 'origin', 'the answer depends on Origin, so a cache has to be told');
  } finally {
    await dispose();
  }
});

test('an origin that is not on the list gets no permission, and still varies on origin', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    const response = await serve.dispatch(request({ headers: { origin: NOT_LISTED } }));
    assert.equal(response.status, 200, 'the request itself is not refused -- it is the *permission* that is withheld');
    assert.equal(response.headers?.['access-control-allow-origin'], undefined,
      `a non-listed origin must not receive any cross-origin grant, got ${JSON.stringify(response.headers)}`);
    assert.equal(response.headers?.vary, 'origin', 'and the cache directive must still be there, or a proxy can hand this answer to a listed origin');
  } finally {
    await dispose();
  }
});

test('the grant covers every response the transport writes, not only a successful one', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    // 401 from a handler, 404 from the router: the shapes an SPA has to be able to read. A CORS header on the
    // 200 only leaves each of these as an opaque network error in the console.
    const denied = await serve.dispatch(request({ path: '/api/v1/whoami', headers: { origin: LISTED } }));
    assert.equal(denied.status, 401);
    assert.equal(denied.headers?.['access-control-allow-origin'], LISTED, 'a 401 the browser cannot read is not a 401 the SPA can handle');
    assert.equal(denied.headers?.['www-authenticate'], 'Bearer realm="platfolio"', 'the handler set header survives the merge');
    const gone = await serve.dispatch(request({ path: '/api/v1/nope', headers: { origin: LISTED } }));
    assert.equal(gone.status, 404);
    assert.equal(gone.headers?.['access-control-allow-origin'], LISTED, 'even a path this API does not have is granted correctly');
  } finally {
    await dispose();
  }
});

test('a preflight is answered for a listed origin, for a method that path actually registers', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    const response = await serve.dispatch(request({
      method: 'OPTIONS',
      headers: { origin: LISTED, 'access-control-request-method': 'post', 'access-control-request-headers': 'authorization, content-type, x-invented' },
    }));
    assert.equal(response.status, 204, `a granted preflight answers with no body, got ${String(response.status)}`);
    assert.equal(response.headers?.['access-control-allow-origin'], LISTED);
    assert.equal(response.headers?.['access-control-allow-methods'], 'GET, POST', 'the route table for this path, sorted');
    assert.equal(response.headers?.['access-control-allow-headers'], 'authorization, content-type',
      'the intersection of what was asked for and what this API reads -- x-invented is not blessed into the answer');
    assert.equal(response.headers?.['access-control-max-age'], '600');
    assert.equal(response.headers?.vary, 'origin, access-control-request-method, access-control-request-headers');
    assert.equal(response.headers?.['access-control-allow-credentials'], undefined);
    assert.notEqual(response.headers?.['cache-control'], 'no-store', 'a no-store here would make max-age a number nobody honours');
  } finally {
    await dispose();
  }
});

test('a preflight from an origin that is not listed grants nothing', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    const response = await serve.dispatch(request({
      method: 'OPTIONS', path: '/api/v1/instances',
      headers: { origin: NOT_LISTED, 'access-control-request-method': 'POST' },
    }));
    assert.equal(response.headers?.['access-control-allow-origin'], undefined,
      `the rejection path: a non-listed preflight must not be granted, got ${JSON.stringify(response.headers)}`);
    assert.equal(response.headers?.['access-control-allow-methods'], undefined, 'and no method list either');
    assert.equal(response.headers?.['access-control-allow-headers'], undefined);
    assert.match(JSON.stringify(response.body), /origin/, 'and the refusal says what was refused');
  } finally {
    await dispose();
  }
});

test('a preflight for a method the path does not register is refused, naming the ones it does', async () => {
  const { serve, dispose } = await serviceWith(listedCors);
  try {
    const response = await serve.dispatch(request({
      method: 'OPTIONS', path: '/api/v1/whoami',
      headers: { origin: LISTED, 'access-control-request-method': 'PATCH' },
    }));
    assert.notEqual(response.status, 204, 'no method grant for a method this path does not have');
    assert.equal(response.headers?.['access-control-allow-methods'], undefined, 'and the browser sees no permission to send PATCH');
    assert.equal(response.headers?.allow, 'GET', 'the honest answer about this path, for whoever is reading a log');
    assert.equal(response.headers?.['access-control-allow-origin'], LISTED, 'the origin was allowed; the method was not');
  } finally {
    await dispose();
  }
});

test('with no origin list configured nothing varies and OPTIONS is still not an operation', async () => {
  // Both spellings the composition root can produce: no `cors` block at all (a bare server, a test double), and
  // `cors.allowedOrigins: []` -- which is what `boot()` passes when PLATFOLIO_ALLOWED_ORIGINS is unset. They must
  // mean the same thing, or "not configured" becomes a policy that varies on Origin for nothing.
  for (const cors of [undefined, { allowedOrigins: [] }]) {
    const { serve, dispose } = await serviceWith(cors);
    try {
      const listed = await serve.dispatch(request({ headers: { origin: LISTED } }));
      assert.equal(listed.headers?.['access-control-allow-origin'], undefined, 'unset means no cross-origin request is enabled');
      assert.equal(listed.headers?.vary, undefined, 'and with no list the answer does not depend on Origin, so Vary is not claimed');
      const preflight = await serve.dispatch(request({ method: 'OPTIONS', headers: { origin: LISTED, 'access-control-request-method': 'POST' } }));
      assert.equal(preflight.status, 404, 'an OPTIONS keeps the 404 it had before this policy existed -- no phantom operation');
      assert.match(JSON.stringify(preflight.body), /no route for OPTIONS/);
    } finally {
      await dispose();
    }
  }
});

test('a response a handler threw on is still readable by the browser', async () => {
  // The transport's catch branch writes the 500 itself and never returns through `dispatch`, so it is the one
  // response path a policy applied in the router would miss. Over a real socket, because that branch only
  // exists in the listener.
  const ctx = new Context();
  await ctx.plugin(ServerService, ServerConfigSchema.parse({ host: '127.0.0.1', port: 0, cors: listedCors }));
  const serve = ctx.server;
  serve.addRoute({
    method: 'GET', path: '/api/v1/throws', operationId: 'throws',
    handle: async () => { throw new Error('a handler that lost its database'); },
  });
  try {
    const base = `http://127.0.0.1:${String(serve.address.port)}`;
    const response = await fetch(`${base}/api/v1/throws`, { headers: { origin: LISTED } });
    assert.equal(response.status, 500, 'the throw is still a 500');
    assert.equal(response.headers.get('access-control-allow-origin'), LISTED, 'and the browser is still allowed to read it');
    assert.equal(response.headers.get('vary'), 'origin');
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'internal');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('a malformed or wildcard origin list refuses to start, naming the entry', () => {
  // The transport is the second net: `configFromEnv` refuses the same shapes with the variable's name in the
  // message. Neither net may be permissive, because a partially-applied origin list is a policy nobody typed.
  for (const bad of ['*', 'app.platfolio.dev', 'https://app.dev/path', 'https://user:pass@app.dev', 'chrome-extension://abc']) {
    assert.throws(() => corsPolicyOf({ allowedOrigins: [bad] }), /refused/, `${bad} must be refused`);
  }
  assert.throws(() => corsPolicyOf({ allowedOrigins: ['*'] }), new RegExp(WILDCARD_REFUSAL.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the wildcard refusal names the bearer-token reason');
  // One bad entry refuses the whole list -- the alternative is a deployment that answers three origins while its
  // operator believes four are live.
  assert.throws(() => corsPolicyOf({ allowedOrigins: [LISTED, 'not-an-origin'] }), /not an origin/);
  assert.equal(corsPolicyOf({ allowedOrigins: [] }), undefined, 'an empty list is the documented "not enabled" state, not an error');
  assert.equal(corsPolicyOf(undefined), undefined);
});

test('boot says the count and the shape, and says so when nothing is configured', () => {
  const enabled = describeCorsPolicy(corsPolicyOf(listedCors));
  assert.match(enabled, /cors: 2 allowed origin\(s\)/, enabled);
  assert.match(enabled, /https:\/\/app\.platfolio\.dev/, 'the origins themselves are public URLs, and printing them is the point');
  assert.match(enabled, /no credentials/, 'and it states the credential decision rather than leaving it implicit');
  assert.ok(!enabled.includes('*'), 'never a wildcard-suppressing default in the line an operator reads');
  assert.match(describeCorsPolicy(corsPolicyOf({ allowedOrigins: [] })), /no allowed origins are configured/, 'unset is stated, not skipped');
});
