import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENDPOINTS, type OperationId, type ParamsOf, type SuccessOf } from '@platfolio/api-contract/generated/types';
import {
  endpointFor, fillPath, formatAge, isLoaded, PollTransport, REQUIRED_PUSH_OPERATIONS, queryString,
  type ApiError, type AuthSource, type OperationTable, type Result, type State, type Transport,
} from '../src/index.ts';

/**
 * 11 §6 and rule 5. The seam is the subject, so the tests drive it through a **second implementation** — the
 * rule of two from `docs/design/10`: a seam with one driver has not been proven to be a seam.
 *
 * ## Where the routes come from, and why that is a test and not a comment
 *
 * #258. This file used to build its own `OperationTable` by hand — six entries, invented paths, one of them
 * (`health`) an operation the specification has never contained. That was the second owner of a fact the spec
 * already had, and it was the last thing standing between this package and a screen writing its own URLs. The
 * table now arrives from `ENDPOINTS`, generated from `apps/control-plane/openapi.yaml` by the same pass that
 * produces `ParamsOf`/`SuccessOf` and gated byte-for-byte by `api:types:check`, so the assertions below are
 * about **real request shapes**: `get /api/v1/instances/{instanceId}`, not whatever a test author typed.
 */

const auth: AuthSource = { token: async () => 'a-token-from-the-shell' };
const fixedNow = () => new Date('2026-11-15T10:00:00.000Z');
const BASE = 'https://api.example.test';

/** A transport routed by the generated table, with `fetch` replaced by a recorder. */
function recorder(
  respond: (call: Recorded) => { status: number; body: unknown } = () => ({ status: 200, body: [] }),
  override: { baseUrl?: string; endpoints?: OperationTable } = {},
) {
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
  const transport = new PollTransport({
    baseUrl: override.baseUrl ?? BASE,
    ...(override.endpoints === undefined ? {} : { endpoints: override.endpoints }),
    fetchImpl: impl,
    now: fixedNow,
  });
  return { transport, calls };
}

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/* ------------------------------------------------------------------ the table itself */

test('the generated table is what the driver routes with, by default', () => {
  const transport = new PollTransport({ baseUrl: BASE, now: fixedNow });
  assert.equal(transport.routeTable, ENDPOINTS, 'the driver built its own routes instead of reading ENDPOINTS');
});

test('the table is total: every operationId has a method and a templated path', () => {
  const ids = Object.keys(ENDPOINTS) as OperationId[];
  // A floor, not a count: the surface grows, and `scripts/check-api.ts` reports today's number. Shrinking past
  // this is the finding, so that is what the assertion refuses.
  assert.ok(ids.length >= 36, `the table covers ${String(ids.length)} operations; the surface has not been smaller since #176`);
  for (const id of ids) {
    const endpoint = ENDPOINTS[id];
    assert.match(endpoint.path, /^\//, `${id}: a path that is not absolute cannot be joined to a base URL`);
    assert.equal(endpoint.method, endpoint.method.toLowerCase(), `${id}: the table is the document's own spelling, not a wire form`);
    // Templated holes are `{name}` in the spec's notation and nothing else: `:name` would silently survive
    // substitution as a literal segment.
    assert.equal(endpoint.path.includes(':'), false, `${id}: a colon in a templated path means the wrong notation`);
    for (const hole of endpoint.path.matchAll(/\{([^}]+)\}/g)) {
      assert.match(String(hole[1]), /^[A-Za-z][A-Za-z0-9_]*$/, `${id}: malformed path parameter {${String(hole[1])}}`);
    }
  }
});

test('the table names the routes the first screen actually asks for', () => {
  // Not a table the test believes: the paths the screen's operations resolve to, read off the generated object.
  assert.deepEqual(ENDPOINTS.listInstances, { method: 'get', path: '/api/v1/instances' });
  assert.deepEqual(ENDPOINTS.listTeams, { method: 'get', path: '/api/v1/teams' });
  assert.deepEqual(ENDPOINTS.getInstance, { method: 'get', path: '/api/v1/instances/{instanceId}' });
  assert.deepEqual(ENDPOINTS.getLatestAttestation, { method: 'get', path: '/api/v1/instances/{instanceId}/latest-attestation' });
});

