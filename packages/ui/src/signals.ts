import type { StandardSchemaV1 } from '@standard-schema/spec';
import { isValueBearingKey } from '@platfolio/page-schema/page';

/**
 * The typed signal registry (11 §3, rule 3).
 *
 * **Retention has no default, and that is the design.** `Signal.retention` is a required property with no
 * fallback anywhere in this file: no `?? 'transient'`, no optional field, no `Partial`. A signal declared
 * without it does not compile (gate: `test/retention-compile.test.ts`, which runs the compiler over a fixture
 * that omits it and asserts the failure is named), and `makeSignal` refuses it at runtime as the second line of
 * defence, because a signal reaching the bus through an `as never` cast is exactly the `FakeInfraProvider`
 * lie from `packages/contracts/src/fake-provider.ts` — a declaration that says one thing and a mechanism that
 * does another.
 *
 * **A `replay` signal may not carry a credential-shaped payload.** The check reuses
 * `isValueBearingKey` from `packages/page-schema` — the one exported predicate, deliberately, because D63's
 * whole point is one description of one fact and 11 §5 says "reusing the page-schema predicate, not a new
 * regex". Inventing a second, slightly different secret-name list here would recreate the gap the rules doc
 * records as closed on 2026-11-15 (open gap 1).
 *
 * The residual limit travels with the fix: **this is a name test.** A credential under a neutral key (`note`,
 * `ref`) is invisible to it, exactly as `docs/ui-architecture.md` states. What closes that half is the payload
 * *schema*, which is why `payload` is mandatory and why a signal that cannot name its fields is refused.
 */

export type Retention = 'replay' | 'transient';

export interface SignalMeta {
  readonly seq: number;
  /** True for the synchronous delivery of a stored value to a subscriber that mounted after the emit. */
  readonly replayed: boolean;
}

export interface Signal<P> {
  readonly name: string;
  readonly payload: StandardSchemaV1<unknown, P>;
  /** Required. There is no default retention in this package. */
  readonly retention: Retention;
}

/** The compile-time shape: `retention` is not optional, so `{ name, payload }` is an error. */
export interface SignalDeclaration<P> {
  readonly name: string;
  readonly payload: StandardSchemaV1<unknown, P>;
  readonly retention: Retention;
}

export class SignalDeclarationError extends Error {
  constructor(name: string, reason: string) {
    super(`signal "${name}": ${reason}`);
    this.name = 'SignalDeclarationError';
  }
}

/**
 * Every property name a payload schema can produce, walked out of the StandardSchema's JSON Schema view.
 *
 * A schema with no discoverable property names is reported as `null`, not as an empty list: "I could not see
 * any secret key" and "there are no keys" are different claims, and conflating them is how a gate goes vacuous.
 */
export function payloadPropertyNames(schema: StandardSchemaV1<unknown, unknown>): string[] | null {
  const jsonSchema = schema['~standard'] as StandardSchemaV1<unknown, unknown>['~standard'] & {
    jsonSchema?: { input: (o: Record<string, never>) => Record<string, unknown> };
  };
  if (typeof jsonSchema.jsonSchema?.input !== 'function') return null;
  let doc: Record<string, unknown>;
  try {
    doc = jsonSchema.jsonSchema.input({});
  } catch {
    return null;
  }
  const names: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const rec = node as Record<string, unknown>;
    const props = rec.properties;
    if (props && typeof props === 'object') {
      for (const key of Object.keys(props as Record<string, unknown>)) names.push(key);
      for (const sub of Object.values(props as Record<string, unknown>)) walk(sub);
    }
    for (const branch of ['anyOf', 'oneOf', 'allOf']) {
      const list = rec[branch];
      if (Array.isArray(list)) list.forEach(walk);
    }
    if (rec.items) walk(rec.items);
  };
  walk(doc);
  return names;
}

