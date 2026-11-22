import assert from 'node:assert/strict';
import { test } from 'node:test';
import sodium from 'libsodium-wrappers-sumo';
import { GithubActionsSecretWriter } from '../src/index.ts';

// A real recipient key: the library rejects anything that is not a decodable 32-byte value, so a fixture
// that merely looks like base64 tests the fixture rather than the code.
await sodium.ready;
// GitHub serves the key URL-safe; the fixture must match the real shape, not the convenient one.
const KEY = sodium.to_base64(sodium.crypto_box_keypair().publicKey, sodium.base64_variants.URLSAFE);
const API = 'https://api.github.com';

function fake(handler: (url: string, method?: string) => { status: number; json?: unknown }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: init.body } : {}) });
    const r = handler(url, init?.method);
    return { ok: r.status < 400, status: r.status, async json() { return r.json ?? {}; }, async text() { return JSON.stringify(r.json ?? {}); } } as Response;
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof globalThis.fetch };
}

/**
 * The key endpoint is scoped to the repository or environment and carries NO secret name. Being strict here
 * matters: an earlier fake accepted any URL ending in `public-key`, so the test passed against a wrong
 * endpoint and the first live call answered 404. A fake more forgiving than the real API documents a
 * fictional one.
 */
const keyEndpoint = (path: string) => (url: string, method?: string) => url === path && method !== 'PUT';
const okKey = (path: string, keyId = 'ABC') => (url: string, method?: string) =>
  keyEndpoint(path)(url, method) ? { status: 200, json: { key_id: keyId, key: KEY } } : { status: 204 };

const writer = (f: typeof globalThis.fetch) => new GithubActionsSecretWriter({ token: 't', fetch: f });

test('presence distinguishes set, missing and "we could not tell"', async () => {
  const cases: [number, string][] = [[204, 'set'], [404, 'missing'], [500, 'unverifiable']];
  for (const [status, expected] of cases) {
    const { fetchImpl } = fake(() => ({ status }));
    assert.equal(await writer(fetchImpl).presence({ repo: 'o/r', name: 'APP_SECRET' }), expected, `HTTP ${status}`);
  }
  // A transport failure is not evidence of absence -- reporting "missing" would send a tenant to re-supply
  // a secret they already set.
  const broken = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof globalThis.fetch;
  assert.equal(await writer(broken).presence({ repo: 'o/r', name: 'APP_SECRET' }), 'unverifiable');
});

test('a write fetches the repo public key, then PUTs ciphertext to the named secret', async () => {
  const keyUrl = `${API}/repos/o/r/actions/secrets/public-key`;
  const { calls, fetchImpl } = fake(okKey(keyUrl));
  await writer(fetchImpl).write({ repo: 'o/r', name: 'APP_SECRET' }, 'hunter2-not-stored-anywhere');

  assert.equal(calls.length, 2, calls.map((c) => `${c.method} ${c.url}`).join(' | '));
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [['GET', keyUrl], ['PUT', `${API}/repos/o/r/actions/secrets/APP_SECRET`]]);
  const body = JSON.parse(calls[1]!.body ?? '{}') as { key_id?: string; encrypted_value?: string };
  assert.equal(body.key_id, 'ABC');
  assert.ok(body.encrypted_value && body.encrypted_value.length > 30, 'ciphertext present');
  assert.ok(!calls[1]!.body!.includes('hunter2'), 'the plaintext never appears on the wire');
});

test('an environment secret goes to the environment endpoint, matching where the plan says it applies', async () => {
  const keyUrl = `${API}/repos/o/r/environments/production/secrets/public-key`;
  const { calls, fetchImpl } = fake(okKey(keyUrl, 'ENCKEY'));
  await writer(fetchImpl).write({ repo: 'o/r', name: 'APP_SECRET', environment: 'production' }, 'v');
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [
    ['GET', keyUrl],
    ['PUT', `${API}/repos/o/r/environments/production/secrets/APP_SECRET`],
  ], calls.map((c) => `${c.method} ${c.url}`).join(' | '));
});

test('a failed key lookup or a refused write is reported, not swallowed', async () => {
  const noKey = fake(() => ({ status: 404 }));
  await assert.rejects(() => writer(noKey.fetchImpl).write({ repo: 'o/r', name: 'S' }, 'v'), /no public key|public-key request failed/);

  const refused = fake((_url, method) => (method === 'PUT' ? { status: 403 } : { status: 200, json: { key_id: 'K', key: KEY } }));
  await assert.rejects(() => writer(refused.fetchImpl).write({ repo: 'o/r', name: 'S' }, 'v'), /was not written \(403\)/);
});

test('remove is the rotation path: delete and re-supply, never replay (D32)', async () => {
  const { calls, fetchImpl } = fake(() => ({ status: 204 }));
  await writer(fetchImpl).remove({ repo: 'o/r', name: 'APP_SECRET' });
  assert.equal(calls[0]?.method, 'DELETE');
  const gone = fake(() => ({ status: 404 }));
  await writer(gone.fetchImpl).remove({ repo: 'o/r', name: 'APP_SECRET' });   // already gone is success
});

test('there is no way to read a secret back, by interface shape', () => {
  const w = new GithubActionsSecretWriter({ token: 'x' }) as unknown as Record<string, unknown>;
  for (const forbidden of ['get', 'read', 'getValue', 'fetch', 'list', 'secrets']) {
    assert.equal(w[forbidden], undefined, `the writer must not expose ${forbidden}()`);
  }
  assert.equal(typeof w.presence, 'function', 'presence is the only question it may ask');
});

test('names and values are validated before anything is sent', async () => {
  const { calls, fetchImpl } = fake(() => ({ status: 204 }));
  await assert.rejects(() => writer(fetchImpl).presence({ repo: 'o/r', name: 'APP-SECRET!' }), /invalid secret name/);
  await assert.rejects(() => writer(fetchImpl).write({ repo: 'o/r', name: 'ok' }, ''), /no value to write/);
  assert.equal(calls.length, 0, 'no request went out for an invalid name');
});
