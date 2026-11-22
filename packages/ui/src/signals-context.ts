import * as React from 'react';
import type { PayloadOf, RetentionOf, SignalBus, SignalId } from './signals.ts';

/**
 * The signal bus as an injected dependency (11 §3, rule 3), beside `SdkContext` and for the same reason: no
 * ambient default.
 *
 * `useOperation` refuses to run outside its provider rather than fall back to a transport, because a fallback is
 * how an endpoint becomes a literal in source (D47). A bus needs the identical discipline for a different reason:
 * a module-level singleton would mean one browser tab holds one bus for every shell mounted in it, so an island
 * and a plain React mount (UI-OD1) would each see the other's context selection. The bus is created by the shell,
 * handed down, and a component that reaches for one uninvited is told what it forgot to inject.
 *
 * Presentational purity survives this. 11 §1 rule 1 forbids `fetch`, storage and the window in a `render`, and a
 * context read is none of those; what stays forbidden is a second event mechanism, which gate §9.4 keeps to the
 * one implementation inside `signals.ts`.
 */

export const SignalsContext = React.createContext<SignalBus | null>(null);

export interface SignalsProviderProps {
  readonly bus: SignalBus;
  readonly children?: React.ReactNode;
}

export function SignalsProvider(props: SignalsProviderProps): React.ReactElement {
  return React.createElement(SignalsContext.Provider, { value: props.bus }, props.children ?? null);
}

export function useSignals(): SignalBus {
  const bus = React.useContext(SignalsContext);
  if (!bus) {
    throw new Error(
      'useSignals() was called outside a <SignalsProvider>: the bus is created by the shell and injected, the way '
      + 'the Transport and the AuthSource are (07: auth is injected, never ambient). A module-level bus would let '
      + 'one shell\'s context selection reach another mounted in the same tab.',
    );
  }
  return bus;
}

/**
 * The value a component is entitled to see right now, or `null` when the signal does not remember.
 *
 * This is 11 §3's retention decision on the render path, and it is the only sanctioned way for a component to
 * read context. Both directions are the contract, and both are asserted in `test/signals-context.test.ts`: a
 * component mounted after `context.switched` shows the selected team on its **first** render (acceptance (d)),
 * and a component mounted after a `transient` signal fired shows nothing, because what a replayed side effect
 * re-runs is the action, not the fact.
 *
 * The initial value comes from `peek` rather than from an effect for exactly that reason: an effect-registered
 * subscription delivers the replay one commit late, and on a server render the first frame is the only frame
 * anyone sees. `useSyncExternalStore` is the shape React offers here, but it wants a snapshot function whose
 * identity holds between reads, and the bus hands out the stored reference rather than a copy -- so the
 * three-line version is the honest one instead of a cache invented beside the registry.
 *
 * Cost 1 still applies and is worth repeating where a screen will read it: a replayed value is a stale value with
 * confidence. It answers *which query to run*. Anything about the server still comes from the SDK.
 */
export function useSignalValue<I extends SignalId>(id: I): PayloadOf<I> | null {
  const bus = useSignals();
  const [value, setValue] = React.useState<PayloadOf<I> | null>(() => bus.peek(id));

  React.useEffect(() => {
    let subscribed = true;
    // Re-read before subscribing. `peek` during render and the replay this `subscribe` is about to deliver are
    // meant to be the same value; if an emit landed in between, this read is the newer one and the replay that
    // follows agrees with it, because the store holds one value per signal.
    setValue(bus.peek(id));
    const unsubscribe = bus.subscribe(id, (payload) => {
      if (subscribed) setValue(payload);
    });
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [bus, id]);

  return value;
}

/** The declared retention of a signal, read off the table rather than guessed at the call site. */
export function useSignalRetention<I extends SignalId>(id: I): RetentionOf<I> {
  return useSignals().retentionOf(id);
}

/**
 * Emit, with the id pinned where a reviewer can read it against the component's `produces` list. Validation stays
 * the bus's job: a payload that does not match its schema throws at emit, which is the refusal the registry tests
 * assert, not something a caller may pre-check and thereby duplicate.
 */
export function useEmit<I extends SignalId>(id: I): (payload: PayloadOf<I>) => void {
  const bus = useSignals();
  return React.useCallback((payload: PayloadOf<I>) => bus.emit(id, payload), [bus, id]);
}
