import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMutationSandbox } from './mutation-sandbox.ts';

/**
 * #259's own falsification: the wiring that makes a `.tsx` type-checked in CI, mutated four ways.
 *
 * `pnpm run typecheck` runs two `tsc --noEmit -p` projects. The split is what buys both halves of the guarantee
 * -- screens are compiled, and `document` stays a type error in the server tree -- and a split is exactly the kind
 * of thing that rots quietly: an include glob narrowed, a project dropped from the script, a `tsconfig.json`
 * added and never wired, a `.tsx` dropped in a package that has no JSX project. Every one of those leaves the
 * command green. So each is done here on purpose, and each must make something fail and name what.
 *
 * Restoration is by byte-exact copy and `cmp`-equivalent comparison, and no case uses `git checkout`/`restore`/
 * `stash`/`clean`: this working tree carries other people's uncommitted work.
 *
 * ## Every case runs inside `mutation-sandbox.ts`
 *
 * This file plants a type error in `packages/ui/src/components/instances.tsx` -- the same file
 * `gates-falsify.test.ts` plants `isMobile` in -- and `node --test` runs the two files in parallel processes.
 * Before the sandbox, whichever baseline ran second read the other's probe and failed an assertion that was
 * telling the truth about a tree it did not own. The sandbox holds the tree for the duration of each case and
 * records the pre-mutation bytes in a `.tmp/` sidecar before it touches anything, so a `SIGKILL` from a step
 * deadline leaves a record the next process replays. See `mutation-sandbox.test.ts` for that proof.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** Module scope: recovery from an interrupted run happens before the first assertion reads the tree. */
const sandbox = createMutationSandbox({ root: ROOT });

