import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Falsification: every gate is mutated and required to name the violation.
 *
 * This is the file that decides whether `ui:check` means anything. A gate that passes on a clean tree proves
 * only that it ran; `docs/ui-architecture.md` prices the alternative three times over — the parity gate that
 * *filed* #247 rather than preventing it, the destroy that would have said "destroyed", and the flipped
 * signature that "had been passing without testing anything, because flipping the last base64url character of
 * an RS256 signature often decodes to identical bytes". A mutation that changes nothing is reported as
 * `DID NOT BITE`, and the test fails, rather than being skipped.
 *
 * ## Restoration is by byte-exact copy, and that is a hard rule
 *
 * Each mutation appends to a file whose original bytes were captured first, and the `finally` writes them back
 * and verifies with `cmp`-equivalent comparison. Nothing here uses `git checkout`, `restore`, `stash`, `clean`
 * or `reset`: this working tree carries other people's uncommitted work, and a reset would take it. The test
 * also asserts the tree is byte-identical afterwards, so a bug in this file's own restore path fails loudly
 * instead of leaving a planted violation behind for someone else to commit.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const GATE = 'scripts/check-ui.ts';

interface Mutation {
  readonly gateId: string;
  readonly label: string;
  readonly file: string;
  readonly append: string;
  /** A fragment that must appear in the gate's stderr/stdout for the violation it just planted. */
  readonly expect: RegExp;
}

