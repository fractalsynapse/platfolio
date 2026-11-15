import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  createSignalBus, makeSignal, payloadPropertyNames, REPLAY_SIGNAL_IDS, SIGNALS, SIGNAL_IDS,
  SignalDeclarationError, UnknownSignalError,
} from '../src/signals.ts';
import type { SignalId } from '../src/signals.ts';

/**
 * Rule 3, and the acceptance criteria in 11 §3. The late-mount case is tested **both directions** because
 * `docs/ui-architecture.md` names a one-sided assertion in a security assertion as this repository's pattern:
 * the flipped-signature test "had been passing without testing anything". A replay test that only ever checks
 * "the value arrived" proves as little as one that only checks "it did not".
 */

const CTX: SignalId = 'context.switched';
const OVERLAY: SignalId = 'overlay.changed';
const SECRETS: SignalId = 'secrets.saved';

/* ------------------------------------------------------------------ the table */

test('every declared signal states its retention out loud — there is nothing to inherit', () => {
  const table = Object.entries(SIGNALS) as [SignalId, { retention: string; name: string }][];
  assert.ok(table.length >= 5, 'the table is smaller than 11 §3 specifies');
  for (const [id, signal] of table) {
    // The frozen declaration carries `name`, and it must agree with the key it is filed under. A table entry
    // whose name and key differ would let `emit('a')` store under one label and report another.
    assert.equal(signal.name, id, 'the declaration names a different signal than the key it is filed under');
    assert.ok(['replay', 'transient'].includes(signal.retention), `${id}: retention is ${JSON.stringify(signal.retention)}`);
    // The distinction the compiler cannot make at a boundary: an *absent* field and an *undefined* one.
    assert.ok('retention' in signal && signal.retention !== undefined, `${id}: retention present but not set`);
  }
});

test('the replay set is exactly the two facts 11 §3 says must survive a late mount', () => {
  assert.deepEqual([...REPLAY_SIGNAL_IDS].sort(), ['context.switched', 'overlay.changed']);
});

test('everything side-effecting is transient by rule, not by taste', () => {
  // `secrets.saved` is the sharpest of these: it is the "I just delivered a credential" fact. Replayed, it
  // invites a second delivery of a value platfolio's claim (D53) is that it never kept.
  assert.equal(SIGNALS['secrets.saved'].retention, 'transient');
  assert.equal(SIGNALS['instance.state-changed'].retention, 'transient');
  assert.equal(SIGNALS['refresh.requested'].retention, 'transient');
});

test('SIGNAL_IDS is the table, not a second list that can drift from it', () => {
  assert.deepEqual([...SIGNAL_IDS].sort(), Object.keys(SIGNALS).sort());
});

/* ------------------------------------------------------------------ late mount, both directions */

test('replay: a component that mounts after the fact is handed it, synchronously, on subscribe', () => {
  const bus = createSignalBus();
  const seen: { payload: unknown; replayed: boolean }[] = [];
  bus.emit(CTX, { teamSlug: 'fractalsynapse', instanceId: '01ABC', environment: 'production' });
  // Mount *after* the emit — the sheet opened late, the lazily hydrated island, the screen re-entered.
  bus.subscribe(CTX, (payload, meta) => seen.push({ payload, replayed: meta.replayed }));
  assert.equal(seen.length, 1, 'a late subscriber to a replay signal got nothing; it will render with no context');
  assert.deepEqual(seen[0]?.payload, { teamSlug: 'fractalsynapse', instanceId: '01ABC', environment: 'production' });
  assert.equal(seen[0]?.replayed, true, 'the delivery must be marked replayed, or a subscriber cannot tell a fact from a moment');
});

test('transient: a component that mounts after the fact stays silent', () => {
  const bus = createSignalBus();
  const seen: unknown[] = [];
  bus.emit(SECRETS, { instanceId: '01ABC', name: 'STRIPE_WEBHOOK_SECRET', environment: 'production' });
  bus.subscribe(SECRETS, (payload) => seen.push(payload));
  assert.deepEqual(seen, [], 'a late subscriber received a transient signal — this is the re-fired mutation, and the inverse case above is what makes asserting it mean something');
});

test('replay is not a cache of history: a late subscriber gets the LAST value, once', () => {
  const bus = createSignalBus();
  bus.emit(CTX, { teamSlug: 'a', instanceId: null, environment: 'staging' });
  bus.emit(CTX, { teamSlug: 'b', instanceId: null, environment: 'production' });
  const seen: unknown[] = [];
  bus.subscribe(CTX, (p) => seen.push(p));
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], { teamSlug: 'b', instanceId: null, environment: 'production' });
});

