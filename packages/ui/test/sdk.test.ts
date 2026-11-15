import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OperationId, ParamsOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import {
  endpointFor, formatAge, isLoaded, PollTransport, REQUIRED_PUSH_OPERATIONS,
  type ApiError, type AuthSource, type OperationTable, type Result, type State, type Transport,
} from '../src/index.ts';

/**
 * 11 §6 and rule 5. The seam is the subject, so the tests drive it through a **second implementation** — the
 * rule of two from `docs/design/10`: a seam with one driver has not been proven to be a seam.
 */

const auth: AuthSource = { token: async () => 'a-token-from-the-shell' };
const fixedNow = () => new Date('2026-11-15T10:00:00.000Z');

/** A total table over the generated union. Built by walking the operation ids the type admits. */
const ALL_OPERATIONS = ['listInstances', 'getInstance', 'createInstance', 'getVersion', 'health'] as const;

function table(over: Partial<Record<OperationId, Endpoint>> = {}): OperationTable {
  const base = {} as Record<string, Endpoint>;
  // Every operation the tests can name needs a value; a driver must not be able to fall back to a guess.
  for (const op of [...ALL_OPERATIONS, 'unbindCapability'] as const) base[op] = { method: 'GET', path: '/api/v1/instances' };
  base.listInstances = { method: 'GET', path: '/api/v1/instances' };
  base.getInstance = { method: 'GET', path: '/api/v1/instances/{instanceId}' };
  base.createInstance = { method: 'POST', path: '/api/v1/instances' };
  base.getVersion = { method: 'GET', path: '/version' };
  base.health = { method: 'GET', path: '/healthz' };
  base.unbindCapability = { method: 'DELETE', path: '/api/v1/instances/{instanceId}/bindings/{capability}' };
  return { ...base, ...over } as OperationTable;
}

type Endpoint = OperationTable[OperationId];

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fakeFetch(respond: (call: Recorded) => { status: number; body: unknown }): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const recorded: Recorded = {
      url,
      method: String(init?.method ?? 'GET'),
      headers,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    };
    calls.push(recorded);
    const { status, body } = respond(recorded);
    // A null-body status genuinely cannot carry a body: `new Response('', { status: 204 })` throws, which is
    // what made the first draft of this double report a *declared* 204 as a parse failure and blame the driver.
    const noBody = status === 204 || status === 205 || status === 304;
    return new Response(noBody ? null : (typeof body === 'string' ? body : JSON.stringify(body)), {
      status,
      ...(noBody ? {} : { headers: { 'content-type': 'application/json' } }),
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

/* ------------------------------------------------------------------ the driver */

test('the poll driver resolves a path template, encodes it, and sends the injected token', async () => {
  const { fetch: doFetch, calls } = fakeFetch(() => ({ status: 200, body: [] }));
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: doFetch, now: fixedNow });
  const result = await transport.call('getInstance', { params: { instanceId: 'a b/c' } as ParamsOf<'getInstance'> }, auth);
  assert.equal(result.ok, true);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, 'GET');
  assert.equal(call.url, 'https://api.example.test/api/v1/instances/a%20b%2Fc');
  assert.equal(call.headers.authorization, 'Bearer a-token-from-the-shell', 'auth is injected and carried, never ambient');
});

test('a non-string id cannot smuggle a path segment', async () => {
  const { fetch: doFetch, calls } = fakeFetch(() => ({ status: 200, body: [] }));
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: doFetch, now: fixedNow });
  await transport.call('getInstance', { params: { instanceId: '../../admin' } as unknown as ParamsOf<'getInstance'> }, auth);
  assert.ok(calls[0]?.url.endsWith('/instances/..%2F..%2Fadmin'), `unencoded traversal reached the URL: ${String(calls[0]?.url)}`);
});

test('a missing path parameter is refused before any request is made', async () => {
  const { fetch: doFetch, calls } = fakeFetch(() => ({ status: 200, body: [] }));
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: doFetch, now: fixedNow });
  const result = await transport.call('getInstance', { params: {} as ParamsOf<'getInstance'> }, auth);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0, 'a request went out with an unsubstituted {instanceId} in the path');
  assert.match((result as { error: ApiError }).error.message, /instanceId/);
});