const MUTATIONS: readonly Mutation[] = [
  {
    gateId: '9.2',
    label: 'a fetch in a presentational file',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const rogueFetch = (): unknown => fetch("/api/v1/instances");\n',
    expect: /transport surface `fetch\(`/,
  },
  {
    gateId: '9.2',
    label: 'localStorage in a presentational file',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const writeDraft = (k: string, v: string): void => { localStorage.setItem(k, v); };\n',
    expect: /browser surface `localStorage`/,
  },
  {
    gateId: '9.2',
    label: 'a window touch outside web/',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const width = (): number => window.innerWidth;\n',
    expect: /browser surface `window\.`/,
  },
  {
    gateId: '9.2',
    label: 'a component-owned timer',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const pollMyself = (): void => { setInterval(() => undefined, 1000); };\n',
    expect: /timer call `setInterval\(` outside the freshness primitive/,
  },
  {
    gateId: '9.3',
    label: 'a width @media in the generated CSS',
    file: 'packages/ui/src/layout/layout.css',
    append: '\n@media (min-width: 60rem) { .ui-stack { display: flex; } }\n',
    expect: /width @media/,
  },
  {
    gateId: '9.3',
    label: 'an isMobile prop',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport interface ForkProps { readonly isMobile: boolean }\n',
    expect: /fork prop or window query `isMobile`/,
  },
  {
    gateId: '9.3',
    label: 'a matchMedia call',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const isWide = (): boolean => matchMedia("(min-width: 48rem)").matches;\n',
    expect: /fork prop or window query `matchMedia`/,
  },
  {
    gateId: '9.4',
    label: 'a raw dispatchEvent outside the registry',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const shout = (d: unknown): void => { document.dispatchEvent(new CustomEvent("x", { detail: d })); };\n',
    expect: /raw event mechanism/,
  },
  {
    gateId: '9.4',
    label: 'an ad-hoc EventTarget',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport const bus = new EventTarget();\n',
    expect: /raw event mechanism `new EventTarget`/,
  },
  {
    gateId: '9.1',
    label: 'a server DTO re-declared locally (#247 in a .tsx)',
    file: 'packages/ui/src/contract.ts',
    append: '\nexport interface Instance { readonly id: string; readonly name: string }\n',
    expect: /re-declares server type Instance/,
  },
  {
    gateId: '9.6',
    label: 'a dynamic import of a remote module',
    file: 'packages/ui/src/registry.ts',
    append: '\nexport const loadRemote = (url: string): Promise<unknown> => import(url);\n',
    expect: /dynamic import\(\) — runtime-loaded code is refused/,
  },
  {
    gateId: '9.6',
    label: 'a registry mutator',
    file: 'packages/ui/src/registry.ts',
    append: '\nexport function registerComponent(id: string, c: AnyComponentContract): void { void id; void c; }\n',
    expect: /registry exports mutator\(s\): registerComponent/,
  },
  {
    gateId: '9.6',
    label: 'a new Function in a page renderer',
    file: 'packages/ui/src/registry.ts',
    append: '\nexport const compile = (src: string): unknown => new Function(src);\n',
    expect: /new Function/,
  },
  {
    gateId: 'R5',
    label: 'an EventSource while the push operations are absent',
    file: 'packages/ui/src/sdk/poll.ts',
    append: '\nexport const stream = (u: string): EventSource => new EventSource(u);\n',
    expect: /EventSource while §4's push operations are absent/,
  },
  {
    gateId: 'R5',
    label: 'a live pill',
    file: 'packages/ui/src/sdk/transport.ts',
    append: '\nexport const liveLabel = (): string => "live";\n',
    expect: /a push-implying state word/,
  },
  /* ---------------------------------------------------------------- the #259 screens */
  {
    // The walk that used to be `.ts`-only. Every grep gate reads through `listSources`, so if it skipped `.tsx`
    // the gates would have scanned 13 files, reported PASS, and never looked at a screen. This is the mutation
    // that says whether the extension to `.tsx` is real or decorative.
    gateId: '9.2',
    label: 'a fetch in a .tsx component',
    file: 'packages/ui/src/components/instances.tsx',
    append: '\nexport const __rogueFetchTsx = (): unknown => fetch("/api/v1/instances");\n',
    expect: /transport surface `fetch\(`/,
  },
  {
    gateId: '9.3',
    label: 'an isMobile prop in a .tsx component',
    file: 'packages/ui/src/components/instances.tsx',
    append: '\nexport interface __ForkTsx { readonly isMobile: boolean }\n',
    expect: /fork prop or window query `isMobile`/,
  },
  {
    gateId: '9.4',
    label: 'an addEventListener in a .tsx component',
    file: 'packages/ui/src/components/instances.tsx',
    append: '\nexport const __wireTsx = (el: EventTarget): void => { el.addEventListener("x", () => undefined); };\n',
    expect: /raw event mechanism `addEventListener\(`/,
  },
  {
    // §9.5's refusal path, weakened from the other side: make one of the "invalid" prop sets actually valid and
    // the gate must notice that the case it claims to refuse no longer refuses anything.
    gateId: '9.5',
    label: 'a fixture violation that stops being a violation',
    file: 'packages/ui/test/fixtures/page-documents.ts',
    append: '\n(BAD_PROPS as unknown as { label: string; page: { component: string; props: Record<string, unknown> }[] })\n  .find((bad) => bad.label === "no instances at all")!\n  .page.props.instances = SAMPLE_INSTANCES;\n',
    expect: /no instances at all .* was ACCEPTED|was ACCEPTED -- §9\.5/,
  },
  {
    // TS0 pays the price of checking the gate scripts under `DOM`. If it does not fire on a browser global in
    // `scripts/check-ui.ts`, that price is being paid by nobody.
    gateId: 'TS0',
    label: 'a window touch in the gate script itself',
    file: 'scripts/check-ui.ts',
    append: '\nexport const __probeWidth = (): number => window.innerWidth;\n',
    expect: /browser global `window\.` in a Node script/,
  },
];

/**
 * Run the gate set. With no id, the whole set (the CI form); with one, just that gate, so a planted violation
 * is attributed to the check that owns it rather than to whatever else happened to be red.
 */
/**
 * A mutation that *weakens a rule* rather than violating it. These are the dangerous ones: a gate that fires on
 * an `isMobile` prop is doing its job, and the only way to know it would still fire is to break the rule it
 * reads. Each entry rewrites one declaration in the source the gate depends on, and every case was produced by
 * actually making that change and watching what the gate said — twice, it said PASS, and both are recorded in
 * the commit history of this file.
 */
interface Weakening {
  readonly gateId: string;
  readonly label: string;
  readonly file: string;
  readonly find: string;
  readonly replace: string;
  /**
   * How the gate is allowed to notice. There are exactly three honest answers, and they are not interchangeable
   * per case, so each entry names the ones it accepts:
   *
   *   `COMPILED`              the negative fixture stopped being an error — the rule is gone and the gate says so
   *   `was REFUSED`           the paired *control* broke, so the gate refuses to trust the refusal beside it
   *   `wrong reason`/`at itself` the refusal no longer comes from the file or the token it is supposed to
   *
   * Anything else — above all a clean exit 0 — is the DID NOT BITE path and fails this test.
   */
  readonly expect: RegExp;
}