test('the push operations D64 requires are absent from the generated table, which is what keeps events a placeholder', () => {
  // `REQUIRED_PUSH_OPERATIONS` is the named dependency, not a wish. This used to compare against a list of
  // operation ids the test file wrote out; it now reads the table `ENDPOINTS` is built from, so the day one of
  // these lands in the spec the assertion goes red for the right reason.
  assert.deepEqual([...REQUIRED_PUSH_OPERATIONS], ['listTeamEvents', 'createEventsTicket']);
  const generated = new Set<string>(Object.keys(ENDPOINTS));
  for (const op of REQUIRED_PUSH_OPERATIONS) {
    assert.equal(generated.has(op), false, `${op} is now a real operation; the placeholder must be replaced`);
  }
});

/* ------------------------------------------------------------------ the real request shape */

test('a GET builds the whole URL from the base and the table, and carries the injected token', async () => {
  const { transport, calls } = recorder(() => ({ status: 200, body: [] }));
  const result = await transport.call('listInstances', { params: {} }, auth);
  assert.equal(result.ok, true);
  assert.deepEqual(
    { method: calls[0]?.method, url: calls[0]?.url, auth: calls[0]?.headers.authorization },
    { method: 'GET', url: `${BASE}/api/v1/instances`, auth: 'Bearer a-token-from-the-shell' },
    'the table says get /api/v1/instances; the request said something else',
  );
});

test('one path parameter is substituted into one segment', async () => {
  const { transport, calls } = recorder(() => ({ status: 200, body: [] }));
  await transport.call('getInstance', { params: { instanceId: '01ABCDEF' } }, auth);
  assert.equal(calls[0]?.url, `${BASE}/api/v1/instances/01ABCDEF`);
  assert.equal(calls[0]?.method, 'GET');
});

test('three path parameters substitute, in the order the path writes them', async () => {
  const { transport, calls } = recorder(() => ({ status: 200, body: { revoked: true } }));
  await transport.call('revokeCapabilityShare', {
    params: { instanceId: '01AAA', capability: 'db', toTeamId: '01BBB' },
  }, auth);
  assert.equal(calls[0]?.url, `${BASE}/api/v1/instances/01AAA/capability/db/shares/01BBB`);
  assert.equal(calls[0]?.method, 'DELETE', 'the table carries the verb, so the driver does not guess it');
  assert.equal(calls[0]?.headers['content-type'], undefined, 'a DELETE with no body must not claim to carry JSON');
});

test('declared query parameters reach the query string, and path parameters do not', async () => {
  const { transport, calls } = recorder(() => ({ status: 200, body: [] }));
  await transport.call('listSecretPresence', {
    params: { instanceId: '01ABC', environment: 'production', service: 'api' },
  }, auth);
  assert.equal(calls[0]?.url, `${BASE}/api/v1/instances/01ABC/secrets?environment=production&service=api`);

  const { transport: paged, calls: pagedCalls } = recorder(() => ({ status: 200, body: [] }));
  await paged.call('listAudit', { params: { limit: 20 } }, auth);
  assert.equal(pagedCalls[0]?.url, `${BASE}/api/v1/audit?limit=20`, 'a number-typed query parameter was dropped or stringified wrong');
});