/** The rule, as one question a test can ask directly. */
export function replayPayloadRefusals<P>(decl: SignalDeclaration<P>): string[] {
  if (decl.retention !== 'replay') return [];
  const names = payloadPropertyNames(decl.payload as StandardSchemaV1<unknown, unknown>);
  if (names === null) {
    // A replay value is handed to every later subscriber and lives as long as the page. If its shape cannot be
    // audited, it cannot be allowed to be remembered.
    return ['retention "replay" needs a payload schema whose property names are discoverable, and this one has none'];
  }
  return names.filter(isValueBearingKey).map((k) => `replayed payload carries the credential-shaped key "${k}" (11 §3 cost 2: transient is mandatory for anything credentialed)`);
}

/**
 * Validate and freeze one signal declaration. The `in` test is the runtime twin of the missing compile-time
 * default: it distinguishes "absent" from "explicitly undefined", which `??` would erase.
 */
export function makeSignal<P>(decl: SignalDeclaration<P>): Signal<P> {
  // Read through `unknown` deliberately. Narrowing a `SignalDeclaration` with `in` collapses it to `never`
  // (the field is required, so the compiler has already proved it is there) and the check would then be dead
  // code. A declaration that arrives from a JS file, a cast, or a JSON blob is exactly what this guards, and
  // `'retention' in decl` is the question the type system cannot ask for it.
  const raw = decl as unknown as Record<string, unknown>;
  if (!('retention' in raw)) {
    throw new SignalDeclarationError(String(raw.name ?? '(unnamed)'), 'retention is required and has no default (rule 3)');
  }
  if (raw.retention !== 'replay' && raw.retention !== 'transient') {
    throw new SignalDeclarationError(String(raw.name ?? '(unnamed)'), `retention must be "replay" or "transient", got ${JSON.stringify(raw.retention)}`);
  }
  const payload = raw.payload;
  if (!payload || typeof payload !== 'object' || !('~standard' in payload)) {
    throw new SignalDeclarationError(String(raw.name ?? '(unnamed)'), 'payload must be a StandardSchemaV1, so a late value can be re-validated (rule 1 reaches here too)');
  }
  for (const problem of replayPayloadRefusals(decl)) {
    throw new SignalDeclarationError(String(raw.name ?? '(unnamed)'), problem);
  }
  return Object.freeze({ name: decl.name, payload: decl.payload, retention: decl.retention });
}

/* ------------------------------------------------------------------ the table */

import { z } from 'zod';

const Environment = z.enum(['development', 'staging', 'production']);

/**
 * The table. Every entry is `{ payload schema, retention }` and **every retention is written out** — there is
 * nothing to inherit.
 *
 * `SignalId` is `keyof typeof SIGNALS`, so emitting a string the table does not hold is a type error *and* a
 * runtime throw, which is what makes 11 §3 acceptance (b)'s "adding a signal requires a table entry, which is
 * where the review happens" enforced rather than requested.
 */
export const SIGNALS = {
  'context.switched': makeSignal({
    name: 'context.switched',
    payload: z.object({ teamSlug: z.string().min(1), instanceId: z.string().nullable(), environment: Environment }).strict(),
    retention: 'replay',
  }),
  'instance.state-changed': makeSignal({
    name: 'instance.state-changed',
    payload: z.object({ instanceId: z.string().min(1), environment: z.string().min(1), from: z.string().min(1), to: z.string().min(1) }).strict(),
    // Transient by rule, not by taste: 11 §3 says a replayed state transition re-fires every "the instance
    // changed, so refresh/notify/toast" subscriber for a fact that is already in the SDK's answer.
    retention: 'transient',
  }),
  'secrets.saved': makeSignal({
    name: 'secrets.saved',
    // Names only — never the value that was saved (D53: presence, not contents).
    payload: z.object({ instanceId: z.string().min(1), name: z.string().min(1), environment: z.string().min(1) }).strict(),
    // This is the signal whose replay would be a mutation: it is the "I just wrote a secret" fact, and handing
    // it to a late subscriber invites a second delivery of a credential that was already delivered once.
    retention: 'transient',
  }),
  'refresh.requested': makeSignal({
    name: 'refresh.requested',
    payload: z.object({ operation: z.string().min(1) }).strict().nullable(),
    retention: 'transient',
  }),
  'overlay.changed': makeSignal({
    name: 'overlay.changed',
    payload: z.object({ stack: z.array(z.string().min(1)) }).strict(),
    // Replays: 11 §5's drafts key on the overlay stack, so a sheet mounted after the stack moved still has to
    // know which sheet it is.
    retention: 'replay',
  }),
} as const satisfies Record<string, AnySignal>;

