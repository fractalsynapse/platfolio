import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { ENDPOINTS } from '@platfolio/api-contract/generated/types';
import type { OperationId, ParamsOf } from '@platfolio/api-contract/generated/types';
import { PollTransport, type AuthSource } from '../src/index.ts';

/**
 * #258, over a socket.
 *
 * `test/sdk.test.ts` proves the request shape by recording what the driver hands to an injected `fetch`. That is
 * one remove from the wire: the URL is a string the driver built, not a path a server resolved. This file removes
 * the last one — a real `node:http` server on loopback, the platform's own `fetch`, and no table but the
 * generated `ENDPOINTS` — so "the route table turns an operation id into a request" is measured rather than
 * described.
 *
 * **What this proves, and what it does not.** It proves the transport's half of rule 1: method, path
 * templating, percent-encoding, query assembly, header carriage, JSON body, and a 204 read as a success with no
 * body. It does **not** prove the control plane answers those paths the way the document says it will — that is
 * `api:check`'s route-manifest comparison (spec ↔ handlers, both directions), and a live check would need a
 * running stack. The base URL is loopback with an ephemeral port (D47: an endpoint is configuration; nothing
 * here is a committed host), and no credential crosses it but a literal test token.
 */

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const auth: AuthSource = { token: async () => 'a-token-from-the-shell' };

/** A server that answers whatever the driver asks with the shape the document declares for it. */
async function withServer<T>(respond: (seen: Seen) => { status: number; body?: unknown }, use: (baseUrl: string, seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: Seen = {
        method: String(req.method),
        url: String(req.url),
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      const { status, body } = respond(entry);
      if (status === 204 || body === undefined) {
        res.writeHead(status);
        res.end();
        return;
      }
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { address: string; port: number };
  // Loopback, ephemeral port: configuration supplied at run time, exactly as a shell supplies `baseUrl`.
  const baseUrl = `http://${address.address}:${String(address.port)}`;
  try {
    return await use(baseUrl, seen);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('the generated table drives a real HTTP request end to end', async () => {
  await withServer(() => ({ status: 200, body: [] }), async (baseUrl, seen) => {
    const transport = new PollTransport({ baseUrl, now: () => new Date('2026-11-15T10:00:00.000Z') });
    const result = await transport.call('listInstances', { params: {} }, auth);

    assert.equal(result.ok, true, `the transport refused a request its own table routed: ${JSON.stringify(result)}`);
    assert.equal(seen.length, 1, 'one call, one request');
    const call = seen[0];
    assert.ok(call);
    assert.equal(call.method, 'GET');
    assert.equal(call.url, ENDPOINTS.listInstances.path, 'the server resolved a path the table did not name');
    assert.equal(call.headers.authorization, 'Bearer a-token-from-the-shell', 'the injected AuthSource did not reach the socket');
  });
});

test('a path parameter is substituted, encoded, and arrives as one segment', async () => {
  await withServer(() => ({ status: 200, body: [] }), async (baseUrl, seen) => {
    const transport = new PollTransport({ baseUrl });
    await transport.call('getInstance', { params: { instanceId: 'a b/c' } as ParamsOf<'getInstance'> }, auth);
    await transport.call('getInstance', { params: { instanceId: '../../admin' } as unknown as ParamsOf<'getInstance'> }, auth);

    assert.equal(seen[0]?.url, '/api/v1/instances/a%20b%2Fc', 'the encoded value did not survive the socket as one segment');
    assert.equal(seen[1]?.url, '/api/v1/instances/..%2F..%2Fadmin', 'a traversal attempt reached the server as path structure');
  });
});

test('declared query parameters arrive in the query string, path parameters do not', async () => {
  await withServer(() => ({ status: 200, body: [] }), async (baseUrl, seen) => {
    const transport = new PollTransport({ baseUrl });
    await transport.call('listSecretPresence', {
      params: { instanceId: '01ABC', environment: 'production', service: 'api' },
    }, auth);
    assert.equal(seen[0]?.url, '/api/v1/instances/01ABC/secrets?environment=production&service=api');
  });
});

test('a mutation carries its JSON body, and a declared 204 reads as success', async () => {
  await withServer((seen) => (seen.method === 'PUT' ? { status: 204 } : { status: 404, body: { error: 'not-found', message: 'unplanned route' } }), async (baseUrl, seen) => {
    const transport = new PollTransport({ baseUrl });
    const result = await transport.call('putSecret', {
      params: { instanceId: '01ABC', name: 'DATABASE_URL' },
      body: { service: 'api', environment: 'production', value: 'postgres://somewhere/else' },
    }, auth);

    assert.equal(result.ok, true, `a 204 with no body was not read as the success the document declares: ${JSON.stringify(result)}`);
    const call = seen[0];
    assert.ok(call);
    assert.equal(call.method, 'PUT');
    assert.equal(call.url, '/api/v1/instances/01ABC/secrets/DATABASE_URL');
    assert.equal(call.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(call.body), { service: 'api', environment: 'production', value: 'postgres://somewhere/else' });
  });
});

test('a refusal the document declares comes back as the stable code, not a thrown error', async () => {
  await withServer(() => ({ status: 409, body: { error: 'capability-in-use', code: 'capability_in_use', message: 'two dependants' } }), async (baseUrl) => {
    const transport = new PollTransport({ baseUrl });
    const result = await transport.call('destroyInstance', { params: { instanceId: '01ABC' } }, auth);
    assert.deepEqual(result, { ok: false, error: { status: 409, code: 'capability_in_use', message: 'two dependants' } });
  });
});

test('an operation id that is not in the table is refused before anything reaches the socket', async () => {
  await withServer(() => ({ status: 200, body: [] }), async (baseUrl, seen) => {
    const transport = new PollTransport({ baseUrl });
    const ghost = 'listTeamEvents' as OperationId;
    await assert.rejects(() => transport.call(ghost, { params: {} }, auth), /no endpoint in the route table for operation "listTeamEvents"/);
    assert.equal(seen.length, 0, 'an unroutable operation id produced a request anyway');
  });
});
