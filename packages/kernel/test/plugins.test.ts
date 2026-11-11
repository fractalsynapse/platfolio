import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context, Service } from 'cordis';
import { createIdentityFixture, defaultIdentityConfig, runIdentityConformance, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '../src/app.ts';
import { IdentityService } from '../src/identity.ts';
import { ServerService, ServerConfigSchema, matchPath } from '../src/server.ts';
import { requireServices } from '../src/startup.ts';

const fixture = createIdentityFixture();

test('ctx.identity satisfies the same conformance suite as the contracts double', async () => {
  const ctx = await createKernel({ identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk], requiredServices: ['identity'] });
  try {
    // The service is a thin capability wrapper, so the suite must pass through ctx.identity itself -- if the
    // plugin dropped or rewrote a verdict on the way through, this is where it shows.
    const report = await runIdentityConformance(() => ({
      name: 'kernel-identity-service',
      contract: '1.0.0',
      describe: () => ctx.identity.describe(),
      verifyAccessToken: (token: string, options?: { requiredScope?: string; now?: Date }) => ctx.identity.verifyAccessToken(token, options ?? {}),
    }), fixture);
    assert.equal(report.ok, true, report.results.filter((r) => r.status !== 'pass').map((r) => `${r.name}: ${r.detail}`).join('\n'));
  } finally {
    await disposeKernel(ctx);
  }
});

test('an unattached identity refuses every token instead of serving unauthenticated traffic', async () => {
  const ctx = new Context();
  await ctx.plugin(IdentityService, defaultIdentityConfig(fixture));
  const result = await ctx.identity.verifyAccessToken(signToken(fixture));
  assert.equal(result.ok, false, 'a configured-but-unattached verifier must not accept the reference token');
  if (result.ok) throw new Error('unreachable');
  assert.match(result.message, /no key source attached/, `refusal should name the fix, got: ${result.message}`);
  assert.match(ctx.identity.describe().keySource, /none/, 'describe() must admit the missing key set -- operators read this');
  await ctx.fiber.dispose();
});

test('the server dispatches by method and path, and 404s without hanging', async () => {
  const ctx = new Context();
  await ctx.plugin(ServerService, ServerConfigSchema.parse({ host: '127.0.0.1', port: 0 }));
  ctx.server.addRoute({ method: 'GET', path: '/ping', operationId: 'ping', handle: async () => ({ status: 200, body: { pong: true } }) });
  ctx.server.addRoute({ method: 'GET', path: '/api/v1/instances/{instanceId}', operationId: 'getInstance', handle: async (_req, params) => ({ status: 200, body: params }) });
  assert.deepEqual(await ctx.server.dispatch({ method: 'GET', path: '/ping', url: '/ping', query: new URLSearchParams(), headers: {}, body: undefined, raw: null as never }), { status: 200, body: { pong: true } });
  const routed = await ctx.server.dispatch({ method: 'get', path: '/api/v1/instances/inst-9', url: '/x', query: new URLSearchParams(), headers: {}, body: undefined, raw: null as never });
  assert.deepEqual(routed.body, { instanceId: 'inst-9' }, 'path parameters must bind, and method match must be case-insensitive');
  const missing = await ctx.server.dispatch({ method: 'DELETE', path: '/ping', url: '/ping', query: new URLSearchParams(), headers: {}, body: undefined, raw: null as never });
  assert.equal(missing.status, 404, 'a method mismatch is a 404, not a hang and not a 405-by-accident');
  assert.equal(ctx.server.listening, true);
  await ctx.fiber.dispose();
});

test('a duplicate route is refused at registration, not silently shadowed', async () => {
  const ctx = new Context();
  await ctx.plugin(ServerService, ServerConfigSchema.parse({ port: 0 }));
  ctx.server.addRoute({ method: 'GET', path: '/dup', operationId: 'a', handle: async () => ({ status: 200, body: 1 }) });
  assert.throws(() => ctx.server.addRoute({ method: 'GET', path: '/dup', operationId: 'b', handle: async () => ({ status: 200, body: 2 }) }), /already registered/);
  await ctx.fiber.dispose();
});

