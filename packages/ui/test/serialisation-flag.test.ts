import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * `--test-concurrency=1` in the root `test` script is load-bearing for correctness, not performance tuning.
 *
 * Pinned because I nearly removed it on exactly that misreading (2026-11-15): I diagnosed one collision --
 * two suites mutating the same tracked files -- concluded the flag was a band-aid, and ordered its removal. A
 * session then reproduced a second collision I had not named: suites that merely *import* a file a mutator has
 * changed. The mutation sandbox cannot fix that class, because ESM evaluates a test file's whole static import
 * graph before any of its code runs, so a reader never gets a chance to wait for the lock -- and a cache-busted
 * dynamic import re-evaluates only the entry module, leaving its imports bound to the cached, possibly mutated,
 * instances. Observed with a forced overlap: `layout.test.ts` failed `stack declares "size"` and
 * `components.test.ts` failed `no instances at all was accepted`, both while a mutator held the change.
 *
 * Removing the flag is legitimate once issue #263 lands (mutate a copy of the audited subtree, so readers can
 * never observe a planted violation). Until then this assertion is the difference between a CI speed-up and a
 * false green in the suites whose entire job is proving the gates can bite.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

test('the test script serialises files, because mutation suites share the working tree with their readers', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const script = pkg.scripts.test ?? '';
  assert.match(
    script,
    /--test-concurrency=1/,
    'the root `test` script must run one test FILE at a time. Two suites mutate tracked sources '
    + '(packages/ui/test/gates-falsify.test.ts, packages/ui/test/typecheck-coverage.test.ts) and other suites import '
    + 'those same files, so a parallel reader can evaluate a planted violation as though it were the real source. '
    + 'Do not remove this flag until issue #263 provides a mutation copy of the audited subtree; see '
    + 'packages/ui/test/mutation-sandbox.ts for the lock that handles the mutator-vs-mutator case.',
  );
  assert.match(
    script,
    /packages\/\*\/test\/\*\.test\.ts/,
    'and it must still run every package and app test file -- serialising must not quietly narrow the surface',
  );
});

test('the sandbox documents the gap this flag is covering, so the two cannot drift apart', () => {
  // The failure mode this guards against is a comment that outlives its code: someone deletes the paragraph,
  // keeps the flag forever, and nobody remembers why. So the reasoning must exist in the module as well as here.
  const sandbox = fs.readFileSync(path.join(ROOT, 'packages/ui/test/mutation-sandbox.ts'), 'utf8');
  assert.match(sandbox, /test-concurrency/, 'mutation-sandbox.ts must name the flag it cannot replace');
  assert.match(sandbox, /import graph|static import/, 'and the ESM reason the lock is insufficient for readers');
  assert.match(sandbox, /#263/, 'and point at the issue that closes the gap');
});