test('an early subscriber is not double-delivered when the value later replays for someone else', () => {
  const bus = createSignalBus();
  let count = 0;
  bus.subscribe(CTX, () => { count += 1; });
  bus.emit(CTX, { teamSlug: 'a', instanceId: null, environment: 'staging' });
  bus.subscribe(CTX, () => { /* a second, later subscriber */ });
  assert.equal(count, 1, 'the live subscriber saw the emit once; the replay store is for late mounts, not a rebroadcast');
});

test('a replay carries a seq later than the emit that stored it, which is what makes stale-drop possible (11 §3 cost 1)', () => {
  // The mitigation 11 §3 offers for "a replayed value is a stale value with confidence" is the monotonic seq:
  // a subscriber that has since seen a newer fact must be able to tell that the thing it was just handed is
  // older. That only works if the replay's seq is *not* the stored emit's seq.
  const bus = createSignalBus();
  const live: { seq: number; replayed: boolean }[] = [];
  bus.subscribe(CTX, (_p, meta) => live.push(meta));
  bus.emit(CTX, { teamSlug: 'a', instanceId: null, environment: 'staging' });
  assert.deepEqual(live, [{ seq: 1, replayed: false }], 'the live emit must be seq 1 and unmarked');

  const late: { seq: number; replayed: boolean }[] = [];
  bus.subscribe(CTX, (_p, meta) => late.push(meta));
  assert.deepEqual(late, [{ seq: 2, replayed: true }], 'the replay must be a later seq, marked replayed');
  assert.ok((late[0]?.seq ?? 0) > (live[0]?.seq ?? 0), 'a replay delivered at seq <= the emit that stored it could not be recognised as stale');

  // And it stays monotonic across *different* signals, so a subscriber comparing a replay against unrelated
  // activity is comparing points on one clock and not two.
  const across: number[] = [];
  bus.emit(OVERLAY, { stack: ['/instances'] });
  bus.subscribe(OVERLAY, (_p, meta) => across.push(meta.seq));
  assert.ok((across[0] ?? 0) > (late[0]?.seq ?? 0), 'the sequence reset or lagged across signals');
});

test('unsubscribe stops delivery, and unsubscribing twice is not an error', () => {
  const bus = createSignalBus();
  let count = 0;
  const off = bus.subscribe(CTX, () => { count += 1; });
  off();
  off();
  bus.emit(CTX, { teamSlug: 'a', instanceId: null, environment: 'staging' });
  assert.equal(count, 0);
});

/* ------------------------------------------------------------------ the typed boundary */

test('an id the table does not hold is refused at runtime as well as at compile time (11 §3 acceptance (b))', () => {
  const bus = createSignalBus();
  const rogue = 'context.switchen' as SignalId;
  assert.throws(() => bus.emit(rogue, {} as never), UnknownSignalError);
  assert.throws(() => bus.subscribe(rogue, () => { /* nothing */ }), UnknownSignalError);
  assert.throws(
    () => bus.emit(rogue, {} as never),
    /Add a table entry to packages\/ui\/src\/signals\.ts/,
    'the refusal must name where a signal is added, because that is where the review happens',
  );
});

test('a payload that does not match its schema is refused, including on the way out of the replay store', () => {
  const bus = createSignalBus();
  // 11 §3 acceptance (a)'s negative fixture, as a runtime assertion: `{ teamSlug: 1 }` is the wrong shape.
  assert.throws(
    () => bus.emit(CTX, { teamSlug: 1, instanceId: null, environment: 'production' } as never),
    SignalDeclarationError,
  );
  // The refusal must name the *field*, not merely reject. Zod reports the accepted options rather than
  // echoing back the rejected value, which is the right trade for a payload that might have carried a secret.
  assert.throws(
    () => bus.emit(CTX, { teamSlug: 'a', instanceId: null, environment: 'qa' } as never),
    /environment: Invalid option/,
    'the refusal should point at `environment`, or a caller has no way to find which field it got wrong',
  );
});

test('an unknown extra prop in a payload is refused, not stripped (strict schemas, as in page-schema)', () => {
  const bus = createSignalBus();
  assert.throws(
    () => bus.emit(CTX, { teamSlug: 'a', instanceId: null, environment: 'staging', token: 'leaked' } as never),
    SignalDeclarationError,
    'a replayed payload carrying an undeclared credential-shaped key must not be accepted and stored',
  );
});

test('retentionOf reads the declaration; it has no fallback to reach', () => {
  const bus = createSignalBus();
  assert.equal(bus.retentionOf(CTX), 'replay');
  assert.equal(bus.retentionOf(SECRETS), 'transient');
  assert.throws(() => bus.retentionOf('nope' as SignalId), UnknownSignalError);
});

/* ------------------------------------------------------------------ the credential rule */

