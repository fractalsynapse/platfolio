import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ENDPOINTS } from '@platfolio/api-contract/generated/types';
import { stripComments } from '../../../scripts/ui-source-scan.ts';
import { registeredComponentIds, componentById } from '../src/registry.ts';
import { SCREENS } from '../src/screens/index.ts';
import { reachableOperations } from '../src/screens/screen.ts';

/**
 * #258's ownership rule, enforced: the routes have one owner, and it is not this package.
 *
 * `poll.ts` used to take an `OperationTable` the shell assembled by hand, and `test/sdk.test.ts` used to be the
 * place that hand-assembled one — six entries, invented paths, one operation id the specification has never
 * declared. That file was the second source, and a second source is what #247 and rule 1 are about, so this file
 * is the one that refuses its return. Three ways, because a claim about ownership has three ways to be wrong:
 *
 * 1. **The driver must read the generated table.** `ENDPOINTS` is imported by exactly one file in this package,
 *    and that file is the one gate §9.2 permits to build a URL. A second reader is a second owner.
 * 2. **No source file may write a route out.** A `/api/v1/…` string in a component, a screen, or a view-model is
 *    an endpoint defined twice, and the compiler cannot see it because both copies are legal. The scan is
 *    falsified by *running it over a mutated copy of the driver in memory* — the tree is never written to, so
 *    this file is safe to run beside every other gate.
 * 3. **A table may be injected, but only a total one.** Proved by the compiler, not by a sentence: the paired
 *    fixtures are compiled standalone and the answers are what the claim is.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SRC = path.join(ROOT, 'packages/ui/src');
const DRIVER = 'packages/ui/src/sdk/poll.ts';

/** Every `.ts`/`.tsx` under `packages/ui/src`, as raw text. The scan strips what it needs to, per rule. */
function sources(): Array<{ rel: string; raw: string }> {
  const out: Array<{ rel: string; raw: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      out.push({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), raw: fs.readFileSync(abs, 'utf8') });
    }
  };
  walk(SRC);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** A route an author wrote out by hand: a spec-shaped path literal anywhere in the code. */
const HAND_WRITTEN_ROUTE = /['"`]\/api\/v1\/[A-Za-z0-9{_/-]*['"`]/g;

/**
 * The scan reads **code with its comments removed and its strings kept** (`stripComments(raw, true)`), and the
 * choice is the whole rule: a route literal is exactly a *string in code*, so blanking string bodies -- what a
 * `fetch`-or-`window` scan does, and what this file's own header prose would otherwise trip -- would make the
 * scan blind to the violation it names. Comments go because `transport.ts` legitimately writes
 * `/api/v1/teams/{teamId}/events` in the sentence refusing it, and a gate that fires on a refusal gets widened.
 */
function handWrittenRoutes(files: ReadonlyArray<{ rel: string; raw: string }>): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const visible = stripComments(file.raw, true);
    HAND_WRITTEN_ROUTE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HAND_WRITTEN_ROUTE.exec(visible)) !== null) {
      hits.push(`${file.rel}: hand-written route \`${m[0]}\` -- ENDPOINTS is the only owner of a path (rule 1, #258)`);
    }
  }
  return hits;
}

test('no source file in this package writes a route out', () => {
  const files = sources();
  assert.ok(files.length >= 15, `the walk found ${String(files.length)} sources; it is looking in the wrong place`);
  assert.deepEqual(handWrittenRoutes(files), []);
});

test('the driver is the only file that reads the generated table', () => {
  const readers = sources()
    .filter((file) => /\bENDPOINTS\b/.test(stripComments(file.raw)))
    .map((file) => file.rel);
  assert.deepEqual(readers, [DRIVER], 'ENDPOINTS is being reached for outside the transport driver');
});