export type SignalId = keyof typeof SIGNALS;

/**
 * The table as a string-keyed view, for the bus internals that receive an id the caller has *not* yet proven
 * is one of ours. `emit`/`subscribe` are typed to `SignalId`, but a value crossing a boundary from JS, from a
 * cast, or from an old bundle is precisely what `UnknownSignalError` exists to name, and that question cannot
 * be asked through a `keyof` index.
 */
const SIGNAL_TABLE: Readonly<Record<string, AnySignal>> = SIGNALS;

/** The ids the registry holds, as strings. `contract.ts` uses this to refuse an undeclared signal. */
export const SIGNAL_IDS = Object.keys(SIGNAL_TABLE);

export type PayloadOf<I extends SignalId> = (typeof SIGNALS)[I] extends Signal<infer P> ? P : never;

export type RetentionOf<I extends SignalId> = (typeof SIGNALS)[I]['retention'];

/** Every id whose declared retention is `replay` — the set a reviewer can enumerate in one file (11 §3 cost 3). */
export const REPLAY_SIGNAL_IDS = (Object.keys(SIGNALS) as SignalId[]).filter((id) => SIGNALS[id].retention === 'replay');

/** The erased view of a declaration, for code that walks the whole table. */
export interface AnySignal {
  readonly name: string;
  readonly payload: StandardSchemaV1<unknown, unknown>;
  readonly retention: Retention;
}

export interface SignalBus {
  emit<I extends SignalId>(id: I, payload: PayloadOf<I>): void;
  /** A late subscriber is handed the stored value first — iff the signal's declared retention is `'replay'`. */
  subscribe<I extends SignalId>(id: I, handler: (payload: PayloadOf<I>, meta: SignalMeta) => void): () => void;
  retentionOf<I extends SignalId>(id: I): RetentionOf<I>;
  /**
   * The store read that `subscribe`'s synchronous replay is built from, exposed so a render can be honest on its
   * **first** frame: the last value for a `replay` signal, `null` for a `transient` one, which has nothing stored.
   *
   * **This is an addition to 11 §3's `SignalBus` shape, recorded as a deviation, not a silent one.** §3
   * acceptance (d) requires that a component mounted after the context changed shows the selected context on its
   * first render. An effect-registered subscription cannot do that — the first render has already happened, so a
   * server render shows a list with no selected row for one frame, and the honest reading of (d) is that the
   * frame is the defect. Every alternative that avoids this method is worse: subscribing during render leaks a
   * second registration under React's double-invocation, and a module-level "last context" variable is the
   * ambient state 11 §3 exists to refuse.
   *
   * What it does not change: cost 1 still holds — a replayed value is a stale value with confidence, it answers
   * *which query to run*, and anything about the server still comes from the SDK.
   */
  peek<I extends SignalId>(id: I): PayloadOf<I> | null;
}

export class UnknownSignalError extends Error {
  constructor(id: string) {
    super(`signal "${id}" is not in the registry. Add a table entry to packages/ui/src/signals.ts — that is where the review happens (11 §3 acceptance (b)).`);
    this.name = 'UnknownSignalError';
  }
}

/**
 * A bus over the table: one store, one sequence, and the retention decision taken from the declaration rather
 * than from the call site.
 *
 * Payloads are validated through the StandardSchema on the way *in* and again on the way *out* of the replay
 * store. The second validation is not redundancy: the store holds a reference the emitter could still mutate
 * through a non-frozen object, and a replayed value that has drifted from its schema is the #247 defect
 * arriving by a different route.
 */
