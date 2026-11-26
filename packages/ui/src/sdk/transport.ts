import type { OperationId, ParamsOf, RequestBodyOf, SuccessOf } from '@platfolio/api-contract/generated/types';

/**
 * The transport seam (11 §6, rules 1 and 5, D64).
 *
 * **A `Transport` is the only door to the API, and `poll.ts` is the only room behind it with a timer or a URL.**
 * Everything above this interface is written against operations and result objects and knows nothing about how
 * freshness arrives. That is the whole of D64's swappability: when 11 §4's operations land in
 * `apps/control-plane/openapi.yaml` — designed there first, under D41, by whoever owns that file — an
 * `events` driver replaces this one inside the SDK and no component changes.
 *
 * What this package deliberately does **not** contain, and why:
 *
 * - No `EventSource`. No `WebSocket`. No "live" pill. The control plane has no push channel (measured by
 *   `scripts/check-ui.ts`, which re-greps `openapi.yaml` on every run and will turn this package red the day
 *   that changes). Shipping a push-backed UX over a polled fact is rule 5's defect: it is #202's
 *   "a service that *finished* was being reported as a service that *runs*" moved to the side of the screen
 *   where a human acts on it.
 * - No `events` **driver**. `EventsTransportPlaceholder` below is a type-level placeholder and nothing more —
 *   `ui:check` §9.10c compiles `test/fixtures/events-driver-built.negative.ts` and requires the refusal, and
 *   `test/transport-table.test.ts` reads the generated `ENDPOINTS` table and requires that the operation ids
 *   it names are absent from it. The distinction matters: the seam is real today, the driver is not, and a
 *   package that pretended otherwise would be describing planned behavior as delivered.
 * - No committed base URL (D47). `PollTransportConfig.baseUrl` is required at construction and comes from the
 *   shell's environment; `check-project.ts`'s endpoint rule keeps it out of source. The paths are not
 *   configuration and do not come from the shell either: they come from `ENDPOINTS` (#258).
 */

/** The stable error `code` from 07, as the generated contract types it. */
export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError };

/** Injected by the shell, never ambient (07: auth is described, not assumed). */
export interface AuthSource {
  token(): Promise<string>;
}

/**
 * How freshness reaches an operation. `poll` is the only implementation this package ships; `events` is the
 * name the driver will have, declared here so the union is closed and a component cannot invent a third.
 */
export type TransportKind = 'poll' | 'events';

export interface Unsubscribe {
  (): void;
}

/**
 * A freshness source: the one primitive components may subscribe to (11 §4 acceptance (b)). It has no `start`,
 * no `interval` and no timer in its public shape, because a component that could schedule a poll is a
 * component that owns a timer.
 */
export interface FreshnessSource {
  subscribe(listener: () => void): Unsubscribe;
  /** The driver's own honesty about what it is doing, for the label the render must show (rule 5). */
  readonly kind: TransportKind;
}

export interface Transport {
  readonly kind: TransportKind;
  call<O extends OperationId>(
    op: O,
    input: { params: ParamsOf<O>; body?: RequestBodyOf<O> },
    auth: AuthSource | undefined,
    signal?: AbortSignal,
  ): Promise<Result<SuccessOf<O>>>;
  /** Optional by the spec of 11 §6. An operation with no freshness source is one no panel may claim is fresh. */
  freshness?<K extends string>(key: K): FreshnessSource | undefined;
}

/* ------------------------------------------------------------------ age by construction */

/** RFC 3339 instant, as the contract emits them. Not a `Date`: a render must be reproducible from the string. */
export type ObservedAt = string;

/**
 * The freshness fact a result carries.
 *
 * `age` is **not optional on the success branch**, and that is rule 5 written as a type: a screen cannot
 * destructure `data` out of a successful call without also holding the thing that says how old it is. Making
 * it `age?:` would put the invariant in a review checklist instead of the compiler, which is the exact
 * downgrade 11 §9.10 refuses — "`age` by construction => rule 5 is a type, not a habit".
 */
export interface Freshness {
  /** When this value was observed by *this* client. The label a render shows comes from this. */
  readonly observedAt: ObservedAt;
  /** The transport that produced it, so a polled value can never be labelled live even by accident. */
  readonly via: TransportKind;
}

export interface OperationResult<O extends OperationId> {
  readonly operation: O;
  readonly params: ParamsOf<O>;
}

export type Loaded<O extends OperationId> = OperationResult<O> & {
  readonly status: 'loaded';
  readonly data: SuccessOf<O>;
  readonly freshness: Freshness;
};

export type Failed<O extends OperationId> = OperationResult<O> & {
  readonly status: 'failed';
  readonly error: ApiError;
  /** A failure still carries when we last looked: "unknown since 10:04" is the honest state, not "no data". */
  readonly freshness: Freshness;
};

export type Pending<O extends OperationId> = OperationResult<O> & {
  readonly status: 'pending';
  readonly since: ObservedAt;
};

/**
 * The union a component consumes. There is no branch that holds server data without holding its age, so
 * "every render shows its age" is a property of the type rather than a habit of the author.
 */
export type State<O extends OperationId> = Loaded<O> | Failed<O> | Pending<O>;

export function isLoaded<O extends OperationId>(s: State<O>): s is Loaded<O> {
  return s.status === 'loaded';
}

/**
 * The one place that turns an instant into a claim about time. Exported so a screen cannot hand-roll a
 * "just now" that means "up to three minutes ago".
 */
export function formatAge(freshness: Freshness, now: ObservedAt): string {
  const then = Date.parse(freshness.observedAt);
  const at = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(at)) return 'age unknown';
  const seconds = Math.max(0, Math.round((at - then) / 1000));
  const human = seconds < 60
    ? `${String(seconds)}s`
    : seconds < 3600
      ? `${String(Math.floor(seconds / 60))}m`
      : `${String(Math.floor(seconds / 3600))}h`;
  // Polling is named, never hidden behind a word that means push. Rule 5's label is the honesty mechanism.
  return `updated ${human} ago · ${freshness.via === 'poll' ? 'polled' : freshness.via}`;
}

/* ------------------------------------------------------------------ the placeholder */

/**
 * A **type-level placeholder and nothing else.** There is no `events.ts` module in this package, no driver
 * object, no code path that can be constructed. 11 §4 lists what has to exist before one can be: a team-scoped
 * event stream, a short-TTL ticketed connection (a browser cannot put a bearer token in an `EventSource` URL,
 * so without the ticket the stream is an authentication hole), and a persisted ordered event entity the Store
 * does not have — all of them API operations designed in `openapi.yaml` first under D41, none of them present.
 *
 * The type is exported so the *shape* a driver must satisfy is reviewable today, which is what makes the swap
 * a driver addition rather than a redesign. It is exported so that a future `events.ts` has something to
 * `implements` — and `never` on the constructor means nothing can produce one until those operations exist.
 */
export interface EventsTransportPlaceholder {
  readonly kind: 'events';
  /**
   * Unsatisfiable on purpose. The day `GET /api/v1/teams/{teamId}/events` is in the generated `ENDPOINTS`
   * table, this member is deleted and the real driver replaces it; until then any attempt to build one is a
   * type error, which is what `ui:check` §9.10c compiles and `test/transport-table.test.ts` reads the table
   * for.
   */
  readonly blockedOn: 'operations absent from apps/control-plane/openapi.yaml (11 §4); design them there first (D41)';
  call: never;
}

/** The operation ids a real `events` driver would need. All three are absent; the gate proves it every run. */
export const REQUIRED_PUSH_OPERATIONS = [
  'listTeamEvents',
  'createEventsTicket',
] as const;
