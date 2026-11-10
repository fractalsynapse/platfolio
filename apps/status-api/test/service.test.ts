import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer, type BuildInfo } from '../src/service.ts';

const INFO: BuildInfo = { version: '1.2.3', commit: 'a'.repeat(40), buildTime: '2026-11-09T00:00:00Z' };
const server = createServer(INFO);
// listen() is asynchronous: without awaiting the binding, the first fetch races a socket that is not yet
// accepting and every test below fails on connection refused rather than on behaviour.
const listening = new Promise<void>((resolve) => { server.once('listening', () => { resolve(); }); });
server.listen(0, '127.0.0.1');
await listening;
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => new Promise<void>((resolve) => { server.close(() => resolve()); }));

async function get(path: string, method = 'GET') {
  const response = await fetch(base() + path, { method });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

test('/healthz is a stable liveness signal', async () => {
  const a = await get('/healthz');
  const b = await get('/healthz');
  assert.equal(a.status, 200);
  assert.equal(a.body, b.body, 'liveness must not vary between requests');
  const json = JSON.parse(a.body) as { status: string; livenessToken: string };
  assert.equal(json.status, 'ok');
  assert.match(json.livenessToken, /^[0-9a-f]{16}$/);
});

test('/version reports the build identity from the environment', async () => {
  const response = await get('/version');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body) as { name: string; providerContract: { name: string; version: string } };
  assert.equal(body.name, 'status-api');
  assert.deepEqual(body.providerContract, { name: 'infra.provider', version: '1.0.0' }, 'the contract it speaks is part of its identity');
});

test('/readyz is honest about having no dependency yet', async () => {
  const response = await get('/readyz');
  assert.equal(response.status, 200);
});

test('an unknown path 404s and a POST 405s, with an Allow header', async () => {
  assert.equal((await get('/nope')).status, 404);
  const post = await get('/healthz', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('responses are never cacheable', async () => {
  for (const path of ['/healthz', '/version', '/readyz']) {
    const response = await get(path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
});