export function createSignalBus(): SignalBus {
  const stored = new Map<SignalId, unknown>();
  const handlers = new Map<SignalId, Set<(payload: never, meta: SignalMeta) => void>>();
  let seq = 0;

  // Takes the resolved signal, not an id: `SIGNAL_TABLE[id]` is `AnySignal | undefined` under
  // `noUncheckedIndexedAccess`, and every caller has already guarded on the lookup. Re-guarding here would put
  // a second, weaker copy of the unknown-id rule in the file.
  const validate = (signal: AnySignal, payload: unknown): never => {
    const result = signal.payload['~standard'].validate(payload);
    if (result instanceof Promise) {
      throw new SignalDeclarationError(signal.name, 'payload schemas must be synchronous; an async one cannot gate an emit');
    }
    if (result.issues) {
      throw new SignalDeclarationError(signal.name, `payload does not match its schema: ${result.issues.map((i) => `${(i.path ?? []).map(String).join('.')}: ${i.message}`).join('; ')}`);
    }
    return result.value as never;
  };

  return {
    emit(id, payload) {
      const signal = SIGNAL_TABLE[id];
      if (!signal) throw new UnknownSignalError(String(id));
      const value = validate(signal, payload);
      seq += 1;
      if (signal.retention === 'replay') stored.set(id, value);
      const set = handlers.get(id);
      if (!set) return;
      const meta: SignalMeta = { seq, replayed: false };
      for (const handler of [...set]) handler(value, meta);
    },

    subscribe(id, handler) {
      const signal = SIGNAL_TABLE[id];
      if (!signal) throw new UnknownSignalError(String(id));
      let set = handlers.get(id);
      if (!set) {
        set = new Set();
        handlers.set(id, set);
      }
      set.add(handler as (payload: never, meta: SignalMeta) => void);

      // The late-mount delivery. `replay` hands the stored value down synchronously, before the caller's own
      // effect can run — that is what lets the component's *first* render show the selected context (11 §3
      // acceptance (d)). `transient` deliberately does nothing here, and the inverse case is tested.
      if (signal.retention === 'replay' && stored.has(id)) {
        seq += 1;
        handler(validate(signal, stored.get(id)) as never, { seq, replayed: true });
      }
      return () => {
        set?.delete(handler as (payload: never, meta: SignalMeta) => void);
      };
    },

    retentionOf(id) {
      const signal = SIGNAL_TABLE[id];
      if (!signal) throw new UnknownSignalError(String(id));
      // The cast erases a per-id literal for a union the caller then re-narrows by `id`. The value itself comes
      // from the frozen declaration, so no default is involved: this is the table, read back.
      return signal.retention as RetentionOf<typeof id>;
    },

    peek(id) {
      const signal = SIGNAL_TABLE[id];
      // Refused, not `null`: a caller asking for a signal the table does not hold has a stale id, and answering
      // "nothing stored" would let that typo read as an empty context forever (11 §3 acceptance (b)).
      if (!signal) throw new UnknownSignalError(String(id));
      // The retention decides, not the call site. A `transient` signal's last value may well be in the map -- it
      // is not, because emit only stores on replay -- and reading through the declaration means a future edit
      // that stores more cannot start handing side effects to late renders.
      if (signal.retention !== 'replay') return null;
      // Named apart from the store it reads: `const stored = stored.get(id)` would be a temporal-dead-zone
      // reference to the Map itself, and the shadowing is exactly the kind of thing a reviewer should not have to
      // notice at 400 lines.
      const remembered = stored.get(id);
      if (remembered === undefined) return null;
      // Validated on the way out, exactly as `subscribe`'s replay does it: the store holds a reference that a
      // caller holding a non-frozen payload could still have mutated, and a peek that skips the check is a second
      // answer to "what is the context" that the emit path does not give.
      return validate(signal, remembered) as PayloadOf<typeof id>;
    },
  };
}
