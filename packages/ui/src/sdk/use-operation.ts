import * as React from 'react';
import type { OperationId, ParamsOf } from '@platfolio/api-contract/generated/types';
import type { AuthSource, Freshness, Loaded, OperationResult, State, Transport } from './transport.ts';
import { isLoaded } from './transport.ts';
import { applyResult, initial } from './state.ts';
import type { Result } from './transport.ts';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

/**
 * `useOperation` (11 §6, rule 5).
 *
 * **This is a `.ts` file using `createElement`-era hooks, not a `.tsx`, and the reason is measured:** the
 * repository's single type-check surface is `tsc --noEmit -p tsconfig.json`, whose `include` covers
 * `packages/<name>/src` via a `.ts`-only glob and declares no `jsx` option. A `.tsx` file here would be
 * transpiled by `tsx` at runtime and never type-checked in CI — an unchecked contract in the one package whose
 * entire job is contracts. `src/layout/index.ts` carries the same note. Closing this means adding `jsx` plus a
 * `.tsx` glob to the root config, which is a tree-wide decision, not this package's to make unilaterally.
 *
 * The result is `State<O>`: a discriminated union in which **every branch that holds server data also holds a
 * `Freshness`**. That is "a screen cannot render server data without knowing its age" written as a type. There
 * is no shape this hook can return that yields `data` without `freshness`; to get the data you narrow on
 * `status`, and narrowing hands you the age in the same breath. Making it `age?:` would move the invariant from
 * the compiler to a review checklist, which is the downgrade 11 §9.10 names.
 *
 * What this hook does not do:
 * - **own a timer.** `transport.freshness(key)` does. Swapping `poll` for `events` changes the driver and not
 *   this file (D64). A `setInterval` in here is gate §9.2's definition of a bug.
 * - **fabricate an optimistic success.** There is no path to `loaded` that skips the transport (R10).
 * - **guess a key.** The caller names it, because only the caller knows whether two uses of one operation are
 *   the same question.
 * - **hold a singleton transport.** It comes from context, injected by the shell — which is what makes the
 *   build-time swap real rather than nominal, and what keeps a base URL out of this package (D47).
 */

export interface UseOperationInput<O extends OperationId> {
  readonly params: ParamsOf<O>;
  readonly key?: string;
}

export interface UseOperationResult<O extends OperationId> {
  readonly state: State<O>;
  readonly reload: () => void;
}

export interface SdkContextValue {
  readonly transport: Transport;
  readonly auth: AuthSource;
  readonly now: () => Date;
}

export const SdkContext = React.createContext<SdkContextValue | null>(null);

export function SdkProvider(props: { value: SdkContextValue; children?: React.ReactNode }): React.ReactElement {
  return React.createElement(SdkContext.Provider, { value: props.value }, props.children ?? null);
}

function useSdk(): SdkContextValue {
  const sdk = React.useContext(SdkContext);
  // No ambient default. A fallback transport is how an endpoint becomes a literal in source (D47) and how a
  // test double quietly becomes what production runs.
  if (!sdk) {
    throw new Error('useOperation was called outside an SdkProvider: the transport and the AuthSource are injected by the shell (07, D47).');
  }
  return sdk;
}

// The transitions live in `state.ts` so they can be tested without a renderer. A second copy here — or, worse,
// a copy in the test file — is the two-definitions defect this package exists to prevent.
const baseOf = <O extends OperationId>(operation: O, params: ParamsOf<O>): OperationResult<O> => ({ operation, params });

export function useOperation<O extends OperationId>(operation: O, input: UseOperationInput<O>): UseOperationResult<O> {
  const { transport, auth, now } = useSdk();
  const params = input.params;
  const key = input.key ?? String(operation);

  const [state, setState] = React.useState<State<O>>(() => initial(baseOf(operation, params), now().toISOString()));
  const alive = React.useRef(true);
  // Held in a ref so the freshness subscription reads the *current* state when deciding whether this is a
  // refresh, without re-subscribing the source on every render.
  const latest = React.useRef<State<O>>(state);
  latest.current = state;

  const settle = React.useCallback(
    (result: Result<SuccessOf<O>>) => {
      if (!alive.current) return;
      const freshness: Freshness = { observedAt: now().toISOString(), via: transport.kind };
      setState(applyResult(latest.current, baseOf(operation, params), result, freshness));
    },
    [transport, now, operation, params],
  );

  const load = React.useCallback(async () => {
    settle(await transport.call(operation, { params }, auth));
  }, [transport, auth, settle, operation, params]);

  React.useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  /**
   * The one subscription to freshness in the whole stack. It lives here so it lives nowhere else: 11 §4
   * acceptance (b) counts this as the primitive's only call site, and gate §9.2 fails a timer anywhere above.
   */
  const source = transport.freshness?.(key);
  React.useEffect(() => {
    if (!source) return;
    const unsubscribe = source.subscribe(() => {
      void load();
    });
    return unsubscribe;
  }, [source, load]);

  const reload = React.useCallback(() => {
    void load();
  }, [load]);

  return { state, reload };
}

export { isLoaded };
export type { Loaded };
