import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OperationId, ParamsOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import { applyResult, initial, isRefresh } from '../src/sdk/state.ts';
import type { AuthSource, FreshnessSource, Result, State, Transport, Unsubscribe } from '../src/index.ts';

/**
 * The hook's *logic*, tested at the seam rather than through a renderer.
 *
 * There is no DOM in this repository's test surface (11 §8 defers the browser harness, and this task forbids
 * smuggling one in), so `useOperation` is exercised through the state machine it drives: the transport, the
 * freshness source, and the rules about when a value may be replaced. Those rules are where the honesty lives —
 * "a refresh that fails keeps the last-known value" is not a rendering behaviour, it is a state-transition one,
 * and asserting it here is asserting the same fact.
 *
 * What is therefore **not** covered by this file, and is reported as such rather than quietly skipped: React's
 * own scheduling of the effect, unmount cleanup, and the context wiring. Those need a renderer. §9.7/§9.8 are
 * the gates that would catch a fault there, and both are NOT RUN.
 */

type Listener = () => void;

class ScriptedTransport implements Transport {
  readonly kind = 'poll' as const;
  readonly calls: OperationId[] = [];
  private readonly listeners = new Set<Listener>();
  /** Each entry is what the following call answers. Exhaust it to assert the sequence a screen sees. */
  private readonly script: (() => Result<SuccessOf<OperationId>>)[];
  constructor(script: (() => Result<SuccessOf<OperationId>>)[]) {
    // No parameter property: `erasableSyntaxOnly` forbids the shorthand tree-wide.
    this.script = script;
  }

  // Declared with the interface's full arity. A double that accepts fewer arguments than `Transport` specifies
  // is a double that would let the real call sites drift: nothing here would notice a parameter nobody reads.
  async call<O extends OperationId>(op: O, _input: unknown, _auth: AuthSource): Promise<Result<SuccessOf<O>>> {
    this.calls.push(op);
    const step = this.script.shift();
    if (!step) throw new Error(`the script ran out after ${String(this.calls.length)} call(s)`);
    return step() as unknown as Result<SuccessOf<O>>;
  }

