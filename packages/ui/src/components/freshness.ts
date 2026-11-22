import * as React from 'react';
import { SdkContext } from '../sdk/use-operation.ts';
import { formatAge, type Freshness, type ObservedAt, type TransportKind } from '../sdk/transport.ts';

/**
 * The one place a claim about *when this was true* is written, and the shapes that let the rest of the package
 * carry an age without inventing one (rule 5, D64).
 *
 * The sentence itself belongs to the SDK: `formatAge()` stamps the transport kind into it, so a polled fact reads
 * "updated 40s ago · polled" and no component can turn that into a push claim by editing its own copy. What lives
 * here is the *calling* of it -- one function, so a screen that wants to say something about age has one door and
 * gate §9.10's type-level half ("every loaded branch carries `freshness`") has something to point at.
 *
 * `formatAge` takes `now` as an argument instead of reading a clock, and that is the reason `useClock` exists
 * separately: a render that calls `Date.now()` inside itself makes the same page mean two things depending on when
 * it was composed, and a server render and a client render would disagree out loud. The clock therefore arrives
 * from the shell -- the same injected `now` the SDK uses to stamp `observedAt` -- and a presentational component
 * receives it as a prop. Nothing in this file owns a timer, and gate §9.2 fails anything above the freshness
 * primitive that tries to.
 */

export interface AgeLabel {
  readonly text: string;
  /** `true` when the observation is older than the interval that keeps it current, so the label says so. */
  readonly mayBeStale: boolean;
}

/** The age sentence for a value, at a stated moment. Reproducible by construction: same inputs, same words. */
export function ageAt(freshness: Freshness, now: ObservedAt): string {
  return formatAge(freshness, now);
}

/**
 * How far behind the observation a label has to get before the screen calls it doubtful.
 *
 * `PollTransport` keeps its interval to itself today -- a component that could read it could also set one, and
 * rule 2 of 11 §4 is exactly "a component that polls with its own timer is a §9.2 failure" -- so the presentation
 * layer carries its own named threshold. Two minutes is four times the shipped default of thirty seconds:
 * deliberately later than "it missed a tick", earlier than "this number is history".
 *
 * The honest rule is "older than *this transport's* interval", and reading that means the interval travels on the
 * `Freshness` the seam hands back -- a change to 11 §6's shape and the SDK owners' call. Reported, not invented
 * here, and `test/components.test.ts` pins the number so a change to one is a change to both.
 */
export const STALE_AFTER_SECONDS = 120;

export function ageIsDoubtful(freshness: Freshness, now: ObservedAt): boolean {
  const then = Date.parse(freshness.observedAt);
  const at = Date.parse(now);
  // An unparseable instant is treated as doubtful rather than fresh: "age unknown" is the honest label, and a
  // rule that defaults to *not* stale would render an unprovable number as current.
  if (Number.isNaN(then) || Number.isNaN(at)) return true;
  return at - then > STALE_AFTER_SECONDS * 1000;
}

/** The age, and whether it has earned the word for "this may no longer be true". */
export function ageLabel(freshness: Freshness, now: ObservedAt): AgeLabel {
  return { text: ageAt(freshness, now), mayBeStale: ageIsDoubtful(freshness, now) };
}

/**
 * The word for the transport in prose, spelled by the driver that produced the fact.
 *
 * `poll` says "polled". A future `events` driver would say something else, and the reason this reads the kind
 * instead of writing a word in a component is D64's swap: changing the driver changes the sentence in one place.
 * There is no `events` driver today; `scripts/check-ui.ts` refuses this package any word implying push while that
 * is true, and the refusal is the point rather than the inconvenience.
 */
export function transportWord(via: TransportKind): string {
  return via === 'poll' ? 'polled' : via;
}

/**
 * The shell's clock, from the same context the SDK reads (11 §6 rule 3: injected, never ambient).
 *
 * Containers use this to stamp a render-time `now` into a presentational component's props; a presentational
 * component does not call it, because then the same props would render two different sentences an hour apart,
 * and a fixture could not assert anything about them.
 */
export function useClock(): () => Date {
  const sdk = React.useContext(SdkContext);
  if (!sdk) {
    throw new Error('useClock() was called outside an <SdkProvider>: the shell injects the clock the age labels use, the same one that stamps `observedAt` (11 §6 rule 3).');
  }
  return sdk.now;
}