test('the scan bites: a hand-assembled table in the driver is reported', () => {
  // The mutation, in memory: nothing in the tree is written, so this file is safe to run beside every other
  // gate. Without it the assertion above is a green light over a rule nobody checks.
  const planted = sources().map((file) => (file.rel === DRIVER
    ? { ...file, raw: `${file.raw}\nexport const SHELL_TABLE = { listInstances: { method: 'get', path: '/api/v1/instances' } };\n` }
    : file));
  const hits = handWrittenRoutes(planted);
  assert.ok(hits.some((h) => h.startsWith(DRIVER) && h.includes('/api/v1/instances')), `planting a route list produced no finding: ${JSON.stringify(hits)}`);

  // And the compliant case is not what trips it: prose is not a route.
  assert.deepEqual(handWrittenRoutes([{ rel: 'x.ts', raw: "const note = 'not a route';\n// '/api/v1/instances'\n" }]), [],
    'a comment mentioning a path was read as code');
  assert.deepEqual(handWrittenRoutes([{ rel: 'y.ts', raw: "export const p = '/api/v1/instances';\n" }]).length, 1,
    'a path literal in code was not read as one');
});

test('every operation a component or a screen names has a route', () => {
  // The claim #258 was for: with the table in place, the screens can actually make the requests they declare.
  // A component whose `reads` had no route would render a state that can never arrive.
  const unrouted: string[] = [];
  for (const id of registeredComponentIds()) {
    for (const operation of componentById(id).reads ?? []) {
      if (!Object.hasOwn(ENDPOINTS, operation)) unrouted.push(`${id} reads ${operation}`);
    }
  }
  for (const screen of SCREENS) {
    for (const operation of reachableOperations(screen, 'wide')) {
      if (!Object.hasOwn(ENDPOINTS, operation)) unrouted.push(`${screen.id} reaches ${operation}`);
    }
  }
  assert.deepEqual(unrouted, [], `operations with no generated route: ${unrouted.join('; ')}`);

  // Named rather than implied, so a spec rename shows up as a changed list and not as a silent subtraction.
  const routed = ['listInstances', 'listTeams', 'getInstance', 'getLatestAttestation'] as const;
  for (const operation of routed) {
    assert.equal(Object.hasOwn(ENDPOINTS, operation), true, `${operation} is no longer in the table`);
  }
});

/* ------------------------------------------------------------------ the compiler's side */

/**
 * Compile one fixture standalone, under the flags this package's own project declares (`extends`, so there is
 * no second list of compiler options here to drift). The negative fixture must fail *at itself*; the control
 * must succeed, or the failure would be about the harness and not about the rule.
 */
function compileFixture(fixture: string): { code: number; output: string } {
  const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-probe-routes-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      `${JSON.stringify({
        extends: path.join(ROOT, 'packages/ui/tsconfig.json'),
        files: [path.relative(dir, path.join(ROOT, fixture))],
        include: [],
        exclude: [],
      }, null, 2)}\n`,
      'utf8',
    );
    try {
      const out = execFileSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', cwd: ROOT, encoding: 'utf8' });
      return { code: 0, output: out };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a partial route table does not compile, and a total one does', () => {
  const control = compileFixture('packages/ui/test/fixtures/route-table-total.control.ts');
  assert.equal(control.code, 0, `the CONTROL fixture did not compile, so the refusal below would mean nothing:\n${control.output.slice(0, 700)}`);

  const negative = compileFixture('packages/ui/test/fixtures/route-table-partial.negative.ts');
  assert.notEqual(negative.code, 0, 'DID NOT BITE: a two-entry route table was accepted where a total one is required');
  const atItself = negative.output
    .split(/\n(?=\S)/)
    .filter((block) => block.startsWith('packages/ui/test/fixtures/route-table-partial.negative.ts('));
  assert.ok(atItself.length > 0, `the refusal came from somewhere else:\n${negative.output.slice(0, 700)}`);
  // A pattern, not a substring, and both spellings: the compiler reports a *type alias as its expansion*, so
  // `OperationTable` surfaces as `Readonly<Record<keyof ApiResponses, Endpoint>>` (11 §9.1b learned this the
  // same way). Either wording is the rule; a third one means the claim moved and this assertion must move with it.
  assert.match(atItself.join('\n'), /OperationTable|Record<keyof ApiResponses, Endpoint>|is missing the following properties/,
    `the refusal does not name the total table type: ${atItself.join(' ').slice(0, 300)}`);
});
