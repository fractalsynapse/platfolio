/**
 * The suffix that turns an age into a warning, in one place so a component cannot invent a softer one.
 *
 * Rule 5's honesty mechanism is the label, not a decoration: an observation older than the interval that keeps it
 * current has to *say* it may be out of date. Spelling it here rather than in each component means the wording is
 * one fact with one owner, and `test/components.test.ts` asserts a stale label carries these words.
 */
export const STALE_SUFFIX = ' -- may be out of date';

/**
 * The one place "we could not read the age" is said.
 *
 * `formatAge` in the SDK already returns this for an unparseable instant; it lives here too because a component
 * that received a `null` observation has to say the same sentence, and two wordings for one state is the defect
 * this package keeps paying to avoid.
 */
export const AGE_UNKNOWN = 'age unknown';
