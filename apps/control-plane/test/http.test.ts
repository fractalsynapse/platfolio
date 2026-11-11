import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { loadSpec, validateResponse } from '@platfolio/api-contract';
import fs from 'node:fs';
import path from 'node:path';
import { registerRoutes, ROUTE_MANIFEST } from '../src/routes.ts';
import { configFromEnv, boot } from '../src/index.ts';
import { createKernel, disposeKernel } from '@platfolio/kernel';

const spec = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../../../api/control-plane.openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const jwksBody = JSON.stringify({ keys: [fixture.jwk] });

// The real app over a real socket: kernel -> server plugin -> routes -> OpenAPI validation. Nothing here is a
// stub of the thing under test, which is the only way a generated artifact boots the way production boots.
const ctx = await createKernel({ identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk], server: { port: 0 }, requiredServices: ['identity', 'server'] });
registerRoutes(ctx.server, { identity: ctx.identity, build: { version: '9.9.9', commit: 'abcdef0123456789', buildTime: '2026-11-11T00:00:00Z' } });
const base = () => `http://127.0.0.1:${String(ctx.server.address.port)}`;
after(async () => { await disposeKernel(ctx); });

const call = async (p: string, options: RequestInit = {}) => {
  const response = await fetch(base() + p, options);
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
};

/** The assertion that makes D41 real: every body a handler produces must satisfy the document. */
const againstSpec = (operationId: string, status: number, body: unknown) => {
  const check = validateResponse(spec, operationId, status, body);
  assert.ok(check.ok, `${operationId} ${String(status)} violates the spec: ${check.errors.join('; ')}\nbody was ${JSON.stringify(body).slice(0, 240)}`);
};

test('healthz, readyz and version answer, and each body matches the specification', async () => {
  const health = await call('/healthz');
  assert.equal(health.status, 200);
  againstSpec('getHealth', 200, health.body);

  const ready = await call('/readyz');
  assert.equal(ready.status, 200);
  againstSpec('getReady', 200, ready.body);
  const checks = (ready.body as { checks: Array<{ name: string; status: string; detail?: string }> }).checks;
  assert.deepEqual(checks.map((c) => c.name).sort(), ['database', 'identity']);
  const db = checks.find((c) => c.name === 'database')!;
  assert.equal(db.status, 'not-configured', 'Slice 1 has no persistence, and readiness must say so rather than pass it quietly');
  assert.ok(db.detail, 'a not-configured check must explain itself');

  const version = await call('/version');
  assert.equal(version.status, 200);
  againstSpec('getVersion', 200, version.body);
  assert.equal((version.body as { version: string }).version, '9.9.9');
  assert.equal((version.body as { providerContract: { name: string } }).providerContract.name, 'infra.provider');
});

test('liveness is identical between calls and the token is not a credential leak', async () => {
  const a = await call('/healthz');
  const b = await call('/healthz');
  assert.equal(JSON.stringify(a.body), JSON.stringify(b.body));
  assert.match((a.body as { livenessToken: string }).livenessToken, /^[0-9a-f]{16}$/);
});

test('whoami accepts a real signed token and refuses every forgery shape, with 401 bodies that match the spec', async () => {
  const good = await call('/api/v1/whoami', { headers: { authorization: `Bearer ${signToken(fixture, { scope: 'platfolio.user' })}` } });
  assert.equal(good.status, 200);
  againstSpec('getWhoami', 200, good.body);
  const claims = good.body as { subject: string; tenantAuthority: boolean; scope: string[] };
  assert.equal(claims.subject, 'user-conformance');
  assert.equal(claims.tenantAuthority, false, 'a platfolio user token asserts no tenant authority -- schema-enforced, not policy prose');

  const noCreds = await call('/api/v1/whoami');
  assert.equal(noCreds.status, 401);
  againstSpec('getWhoami', 401, noCreds.body);

  for (const forged of [
    signToken(fixture, { scope: 'platfolio.user', issuer: 'https://evil.test/realms/platfolio' }),
    signToken(fixture, { scope: 'platfolio.user', expiresIn: -7200 }),
    signToken(fixture, { scope: 'platfolio.user', kid: 'unknown-key' }),
    `${signToken(fixture, { scope: 'platfolio.user' }).split('.').slice(0, 2).join('.')}.AAAA`,
    (() => { const [h, p] = signToken(fixture, { scope: 'platfolio.user' }).split('.'); const evil = Buffer.from(JSON.stringify({ iss: fixture.issuer, aud: fixture.audience, sub: 'attacker', scope: 'platfolio.user', exp: Math.floor(Date.now() / 1000) + 9999 })).toString('base64url'); return `${h}.${evil}.${signToken(fixture).split('.')[2]}`; })(),
  ]) {
    const response = await call('/api/v1/whoami', { headers: { authorization: `Bearer ${forged}` } });
    assert.equal(response.status, 401, `a forged token was accepted: ${JSON.stringify(response.body)}`);
    againstSpec('getWhoami', 401, response.body);
  }
});