test('matchPath: literal segments, parameters, trailing slashes and arity', () => {
  assert.deepEqual(matchPath('/api/v1/instances/{instanceId}', '/api/v1/instances/inst-1'), { instanceId: 'inst-1' });
  assert.equal(matchPath('/api/v1/instances/{instanceId}', '/api/v1/instances'), null, 'a missing segment must not match');
  assert.equal(matchPath('/a/{b}', '/a/b/c'), null, 'extra segments must not match');
  assert.deepEqual(matchPath('/healthz', '/healthz/'), {}, 'a trailing slash is not a second route');
  assert.equal(matchPath('/healthz', '/healthX'), null);
  assert.deepEqual(matchPath('/x/{a}/y/{b}', '/x/1/y/2'), { a: '1', b: '2' });
  assert.deepEqual(matchPath('/x/{a}', '/x/a%20b'), { a: 'a b' }, 'percent-encoded parameters decode');
});

test('createKernel with an identity plugin provides ctx.identity, and the guard accepts it', async () => {
  const ctx = await createKernel({ identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk], requiredServices: ['identity'] });
  try {
    assert.ok(ctx.identity);
    const result = await ctx.identity.verifyAccessToken(signToken(fixture));
    assert.equal(result.ok, true, 'the wired service must verify the reference token');
  } finally {
    await disposeKernel(ctx);
  }
});

test('the port really closes when the fiber is disposed -- the disposer is not decoration', async () => {
  const ctx = await createKernel({ server: { port: 0 }, requiredServices: ['server'] });
  const { port } = ctx.server.address;
  const probe = await fetch(`http://127.0.0.1:${String(port)}/nothing`);
  assert.equal(probe.status, 404, 'the server answers before disposal');
  await disposeKernel(ctx);
  await assert.rejects(() => fetch(`http://127.0.0.1:${String(port)}/nothing`), 'the listener must be gone');
});

test('requireServices names a missing capability instead of letting it read as healthy', async () => {
  // Measured, not inherited: a missing provider shows up as an absent property, and `ctx.inject` resolves
  // anyway -- so nothing in the framework reports this, and a control plane can boot "successfully" with no
  // HTTP layer. The report this project was handed claimed a silent PENDING hang; it does not reproduce here.
  const ctx = new Context();
  const started = Date.now();
  await assert.rejects(
    () => requireServices(ctx, ['neverProvided'], { timeoutMs: 400 }),
    (error: Error) => {
      assert.match(error.message, /"neverProvided" is not present on the context/, error.message);
      assert.match(error.message, /is not present on the context/, 'the message must describe what was measured');
  assert.match(error.message, /static provide/, 'and name the likeliest causes in order');
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, 'the assertion must be bounded, or it inherits the hang it detects');
  await ctx.fiber.dispose();
});

test('requireServices passes quietly when the graph is satisfiable', async () => {
  // The cyclic variant of this test was deliberately dropped: with two plugins injecting each other, the
  // context cannot be disposed either -- unload blocks on dependents that never leave -- so the assertion was
  // uncontainable inside a test process. That behaviour is real and is recorded as an issue instead of being
  // replaced by a passing test that does not prove it.
  const ok = new Context();
  await ok.plugin(IdentityService, defaultIdentityConfig(fixture));
  await requireServices(ok, ['identity'], { timeoutMs: 1_000 });
  assert.ok(ok.identity);
  await ok.fiber.dispose();
});

test('createKernel refuses to report success when a required service never arrives', async () => {
  await assert.rejects(
    () => createKernel({ requiredServices: ['server'], timeoutMsIgnored: undefined } as never),
    /is not present on the context/,
    'boot must fail rather than hand back a context that quietly lacks the HTTP layer',
  );
});
