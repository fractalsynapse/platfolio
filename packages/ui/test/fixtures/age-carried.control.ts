import type { Loaded } from '../../src/index.ts';
import { oneInstance } from './instance-fixture.ts';

/**
 * POSITIVE CONTROL for `age-omitted.negative.ts`, and the reason the negative fixture means anything: it is the
 * same value with `freshness` present, compiled by the same `tsc` invocation, and it **must** succeed. Without
 * it, the negative case could be failing on a bad import path and gate §9.10b would still report a refusal.
 */
export const badge = {
  operation: 'listInstances',
  params: {},
  status: 'loaded',
  data: [oneInstance],
  freshness: { observedAt: '2026-11-15T10:00:00.000Z', via: 'poll' },
} satisfies Loaded<'listInstances'>;

/**
 * The other half of the claim, which the negative fixture used to carry and must not: rule 5 does not merely
 * forbid a valueless age, it **delivers** one. Destructuring `freshness` off a `Loaded` has to type, or the
 * honesty rule is unimplementable rather than enforced.
 */
export function rendersWithAge(state: Loaded<'listInstances'>): string {
  const { data, freshness } = state;
  void data;
  return `${freshness.via}@${freshness.observedAt}`;
}
