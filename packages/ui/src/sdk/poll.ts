import { ENDPOINTS, type Endpoint, type OperationId, type ParamsOf, type RequestBodyOf, type SuccessOf } from '@platfolio/api-contract/generated/types';
import type { ApiError, AuthSource, Freshness, FreshnessSource, Result, Transport, Unsubscribe } from './transport.ts';

/**
 * The `poll` transport driver — **the only file in this package allowed to hold a timer, build a URL, or call
 * `fetch`** (gate §9.2). That is not a convention asserted in a comment: `scripts/check-ui.ts` reads this exact
 * path out of its own allowlist and fails on any other file that does these things, and the allowlist is
 * falsified by test.
 *
 * ## Where the routes come from (#258)
 *
 * From `ENDPOINTS`, generated into the same module as the type maps by the same parse of
 * `apps/control-plane/openapi.yaml` and gated byte-for-byte by `api:types:check`. An operation id therefore
 * turns into `get /api/v1/instances/{instanceId}` without anyone writing that string down a second time.
 * Before #258 the generated module carried the types and not the routes, and this file took an **injected**
 * table someone hand-assembled: one fact with two owners, in the exact place rule 1 says must not have two.
 * `test/transport-table.test.ts` is what keeps it from coming back: it walks this package's sources for a
 * path literal, requires this file to be the only one that reads the generated table, runs the same scan over
 * an in-memory mutated copy and requires it to report the planted route list, and compiles
 * `fixtures/route-table-partial.negative.ts` to prove a partial table is a compile error rather than a
 * smaller truth.
 *
 * The seam is still a seam. `PollTransportConfig.endpoints` is injectable and typed `OperationTable`, which is
 * total over the generated union, so a driver can be given a different view of the world (a test that records
 * requests, a deployment behind a path-rewriting proxy) and cannot be given a partial list of routes. The
 * default is the generated table, so the shell supplies an origin and nothing else — which is also the whole
 * of D47 read from this side: a base URL is configuration, a path is a fact about the API.
 *
 * ## Path templating, and why the encoding rule lives here
 *
 * `ENDPOINTS` keeps the path **templated**. Nothing percent-encodes at generation time, because the value that
 * fills `{instanceId}` is the caller's `ParamsOf<O>` and does not exist until a request is made. So the rule —
 * substitute the whole value through `encodeURIComponent`, refuse rather than leave a hole — lives in
 * `fillPath` below. That the hole is *fillable at all* is not this file's assumption: the generated module
 * asserts it per operation with `ROUTES_ARE_FILLABLE`, and the emitter refuses a template whose placeholder no
 * required `in: path` parameter of that operation names. The rule lives *here* for two reasons and no third:
 *
 * - `packages/api-contract` has no parameter-to-URL code to reuse. Measured: it types parameters
 *   (`ApiParameters`), validates bodies against the spec (`validateResponse`), and never serialises one into a
 *   URL. Writing a serialiser into the generated file would put request-time behaviour inside a data module
 *   and invent a second owner for the encoding rule.
 * - 11 §6 acceptance (c) forbids parsing `openapi.yaml` inside `packages/ui`, so the rule cannot live next to
 *   the document either. It belongs to the transport, and gate §9.2 says the transport is this file.
 */

/** The entry shape is the generated module's. Re-exported, not restated: one description of one fact. */
export type { Endpoint } from '@platfolio/api-contract/generated/types';

/**
 * Total by construction: `Readonly<Record<OperationId, …>>`, so a missing operation is a compile error and a
 * partial table cannot be handed to a driver at all. `ENDPOINTS` is the value that normally satisfies it.
 */
export type OperationTable = Readonly<Record<OperationId, Endpoint>>;

