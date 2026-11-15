import type { ApiError, Freshness, OperationResult, State } from './transport.ts';
import type { OperationId, SuccessOf } from '@platfolio/api-contract/generated/types';

/**
 * The state transitions `useOperation` performs, factored out of the hook (11 §6, rule 5).
 *
 * This is here rather than inline in the hook so the honesty rules are testable **without a renderer**. This
 * repository has no browser harness yet — 11 §8 defers axe/Playwright, and 11 §9.7–§9.9 are reported NOT RUN
 * rather than worked around — so a transition that only existed inside a `useEffect` could not be asserted at
 * all. Two versions of that sentence exist in this package's drafts; the second defined `applyLoad` *inside the
 * test file* and asserted the copy, which is two definitions of one fact and would have passed forever while
 * the hook did something else. One implementation, imported by both sides, is the fix.
 */

/** What the client observed, and when. `loaded` and `failed` both carry it; `pending` cannot, and says so. */
/**
 * Takes the status rather than a `State<OperationId>` on purpose: the union is invariant in its operation
 * parameter (`data: SuccessOf<O>`), so a helper typed against one operation's state cannot accept another's,
 * and `Loaded<O>` is not assignable to `Loaded<OperationId>`. Widening the argument to `never`-typed data
 * would be a lie about the shape; reading the one field this rule needs is not.
 */
export function isRefresh(current: { readonly status: State<OperationId>['status'] } | undefined): boolean {
  return current !== undefined && current.status !== 'pending';
}

/**
 * The one rule that decides whether a response displaces what is on screen.
 *
 * **A refresh that fails leaves the last-known value in place, at its original age.** Replacing good data with
 * an error because one poll did not land is #202's defect — "a service that *finished* was being reported as a
 * service that *runs*" — moved to the render side, and it is also R10's fail: delete the server and the screen
 * must show last-known-with-age, not a spinner and not a red panel over data that was true ninety seconds ago.
 *
 * The first load is the opposite case: there is nothing to keep, so the failure *is* the state, and it still
 * carries when we looked. "Unknown since 10:04" is an honest render; an unresolved spinner is not.
 */
export function applyResult<O extends OperationId>(
  current: State<O> | undefined,
  base: OperationResult<O>,
  result: { readonly ok: true; readonly value: SuccessOf<O> } | { readonly ok: false; readonly error: ApiError },
  freshness: Freshness,
): State<O> {
  if (result.ok) {
    return { ...base, status: 'loaded', data: result.value, freshness };
  }
  // Narrowed here rather than through `isRefresh`: the helper answers a question about the status, and TypeScript
  // does not carry that answer into the union. The two checks together are the rule — a refresh, onto loaded data.
  if (current !== undefined && current.status !== 'pending' && current.status === 'loaded') {
    // Returned unchanged, identity included: the age on screen is the age of the data on screen, and rewriting
    // it to the failed attempt's timestamp would be a lie about how fresh the visible value is.
    return current;
  }
  return { ...base, status: 'failed', error: result.error, freshness };
}

/** The initial state for a call that has not come back yet. */
export function initial<O extends OperationId>(base: OperationResult<O>, observedAt: string): State<O> {
  return { ...base, status: 'pending', since: observedAt };
}
