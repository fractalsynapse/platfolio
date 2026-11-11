import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryStore } from '../src/memory-store.ts';
import { runStoreConformance, type StoreReport } from '../src/store-conformance.ts';
import type { Store } from '../src/persistence.ts';

const summarize = (report: StoreReport): string => report.results.filter((r) => r.status !== 'pass').map((r) => `  - ${r.name}: ${r.status} -- ${r.detail}`).join('\n') || '  (none)';

test('the in-memory Store satisfies the conformance suite', async () => {
  const report = await runStoreConformance(() => new MemoryStore());
  assert.equal(report.ok, true, `${report.driver} conformance:\n${summarize(report)}`);
  assert.ok(report.passed >= 16, `expected the full case list, got ${String(report.passed)} of ${String(report.results.length)}`);
  assert.ok(report.results.every((r) => r.name.length > 0), 'every case must be named');
});

test('the suite has teeth: a store that leaks references and allows replay FAILS it', async () => {
  // The two behaviours the suite exists to catch. Built by shadowing a real store rather than subclassing it:
  // an override whose return type is wider than the base is a type error, and loosening the base to satisfy a
  // test would remove the thing the test is checking.
  const base = new MemoryStore();
  const internals = base as unknown as { instances: Map<string, unknown> };
  const sloppy = Object.create(base) as Store;
  Object.defineProperty(sloppy, 'getInstance', { value: async (id: string) => ({ ok: true, value: internals.instances.get(id) }) });
  Object.defineProperty(sloppy, 'consumeDispatch', {
    // Accepts a second consume -- precisely the single-use violation the store exists to make impossible.
    value: async (id: string) => base.getDispatch(id),
  });

  const report = await runStoreConformance(() => sloppy);
  assert.equal(report.ok, false, 'the negative control must not conform');
  const failing = report.results.filter((r) => r.status === 'fail').map((r) => r.name);
  for (const expectation of [
    'a dispatch is single-use, and the second consume is a replay',
    'returned records are copies: mutating a read cannot corrupt the store',
  ]) {
    assert.ok(failing.includes(expectation), `the suite no longer catches this: ${expectation}\nfailed cases: ${JSON.stringify(failing)}`);
  }
});

test('a second, independent store instance satisfies the same suite (no shared-state conformance)', async () => {
  // Catches a double that secretly uses module-level Maps: two instances must not see each other's rows.
  const reports = await Promise.all([runStoreConformance(() => new MemoryStore()), runStoreConformance(() => new MemoryStore())]);
  for (const report of reports) assert.equal(report.ok, true, summarize(report));
  const a = new MemoryStore();
  const b = new MemoryStore();
  const team = await a.createTeam({ name: 'isolation' });
  assert.ok(team.ok);
  assert.equal((await b.listTeams()).length, 0, 'instance B can see instance A teams');
});