test('a verified token without the required scope is 403, so the spec does not carry a decorative status', async () => {
  const response = await call('/api/v1/whoami', { headers: { authorization: `Bearer ${signToken(fixture, { scope: 'profile email' })}` } });
  assert.equal(response.status, 403, 'scope enforcement must be reachable -- otherwise delete it from the spec');
  againstSpec('getWhoami', 403, response.body);
});

test('claims that are not allow-listed never reach the response', async () => {
  const token = signToken(fixture, { scope: 'platfolio.user', extra: { password: 'let-me-in', tenantAuthority: true, secret: 'hunter2' } });
  const response = await call('/api/v1/whoami', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  // Exact key sets, not substring hunting: my first draft searched for "tenantAuthority" and matched the
  // response's own honest `tenantAuthority: false` field -- a test that failed on a correct answer. What must be
  // true is that the body carries the allow-listed keys and nothing else, and carries no claim *values*.
  const body = response.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['audience', 'clientId', 'expiresAt', 'issuer', 'scope', 'subject', 'tenantAuthority']);
  const text = JSON.stringify(response.body);
  for (const needle of ['let-me-in', 'hunter2']) {
    assert.ok(!text.includes(needle), `response leaked a token claim value "${needle}"`);
  }
  assert.equal(body.tenantAuthority, false, 'the field is the platform denying authority, not the token asserting it');
});

test('unknown routes 404 as JSON and never hang', async () => {
  const response = await call('/nope');
  assert.equal(response.status, 404);
  // The transport fallback is not a spec operation, so it is not validated against the document -- but it must
  // still be a machine-readable body rather than a bare string the client has to guess at.
  assert.deepEqual(Object.keys(response.body as object).sort(), ['error', 'message']);
  assert.match((response.body as { message: string }).message, /no route for GET \/nope/);
});

test('the manifest and the document still agree (the drift check runs at request time too)', () => {
  assert.deepEqual(ROUTE_MANIFEST.map((r) => r.operationId).sort(), ['getHealth', 'getReady', 'getVersion', 'getWhoami']);
  for (const route of ROUTE_MANIFEST) {
    assert.ok(Object.values(spec.paths).some((item) => Object.entries(item as object).some(([, op]) => (op as { operationId?: string }).operationId === route.operationId)), `${route.operationId} is not in the spec`);
  }
});

test('configFromEnv refuses to start without an issuer, and never invents one', () => {
  assert.throws(() => configFromEnv({}), /PLATFOLIO_IDENTITY_ISSUER/);
  assert.throws(() => configFromEnv({ PLATFOLIO_IDENTITY_ISSUER: 'https://id.test' }), /PLATFOLIO_IDENTITY_AUDIENCE/);
  const ok = configFromEnv({ PLATFOLIO_IDENTITY_ISSUER: 'https://id.test/realms/p', PLATFOLIO_IDENTITY_AUDIENCE: 'api', PLATFOLIO_IDENTITY_JWKS_URI: 'https://id.test/jwks', PORT: '1234' });
  assert.equal(ok.port, 1234);
  assert.equal(ok.build.version, '0.0.0-dev', 'an unset version stays visibly a placeholder rather than pretending to be a release');
});

test('boot() refuses to start when the JWKS location is unknown, instead of serving an authenticating nobody', async () => {
  await assert.rejects(() => boot(configFromEnv({ PLATFOLIO_IDENTITY_ISSUER: 'https://id.test/realms/p', PLATFOLIO_IDENTITY_AUDIENCE: 'api' })), /PLATFOLIO_IDENTITY_JWKS_URI/);
});

test('boot() with a reachable key source serves authenticated traffic over HTTP', async () => {
  const fetchImpl = (async () => new Response(jwksBody, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const app = await boot({ issuer: fixture.issuer, audience: fixture.audience, jwksUri: 'https://id.test/jwks', host: '127.0.0.1', port: 0, build: { version: '1.2.3', commit: 'a'.repeat(40), buildTime: '2026-11-11T00:00:00Z' } }, fetchImpl);
  try {
    const url = `http://127.0.0.1:${String(app.address.port)}/api/v1/whoami`;
    const good = await fetch(url, { headers: { authorization: `Bearer ${signToken(fixture, { scope: 'platfolio.user' })}` } });
    assert.equal(good.status, 200, await good.text());
    const bad = await fetch(url);
    assert.equal(bad.status, 401);
    const version = await (await fetch(`http://127.0.0.1:${String(app.address.port)}/version`)).json() as { version: string; commit: string };
    assert.deepEqual([version.version, version.commit], ['1.2.3', 'a'.repeat(40)]);
  } finally {
    await app.stop();
  }
  await assert.rejects(() => fetch(`http://127.0.0.1:${String(app.address.port)}/version`), 'stop() must close the listener');
});