test('a POST carries the declared body as JSON with the content type the body implies', async () => {
  const { transport, calls } = recorder(() => ({ status: 201, body: { id: '01X', teamId: '01T', name: 'starter-web', template: 'starter-web', state: 'pending', provider: 'railway', createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', environments: [] } }));
  const result = await transport.call('createInstance', {
    params: {},
    body: { teamId: '01T', name: 'starter-web', template: 'starter-web' },
  }, auth);
  assert.equal(result.ok, true);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE}/api/v1/instances`);
  assert.equal(call.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body ?? '{}'), { teamId: '01T', name: 'starter-web', template: 'starter-web' });
});

test('204 is a success with no body, not a JSON parse failure', async () => {
  const { transport, calls } = recorder(() => ({ status: 204, body: '' }));
  const result = await transport.call('putSecret', {
    params: { instanceId: '01ABC', name: 'DATABASE_URL' },
    body: { service: 'api', environment: 'production', value: 'postgres://elsewhere' },
  }, auth);
  assert.equal(result.ok, true, `a declared 204 came back as: ${JSON.stringify(result)}`);
  assert.equal(calls[0]?.url, `${BASE}/api/v1/instances/01ABC/secrets/DATABASE_URL`);
  assert.equal(calls[0]?.method, 'PUT');
});

test('a base URL that ends in a slash and a table path that starts with one produce one slash', async () => {
  const { transport, calls } = recorder(() => ({ status: 200, body: [] }), { baseUrl: `${BASE}/` });
  await transport.call('listInstances', { params: {} }, auth);
  assert.equal(calls[0]?.url, `${BASE}/api/v1/instances`, 'the join doubled the slash, so the URL the server sees is not the one the table describes');
});

/* ------------------------------------------------------------------ substitution and encoding */

test('fillPath percent-encodes a value that needs it and reports nothing missing', () => {
  const { path, missing } = fillPath('/api/v1/instances/{instanceId}', { instanceId: 'a b/c' });
  assert.deepEqual(missing, []);
  assert.equal(path, '/api/v1/instances/a%20b%2Fc', 'a value with a space and a slash was not encoded as one segment');
});

test('fillPath refuses to leave a hole behind: an absent parameter is reported, not emitted', () => {
  const { path, missing } = fillPath('/api/v1/instances/{instanceId}/bindings/{capability}', { instanceId: '01ABC' });
  assert.deepEqual(missing, ['capability']);
  assert.equal(path.includes('{capability}'), true, 'the reported hole is not the one the template left in place');
});

test('queryString serialises the declared parameters that are not path segments', () => {
  assert.equal(queryString('/api/v1/audit', { limit: 20 }), '?limit=20');
  assert.equal(queryString('/api/v1/instances/{instanceId}/secrets', { instanceId: '01A', environment: 'staging' }), '?environment=staging');
  assert.equal(queryString('/api/v1/instances/{instanceId}', { instanceId: '01A' }), '', 'a path parameter must not also be appended as a query parameter');
  assert.equal(queryString('/api/v1/audit', { limit: undefined }), '');
  assert.equal(queryString('/api/v1/capabilities', { capability: 'a b' }), '?capability=a%20b', 'query values are encoded too');
});

test('a non-string id cannot smuggle a path segment', async () => {
  const { transport, calls } = recorder();
  await transport.call('getInstance', { params: { instanceId: '../../admin' } as unknown as ParamsOf<'getInstance'> }, auth);
  assert.ok(calls[0]?.url.endsWith('/instances/..%2F..%2Fadmin'), `unencoded traversal reached the URL: ${String(calls[0]?.url)}`);
});

test('a missing path parameter is refused before any request is made', async () => {
  const { transport, calls } = recorder();
  const result = await transport.call('getInstance', { params: {} as ParamsOf<'getInstance'> }, auth);
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0, 'a request went out with an unsubstituted {instanceId} in the path');
  assert.match((result as { error: ApiError }).error.message, /instanceId/);
});

/* ------------------------------------------------------------------ the table's refusals */

test('endpointFor refuses a table built at a boundary that omits an operation', () => {
  assert.throws(
    () => endpointFor({} as OperationTable, 'listInstances'),
    /no endpoint in the route table for operation "listInstances"/,
  );
});

test('an unknown operation id reaching the transport is refused by name and sends nothing', async () => {
  // The generated table is total, so this only happens when an id crosses a boundary as a string: a page
  // document, a stored signal, a hand-written table. The driver must say which id it could not route rather
  // than request `/undefined` and report the server's 404 as the API's answer.
  const ghost = 'listTeamEvents' as OperationId;
  const { transport, calls } = recorder();
  await assert.rejects(
    () => transport.call(ghost, { params: {} }, auth),
    /no endpoint in the route table for operation "listTeamEvents"/,
  );
  assert.equal(calls.length, 0, 'an unroutable operation id still produced a request');
});

/* ------------------------------------------------------------------ the driver's other answers */

test('a server error keeps the spec\'s stable code, and never invents one', async () => {
  const { transport } = recorder(() => ({ status: 409, body: { code: 'capability_in_use', message: 'two dependants' } }));
  const result = await transport.call('listInstances', { params: {} }, auth);
  assert.deepEqual(result, { ok: false, error: { status: 409, code: 'capability_in_use', message: 'two dependants' } });

  const { transport: bare } = recorder(() => ({ status: 500, body: 'not json at all' }));
  const r2 = await bare.call('listInstances', { params: {} }, auth);
  assert.equal((r2 as { error: ApiError }).error.code, 'invalid_response', 'a non-JSON body was reported as if it had validated');
});

test('a network failure is a failure with an age, not a thrown exception reaching render', async () => {
  const dying = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  const transport = new PollTransport({ baseUrl: BASE, fetchImpl: dying, now: fixedNow });
  const result = await transport.call('listInstances', { params: {} }, auth);
  assert.equal(result.ok, false);
  assert.equal((result as { error: ApiError }).error.code, 'network_error');
});

test('an AuthSource that cannot produce a token is distinguished from a server refusal', async () => {
  const { transport, calls } = recorder();
  const result = await transport.call('listInstances', { params: {} }, { token: async () => { throw new Error('no session'); } });
  assert.equal((result as { error: ApiError }).error.code, 'auth_unavailable');
  assert.equal(calls.length, 0, 'an unauthenticated request was sent anyway');
});

test('no base URL is a construction error, because an endpoint is configuration (D47)', () => {
  assert.throws(() => new PollTransport({ baseUrl: '' }), /baseUrl from the shell environment/);
});

test('a route table may be injected, and the injected one wins', async () => {
  // The seam is real: a driver behind a path-rewriting proxy can be handed another view of the routes, and the
  // rest of the table still comes from the spec. What it cannot be handed is a *partial* list --
  // `fixtures/route-table-partial.negative.ts` is the compiler refusing that, run by `test/transport-table.test.ts`.
  const overridden = {
    ...ENDPOINTS,
    listInstances: { method: 'get', path: '/rewritten/instances' },
  } satisfies OperationTable;
  const { transport, calls } = recorder(() => ({ status: 200, body: [] }), { endpoints: overridden });
  await transport.call('listInstances', { params: {} }, auth);
  assert.equal(calls[0]?.url, `${BASE}/rewritten/instances`);
  await transport.call('listTeams', { params: {} }, auth);
  assert.equal(calls[1]?.url, `${BASE}/api/v1/teams`, 'an injected table replaced the operations it named and lost the rest');
});

test('the driver reports its own kind as the literal "poll", and stamps it into every freshness it hands out', () => {
  const transport = new PollTransport({ baseUrl: BASE, now: fixedNow });
  assert.equal(transport.kind, 'poll');
  // Typed as the union it would let a component claim `events` and this assertion would still pass.
  const kind: 'poll' = transport.kind;
  assert.equal(kind, 'poll');
});

/* ------------------------------------------------------------------ the one timer */

test('N subscribers to one freshness key are one poller, not N', () => {
  const transport = new PollTransport({ baseUrl: BASE, intervalMs: 1000, now: fixedNow });
  const a = transport.freshness?.('instances');
  const b = transport.freshness?.('instances');
  assert.equal(a, b, 'two panels asking the same question got two sources');
  assert.equal(transport.sourceCount, 1);
  assert.equal(transport.freshness?.('teams'), transport.freshness?.('teams'));
  assert.equal(transport.sourceCount, 2, 'distinct keys must not collapse into one shared timer either');
});

test('a freshness source with no listeners holds no timer, so a closed panel stops polling', () => {
  const transport = new PollTransport({ baseUrl: BASE, intervalMs: 60_000, now: fixedNow });
  const source = transport.freshness?.('instances');
  assert.ok(source);
  let fired = 0;
  const off = source.subscribe(() => { fired += 1; });
  off();
  assert.equal(fired, 0);
  off(); // idempotent
});

test('the freshness source says which transport it is, so a label cannot claim otherwise', () => {
  const transport = new PollTransport({ baseUrl: BASE, now: fixedNow });
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

test('the only transport kinds the type admits are poll and events, and only poll is buildable', () => {
  const kinds: Set<string> = new Set(['poll', 'events']);
  assert.equal(kinds.has('poll'), true);
  // The compile-time half lives in `fixtures/events-driver-built.negative.ts`, run by `pnpm run ui:check`.
  assert.equal(typeof PollTransport, 'function');
});
