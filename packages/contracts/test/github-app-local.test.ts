import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';
import { createAppJwt, exchangeManifestCode, localDevManifest, localManifestTarget } from '../src/index.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

test('the local manifest keeps every URL on localhost and turns webhooks off', () => {
  const m = localDevManifest({ port: 8077 });
  assert.equal(m.url, 'http://localhost:8077');
  assert.deepEqual(m.callback_urls, ['http://localhost:8077/platfolio/callback']);
  assert.equal(m.redirect_url, 'http://localhost:8077/platfolio/callback');
  assert.equal(m.public, false);
  assert.deepEqual(m.default_events, [], 'a polling app with no events produces no failing deliveries');
  assert.equal('hook_attributes' in m, false, 'no webhook object rather than one with an empty URL');
});

test('a forwarding URL is used only when supplied, and always inactive', () => {
  const m = localDevManifest({ port: 8077, webhookUrl: 'https://smee.io/AbC' });
  assert.deepEqual(m.hook_attributes, { url: 'https://smee.io/AbC', active: false });
});

test('the flow is a POST to the settings endpoint, not a GET link with the manifest encoded', () => {
  assert.equal(localManifestTarget(), 'https://github.com/settings/apps/new');
  assert.equal(localManifestTarget('acme'), 'https://github.com/organizations/acme/settings/apps/new');
});

test('the app JWT is RS256, carries the app id, and verifies against its own public key', () => {
  const jwt = createAppJwt({ appId: 12345, privateKeyPem: PEM, now: 1_700_000_000_000 });
  const [h, p, s] = jwt.split('.');
  assert.ok(h && p && s, 'three segments');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
  assert.deepEqual(claims, { iat: 1_700_000_000, exp: 1_700_000_240, iss: '12345', jti: claims.jti });
  assert.ok(typeof claims.jti === 'string' && claims.jti.length > 8, 'a jti so a replayed JWT is distinguishable');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'));
  assert.equal(ok, true, 'signature must verify -- an unverifiable JWT is a runtime 401 nobody can debug');
});

test('a JWT longer than ten minutes is refused, because GitHub rejects it anyway', () => {
  assert.throws(() => createAppJwt({ appId: 1, privateKeyPem: PEM, ttlSeconds: 3600 }), /within 10 minutes/);
});

test('manifest exchange posts the code and requires every credential the next step needs', async () => {
  const calls: { url: string; method: string; auth?: string }[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.headers?.authorization ? { auth: init.headers.authorization } : {}) });
    return {
      ok: true, status: 201,
      async json() { return { id: 9, slug: 'platfolio-local', client_id: 'Iv1.x', client_secret: 'sec', webhook_secret: 'wh', pem: '-----BEGIN RSA PRIVATE KEY-----' }; },
    } as Response;
  }) as unknown as typeof globalThis.fetch;
  const creds = await exchangeManifestCode('a180b1a3d263c81bc6441d7b990bae27d4c10679', fetchImpl);
  assert.equal(calls[0]?.url, 'https://api.github.com/app-manifests/a180b1a3d263c81bc6441d7b990bae27d4c10679/conversions');
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(calls[0]?.auth, undefined, 'no credentials exist yet -- the flow bootstraps them');
  assert.deepEqual(creds, { appId: 9, slug: 'platfolio-local', clientId: 'Iv1.x', clientSecret: 'sec', webhookSecret: 'wh', privateKeyPem: '-----BEGIN RSA PRIVATE KEY-----' });
});

test('a malformed or short code is refused locally rather than sent', async () => {
  let made = 0;
  const fetchImpl = (async () => { made += 1; return { ok: true, status: 200, async json() { return {}; } } as Response; }) as unknown as typeof globalThis.fetch;
  await assert.rejects(() => exchangeManifestCode('short', fetchImpl), /not well-formed/);
  assert.equal(made, 0);
});

test('a truncated exchange response is named, not defaulted to empty strings', async () => {
  const fetchImpl = (async () => ({ ok: true, status: 201, async json() { return { id: 9, slug: 's' }; } }) ) as unknown as typeof globalThis.fetch;
  await assert.rejects(() => exchangeManifestCode('a'.repeat(40), fetchImpl), /missing client_id, client_secret, webhook_secret, pem/);
});