/** The three ways an honest gate reacts to its rule being relaxed. Not a wildcard: exit 0 is absent by design. */
const NOTICED = /COMPILED|was REFUSED|for the wrong reason|not \*at itself\*/;

const WEAKENINGS: readonly Weakening[] = [
  {
    gateId: '9.4b',
    label: 'retention gains a default (optional field)',
    file: 'packages/ui/src/signals.ts',
    find: '  readonly retention: Retention;',
    replace: '  readonly retention?: Retention;',
    expect: NOTICED,
  },
  {
    gateId: '9.10b',
    label: 'the loaded branch makes freshness optional',
    file: 'packages/ui/src/sdk/transport.ts',
    // Only the first occurrence: `Loaded` and `Failed` carry the same line, and weakening the rule under test
    // means weakening exactly one branch of it.
    find: '  readonly freshness: Freshness;',
    replace: '  readonly freshness?: Freshness;',
    expect: NOTICED,
  },
  {
    gateId: '9.10c',
    label: 'the events placeholder becomes constructible (never removed)',
    file: 'packages/ui/src/sdk/transport.ts',
    find: '  call: never;',
    replace: '  call(): Promise<unknown>;',
    expect: NOTICED,
  },
  {
    gateId: '9.1b',
    label: 'reads stops being typed from the generated table',
    file: 'packages/ui/src/contract.ts',
    find: '  readonly reads?: readonly OperationId[];',
    replace: '  readonly reads?: readonly string[];',
    expect: NOTICED,
  },
  {
    gateId: 'D63',
    label: 'a token module edit that the committed CSS no longer matches',
    file: 'packages/ui/src/tokens.ts',
    find: "  5: '1rem', 6: '1.5rem', 7: '2rem', 8: '3rem', 9: '4rem',",
    replace: "  5: '1rem', 6: '1.5rem', 7: '2rem', 8: '3rem', 9: '4.5rem',",
    expect: /does not reproduce from/,
  },
  {
    gateId: '9.3',
    label: 'the stack primitive stops declaring its container-type',
    file: 'packages/ui/src/layout/primitives.ts',
    // Matched on the stack's own line, so only one primitive is weakened and the CSS reproducibility check
    // (§D63) is not what trips here.
    find: "    containerType: 'inline-size',\n    mayContain: ['stack'],",
    replace: "    containerType: 'size',\n    mayContain: ['stack'],",
    expect: /without container-type|does not reproduce|COMPILED|was REFUSED|for the wrong reason|not \*at itself\*/,
  },
];

