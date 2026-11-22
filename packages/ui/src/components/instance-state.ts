import type { InstanceResponse } from '@platfolio/api-contract/generated/types';

/**
 * How an instance's state is presented (11 §8: a problem is text, never colour alone; rule 5: a state word is a
 * claim about the provider and travels with the age of the observation that produced it).
 *
 * What a screen renders is `InstanceResponse.state` **verbatim**, out of the data -- the contract's own token, not
 * a gentler word invented one file away. That is #202's rule on the render side: the normalized value is what a
 * person reads, and platfolio adds no gloss over it. `tone` names a *token role*, not a colour, and every colour
 * pair the token module lists is measured in `test/contrast.test.ts`, so `ui-tone-warn` is a claim about a listed
 * pair rather than about taste.
 *
 * ## The one state that is not named here, and exactly what that costs
 *
 * The contract's state enum has a member spelled the way rule 5's forbidden word is spelled. `scripts/check-ui.ts`
 * gate §R5 searches the visible text of this package for that word and its relatives -- because a green pill over
 * a four-minute-old poll is #202's "a service that *finished* was being reported as a service that *runs*" moved to
 * the side of the screen where a human acts on it -- and a text search cannot tell an enumeration key in a table
 * like this one from a label in copy.
 *
 * So the form I wanted is not available in this package today: one row per member of
 * `Record<InstanceState, StatePresentation>`, which would stop this file compiling the day the specification adds
 * a state, makes the gate fire on the key. I did not widen the gate and I did not spell the word in a shape that
 * slips past it -- both of those are "fixing the acceptance to make it green", which this repository treats as
 * worse than the failure it hides. The table below names every state *except* that one, and the unnamed member
 * falls to a stated default.
 *
 * **The cost, stated, because it is a product consequence and not a style preference:**
 *
 * 1. the healthy state renders in the `neutral` tone rather than the `ok` colour. The word it shows is still the
 *    contract's own, which is the part 11 §8 makes load-bearing; the colour is what this compromise gives up;
 * 2. a state the specification adds later also falls to `neutral`, silently, and nothing fails to tell anyone.
 *    With the total table that would have been a compile error. `test/components.test.ts` asserts the fallback is
 *    `neutral` and never `ok`, so at least the direction of the error is "understated", not "optimistic" -- which
 *    is the same rule R10 tests from the other side.
 *
 * The fix belongs to the gate or to the dependency graph, not to this file. Either §R5 learns to skip enumeration
 * positions (it already had to learn to skip `aria-live`, which 11 §8 mandates, for the same class of reason), or
 * `packages/ui` declares `@platfolio/contracts` and reuses its authoritative `InstanceStateSchema` so nobody in
 * this package writes the vocabulary at all. Both are their owners' calls and both are recorded in the change
 * notes; neither is decided from a UI branch.
 */
export type InstanceState = InstanceResponse['state'];
export type StateTone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface StatePresentation {
  readonly tone: StateTone;
  /** Said after the contract's own word, for a screen reader. Empty means the token explains itself. */
  readonly announcement: string;
}

const presentation = (tone: StateTone, announcement = ''): StatePresentation => ({ tone, announcement });

/**
 * What an un-named state looks like: neutral, no added words. Never `ok`, because "nobody described this state"
 * must not be rendered as "the platform says this is fine".
 */
export const DEFAULT_STATE_PRESENTATION: StatePresentation = presentation('neutral');

/**
 * The states whose presentation differs from the default. The full enumeration lives in the generated contract
 * (`InstanceResponse['state']`), which is where it belongs; see the note above for the member deliberately absent
 * from this table and the price of that absence.
 */
export const STATE_PRESENTATION = {
  pending: presentation('neutral', 'not started yet'),
  provisioning: presentation('neutral', 'being created'),
  degraded: presentation('warn', 'at least one environment is not healthy'),
  paused: presentation('neutral', 'suspended on purpose'),
  failed: presentation('danger', 'the last plan did not apply'),
  deprovisioning: presentation('warn', 'teardown is recorded; the provider may not have finished'),
  removed: presentation('neutral', 'no longer hosted'),
} as const satisfies Partial<Record<InstanceState, StatePresentation>>;

/**
 * Look a state up. The parameter is `string`, not `InstanceState`, because the props schemas validate the kind
 * (see the note in `props.ts` for the three routes that led there) and a narrower parameter would be a promise
 * the validation does not keep. The table below stays keyed on the generated union, which is what makes a *named*
 * row still a claim about a real state rather than about a spelling.
 */
export function statePresentation(state: string): StatePresentation {
  // Read through a widened view of the table, so a state this file cannot name reaches the default rather than
  // `undefined`: `noUncheckedIndexedAccess` is on in every program that compiles this package, and a lookup that
  // can come back undefined would push the "what does an undescribed state look like" decision into every caller.
  const table: Readonly<Record<string, StatePresentation | undefined>> = STATE_PRESENTATION;
  return table[state] ?? DEFAULT_STATE_PRESENTATION;
}

/**
 * The rollup is not the truth (#179): `InstanceResponse.state` is production when a production environment
 * exists, otherwise the worst of the environments. A screen says which one it is showing, rather than presenting
 * the rollup as an observation -- staging degraded next to production healthy is a real Tuesday, not a
 * contradiction to average away.
 */
export const ROLLUP_IS_NOT_THE_TRUTH = 'the rollup of the environments listed under it';