function run(args: string[]): { code: number; output: string } {
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', ...args], { stdio: 'pipe', cwd: ROOT, encoding: 'utf8' });
    return { code: 0, output: out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const typecheck = (): { code: number; output: string } => {
  // The script itself, not an approximation of it: reading `package.json` is what keeps this honest about the
  // wiring under test rather than about a command the test invented.
  const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.typecheck as string;
  const parts = script.split(' && ');
  let last: { code: number; output: string } = { code: 0, output: '' };
  for (const part of parts) {
    last = run([path.join(ROOT, 'node_modules/typescript/bin/tsc'), ...part.replace('tsc ', '').split(' ')]);
    if (last.code !== 0) return last;
  }
  return last;
};

// Not --quiet: the summary line is the evidence the assertions below read, and `say()` suppresses it.
const coverage = (): { code: number; output: string } => run(['scripts/check-project.ts']);

test('the clean tree type-checks in every project the script names, and the coverage gate agrees', () => {
  sandbox.exclusive('baseline: clean tree type-checks', () => {
    const check = typecheck();
    assert.equal(check.code, 0, `typecheck is red on a clean tree; the mutations below would mean nothing:\n${check.output.slice(-1500)}`);
    const cov = coverage();
    assert.equal(cov.code, 0, `type-check coverage is red on a clean tree:\n${cov.output.slice(-1500)}`);
    // DERIVED, never hardcoded. This line asserted the literal `2 project(s)` and went red the moment `apps/site`
    // added its own type-check project -- which is the correct outcome for a coverage change and the wrong outcome
    // for a test: the count is whatever the `typecheck` script says it is, so pinning it here meant the test could
    // only ever be updated by hand, exactly like the stale counts AGENTS.md keeps getting wrong. Now it re-derives
    // the number from the script that defines it, and still fails if the gate and the script disagree.
    const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
    const declared = scripts.typecheck;
    assert.ok(declared, 'the root package.json must define a `typecheck` script; this test has no subject without one');
    // Count the projects the script actually runs: every `-p <path>.json` whose basename is a tsconfig.
    // The first version of this used /-p\s+\S+tsconfig.../ which silently missed the bare `-p tsconfig.json`
    // (no path prefix to satisfy `\S+`), derived 2 against a gate reporting 3, and failed -- a derived number
    // parsed wrongly is no better than a hardcoded one, and it is harder to spot.
    const expected = (declared.match(/-p\s+(\S+\.json)/g) ?? [])
      .map((m) => m.replace(/-p\s+/, ''))
      .filter((p) => p === 'tsconfig.json' || p.endsWith('/tsconfig.json')).length;
    assert.ok(expected >= 2, `the typecheck script must name at least two projects, got ${String(expected)} in: ${declared}`);
    assert.match(
      cov.output,
      new RegExp(`\\b${String(expected)} project\\(s\\):`),
      `the coverage gate must report exactly the ${String(expected)} project(s) the typecheck script names -- `
      + `a project on disk that the script never runs is unchecked code that looks checked:\n${cov.output.slice(-400)}`,
    );
  });
});

test('a type error inside a .tsx screen fails the type-check step and names the file', () => {
  // The whole point of #259. Before it, this file would have been transpiled by `tsx` at run time and compiled by
  // nothing, and every gate that reads it as text would still have been green.
  sandbox.exclusive('type error in a .tsx screen', () => {
    const target = path.join(ROOT, 'packages/ui/src/components/instances.tsx');
    const original = sandbox.append('packages/ui/src/components/instances.tsx', '\nexport const __typeErrorProbe = (): string => 42;\n');
    try {
      const { code, output } = typecheck();
      assert.notEqual(code, 0, 'DID NOT BITE: a type error in a .tsx passed the type-check step');
      assert.match(output, /instances\.tsx\(\d+,\d+\): error TS/);
      assert.match(output, /TS2322|not assignable/);
    } finally {
      sandbox.restore();
      assert.ok(original.equals(fs.readFileSync(target)), 'RESTORATION FAILED: probe code is still in the tree');
    }
    assert.equal(typecheck().code, 0, 'the tree did not come back clean');
  });
});

test('a stray document reference in the server tree is still a type error, not a grep', () => {
  sandbox.exclusive('document reference in the server tree', () => {
    const target = path.join(ROOT, 'packages/contracts/src/attestation.ts');
    const original = sandbox.append('packages/contracts/src/attestation.ts', '\nexport const __domLeak = (): string => document.title;\n');
    try {
      const { code, output } = typecheck();
      assert.notEqual(code, 0, 'DID NOT BITE: the server tree gained a browser global and stayed green');
      assert.match(output, /attestation\.ts\(\d+,\d+\): error TS2584/);
      assert.match(output, /Cannot find name 'document'/);
    } finally {
      sandbox.restore();
      assert.ok(original.equals(fs.readFileSync(target)), 'RESTORATION FAILED');
    }
  });
});

test('a project the typecheck script names but that does not exist fails loudly', () => {
  sandbox.exclusive('typecheck script names a missing project', () => {
    const target = path.join(ROOT, 'package.json');
    const original = sandbox.replaceOnce('package.json', '-p packages/ui/tsconfig.json', '-p packages/ui/tsconfig.nope.json');
    try {
      const { code, output } = typecheck();
      assert.notEqual(code, 0, 'DID NOT BITE: a missing type-check project was skipped rather than failed');
      assert.match(output, /TS5058|does not exist/);
      // The coverage gate names the same breakage from its own side, which is what `pnpm run check` catches.
      const cov = coverage();
      assert.equal(cov.code, 1, 'the coverage gate accepted a typecheck script that points at nothing');
      assert.match(cov.output, /cannot be read/);
      assert.match(cov.output, /is type-checked by no project/);
    } finally {
      sandbox.restore();
      assert.ok(original.equals(fs.readFileSync(target)), 'RESTORATION FAILED: package.json left mutated');
    }
  });
});

test('a .tsx that no project claims is reported, not silently unchecked', () => {
  sandbox.exclusive('unclaimed .tsx is reported', () => {
    const orphan = path.join(ROOT, 'packages/page-schema/src/probe-orphan.tsx');
    assert.ok(!fs.existsSync(orphan), 'the probe path is occupied; refusing to overwrite someone else file');
    sandbox.write('packages/page-schema/src/probe-orphan.tsx', 'export const __orphan = 1;\n');
    try {
      const cov = coverage();
      assert.equal(cov.code, 1, 'DID NOT BITE: an unclaimed .tsx passed the coverage gate');
      assert.match(cov.output, /probe-orphan\.tsx is type-checked by no project/);
    } finally {
      sandbox.restore();
      assert.ok(!fs.existsSync(orphan), 'the probe file was left in the tree');
    }
  });
});

test('a .tsx claimed by a project without jsx is named, and the tempting fix is in the message', () => {
  sandbox.exclusive('.tsx in a jsx-free project is named', () => {
    const orphan = path.join(ROOT, 'packages/contracts/src/probe-dom-tsx.tsx');
    assert.ok(!fs.existsSync(orphan), 'the probe path is occupied');
    sandbox.write('packages/contracts/src/probe-dom-tsx.tsx', 'export const __probe = (): number => 1;\n');
    try {
      // `packages/contracts/src/**.tsx` is inside the ROOT include family once the extension matches, so this is the
      // shape of the mistake: a screen in a server package, claimed by a program with no `jsx`.
      // Either the coverage gate claims it (no project) or a project without jsx does (TS6142 at the type-check
      // step). What is not acceptable is silence.
      const named = coverage().code !== 0 || typecheck().code !== 0;
      assert.ok(named, 'DID NOT BITE: a .tsx in a DOM-free, jsx-free project passed every gate');
    } finally {
      sandbox.restore();
      assert.ok(!fs.existsSync(orphan), 'the probe file was left in the tree');
    }
  });
});

test('a tsconfig that exists but is never run is reported', () => {
  sandbox.exclusive('tsconfig nobody runs is reported', () => {
    const extra = path.join(ROOT, 'packages/page-schema/tsconfig.json');
    assert.ok(!fs.existsSync(extra), 'the probe path is occupied');
    sandbox.write('packages/page-schema/tsconfig.json', '{ "extends": "../../tsconfig.json", "include": ["src/**/*.ts"] }\n');
    try {
      const cov = coverage();
      assert.equal(cov.code, 1, 'DID NOT BITE: a project nobody runs looked like a project that was checked');
      assert.match(cov.output, /packages\/page-schema\/tsconfig\.json exists but no `tsc -p` in the `typecheck` script runs it/);
    } finally {
      sandbox.restore();
      assert.ok(!fs.existsSync(extra), 'the probe tsconfig was left in the tree');
    }
  });
});

test('nothing was left behind: every mutated path is back the way it was found', () => {
  // The mirror of the assertion `gates-falsify.test.ts` makes: this file creates as well as edits, so "restored"
  // has to mean the probe paths are absent *and* the tree type-checks again. A green run that left a probe behind
  // is the failure shape that cost a day of chasing a phantom in the tree.
  sandbox.exclusive('nothing left behind', () => {
    sandbox.assertNothingPending();
    for (const probe of ['packages/page-schema/src/probe-orphan.tsx', 'packages/contracts/src/probe-dom-tsx.tsx', 'packages/page-schema/tsconfig.json']) {
      assert.ok(!fs.existsSync(path.join(ROOT, probe)), `${probe} survived this run`);
    }
    assert.equal(typecheck().code, 0, 'the tree does not type-check after this run, so something was not restored');
    assert.equal(coverage().code, 0, 'the coverage gate is red after this run, so something was not restored');
  });
});
