import type { AuthSource, EventsTransportPlaceholder, Result, State, Transport } from '../../src/sdk/transport.ts';

/**
 * NEGATIVE FIXTURE — this file is expected to FAIL compilation.
 *
 * Gate §9.10c, the mechanical half of D64's boundary. D64 says the UI must be *capable* of real time and must
 * ship on polling. The seam is real; the `events` driver is not. So the placeholder must be **unconstructible**
 * — if this file compiled, `EventsTransportPlaceholder` would be a working transport with a misleading name, and
 * the next author would wire a "live" badge to a type that cannot deliver one.
 *
 * Two refusals, both wanted:
 *
 * 1. `implements Transport` fails, because `call` is `never` in the placeholder and a class cannot satisfy a
 *    method it does not have.
 * 2. Assigning the placeholder to a `Transport` fails for the same reason, from the other direction.
 *
 * The positive control is `events-absent.control.ts`: it asserts the *absence* still holds — that no module in
 * this package exports something satisfying `Transport` with `kind: 'events'`. That is the fixture that starts
 * failing on the day 11 §4's operations land and someone legitimately adds the driver, which is exactly when the
 * placeholder should stop being a placeholder.
 */
export class AttemptedEventsTransport implements EventsTransportPlaceholder, Transport {
  readonly kind = 'events' as const;

  // Refused: `blockedOn` is an unsatisfiable string literal naming the work that has to happen first, in the
  // file that owns it (apps/control-plane/openapi.yaml), under D41 — not in a UI branch.
  readonly blockedOn = 'nothing' as unknown as EventsTransportPlaceholder['blockedOn'];

  async call(): Promise<Result<unknown>> {
    throw new Error('unreachable if this file compiles at all');
  }

  use(): State<'listInstances'> | undefined {
    return undefined;
  }
}

export const asTransport: Transport = new AttemptedEventsTransport();

export type NeedsAuth = AuthSource;
