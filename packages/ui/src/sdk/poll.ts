import type { OperationId, ParamsOf, RequestBodyOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import type { ApiError, AuthSource, Freshness, FreshnessSource, Result, Transport, Unsubscribe } from './transport.ts';

/**
 * The `poll` transport driver — **the only file in this package allowed to hold a timer, build a URL, or call
 * `fetch`** (gate §9.2). That is not a convention asserted in a comment: `scripts/check-ui.ts` reads this exact
 * path out of its own allowlist and fails on any other file that does these things, and the allowlist is
 * falsified by test.
 *
 * ## The gap this file refuses to paper over
 *
 * `packages/api-contract`'s generated table gives `OperationId`, `ParamsOf`, `RequestBodyOf` and `SuccessOf`.
 * It gives **no method and no path**. So an operation id alone cannot produce an HTTP request, and the two
 * ways to fix that are both closed from here:
 *
 * - parsing `apps/control-plane/openapi.yaml` at runtime in this package is forbidden by name — 11 §6
 *   acceptance (c): "importing `openapi.yaml` parsing utilities into `packages/ui` is a §9.2 failure";
 * - extending the generated types would mean editing `packages/api-contract/**`, which is owned elsewhere and
 *   off-limits to this change (D41: the shape of the contract is its owners' call).
 *
 * So `PollTransportConfig.operations` is **injected**, and typed `Record<OperationId, Endpoint>` so a partial
 * table is a compile error rather than a 404 at run time. Whoever owns the contract can close this by emitting
 * the endpoint table next to the type table, at which point the shell stops supplying it and this file does
 * not change shape. Until then the honest statement is: the REST driver is real, and its routing table is
 * configuration the shell must bring. `test/sdk-freshness.test.ts` asserts the table is total.
 */

export interface Endpoint {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The spec's own notation, so `{instanceId}` matches rather than `:instanceId`. */
  readonly path: string;
}

/** Total by construction: `Record` over the generated union, so one missing operation does not compile. */
export type OperationTable = Readonly<Record<OperationId, Endpoint>>;

export interface PollTransportConfig {
  /** D47: an endpoint is configuration. Required, injected by the shell, never a literal in this package. */
  readonly baseUrl: string;
  readonly operations: OperationTable;
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

function substitutePath(template: string, params: Record<string, unknown>): { path: string; missing: string[] } {
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
function queryString(template: string, params: Record<string, unknown>): string {
  const pathNames = new Set([...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] as string));
  const pairs = Object.entries(params)
    .filter(([k, v]) => !pathNames.has(k) && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

export function endpointFor(operations: OperationTable, op: OperationId): Endpoint {
  const endpoint = operations[op];
  if (!endpoint) {
    throw new TypeError(
      `no endpoint configured for operation "${op}". The table is typed total, so this is an object built at a boundary `
      + 'and cast — inject the shell\'s full table instead of a partial one.',
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
  private readonly intervalMs: number;
  private readonly now: Clock;
  private readonly sources = new Map<string, PollFreshness>();

  constructor(config: PollTransportConfig) {
    if (!config.baseUrl) {
      throw new TypeError('PollTransport needs a baseUrl from the shell environment (D47: an endpoint is configuration, and a committed one is check-project.ts\'s problem, not this class\'s)');
    }
    this.config = config;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.now = config.now ?? (() => new Date());
  }

  async call<O extends OperationId>(
    op: O,
    input: { params: ParamsOf<O>; body?: RequestBodyOf<O> },
    auth: AuthSource,
    signal?: AbortSignal,
  ): Promise<Result<SuccessOf<O>>> {
    const endpoint = endpointFor(this.config.operations, op);
    const params = (input.params ?? {}) as Record<string, unknown>;
    const { path, missing } = substitutePath(endpoint.path, params);
    if (missing.length) {
      return { ok: false, error: { status: 0, code: 'invalid_request', message: `${op}: path parameter(s) missing: ${missing.join(', ')}` } };
    }
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}${queryString(endpoint.path, params)}`;

    let token: string;
    try {
      token = await auth.token();
    } catch {
      // Auth is injected (07), so a failure here is the shell's, and the UI needs to be able to say so without
      // implying the server refused.
      return { ok: false, error: { status: 0, code: 'auth_unavailable', message: `${op}: the AuthSource did not produce a token` } };
    }

    const doFetch = this.config.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: endpoint.method,
        headers: { authorization: `Bearer ${token}`, ...(endpoint.method === 'GET' ? {} : { 'content-type': 'application/json' }) },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
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