test('a replay signal whose payload is credential-shaped is refused at declaration', () => {
  for (const key of ['token', 'apiKey', 'clientSecret', 'value', 'password', 'bearer']) {
    assert.throws(
      () => makeSignal({
        name: `credential.${key}`,
        payload: z.object({ [key]: z.string() }).strict(),
        retention: 'replay',
      }),
      SignalDeclarationError,
      `"${key}" was accepted into a replay payload`,
    );
  }
});

test('the refusal names the page-schema predicate rather than inventing a second list (D63, rule 4)', () => {
  let message = '';
  try {
    makeSignal({ name: 'x', payload: z.object({ accessToken: z.string() }).strict(), retention: 'replay' });
  } catch (error) {
    message = (error as Error).message;
  }
  assert.match(message, /credential-shaped key "accessToken"/);
  assert.match(message, /transient is mandatory for anything credentialed/);
});

test('the same credential-shaped payload is legal as transient', () => {
  // The rule is about *retention*, not about the key: a one-shot delivery signal has to name the secret it
  // delivered. Refusing it outright would push people to weaken the check everywhere.
  const ok = makeSignal({ name: 'secrets.typed', payload: z.object({ token: z.string() }).strict(), retention: 'transient' });
  assert.equal(ok.retention, 'transient');
});

test('a benign payload is not rejected by over-broad matching', () => {
  const ok = makeSignal({
    name: 'context.switched',
    payload: z.object({ teamSlug: z.string(), labelValue: z.string(), satisfied: z.boolean() }).strict(),
    retention: 'replay',
  });
  assert.equal(ok.retention, 'replay');
});

test('a replay signal whose property names cannot be discovered is refused (fail closed, not fail blind)', () => {
  // A schema with no readable shape would otherwise produce an empty key list, and "I found no secret names"
  // would be recorded as "this payload holds no secrets". That is #247's "compared" quietly meaning "not
  // generated", one layer down.
  const opaque = {
    '~standard': {
      version: 1 as const,
      vendor: 'opaque',
      validate: (value: unknown) => ({ value: value as object }),
    },
  };
  assert.equal(payloadPropertyNames(opaque), null, 'an opaque schema must report null, never []');
  assert.throws(
    () => makeSignal({ name: 'opaque.replay', payload: opaque, retention: 'replay' }),
    /property names are discoverable/,
  );
  // And the same opaque schema is fine as transient: the rule protects the replay store.
  assert.equal(makeSignal({ name: 'opaque.transient', payload: opaque, retention: 'transient' }).retention, 'transient');
});

test('payloadPropertyNames walks nested and unioned shapes, not just the top level', () => {
  const nested = z.object({
    outer: z.string(),
    inner: z.object({ clientSecret: z.string() }),
    list: z.array(z.object({ refreshToken: z.string() })),
  }).strict();
  const names = payloadPropertyNames(nested) ?? [];
  assert.deepEqual([...new Set(names)].sort(), ['clientSecret', 'inner', 'list', 'outer', 'refreshToken']);
  assert.throws(() => makeSignal({ name: 'nested.replay', payload: nested, retention: 'replay' }), /clientSecret/);

  const unioned = z.union([z.object({ apiKey: z.string() }), z.object({ ok: z.boolean() })]);
  assert.ok((payloadPropertyNames(unioned) ?? []).includes('apiKey'), 'a key reachable only through one branch must still be seen');
});

/* ------------------------------------------------------------------ declarations are frozen */

test('a signal declaration is frozen, so retention cannot be flipped after the fact', () => {
  assert.ok(Object.isFrozen(SIGNALS[CTX]));
  const before = SIGNALS[CTX].retention;
  try {
    (SIGNALS[CTX] as { retention: string }).retention = 'transient';
  } catch {
    /* strict mode throws; non-strict silently ignores. Both are checked by the assertion below. */
  }
  assert.equal(SIGNALS[CTX].retention, before, 'retention moved at runtime, which means the store could be widened without a diff');
});

test('makeSignal refuses a retention that is neither literal', () => {
  assert.throws(
    () => makeSignal({ name: 'x', payload: z.object({ a: z.string() }).strict(), retention: 'maybe' as 'replay' }),
    /must be "replay" or "transient"/,
  );
});

test('makeSignal refuses a missing retention even when the compiler is not in the loop', () => {
  // The type-level refusal is gate §9.4b. This is the runtime twin, for a declaration that arrives from
  // JavaScript or from a cast — the `FakeInfraProvider` shape, where the declaration and the behaviour part
  // company.
  const smuggled = { name: 'x', payload: z.object({ a: z.string() }).strict() } as unknown as Parameters<typeof makeSignal>[0];
  assert.throws(() => makeSignal(smuggled), /retention is required and has no default/);
  const explicitUndefined = { name: 'x', payload: z.object({ a: z.string() }).strict(), retention: undefined } as unknown as Parameters<typeof makeSignal>[0];
  assert.throws(() => makeSignal(explicitUndefined), /must be "replay" or "transient"/);
});