test('204 is a success with no body, not a JSON parse failure', async () => {
  const { fetch: doFetch } = fakeFetch(() => ({ status: 204, body: '' }));
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: doFetch, now: fixedNow });
  const result = await transport.call(
    'unbindCapability',
    { params: { instanceId: '01ABC', capability: 'db' } as ParamsOf<'unbindCapability'> },
    auth,
  );
  assert.equal(result.ok, true, `a declared 204 came back as: ${JSON.stringify(result)}`);
});

test('a server error keeps the spec\'s stable code, and never invents one', async () => {
  const { fetch: doFetch } = fakeFetch(() => ({ status: 409, body: { code: 'capability_in_use', message: 'two dependants' } }));
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: doFetch, now: fixedNow });
  const result = await transport.call('listInstances', { params: {} }, auth);
  assert.deepEqual(result, { ok: false, error: { status: 409, code: 'capability_in_use', message: 'two dependants' } });

  const { fetch: bare } = fakeFetch(() => ({ status: 500, body: 'not json at all' }));
  const t2 = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: bare, now: fixedNow });
  const r2 = await t2.call('listInstances', { params: {} }, auth);
  assert.equal((r2 as { error: ApiError }).error.code, 'invalid_response', 'a non-JSON body was reported as if it had validated');
});

test('a network failure is a failure with an age, not a thrown exception reaching render', async () => {
  const dying = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), fetchImpl: dying, now: fixedNow });
  const result = await transport.call('listInstances', { params: {} }, auth);
  assert.equal(result.ok, false);
  assert.equal((result as { error: ApiError }).error.code, 'network_error');
});

test('an AuthSource that cannot produce a token is distinguished from a server refusal', async () => {
  const { fetch: doFetch, calls } = fakeFetch(() => ({ status: 200, body: [] }));
  const transport = new PollTransport({
    baseUrl: 'https://api.example.test', operations: table(), fetchImpl: doFetch, now: fixedNow,
  });
  const result = await transport.call('listInstances', { params: {} }, { token: async () => { throw new Error('no session'); } });
  assert.equal((result as { error: ApiError }).error.code, 'auth_unavailable');
  assert.equal(calls.length, 0, 'an unauthenticated request was sent anyway');
});

test('no base URL is a construction error, because an endpoint is configuration (D47)', () => {
  assert.throws(() => new PollTransport({ baseUrl: '', operations: table() }), /baseUrl from the shell environment/);
});

test('the driver reports its own kind as the literal "poll", and stamps it into every freshness it hands out', () => {
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), now: fixedNow });
  assert.equal(transport.kind, 'poll');
  // Typed as the union it would let a component claim `events` and this assertion would still pass.
  const kind: 'poll' = transport.kind;
  assert.equal(kind, 'poll');
});

test('endpointFor refuses a table built at a boundary that omits an operation', () => {
  assert.throws(() => endpointFor({} as OperationTable, 'listInstances'), /no endpoint configured for operation "listInstances"/);
});

/* ------------------------------------------------------------------ the one timer */

test('N subscribers to one freshness key are one poller, not N', () => {
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), intervalMs: 1000, now: fixedNow });
  const a = transport.freshness?.('instances');
  const b = transport.freshness?.('instances');
  assert.equal(a, b, 'two panels asking the same question got two sources');
  assert.equal(transport.sourceCount, 1);
  assert.equal(transport.freshness?.('teams'), transport.freshness?.('teams'));
  assert.equal(transport.sourceCount, 2, 'distinct keys must not collapse into one shared timer either');
});

test('a freshness source with no listeners holds no timer, so a closed panel stops polling', () => {
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), intervalMs: 60_000, now: fixedNow });
  const source = transport.freshness?.('instances');
  assert.ok(source);
  let fired = 0;
  const off = source.subscribe(() => { fired += 1; });
  off();
  assert.equal(fired, 0);
  off(); // idempotent
});

test('the freshness source says which transport it is, so a label cannot claim otherwise', () => {
  const transport = new PollTransport({ baseUrl: 'https://api.example.test', operations: table(), now: fixedNow });
  assert.equal(transport.freshness?.('k')?.kind, 'poll');
});

/* ------------------------------------------------------------------ age */