export interface PollTransportConfig {
  /** D47: an endpoint is configuration. Required, injected by the shell, never a literal in this package. */
  readonly baseUrl: string;
  /**
   * The routes, defaulting to the generated `ENDPOINTS`. Overridable so the driver stays swappable; not
   * overridable into a smaller table, because `OperationTable` is total.
   */
  readonly endpoints?: OperationTable;
  /**
   * The polling interval, in the one place a poll interval may exist (11 §4 acceptance (b)). A component
   * cannot see or set this; if it could, it would own a timer and that is a §9.2 failure.
   */
  readonly intervalMs?: number;
  /** Injectable for tests, and only for tests: the default is the platform's `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const DEFAULT_INTERVAL_MS = 30_000;

/** A clock with no `Date.now()` inside it, so a test can move time without moving the machine's. */
type Clock = () => Date;

/**
 * Fill a templated spec path from an operation's declared parameters.
 *
 * Every value goes through `encodeURIComponent` **whole**. A `{instanceId}` is one segment, so a value
 * containing `/` must not be allowed to become two of them: `'../../admin'` arrives as `..%2F..%2Fadmin`,
 * which is the traversal refusal, not a bug in the encoding. An absent or empty value is reported in
 * `missing` and the caller refuses the request — sending `/api/v1/instances/` and hoping the server says 404
 * is how a UI asks the control plane a question it never had an identity to answer.
 */
export function fillPath(template: string, params: Record<string, unknown>): { path: string; missing: string[] } {
  const missing: string[] = [];
  const path = template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      missing.push(name);
      return `{${name}}`;
    }
    return encodeURIComponent(String(value));
  });
  return { path, missing };
}