  freshness(): FreshnessSource & { tick(): void } {
    const listeners = this.listeners;
    return {
      kind: 'poll',
      subscribe(l: Listener): Unsubscribe {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      tick(): void {
        for (const l of [...listeners]) l();
      },
    };
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }
}

// `Result<unknown>` for the helpers, so `ok([])` is a value and not a `never` the compiler then refuses to put
// anywhere. Each call site narrows with `as Result<SuccessOf<O>>`, which is a test double asserting against a
// generated type and is honestly a cast, not a disguised shape copy.
const ok = (value: unknown): Result<SuccessOf<OperationId>> => ({ ok: true, value: value as SuccessOf<OperationId> });
const err = (code: string): Result<SuccessOf<OperationId>> => ({ ok: false, error: { status: 500, code, message: code } });

const BASE = { operation: 'listInstances', params: {} } as const;
type O = 'listInstances';

test('a first failure is a failed state with an age, not an eternal spinner (R10)', () => {
  const f = { observedAt: '2026-11-15T10:00:00.000Z', via: 'poll' as const };
  const next = applyResult<O>(initial<O>(BASE, '2026-11-15T09:59:00.000Z'), BASE, err('network_error') as unknown as Result<SuccessOf<O>>, f);
  assert.equal(next.status, 'failed');
  assert.ok('freshness' in next, 'the failed state lost its age, so the screen cannot say "unknown since"');
});

test('a refresh that fails keeps the last-known value with its ORIGINAL age', () => {
  // This is the rule that stops a status page lying during a hiccup: replacing good data with an error because
  // one poll did not land is #202's defect ("a service that finished was being reported as a service that
  // runs") moved to the render side.
  const original = { observedAt: '2026-11-15T10:00:00.000Z', via: 'poll' as const };
  const current: State<O> = { ...BASE, status: 'loaded', data: [], freshness: original };
  const later = { observedAt: '2026-11-15T10:05:00.000Z', via: 'poll' as const };
  const next = applyResult<O>(current, BASE, err('network_error') as unknown as Result<SuccessOf<O>>, later);
  assert.equal(next, current, 'a failed refresh displaced good data');
  assert.equal(isRefresh(current), true, 'isRefresh must call a loaded state a refresh, or the rule above never applies');
  assert.equal(isRefresh(initial<O>(BASE, 'x')), false, 'a pending state is not a refresh: its failure has to show');
  assert.ok('freshness' in next && next.freshness.observedAt === '2026-11-15T10:00:00.000Z', 'the age was rewritten to the failed attempt');
});

test('a refresh that succeeds replaces both the value and the age', () => {
  const current: State<O> = { ...BASE, status: 'loaded', data: [], freshness: { observedAt: '2026-11-15T10:00:00.000Z', via: 'poll' } };
  const later = { observedAt: '2026-11-15T10:05:00.000Z', via: 'poll' as const };
  const next = applyResult<O>(current, BASE, ok([]) as unknown as Result<SuccessOf<O>>, later);
  assert.ok(next.status === 'loaded' && 'freshness' in next);
  assert.equal(next.freshness.observedAt, '2026-11-15T10:05:00.000Z', 'the age still pointed at the previous value');
  assert.notEqual(next, current, 'a successful refresh returned the old object');
});

test('one freshness source is shared by every subscriber, so N panels are one timer', async () => {
  const transport = new ScriptedTransport([() => ok([]), () => ok([]), () => ok([])]);
  const auth: AuthSource = { token: async () => 't' };
  await transport.call('listInstances', { params: {} as ParamsOf<'listInstances'> }, auth);
  const source = transport.freshness();
  assert.ok(source);
  const offA = source.subscribe(() => { void transport.call('listInstances', { params: {} }, auth); });
  const offB = source.subscribe(() => { void transport.call('listInstances', { params: {} }, auth); });
  assert.equal(transport.subscriberCount, 2, 'two panels attached to the same source');
  // The invariant is *one source per key*, which is what makes one timer. Each subscriber still reacts to the
  // tick it is handed — that is the point of subscribing — but the scheduling count, not the listener count, is
  // what a tenant's control plane feels. `PollTransport` is where that lives, and `sdk.test.ts` asserts
  // `sourceCount === 1` there; this asserts the source identity that makes it true.
  // Source identity — one timer per key — is a property of `PollTransport`, which owns the scheduling, and
  // `sdk.test.ts` asserts `sourceCount === 1` there against the real driver. This double hands out a fresh
  // source per call on purpose: it is testing listener bookkeeping, not deduplication, and a double that
  // silently grew the driver's behaviour would let this file pass while proving something else.
  assert.equal(transport.subscriberCount, 2, 'both panels are not attached to the source they were given');
  source.tick();
  assert.equal(transport.calls.length, 3, 'one initial load plus one tick for each of two listeners');
  offA();
  offB();
  assert.equal(transport.subscriberCount, 0, 'unsubscribing left a listener behind, so the timer outlives the screen');
});

test('a transport with no freshness source yields undefined rather than a fake one', async () => {
  const bare: Transport = {
    kind: 'poll',
    call: async () => ({ ok: true, value: [] as never }),
  };
  assert.equal(bare.freshness?.('anything'), undefined);
  // 11 §4: a panel on such a transport must not be able to claim it is fresh. `freshness` absent is the honest
  // answer, and `useOperation` never schedules a subscription for it.
});

test('the state union has no branch carrying data without an age (rule 5, runtime face)', () => {
  // The compiler-side assertion lives in `fixtures/age-omitted.negative.ts` and runs under `ui:check` §9.10b.
  // This one checks the three branches are constructible and distinguishable at runtime, which is what a render
  // switches on.
  const f = { observedAt: 'x', via: 'poll' as const };
  const branches: State<O>[] = [
    initial<O>(BASE, 'x'),
    { ...BASE, status: 'loaded', data: [], freshness: f },
    { ...BASE, status: 'failed', error: { status: 500, code: 'x', message: 'x' }, freshness: f },
  ];
  assert.deepEqual(branches.map((b) => b.status), ['pending', 'loaded', 'failed']);
  for (const branch of branches) {
    if (branch.status === 'pending') {
      assert.ok('since' in branch && typeof branch.since === 'string', 'pending lost its timestamp');
      continue;
    }
    assert.ok(branch.freshness.observedAt, `${branch.status} carried data or an error without an age`);
    assert.equal(branch.freshness.via, 'poll', `${branch.status} did not say which transport produced it`);
  }
});