function runGate(id?: string): { code: number; output: string } {
  const args = id === undefined ? [] : ['--only', id];
  try {
    const out = execFileSync(process.execPath, ['--import', 'tsx', path.join(ROOT, GATE), ...args], {
      stdio: 'pipe', cwd: ROOT, encoding: 'utf8',
    });
    return { code: 0, output: out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('the clean tree passes ui:check, so every failure below is attributable to the mutation', () => {
  const { code, output } = runGate();
  assert.equal(code, 0, `ui:check is red on a clean tree; falsification results would be meaningless:\n${output.slice(-2000)}`);
});

const didNotBite: string[] = [];

for (const mutation of MUTATIONS) {
  test(`falsify §${mutation.gateId}: ${mutation.label}`, () => {
    const abs = path.join(ROOT, mutation.file);
    const original = fs.readFileSync(abs);
    try {
      fs.appendFileSync(abs, mutation.append);
      const { code, output } = runGate(mutation.gateId);
      if (code === 0) {
        didNotBite.push(`§${mutation.gateId} ${mutation.label}`);
        assert.fail(`DID NOT BITE: the gate reported success with the violation present.\n${output.slice(-800)}`);
      }
      assert.match(
        output,
        mutation.expect,
        `the gate failed, but not for the planted violation (expected ${mutation.expect}). Output tail:\n${output.slice(-900)}`,
      );
    } finally {
      fs.writeFileSync(abs, original);
      const restored = fs.readFileSync(abs);
      assert.ok(original.equals(restored), `RESTORATION FAILED for ${mutation.file} — planted code is still in the tree`);
    }
  });
}

for (const weakening of WEAKENINGS) {
  test(`falsify §${weakening.gateId} by weakening the rule: ${weakening.label}`, () => {
    const abs = path.join(ROOT, weakening.file);
    const original = fs.readFileSync(abs);
    const occurrences = original.toString().split(weakening.find).length - 1;
    assert.ok(occurrences >= 1, `${weakening.file} no longer contains the source line this mutation targets: the rule moved and the falsification is stale`);
    try {
      fs.writeFileSync(abs, original.toString().replace(weakening.find, weakening.replace));
      assert.notEqual(fs.readFileSync(abs, 'utf8'), original.toString(), 'the mutation changed nothing, so this case proves nothing');
      const { code, output } = runGate(weakening.gateId);
      if (code === 0) {
        didNotBite.push(`§${weakening.gateId} ${weakening.label} (weakening)`);
        assert.fail(`DID NOT BITE: the gate still reported success after the rule it enforces was relaxed.
${output.slice(-800)}`);
      }
      assert.match(output, weakening.expect, `the gate went red, but not for the relaxed rule. Tail:
${output.slice(-900)}`);
    } finally {
      fs.writeFileSync(abs, original);
      assert.ok(original.equals(fs.readFileSync(abs)), `RESTORATION FAILED for ${weakening.file}`);
    }
  });
}

test('the web/ allowlist is real in both directions: it bites outside and permits inside', () => {
  // §9.2 confines the browser surface to `src/web/` and the transport driver. An allowlist is only worth having
  // if it is *narrow* and *live*: a check that refuses everywhere passes the "bites outside" half by accident,
  // and a check that permits everything passes the "inside" half by accident. Both halves, one test.
  const outside = path.join(ROOT, 'packages/ui/src/contract.ts');
  const inside = path.join(ROOT, 'packages/ui/src/web/index.ts');
  const probe = '\nexport const __falsify_storage__ = (): string | null => localStorage.getItem("draft");\n';
  const beforeOutside = fs.readFileSync(outside);
  const beforeInside = fs.readFileSync(inside);
  try {
    fs.appendFileSync(outside, probe);
    assert.equal(runGate('9.2').code, 1, 'localStorage in a presentational file was permitted — the boundary is not narrow');
    fs.writeFileSync(outside, beforeOutside);

    fs.appendFileSync(inside, probe);
    const permitted = runGate('9.2');
    assert.equal(permitted.code, 0, `localStorage inside the declared boundary was refused, so the boundary permits nothing:\n${permitted.output.slice(-600)}`);
  } finally {
    fs.writeFileSync(outside, beforeOutside);
    fs.writeFileSync(inside, beforeInside);
    assert.ok(beforeOutside.equals(fs.readFileSync(outside)), 'contract.ts not restored');
    assert.ok(beforeInside.equals(fs.readFileSync(inside)), 'web/index.ts not restored');
  }
});

test('the boundary path is stated once, in the package that owns it (D63)', () => {
  // `scripts/check-ui.ts` used to hardcode `packages/ui/src/web/` while `src/web/index.ts` exported
  // `packages/ui/src/web` — two spellings of the one fact that decides which files may touch a browser, and
  // they already disagreed about the trailing slash. The gate now imports it.
  const gate = fs.readFileSync(path.join(ROOT, 'scripts/check-ui.ts'), 'utf8');
  const owner = fs.readFileSync(path.join(ROOT, 'packages/ui/src/web/index.ts'), 'utf8');
  assert.match(gate, /import \{ WEB_BOUNDARY_DIR \} from '\.\.\/packages\/ui\/src\/web\/index\.ts'/);
  assert.match(owner, /export const WEB_BOUNDARY_DIR = 'packages\/ui\/src\/web';/);
  assert.ok(!/const WEB_BOUNDARY = 'packages\/ui\/src\/web\/?'/.test(gate), 'the gate hardcodes the boundary path again');
});

test('rule 5\'s state-word grep is real in both directions: it permits aria-live and refuses the pill', () => {
  // 11 §8 mandates `aria-live="polite"` on a region that updates from a signal, and the same gate refuses the word
  // when it claims liveness. Those two rules collide unless the grep knows the difference, and a grep that fires on
  // the mandated attribute is one that gets widened until it fires on nothing. Both halves, one test -- the same
  // shape as the `web/` allowlist check below it.
  const target = path.join(ROOT, 'packages/ui/src/components/copy.ts');
  const original = fs.readFileSync(target);
  try {
    fs.appendFileSync(target, '\nexport const __politeMarkup = \'<ul aria-live="polite" role="list">x</ul>\';\n');
    const permitted = runGate('R5');
    assert.equal(permitted.code, 0, `the mandated a11y attribute was refused:\n${permitted.output.slice(-700)}`);
  } finally {
    fs.writeFileSync(target, original);
    assert.ok(original.equals(fs.readFileSync(target)), 'copy.ts not restored');
  }
  try {
    fs.appendFileSync(target, '\nexport const __pill = (): string => "live";\n');
    const refused = runGate('R5');
    assert.equal(refused.code, 1, 'a copy-level liveness claim was permitted -- the narrowing swallowed the rule too');
    assert.match(refused.output, /a push-implying state word/);
  } finally {
    fs.writeFileSync(target, original);
    assert.ok(original.equals(fs.readFileSync(target)), 'copy.ts not restored after the refusal case');
  }
});

test('§9.11 is real in both directions: it permits a component with a floor home and refuses one without', () => {
  // The parity gate has one job: a capability that exists only when wide must fail the build. A check that refuses
  // everything would satisfy the mutation above and be switched off within a week, so the permit side is asserted
  // against the same declaration the refusal reads.
  const clean = runGate('9.11');
  assert.equal(clean.code, 0, `the honest screen was refused:\n${clean.output.slice(-700)}`);
  assert.match(clean.output, /reachable at both widths/);

  const target = path.join(ROOT, 'packages/ui/src/components/instances.tsx');
  const original = fs.readFileSync(target);
  try {
    // Give the list a slots list that cannot be a sheet, and its `reads` become reachable only when wide.
    // The detail pane is the component the screen places in the split's detail track, and `popout-sidebar`
    // projects its content to `overlay-sheet` at the floor. Take that slot away and its two operations become
    // reachable only when the container is wide -- the defect §9.11 exists for.
    //
    // The first version of this case removed `overlay-sheet` from `instance.list` instead and did not bite, which
    // was the test's error rather than the gate's: the list is placed in a `stack`, whose floor home it still
    // declared, so there was no violation to find. A mutation that cannot fail is not a falsification.
    fs.writeFileSync(target, original.toString().replace(
      "  slots: ['overlay-sheet', 'popout-sidebar', 'stack', 'full-page'],",
      "  slots: ['popout-sidebar', 'stack', 'full-page'],",
    ));
    assert.notEqual(fs.readFileSync(target, 'utf8'), original.toString(), 'the mutation changed nothing, so this case proves nothing');
    const { code, output } = runGate('9.11');
    assert.equal(code, 1, 'a wide-only capability was accepted -- §9.11 is decoration');
    assert.match(output, /no floor home|reachable only when wide/);
  } finally {
    fs.writeFileSync(target, original);
    assert.ok(original.equals(fs.readFileSync(target)), 'instances.tsx not restored');
  }
});

test('the primitive table cannot lose its floor home without §9.11 saying which primitive', () => {
  const target = path.join(ROOT, 'packages/ui/src/layout/primitives.ts');
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, original.toString().replace("    floorSlots: ['overlay-sheet'],\n    containerType: 'inline-size',\n    mayContain: ['stack'],", "    floorSlots: [],\n    containerType: 'inline-size',\n    mayContain: ['stack'],"));
    assert.notEqual(fs.readFileSync(target, 'utf8'), original.toString(), 'the mutation changed nothing');
    const { code, output } = runGate('9.11');
    assert.equal(code, 1, 'a primitive with no floor home at all was accepted');
    assert.match(output, /no floor home for their content/);
  } finally {
    fs.writeFileSync(target, original);
    assert.ok(original.equals(fs.readFileSync(target)), 'primitives.ts not restored');
  }
});

test('nothing was left behind: every mutated file is byte-identical to how it was found', () => {
  // A second, independent check. The per-test assertions above compare `original` against the bytes read back in
  // the same test; this one re-runs the clean gate, which is the only check that catches a mutation that
  // restored a file's bytes but left the *tree* inconsistent.
  const { code, output } = runGate();
  assert.equal(code, 0, `ui:check is red after the mutation suite, so something was not restored:\n${output.slice(-2000)}`);
});

test('no mutation in this file silently failed to bite', () => {
  assert.deepEqual(didNotBite, [], `these gates accepted a tree that violates them: ${didNotBite.join('; ')}`);
});