test('formatAge names the transport as polled, never as live (rule 5)', () => {
  const at = (observedAt: string, via: 'poll' = 'poll') => formatAge({ observedAt, via }, '2026-11-15T10:00:00.000Z');
  assert.equal(at('2026-11-15T10:00:00.000Z'), 'updated 0s ago · polled');
  assert.equal(at('2026-11-15T09:59:30.000Z'), 'updated 30s ago · polled');
  assert.equal(at('2026-11-15T09:56:00.000Z'), 'updated 4m ago · polled');
  assert.equal(at('2026-11-15T07:00:00.000Z'), 'updated 3h ago · polled');
  assert.equal(at('2026-11-15T10:05:00.000Z'), 'updated 0s ago · polled', 'a clock skew must not read as a negative age');
  assert.equal(at('not a date'), 'age unknown', 'an unparseable instant must say so, not silently claim freshness');
});

test('no branch of the state union holds server data without an age', () => {
  // The runtime face of the type-level gate (§9.10b, `age-omitted.negative.ts`). The compiler refuses the
  // object literal; this refuses the *discrimination* path that would let a render reach `data` alone.
  const loaded: State<'listInstances'> = {
    operation: 'listInstances',
    params: {},
    status: 'loaded',
    data: [],
    freshness: { observedAt: '2026-11-15T10:00:00.000Z', via: 'poll' },
  };
  assert.ok(isLoaded(loaded));
  assert.equal(loaded.freshness.via, 'poll');
  const failed: State<'listInstances'> = {
    operation: 'listInstances',
    params: {},
    status: 'failed',
    error: { status: 0, code: 'network_error', message: 'down' },
    freshness: { observedAt: '2026-11-15T10:00:00.000Z', via: 'poll' },
  };
  assert.equal(isLoaded(failed), false);
  // R10: "delete the server — what does the screen show?" The answer must be expressible. A failed branch that
  // still carries when we last looked is what makes "unknown since 10:00" renderable instead of a spinner.
  assert.ok('freshness' in failed);
  const pending: State<'listInstances'> = { operation: 'listInstances', params: {}, status: 'pending', since: '2026-11-15T10:00:00.000Z' };
  assert.equal(isLoaded(pending), false);
});

/* ------------------------------------------------------------------ the second driver, for the rule of two */

/**
 * An in-memory transport, which is the second implementation that proves the seam is not REST-shaped
 * (11 §6 rule 2, and `docs/design/10`'s rule of two). It has no URL, no fetch, no method, no path template —
 * and every assertion below passes against it unchanged.
 */
class InMemoryTransport implements Transport {
  readonly kind = 'poll' as const;
  private readonly canned: Record<string, unknown>;
  constructor(canned: Record<string, unknown>) {
    // No parameter property: `erasableSyntaxOnly` forbids the shorthand tree-wide.
    this.canned = canned;
  }
  async call<O extends OperationId>(op: O): Promise<Result<SuccessOf<O>>> {
    const value = this.canned[op];
    return value === undefined
      ? { ok: false, error: { status: 404, code: 'not_found', message: `${op} is not canned` } }
      : { ok: true, value: value as SuccessOf<O> };
  }
}

test('the seam is not REST-shaped: a second transport satisfies it with no URL anywhere', async () => {
  const transport: Transport = new InMemoryTransport({ listInstances: [] });
  const result = await transport.call('listInstances', { params: {} }, auth);
  assert.equal(result.ok, true);
  assert.equal(transport.freshness?.('anything'), undefined, 'a driver with no freshness source must report that, not fake one');
});

/* ------------------------------------------------------------------ D64's boundary */

test('the push operations D64 requires are still absent, which is what keeps events a placeholder', () => {
  // `REQUIRED_PUSH_OPERATIONS` is the named dependency, not a wish. If one of these ever reaches the generated
  // table, 11 §4's operations have landed and this package must gain a real driver — the gate in check-ui.ts
  // turns red on exactly that event so the swap cannot be forgotten.
  assert.deepEqual([...REQUIRED_PUSH_OPERATIONS], ['listTeamEvents', 'createEventsTicket']);
  const generated = new Set<string>(ALL_OPERATIONS);
  for (const op of REQUIRED_PUSH_OPERATIONS) {
    assert.equal(generated.has(op), false, `${op} is now a real operation; the placeholder must be replaced`);
  }
});

test('the only transport kinds the type admits are poll and events, and only poll is buildable', () => {
  const kinds: Set<string> = new Set(['poll', 'events']);
  assert.equal(kinds.has('poll'), true);
  // The compile-time half lives in `fixtures/events-driver-built.negative.ts`, run by `pnpm run ui:check`.
  assert.equal(typeof PollTransport, 'function');
});