/** Query parameters are the declared params that are not path segments. One rule, applied to every operation. */
export function queryString(template: string, params: Record<string, unknown>): string {
  const pathNames = new Set([...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string));
  const pairs = Object.entries(params)
    .filter(([k, v]) => !pathNames.has(k) && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/**
 * The refusal that belongs to a table rather than to a request. `OperationTable` is total, so arriving here
 * with an operation the table does not name means the table was built or cast at a boundary — say which,
 * instead of letting `undefined.path` reach the URL builder.
 */
export function endpointFor(operations: OperationTable, op: OperationId): Endpoint {
  const endpoint = operations[op] as Endpoint | undefined;
  if (!endpoint) {
    throw new TypeError(
      `no endpoint in the route table for operation "${op}". The generated ENDPOINTS is total by construction `
      + '(it `satisfies Record<OperationId, Endpoint>`), so this is a table assembled or cast at a boundary: pass '
      + 'ENDPOINTS rather than an object someone wrote out.',
    );
  }
  return endpoint;
}

/**
 * The driver. `kind: 'poll'` is not cosmetic: it is stamped into every `Freshness` this transport produces and
 * therefore into every age label, so a polled value cannot be presented as live even by a component that tries
 * (rule 5). `formatAge` renders the kind as the word "polled".
 */
export class PollTransport implements Transport {
  /**
   * A literal, not `TransportKind`. Typed as the union it would read as "this driver might be either one", and
   * `test/fixtures/events-absent.control.ts` derives the set of buildable drivers by reading `kind` off the
   * instance type — so the wide annotation made the trip-wire report that an events driver was buildable today.
   * The fixture caught that; keep it narrow.
   */
  readonly kind = 'poll' as const;
  private readonly config: PollTransportConfig;
  private readonly endpoints: OperationTable;
  private readonly intervalMs: number;
  private readonly now: Clock;
  private readonly sources = new Map<string, PollFreshness>();

  constructor(config: PollTransportConfig) {
    if (!config.baseUrl) {
      throw new TypeError('PollTransport needs a baseUrl from the shell environment (D47: an endpoint is configuration, and a committed one is check-project.ts\'s problem, not this class\'s)');
    }
    this.config = config;
    this.endpoints = config.endpoints ?? ENDPOINTS;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.now = config.now ?? (() => new Date());
  }

  /** The table this driver routes with — for the test that proves the default is the generated one. */
  get routeTable(): OperationTable {
    return this.endpoints;
  }

  async call<O extends OperationId>(
    op: O,
    input: { params: ParamsOf<O>; body?: RequestBodyOf<O> },
    auth: AuthSource | undefined,
    signal?: AbortSignal,
  ): Promise<Result<SuccessOf<O>>> {
    const endpoint = endpointFor(this.endpoints, op);
    const params = (input.params ?? {}) as Record<string, unknown>;
    const { path, missing } = fillPath(endpoint.path, params);
    if (missing.length) {
      return { ok: false, error: { status: 0, code: 'invalid_request', message: `${op}: path parameter(s) missing: ${missing.join(', ')}` } };
    }
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}${queryString(endpoint.path, params)}`;

    let token: string | undefined;
    try {
      token = await auth?.token();
    } catch {
      // Auth is injected (07), so a failure here is the shell's, and the UI needs to be able to say so without
      // implying the server refused.
      return { ok: false, error: { status: 0, code: 'auth_unavailable', message: `${op}: the AuthSource did not produce a token` } };
    }

    const doFetch = this.config.fetchImpl ?? fetch;
    // The table carries the document's own spelling (`get`); the wire wants the verb (`GET`). Normalising here
    // rather than emitting `'GET'` keeps ENDPOINTS a reading of the spec instead of a reading of fetch.
    const method = endpoint.method.toUpperCase();
    // The content type travels with the *body*, not with the verb: `acceptInvitation` is a POST the document
    // describes as having no body at all, and a request that claims to carry JSON while carrying nothing is
    // the kind of fiction a server has to guess about.
    const requestBody = input.body === undefined ? undefined : JSON.stringify(input.body);
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(requestBody === undefined ? {} : { body: requestBody }),
        ...(auth === undefined ? { credentials: 'omit', redirect: 'error' } : {}),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (cause) {
      return { ok: false, error: { status: 0, code: 'network_error', message: `${op}: ${(cause as Error).message}` } };
    }

    // 204 is a declared success for several operations and has no body; parsing it as JSON would turn a
    // success into a parse error, which is the same class of bug as the response that "validated" by not
    // being resolved.
    if (response.status === 204) {
      return { ok: true, value: undefined as SuccessOf<O> };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: { status: response.status, code: 'invalid_response', message: `${op}: ${String(response.status)} with a body that is not JSON` } };
    }
    if (!response.ok) {
      const err = body as Partial<ApiError> | undefined;
      return {
        ok: false,
        error: {
          status: response.status,
          // The spec's `Error.code` is the stable field (07). A body that omits it gets a transport-level code,
          // never a fabricated echo of the status.
          code: typeof err?.code === 'string' ? err.code : 'request_failed',
          message: typeof err?.message === 'string' ? err.message : `${op} responded ${String(response.status)}`,
        },
      };
    }
    return { ok: true, value: body as SuccessOf<O> };
  }

  /**
   * One freshness source per key, shared by every subscriber. Two panels watching the same instance are one
   * timer, not two, which is the difference between "one poller per page" (11 §4) and a self-inflicted
   * denial-of-service against the tenant's own control plane.
   */
  freshness<K extends string>(key: K): FreshnessSource {
    const existing = this.sources.get(key);
    if (existing) return existing;
    const created = new PollFreshness(key, this.intervalMs, this.now);
    this.sources.set(key, created);
    return created;
  }

  /** How many timers this driver is holding, for the test that proves N subscribers are 1 poller. */
  get sourceCount(): number {
    return this.sources.size;
  }
}

/**
 * The single freshness primitive (rule 5, D64). A component subscribes and is told "look again"; it never
 * learns how often, never owns a `setTimeout`, and never sees the difference between this and the driver
 * `events` replaces it with.
 */
class PollFreshness implements FreshnessSource {
  readonly kind = 'poll' as const;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Held so a late subscriber can be told the current interval without a second poll being scheduled. */
  private readonly observedAt: () => string;

  readonly key: string;
  private readonly intervalMs: number;

  constructor(key: string, intervalMs: number, now: Clock) {
    // No parameter properties: the root tsconfig sets `erasableSyntaxOnly`, which forbids the syntax. Stated
    // because it is the second place in this package the flag has bitten (see the `.tsx` note upstream).
    this.key = key;
    this.intervalMs = intervalMs;
    this.observedAt = () => now().toISOString();
  }

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      // No listeners, no timer: a poll that outlives its last subscriber is a leak that keeps asking the
      // tenant's control plane for data nobody is rendering.
      if (this.listeners.size === 0) this.stop();
    };
  }

  freshness(): Freshness {
    return { observedAt: this.observedAt(), via: this.kind };
  }

  private start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      for (const listener of [...this.listeners]) listener();
    }, this.intervalMs);
    // Never let a background freshness source hold a process open.
    this.timer.unref?.();
  }

  private stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export type { Freshness };
