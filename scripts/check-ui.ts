#!/usr/bin/env node
/**
 * `pnpm run ui:check` — the gates in 11 §9 that `packages/ui` can bite on today.
 *
 * Normative rules: [docs/ui-architecture.md](../docs/ui-architecture.md). Contracts and rationale:
 * [11](../docs/design/11-ui-components-and-page-model.md). This file implements §9.2, §9.3, §9.4, §9.5, §9.6
 * and the part of §9.11 that is expressible without screens.
 *
 * ## The reporting contract, which is the point of the file
 *
 * Every gate prints one of three words, and the third is not a pass:
 *
 *   PASS      the check ran and found nothing
 *   FAILED    the check ran and found a violation; the process exits 1
 *   NOT RUN   the check has no subject yet. Reported in the output, named, with the reason.
 *
 * A gate that cannot bite says so instead of going quiet. This repository has been burned repeatedly by
 * vacuous green — the parity gate that *filed* #247 instead of preventing it, the destroyed-service overlay
 * carrying "a real digest of the deleted service's image, which every check passed", the flipped-signature test
 * that "had been passing without testing anything" because the last base64url character often decodes to the
 * same bytes. `pnpm run verify` therefore exits 0 while printing NOT RUN lines, because the checks that
 * genuinely cannot run yet must not block a foundation commit — but the output says which ones, and the report
 * says why. §9.7/§9.8/§9.9 (Playwright, axe, drafts) are outside this script entirely: they need a browser,
 * and 11 §8 defers that harness rather than letting this package invent one.
 *
 * ## §9.6 is a security boundary, not a style rule (D13, D14)
 *
 * "Pluggable" means swappable at build time behind a versioned registry, never loadable at runtime. An
 * in-process extension shares the heap of the user's session; 11 names the result "cross-tenant XSS with a
 * nicer name", and 10 § The collision gives the arithmetic: a runtime-hot-loading design would make platfolio's
 * own compromise equivalent to compromising every tenant it can dispatch to. That is why the dynamic-import
 * check has no allowlist, and why a remote specifier in the registry table is refused by type as well as by
 * grep.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LAYOUT_PRIMITIVE_SLOTS, LAYOUT_SLOTS, PRIMITIVES } from '../packages/ui/src/layout/primitives.ts';
import { REPLAY_SIGNAL_IDS, SIGNAL_IDS } from '../packages/ui/src/signals.ts';
import { componentById, documentProblems, registeredComponentIds } from '../packages/ui/src/registry.ts';
import { WEB_BOUNDARY_DIR } from '../packages/ui/src/web/index.ts';
import { capabilityParityProblems, reachableOperations, screenPlacements } from '../packages/ui/src/screens/screen.ts';
import { SCREENS } from '../packages/ui/src/screens/index.ts';
import type { ScreenDocument } from '../packages/ui/src/screens/screen.ts';
import { ACCEPTED_BUT_WRONG, BAD_PROPS, SAMPLE_PROPS, STORED_DOCUMENT } from '../packages/ui/test/fixtures/page-documents.ts';
import { lineOf, stripComments, stripCssComments } from './ui-source-scan.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/**
 * The screen list and the primitive floor homes, read through their *declared* types rather than the literal
 * tuples the compiler infers from `as const`.
 *
 * Both reads have a branch that is currently empty -- "no screens declared", "a primitive with no floor home" --
 * and those branches are the whole point of the gates they belong to. Without the widening, `SCREENS.length ===
 * 0` on a one-element `as const` tuple is TS2375-flagged dead code (measured: "this comparison appears to be
 * unintentional because the types '1' and '0' have no overlap"), and the next `as const` addition would be
 * checked by a branch the compiler says can never run. Widening is how a gate keeps its own vacuity check alive.
 */
const declaredScreens: readonly ScreenDocument[] = SCREENS;
const primitiveFloorHomes = LAYOUT_PRIMITIVE_SLOTS.map((slot) => [slot, PRIMITIVES[slot].floorSlots as readonly string[]] as const);
const SRC = path.join(ROOT, 'packages/ui/src');

/**
 * `--only <id>` runs one gate and exits on its result alone. It exists for `test/gates-falsify.test.ts`, and
 * for a reason worth stating: without it, a planted violation makes every downstream gate red, and a
 * falsification test can only assert "something failed" — which an unrelated pre-existing failure would
 * satisfy just as well. Targeted runs make each assertion mean the thing it names.
 *
 * It is **not** a way to skip gates in CI: plain `ui:check` runs the whole set, and `verify` calls it that way.
 *
 * Parsed up here rather than at the output stage because the expensive checks — six `tsc` subprocesses and a
 * nested `ui:css:check` — consult it before running. The first version filtered only the *report*, so every
 * single-gate run still paid for all of them and the falsification suite took minutes. That is the same shape
 * as `FakeInfraProvider({ without })` filtering `describe()` but leaving the method working: the switch moved
 * the answer, not the behaviour.
 */
const onlyIndex = process.argv.indexOf('--only');
if (onlyIndex >= 0 && !process.argv[onlyIndex + 1]) {
  console.error('error: --only needs a gate id');
  process.exit(2);
}
const ONLY: string | null = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] as string) : null;
const unknownFlag = process.argv.find((a) => a.startsWith('--') && a !== '--only');
if (unknownFlag) {
  console.error(`error: unknown flag ${unknownFlag}. Usage: check-ui.ts [--only <gateId>]`);
  process.exit(2);
}
/** Cheap gates always run, so a `--only` report still says something true about the whole package. */
const isSelected = (id: string): boolean => ONLY === null || ONLY === id;

/* ------------------------------------------------------------------ the report */

type Status = 'PASS' | 'FAILED' | 'NOT RUN';

interface Gate {
  readonly id: string;
  readonly title: string;
  status: Status;
  readonly notes: string[];
  readonly failures: string[];
}

const gates: Gate[] = [];

function gate(id: string, title: string): Gate {
  const g: Gate = { id, title, status: 'NOT RUN', notes: [], failures: [] };
  gates.push(g);
  return g;
}

function pass(g: Gate, ...notes: string[]): void {
  // A pass with nothing said about it is how a check that scans zero files looks identical to a check that
  // scanned fifty. Demand the evidence.
  if (notes.length === 0) throw new Error(`gate §${g.id} reported PASS with no evidence`);
  // **Never downgrade a FAILED gate.** The first version of `check-ui.ts` reported §9.6 PASS with
  // `export function registerComponent` sitting in the registry, because the mutator check ran first and set
  // FAILED, and a later `pass()` for the dynamic-import sweep overwrote it. A gate whose second half can
  // cancel its first half is not a gate, and no amount of green output would have shown that. Falsification
  // found it (`test/gates-falsify.test.ts`); a review of the clean tree could not.
  if (g.status !== 'FAILED') g.status = 'PASS';
  g.notes.push(...notes);
}

function fail(g: Gate, ...reasons: string[]): void {
  g.status = 'FAILED';
  g.failures.push(...reasons);
}

function notRun(g: Gate, reason: string): void {
  // Only ever widens toward honesty: a FAILED gate is never downgraded to NOT RUN.
  if (g.status !== 'FAILED') g.status = 'NOT RUN';
  g.notes.push(`not run: ${reason}`);
}

/* ------------------------------------------------------------------ source walk */

interface SourceFile {
  readonly rel: string;
  readonly text: string;
  readonly lines: readonly string[];
}

/**
 * A file the grep gates read: TypeScript or TSX.
 *
 * `.tsx` joined the walk on 2026-11-15 with #259 -- and the *predicate* had to join it too. The first attempt
 * widened `listSources` and left `§9.2`'s own filter reading `rel.endsWith('.ts')`, so a `fetch` planted in a
 * screen was still invisible to the gate whose job is to find it, and the mutation for exactly that said PASS.
 * A widened walk behind a narrowed filter is the same hole wearing a fix, which is why the extension list is one
 * function now and `test/gates-falsify.test.ts` plants in both extensions.
 */
const isSourceFile = (rel: string): boolean => rel.endsWith('.ts') || rel.endsWith('.tsx');

function listSources(dir: string, predicate: (rel: string) => boolean): SourceFile[] {
  if (!fs.existsSync(dir)) return [];
  const out: SourceFile[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      // `.tsx` joined `.ts` here on 2026-11-15, with #259. It is not a cosmetic widening: every grep in this file
      // reads through `listSources`, so a `.ts`-only walk would have scanned 13 files, reported PASS on all of
      // them, and never looked at a single screen -- the vacuous green this package exists to refuse, arriving by
      // way of a file-extension list. The falsification suite plants a violation in a `.tsx` and requires it be
      // found, because "the gate is red on my machine" is not what an unchecked extension costs.
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (!predicate(rel)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      out.push({ rel, text, lines: text.split('\n') });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * `stripComments` rather than a raw grep, for one reason: prose in this repository *names* the things it
 * forbids, and a gate that fired on the word `fetch` inside the comment explaining why `fetch` is forbidden
 * would be switched off within a week. Comment text is not code.
 *
 * The cost is stated so it is not mistaken for completeness: **a violation hidden inside a comment is not
 * found.** That is acceptable because a violation in a comment is inert — it cannot run. What is *not*
 * acceptable, and what the falsification tests in `test/gates-falsify.test.ts` check, is a violation that
 * reaches the code path and is missed.
 */
/* ------------------------------------------------------------------ declared boundaries */

/**
 * The two places browser and transport capabilities are permitted. Read from here, so widening either is a
 * diff a reviewer sees; `test/gates.test.ts` asserts these paths exist and that the transport driver is the
 * only file with a timer.
 */
/**
 * Read from `src/web/index.ts`, not written here. The gate and the package must agree on which directory is the
 * browser boundary or the allowlist is a second description of the thing it polices — and a second description
 * that can drift by a trailing slash, which is exactly how this one started.
 */
const WEB_BOUNDARY = `${WEB_BOUNDARY_DIR}/`;
const TRANSPORT_DRIVER = 'packages/ui/src/sdk/poll.ts';
const SIGNAL_REGISTRY_IMPL = 'packages/ui/src/signals.ts';
const FRESHNESS_PRIMITIVES = new Set(['packages/ui/src/sdk/poll.ts', 'packages/ui/src/sdk/use-operation.ts']);

/**
 * The files the DOM-enabled project checks *outside* this package, read out of `packages/ui/tsconfig.json`
 * rather than written here. Same reasoning as `WEB_BOUNDARY_DIR` above and for the same reason: the config is
 * the thing that decides which files get `DOM`, and a second list beside it is a second description of that
 * decision -- one that would silently stop covering the file someone added to the include list.
 */
const UI_GATE_SCRIPTS: readonly string[] = (() => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/ui/tsconfig.json'), 'utf8')) as { include?: string[] };
  return (config.include ?? [])
    .filter((entry) => entry.startsWith('../../scripts/'))
    .map((entry) => entry.replace('../../', ''));
})();

const FORBIDDEN_OUTSIDE_WEB: readonly (readonly [RegExp, string])[] = [
  [/\bdocument\s*\./g, 'document.'],
  [/\bwindow\s*\./g, 'window.'],
  [/\blocalStorage\b/g, 'localStorage'],
  [/\bsessionStorage\b/g, 'sessionStorage'],
  [/\bnavigator\s*\./g, 'navigator.'],
  [/\bindexedDB\b/g, 'indexedDB'],
];

/** §9.2's data half. `fetch`/`XMLHttpRequest` belong to the transport driver and nowhere else. */
const FORBIDDEN_OUTSIDE_TRANSPORT: readonly (readonly [RegExp, string])[] = [
  [/\bfetch\s*\(/g, 'fetch('],
  [/\bXMLHttpRequest\b/g, 'XMLHttpRequest'],
  [/\bAbortController\b/g, 'AbortController'],
];

/** §9.2's timer half: "zero timer-based polling outside the freshness primitive". */
const FORBIDDEN_TIMERS: readonly (readonly [RegExp, string])[] = [
  [/\bsetInterval\s*\(/g, 'setInterval('],
  [/\bsetTimeout\s*\(/g, 'setTimeout('],
];

/** §9.4: "zero raw EventTarget/dispatchEvent/string-event subscriptions outside signals.ts". */
const FORBIDDEN_EVENTS: readonly (readonly [RegExp, string])[] = [
  [/\bnew EventTarget\b/g, 'new EventTarget'],
  [/\bdispatchEvent\s*\(/g, 'dispatchEvent('],
  [/\baddEventListener\s*\(/g, 'addEventListener('],
  [/\bCustomEvent\b/g, 'CustomEvent'],
  [/\bon\s*\(\s*['"`]/g, "on('string')"],
];

/* ------------------------------------------------------------------ TS0: the #259 price, paid back */

/**
 * `packages/ui/tsconfig.json` checks the three files below with `DOM` available, because they import this
 * package's modules and dragging them into the DOM-free root program is what made `.tsx` un-checkable in the
 * first place (#259). The honest consequence: inside these three files a stray `window.` is no longer a
 * compile error. They are Node scripts -- a browser global here is a crash at gate time, not a UI feature --
 * so this gate is the grep that keeps paying on their behalf.
 *
 * Member-access shapes only, deliberately: this file *contains* the patterns it forbids (`/\bdocument\s*\./g`),
 * and a scanner that fired on its own regex source would be switched off within a week. `document.`, `window.`
 * and `localStorage.` do not appear as calls in the pattern definitions, and the string labels beside them are
 * blanked by `stripComments` like every other literal here.
 *
 * Limit, stated: this is a text rule over three named files. It does not cover a fourth file added to
 * `packages/ui/tsconfig.json`'s include list later -- scripts/check-project.ts's typecheck-coverage rule
 * reports that project's file list, so a new member is visible in its output, and the list below must be
 * widened with it.
 */
{
  const g = gate('TS0', 'the gate scripts that inherit DOM keep browser globals out (the #259 price)');
  const browserAccess = [
    [/\bdocument\s*\./g, 'document.'],
    [/\bwindow\s*\./g, 'window.'],
    [/\blocalStorage\s*\./g, 'localStorage.'],
    [/\bsessionStorage\s*\./g, 'sessionStorage.'],
    [/\bnavigator\s*\./g, 'navigator.'],
    [/\bindexedDB\s*\./g, 'indexedDB.'],
  ] as const;
  const hits: string[] = [];
  for (const rel of UI_GATE_SCRIPTS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      fail(g, `${rel} is named by packages/ui/tsconfig.json but is not on disk -- the gate's own subject moved`);
      continue;
    }
    const clean = stripComments(fs.readFileSync(abs, 'utf8'));
    for (const [pattern, name] of browserAccess) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(clean)) !== null) {
        hits.push(`${rel}:${String(lineOf(clean, m.index))}: browser global \`${name}\` in a Node script -- it type-checks now because the UI project carries \`DOM\`, so this gate is the only thing refusing it (rule 1: presentational code reaches no browser surface)`);
      }
    }
  }
  if (hits.length) fail(g, ...hits);
  else pass(g, `${String(UI_GATE_SCRIPTS.length)} scripts checked under the DOM-enabled project, none touches a browser global: ${UI_GATE_SCRIPTS.join(', ')}`);
}

/* ------------------------------------------------------------------ §9.2 rogue data and storage */

{
  const g = gate('9.2', 'no rogue data or storage');
  const sources = listSources(SRC, isSourceFile);
  if (sources.length === 0) {
    fail(g, 'no TypeScript sources under packages/ui/src — the gate has no subject, which is a packaging failure, not a pass');
  } else {
    const hits: string[] = [];
    const scan = (
      file: SourceFile,
      patterns: readonly (readonly [RegExp, string])[],
      allowedPrefix: string,
      label: string,
    ): void => {
      if (file.rel.startsWith(allowedPrefix)) return;
      const clean = stripComments(file.text);
      for (const [pattern, name] of patterns) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(clean)) !== null) {
          hits.push(`${file.rel}:${String(lineOf(clean, m.index))}: ${label} \`${name}\``);
        }
      }
    };
    for (const file of sources) {
      scan(file, FORBIDDEN_OUTSIDE_WEB, WEB_BOUNDARY, 'browser surface');
      scan(file, FORBIDDEN_OUTSIDE_TRANSPORT, TRANSPORT_DRIVER, 'transport surface');
      if (!FRESHNESS_PRIMITIVES.has(file.rel)) {
        const clean = stripComments(file.text);
        for (const [pattern, name] of FORBIDDEN_TIMERS) {
          pattern.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = pattern.exec(clean)) !== null) {
            hits.push(`${file.rel}:${String(lineOf(clean, m.index))}: timer call \`${name}\` outside the freshness primitive (11 §4 acceptance (b))`);
          }
        }
      }
    }
    // The boundary itself is checked, not trusted: `web/` may reach the browser, and that is exactly why it
    // must not be reachable from a presentational file.
    const webFiles = sources.filter((f) => f.rel.startsWith(WEB_BOUNDARY));
    if (webFiles.length === 0) {
      g.notes.push('web/ boundary holds no files yet (the draft store of 11 §5 is not built), so nothing reaches the browser from here today');
    }
    if (hits.length) fail(g, ...hits);
    else pass(g, `${String(sources.length)} source files scanned; browser surface confined to ${WEB_BOUNDARY}, transport to ${TRANSPORT_DRIVER}, timers to the freshness primitive`);
  }
}

/* ------------------------------------------------------------------ §9.3 layout discipline */

{
  const g = gate('9.3', 'layout discipline');
  // Every generated sheet this package ships. The third one arrived with the components: 11 §8's hit-target
  // floor lives in `components/components.css`, and a layout gate that scanned only the two sheets that existed
  // when it was written would have waved a width `@media` through the one the screens actually depend on.
  const sheets = ['packages/ui/src/tokens.css', 'packages/ui/src/layout/layout.css', 'packages/ui/src/components/components.css']
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));
  if (sheets.length < 3) {
    fail(g, `only ${String(sheets.length)} of the 3 generated stylesheets are on disk -- run \`pnpm run ui:css\`; a sheet this gate cannot see is a sheet it does not audit`);
  } else {
    const hits: string[] = [];
    for (const sheet of sheets) {
      // Strip the stylesheet's own comments first. `layout.css` says, in its header, that it contains no width
      // @media — and the first version of this gate reported that sentence as the violation. A finding that
      // fires on the prose denying it is the false positive that gets a gate widened, then switched off.
      const body = stripCssComments(sheet.text);
      const lines = body.split('\n');
      lines.forEach((line, i) => {
        // A `@media` naming a width is the violation. A `@media (prefers-*)` is the one window input 11 §2
        // acceptance (a) permits, so it must not be swept up by a rule looking for the other kind.
        const media = /@media[^{]*\b(width|min-width|max-width|device-width|device-aspect-ratio)\b/i.exec(line);
        if (media) hits.push(`${sheet.rel}:${String(i + 1)}: width @media \`${line.trim()}\` — responsive comes from the container, not the window (rule 2)`);
      });
      if (!/@container\s*\(/.test(body) && sheet.rel.endsWith('layout.css')) {
        hits.push(`${sheet.rel}: contains no @container query, so the primitives declare a container nobody queries`);
      }
    }
    // Fork props, in source and in types: a prop named for a device is the matrix forked into two renders.
    const FORK_PROP = /\b(?:isMobile|isDesktop|isTablet|isPhone|compact|dense|desktopOnly|mobileOnly|useMediaQuery|matchMedia)\b/g;
    for (const file of listSources(SRC, () => true)) {
      const clean = stripComments(file.text);
      FORK_PROP.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FORK_PROP.exec(clean)) !== null) {
        hits.push(`${file.rel}:${String(lineOf(clean, m.index))}: fork prop or window query \`${m[0]}\` — width behaviour comes from container queries only (gate §9.3)`);
      }
    }
    // Every primitive declares its container. Checked against the data the CSS is generated from, so the gate
    // cannot be satisfied by a stylesheet someone hand-edited.
    const missing = LAYOUT_PRIMITIVE_SLOTS.filter((slot) => PRIMITIVES[slot].containerType !== 'inline-size');
    if (missing.length) hits.push(`primitives without container-type: inline-size: ${missing.join(', ')}`);
    const uncovered = LAYOUT_SLOTS.filter((slot) => !PRIMITIVES[slot]);
    if (uncovered.length) hits.push(`slots with no primitive: ${uncovered.join(', ')}`);
    if (hits.length) fail(g, ...hits);
    else pass(
      g,
      `${String(sheets.length)} stylesheets: @container only, no width @media`,
      `all ${String(LAYOUT_PRIMITIVE_SLOTS.length)} primitives declare container-type: inline-size`,
    );
  }
}

/* ------------------------------------------------------------------ §9.4 typed signals only */

{
  const g = gate('9.4', 'typed signals only');
  const hits: string[] = [];
  for (const file of listSources(SRC, () => true)) {
    if (file.rel === SIGNAL_REGISTRY_IMPL) continue;
    const clean = stripComments(file.text);
    for (const [pattern, name] of FORBIDDEN_EVENTS) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(clean)) !== null) {
        hits.push(`${file.rel}:${String(lineOf(clean, m.index))}: raw event mechanism \`${name}\` outside ${SIGNAL_REGISTRY_IMPL} (rule 3: no stringly-typed bus, ever)`);
      }
    }
  }
  // "Every signal in the table has an explicit retention" — read off the frozen declarations, which is the
  // only place retention actually exists at runtime.
  const signalSources = listSources(SRC, (rel) => rel === SIGNAL_REGISTRY_IMPL);
  const registryImpl = signalSources[0];
  if (!registryImpl) {
    fail(g, `${SIGNAL_REGISTRY_IMPL} is missing, so no signal has a declaration to check`);
  } else {
    const text = registryImpl.text;
    const declared = [...text.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1] as string);
    const retentions = [...text.matchAll(/name:\s*'([^']+)'[\s\S]{0,600}?retention:\s*'(replay|transient)'/g)]
      .map((m) => m[1] as string);
    const unretained = declared.filter((n) => !retentions.includes(n));
    if (unretained.length) hits.push(`signals declared without a retention: ${unretained.join(', ')}`);
    if (declared.length !== SIGNAL_IDS.length) {
      hits.push(`the table declares ${String(declared.length)} signal name(s) but the registry holds ${String(SIGNAL_IDS.length)} — one of these lists is stale`);
    }
  }
  if (hits.length) fail(g, ...hits);
  else pass(
    g,
    `${String(SIGNAL_IDS.length)} signals registered, each with an explicit retention`,
    `replay set: ${REPLAY_SIGNAL_IDS.join(', ') || '(none)'}`,
    'no raw event mechanism outside signals.ts',
  );
}

/* ------------------------------------------------------------------ §9.5 + §9.6 registration, no runtime code */

{
  const g95 = gate('9.5', 'registration resolves');
  const g96 = gate('9.6', 'no runtime-loaded code');

  const all = listSources(SRC, () => true);

  // §9.6 first: this is the security line, and it has no allowlist.
  const RUNTIME_LOAD = [
    [/\bimport\s*\(/g, 'dynamic import()'],
    [/\bnew\s+Function\s*\(/g, 'new Function'],
    [/\beval\s*\(/g, 'eval'],
    [/\bimport\s*\w*\s*from\s*['"`](?:https?:|\/\/)/g, 'remote module specifier'],
    [/\bURL\s*\(\s*['"`]https?:/g, 'URL literal used as a loader'],
    [/\bWebAssembly\b/g, 'WebAssembly'],
    [/\bdocument\s*\.\s*createElement\s*\(\s*['"]script/g, 'script tag injection'],
  ] as const;
  const loads: string[] = [];
  for (const file of all) {
    const clean = stripComments(file.text);
    for (const [pattern, name] of RUNTIME_LOAD) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(clean)) !== null) {
        loads.push(`${file.rel}:${String(lineOf(clean, m.index))}: ${name} — runtime-loaded code is refused by D13/D14, not discouraged (10 § The collision)`);
      }
    }
  }
  // The registry must not be reachable by mutation from outside.
  const registryFile = all.find((f) => f.rel === 'packages/ui/src/registry.ts');
  if (!registryFile) {
    fail(g96, 'packages/ui/src/registry.ts is missing');
  } else {
    // Anchored on the camelCase head, so `registeredComponentIds` (a read) is not mistaken for
    // `registerComponent` (a write). A prefix match flagged exactly that function on the first run, which is
    // the kind of false positive that teaches everyone to ignore §9.6.
    const MUTATOR_HEAD = /^(?:register|add|insert|set|load|extend|delete|remove|clear|mutate|update|push|apply)(?![a-z])[A-Za-z]*$/;
    const exportedNames = [...stripComments(registryFile.text).matchAll(/export\s+(?:const|function|let|async function)\s+([A-Za-z_$][\w$]*)/g)]
      .map((m) => m[1] as string);
    const exportedMutators = exportedNames.filter((name) => MUTATOR_HEAD.test(name));
    g96.notes.push(`registry exports: ${exportedNames.join(', ')}`);
    if (exportedMutators.length) {
      fail(g96, `registry exports mutator(s): ${exportedMutators.join(', ')} — a registry that can be populated at runtime is the Tier 2 boundary removed (gate §9.6)`);
    }
  }
  if (loads.length) fail(g96, ...loads);
  else pass(g96, `${String(all.length)} source files: no dynamic import, no remote specifier, no compiled-at-runtime code, no registry mutator`);

  // §9.5: every id a page document may name resolves in the build-time registry, with a props schema.
  if (!registryFile) {
    fail(g95, 'no registry to check');
  } else {
    const ids = registeredComponentIds();
    if (ids.length === 0) {
      notRun(
        g95,
        'the component registry is empty by design — this commit is the contract package, not a screen (11 § Consequences for the plan). '
        + 'What IS checked here is the boundary: an unknown id throws rather than rendering an empty div. '
        + 'The 11 §9.5 fixture that re-renders yesterday\'s stored page document needs real components to be meaningful, and lands with the first screen.',
      );
      // Still assert the refusal, because "throws on unknown" is checkable with zero registered components.
      try {
        componentById('a-component-that-does-not-exist');
        fail(g95, 'componentById() returned for an id that is not registered — §9.5 refuses an empty div');
      } catch (error) {
        if ((error as Error).name !== 'UnknownComponentError') {
          fail(g95, `componentById() threw ${(error as Error).name} instead of UnknownComponentError`);
        }
      }
      const doc = documentProblems({ component: 'a-component-that-does-not-exist', props: {} });
      if (doc.length === 0) fail(g95, 'documentProblems() reported nothing about an unknown component id');
    } else {
      const unvalidatable = ids.filter((id) => {
        const c = componentById(id);
        return !c.props || typeof c.props !== 'object' || !('~standard' in c.props);
      });
      if (unvalidatable.length) fail(g95, `registered without a props schema: ${unvalidatable.join(', ')}`);

      // 11 §9.5's actual fixture: re-render *yesterday's* stored page document. The registry is no longer empty,
      // so this is no longer a boundary-only check -- but note what it is and is not. The document below is a
      // literal in `test/fixtures/page-documents.ts`, typed against the generated contract, and the honest
      // description of it is "a document written to today's ids", not "a document captured in a previous
      // release". A real stored document from a real previous release is what 11 §9.5 ultimately wants, and that
      // needs a release to have happened; until then the refusal paths (unknown id, invalid props) are what carry
      // the gate, and they are exercised against every registered component rather than against one fixture.
      const stored = documentProblems(STORED_DOCUMENT);
      if (stored.length) fail(g95, `the stored page document no longer validates: ${stored.join('; ')}`);
      const unknown = documentProblems({ component: 'instances.table', props: {} });
      if (unknown.length === 0) fail(g95, 'documentProblems() reported nothing about an unknown component id');

      // Every registered id must have props the registry accepts, and must refuse props it does not.
      const missingSample = ids.filter((id) => !Object.hasOwn(SAMPLE_PROPS, id));
      if (missingSample.length) {
        fail(g95, `registered with no fixture props: ${missingSample.join(', ')} — §9.5 acceptance (b) renders every registered component from a props object validated by its own schema`);
      }
      const sampleProblems = Object.entries(SAMPLE_PROPS)
        .flatMap(([id, props]) => documentProblems({ component: id, props }).map((p) => `${id}: ${p}`));
      if (sampleProblems.length) fail(g95, ...sampleProblems);

      const refused = BAD_PROPS.map((bad) => ({ ...bad, problems: documentProblems(bad.page) }))
        .filter((bad) => bad.problems.length === 0)
        .map((bad) => `${bad.label} (${bad.page.component}) was ACCEPTED -- §9.5 promises validation, not decoration`);
      if (refused.length) fail(g95, ...refused);

      // The gap, asserted rather than described. Each entry here is *wrong in a way this package cannot refuse
      // today* and is accepted; if a future change makes the validator strict, these stop being accepted and this
      // gate goes red until the entry is deleted, which is how a closed gap should announce itself.
      const stillAccepted = ACCEPTED_BUT_WRONG
        .map((bad) => ({ label: bad.label, problems: documentProblems(bad.page) }))
        .filter((bad) => bad.problems.length > 0)
        .map((bad) => `${bad.label}: was expected to be ACCEPTED (the kind-only-enumeration gap that components/props.ts names), but validation refused it -- if the props schemas are now strict about enumeration membership, delete this entry from test/fixtures/page-documents.ts and say so in 11 §9.5`);
      if (stillAccepted.length) fail(g95, ...stillAccepted);

      if (unvalidatable.length === 0 && missingSample.length === 0 && sampleProblems.length === 0 && refused.length === 0 && stored.length === 0) {
        pass(
          g95,
          `${String(ids.length)} component id(s) resolve, each with a StandardSchema props definition: ${ids.join(', ')}`,
          `stored document re-validates (${STORED_DOCUMENT.component}); an unknown id still throws UnknownComponentError; ${String(BAD_PROPS.length)} invalid prop sets are refused at validation`,
          `and ${String(ACCEPTED_BUT_WRONG.length)} prop sets are named-accepted that are still wrong: enumeration membership is checked by the compiler and by the server, not by props validation (components/props.ts states why) -- named rather than passed over`,
          'not run here: a document captured from a previous *release*. There has been no release of this registry, so the fixture is written to today\'s ids -- which is what makes the refusal paths, not the fixture, the load-bearing half.',
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ §9.11 capability parity */

{
  const g = gate('9.11', 'capability parity across widths');
  const ids = registeredComponentIds();
  if (ids.length === 0) {
    notRun(
      g,
      'the gate compares, per screen, the set of OperationIds reachable from its components at a 360 px container against the set at 1920 px. '
        + 'There are no registered components and no screens in this package, so there is no pair of sets to compare. '
        + 'A parity check over an empty registry is the vacuous green this repository keeps naming, so it reports itself instead.',
    );
  } else if (declaredScreens.length === 0) {
    notRun(
      g,
      `the registry has ${String(ids.length)} component(s) but packages/ui/src/screens/index.ts declares no screens, so there is no per-screen pair of operation sets to compare. `
        + 'The structural half below still runs, and it is the weaker claim: do not read this as parity proven.',
    );
    const contractText = fs.readFileSync(path.join(SRC, 'contract.ts'), 'utf8');
    if (/reads\w*(?:Wide|Narrow|Desktop|Mobile|BySlot)/i.test(contractText) || /Record<LayoutSlot,[^>]*OperationId/.test(contractText)) {
      fail(g, 'contract.ts declares a slot-dependent `reads` shape — a capability that exists only at one width is rule 2\'s definition of a fail');
    } else {
      pass(g, `no per-slot read set is expressible in the contract type, and no screen exists to compare: ${String(ids.length)} component(s) registered, SCREENS is empty`);
    }
  } else {
    // The structural refusal stays, and it is the cheap one: if the contract ever grows a width-dependent read
    // set, every comparison below becomes a comparison of two different questions.
    const contractText = fs.readFileSync(path.join(SRC, 'contract.ts'), 'utf8');
    const perSlotReads = /reads\w*(?:Wide|Narrow|Desktop|Mobile|BySlot)/i.test(contractText)
      || /Record<LayoutSlot,[^>]*OperationId/.test(contractText);

    const problems: string[] = [];
    if (perSlotReads) {
      problems.push('contract.ts declares a slot-dependent `reads` shape — a capability that exists only at one width is rule 2\'s definition of a fail');
    }

    const reported: string[] = [];
    for (const screen of declaredScreens) {
      // One implementation of the question, in the package that owns the answer: `capabilityParityProblems` walks
      // the placements and compares the two operation sets through `floorSlots`, the same field the CSS generator
      // reads. A second copy of that logic here would be a gate that can disagree with the layout it audits.
      problems.push(...capabilityParityProblems(screen));
      const floor = reachableOperations(screen, 'floor');
      const wide = reachableOperations(screen, 'wide');
      if (floor.length !== wide.length || floor.some((operation) => !wide.includes(operation))) {
        problems.push(`${screen.id}: floor set [${floor.join(', ')}] does not equal the wide set [${wide.join(', ')}]`);
      }
      // Non-vacuity, in the direction the whole gate depends on: a parity comparison over a screen with no
      // operations would pass forever. Both sets must be non-empty, and the placements must be more than one.
      if (wide.length === 0) problems.push(`${screen.id}: no operations reachable at any width, so the parity comparison below is vacuous`);
      if (floor.length === 0) problems.push(`${screen.id}: nothing reachable at the floor width — the screen is unreachable on a phone, which is the opposite of rule 2`);
      reported.push(`${screen.id}: ${String(screenPlacements(screen).length)} placement(s), ${String(wide.length)} operation(s) reachable at both widths [${wide.join(', ')}]`);
    }

    // And the primitive table has to actually carry the degradation this gate reasons from, or `floorSlots` is
    // documentation rather than data and every comparison above is arithmetic over an unowned guess.
    const withoutFloor = primitiveFloorHomes.filter(([, homes]) => homes.length === 0).map(([slot]) => slot);
    if (withoutFloor.length) problems.push(`primitives with no floor home for their content: ${withoutFloor.join(', ')}`);

    if (problems.length) fail(g, ...problems);
    else pass(
      g,
      `${String(declaredScreens.length)} screen(s) walked: ${reported.join('; ')}`,
      `degradation is data, not prose: all ${String(LAYOUT_PRIMITIVE_SLOTS.length)} primitives declare floorSlots, and the comparison reads them through the same \`capabilityParityProblems\` the screens use`,
      'still NOT RUN: what a browser paints at 360 px. This gate compares declared reachability. §9.7 is the same-slot matrix that would catch a component that claims a slot it cannot render in, and it needs a browser.',
    );
  }
}

/* ------------------------------------------------------------------ rule 5's witness: no push fiction */

{
  const g = gate('R5', 'freshness honesty (rule 5 / §9.10, the half that runs today)');
  const specPath = path.join(ROOT, 'apps/control-plane/openapi.yaml');
  if (!fs.existsSync(specPath)) {
    fail(g, 'apps/control-plane/openapi.yaml is missing — the gate cannot prove the push operations are absent');
  } else {
    const spec = fs.readFileSync(specPath, 'utf8');
    const push = /text\/event-stream|websocket|EventSource|\bevents\/stream\b/i.exec(spec);
    const generated = fs.readFileSync(path.join(ROOT, 'packages/api-contract/src/generated/types.ts'), 'utf8');
    const pushIds = ['listTeamEvents', 'createEventsTicket'].filter((id) => new RegExp(`\\b${id}\\b`).test(generated));

    const hits: string[] = [];
    if (push) {
      // The spec moved. Rule 5's constraint moves with it, and this file must say so rather than keep refusing.
      g.notes.push(`openapi.yaml now mentions a push channel (${JSON.stringify(push[0])}) — re-read 11 §4: the SDK may take an events driver, and the refusal below is now wrong`);
    }
    for (const file of listSources(SRC, () => true)) {
      // Two different readings of one file. `clean` erases literals, because a `fetch` inside a string is not a
      // call; `visible` keeps them, because the word this rule polices is *copy*, and copy only ever appears
      // inside a literal. Using `clean` for both is how a live pill sailed through.
      const clean = stripComments(file.text);
      const visible = stripComments(file.text, true);
      for (const [pattern, name, subject] of [
        [/\bEventSource\b/g, 'EventSource', clean],
        [/\bWebSocket\b/g, 'WebSocket', clean],
        // The negative lookbehind is a correction, not a concession, and both directions are falsified in
        // `test/gates-falsify.test.ts`. `aria-live` is the one spelling this package is *required* to write:
        // 11 §8 says a region updated from a signal lands in an `aria-live="polite"` region, never assertive.
        // Measured before the first list existed, the pattern searched here fired on that attribute name inside a
        // string -- so the first screen that obeyed 11 §8 would have failed the gate for being accessible. A gate
        // that reports the compliant case as the violation gets switched off, which is the failure this
        // repository's own history names. Refusing copy that *claims* liveness is untouched: a `"live"` label
        // still fails, and the mutation proves it.
        [/(?<!aria-)\b(?:live|livestream|realtime|real-time)\b/gi, 'a push-implying state word', visible],
      ] as const) {
        pattern.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(subject)) !== null) {
          hits.push(`${file.rel}:${String(lineOf(subject, m.index))}: ${name} while §4's push operations are absent (rule 5: polling is never described or styled as push)`);
        }
      }
    }
    // The placeholder must stay a placeholder: no file may construct an events transport.
    const driverFiles = listSources(path.join(SRC, 'sdk'), (rel) => /\.event[s]?\.ts$/.test(rel));
    if (driverFiles.length) hits.push(`an events driver file exists (${driverFiles.map((f) => f.rel).join(', ')}) — §4's operations are absent, so this is describing unshipped behaviour as delivered`);
    if (pushIds.length) hits.push(`the generated contract now carries push operation(s) ${pushIds.join(', ')} — the placeholder in transport.ts must be replaced by a real driver, and the spec moved first, so update 11 §4's status too`);

    if (hits.length) fail(g, ...hits);
    else pass(
      g,
      push ? 'spec mentions a push channel; see the note above' : 'openapi.yaml has no push channel (re-measured this run)',
      'no EventSource, no WebSocket, no "live" in any source file; no events driver exists',
    );
  }
}

/* ------------------------------------------------------------------ the type-level gates */

/**
 * Every type-level claim in this package is proved by running the compiler, because a grep cannot establish
 * "the compiler refuses this". The fixtures live in `packages/ui/test/fixtures/` and are excluded from the root
 * type-check program by name (`*.negative.ts`), so CI compiles each one standalone and checks the *answer*:
 *
 *   `*.negative.ts`  must FAIL, and the error must name the subject   (the rule bites)
 *   `*.control.ts`   must COMPILE                                     (the fixture is not broken in a way that
 *                                                                     would make the refusal meaningless)
 *
 * The control is not decoration. `docs/ui-architecture.md` rule 3 records a security assertion that "had been
 * passing without testing anything" because a flipped signature byte often decodes to the same value; a
 * negative fixture with no positive control is that defect in test form — it would fail to compile for reasons
 * that have nothing to do with the rule, and the gate would read the failure as protection.
 */
interface TypeAssertion {
  readonly fixture: string;
  readonly gate: string;
  /**
   * A pattern the compiler error must match, or null when the fixture must merely fail.
   *
   * A pattern and not a bare substring, because the error text belongs to TypeScript and not to us: a type
   * alias is reported as its *expansion*, so `reads: OperationId[]` surfaces as `keyof ApiResponses`. Both
   * spellings are accepted so the assertion holds what it means — "the compiler rejected this as a member of
   * the operation union" — without hardening against one phrasing that a `tsc` upgrade is free to change.
   */
  readonly mustMention: RegExp | null;
  readonly expect: 'fail' | 'compile';
  readonly claim: string;
}

const TYPE_ASSERTIONS: readonly TypeAssertion[] = [
  {
    fixture: 'packages/ui/test/fixtures/retention-omitted.negative.ts',
    gate: '9.4b', mustMention: /retention/, expect: 'fail',
    claim: 'a signal declared without `retention` does not compile — the field has no default (rule 3)',
  },
  {
    fixture: 'packages/ui/test/fixtures/retention-declared.control.ts',
    gate: '9.4b', mustMention: null, expect: 'compile',
    claim: 'the same declaration with an explicit retention does compile, so the refusal above is about retention',
  },
  {
    fixture: 'packages/ui/test/fixtures/reads-unknown-operation.negative.ts',
    gate: '9.1b', mustMention: /keyof ApiResponses|OperationId/, expect: 'fail',
    claim: 'a component cannot name an operation the generated contract does not have (rule 1, and rule 5\'s "no planned endpoint" half)',
  },
  {
    fixture: 'packages/ui/test/fixtures/age-omitted.negative.ts',
    gate: '9.10b', mustMention: /freshness/, expect: 'fail',
    claim: 'server data cannot be produced without its age — `freshness` is required on the loaded branch (rule 5)',
  },
  {
    fixture: 'packages/ui/test/fixtures/age-carried.control.ts',
    gate: '9.10b', mustMention: null, expect: 'compile',
    claim: 'the same value with `freshness` compiles, so the refusal above is about the age and not the DTO',
  },
  {
    fixture: 'packages/ui/test/fixtures/events-driver-built.negative.ts',
    gate: '9.10c', mustMention: /never/, expect: 'fail',
    claim: 'the events placeholder cannot be constructed into a Transport (D64: design the capability, ship poll)',
  },
  {
    fixture: 'packages/ui/test/fixtures/events-absent.control.ts',
    gate: '9.10c', mustMention: null, expect: 'compile',
    claim: 'the set of buildable driver kinds, read off the exported transports, contains no `events` today',
  },
];

/**
 * The flags a fixture is compiled with. They are the UI project's flags, spelled out rather than inherited from
 * `packages/ui/tsconfig.json`, and the reason is measured: a fixture imports `packages/ui/src/index.ts`, which
 * imports the registry, which imports `components/instances.tsx`. Without `--jsx` the control fixtures failed with
 * TS6142 on a file they do not name, and a *control* that cannot compile makes its paired refusal meaningless --
 * the exact coin-flip defect 11 §3 prices. Keeping the flag list here and the flag list in the config in two
 * places is a real cost; `test/gates-falsify.test.ts` pays it back by asserting the control side of every pair.
 */
const FIXTURE_FLAGS = [
  '--noEmit', '--strict', '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext',
  '--lib', 'es2023,dom,dom.iterable', '--jsx', 'react-jsx',
  '--skipLibCheck', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--verbatimModuleSyntax',
  '--allowImportingTsExtensions', '--erasableSyntaxOnly', '--noUnusedLocals', '--types', 'node',
] as const;

function runTsc(fixture: string): { code: number; output: string } {
  try {
    execFileSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'node_modules/typescript/bin/tsc'), ...FIXTURE_FLAGS, fixture],
      { stdio: 'pipe', cwd: ROOT });
    return { code: 0, output: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: e.status ?? 1, output: `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`.trim() };
  }
}

for (const assertion of TYPE_ASSERTIONS) {
  const g = gate(assertion.gate, assertion.claim);
  if (!isSelected(assertion.gate)) {
    notRun(g, `not selected by --only ${String(ONLY)}; the compiler was not run for this claim on this invocation`);
    continue;
  }
  if (!fs.existsSync(path.join(ROOT, assertion.fixture))) {
    fail(g, `${assertion.fixture} is missing — the claim is unfalsifiable without it`);
    continue;
  }
  const { code, output } = runTsc(assertion.fixture);
  const firstError = output.split('\n').find((l) => l.includes('error TS'))?.trim() ?? '';
  if (assertion.expect === 'compile') {
    if (code !== 0) fail(g, `${assertion.fixture} was REFUSED (exit ${String(code)}), so the paired negative proves nothing:\n      ${firstError.slice(0, 240)}`);
    else pass(g, `${assertion.fixture} compiles`);
    continue;
  }
  if (code === 0) {
    fail(g, `${assertion.fixture} COMPILED — the rule is not enforced by the type system after all (this gate is the coin flip: green, meaningless, load-bearing)`);
    continue;
  }
  if (assertion.mustMention && !assertion.mustMention.test(output)) {
    fail(g, `${assertion.fixture} failed to compile for the wrong reason (exit ${String(code)}); no error matches ${String(assertion.mustMention)}:\n      ${firstError.slice(0, 240)}`);
    continue;
  }
  // **The error must come from the fixture itself.** Without this, a negative assertion can be satisfied by any
  // compile error anywhere in the transitive program — and it was: making `retention` optional produced an error
  // inside `signals.ts`, which the `mustMention` pattern matched, so §9.4b reported PASS on the very mutation it
  // exists to catch. The paired control went red and saved the exit code, but a gate that passes for the wrong
  // reason is the coin-flip defect with extra steps. Anchoring on the fixture path makes the claim local.
  const mention = assertion.mustMention;
  // Group the compiler's output into per-diagnostic blocks. TypeScript prints the headline as
  // `file(line,col): error TSxxxx: …` and continues the explanation on **indented following lines** — which is
  // where the words worth matching usually are, since the headline is often "Type X does not satisfy Y" and the
  // missing member is named on the next line. Filtering on line-starts alone threw that evidence away and made
  // two correct refusals look like they came from elsewhere.
  const owned = output
    .split(/\n(?=\S)/)
    .filter((block) => block.startsWith(`${assertion.fixture}(`))
    .map((block) => block.replace(/\s+/g, ' '));
  if (mention && !owned.some((block) => mention.test(block))) {
    fail(
      g,
      `${assertion.fixture} was refused, but not *at itself* — no error line from that file matches ${String(mention)}. `
      + 'A negative fixture satisfied by an error in some other file proves nothing about the rule it names.\n'
      + `      errors from the fixture: ${owned[0]?.slice(0, 220) ?? '(none)'}`,
    );
    continue;
  }
  pass(g, `${assertion.fixture} refused at itself, and the refusal matches ${String(assertion.mustMention ?? 'any type error')}`);
}

/* ------------------------------------------------------------------ the stylesheets still reproduce */

{
  const g = gate('D63', 'tokens.css is generated, not hand-kept');
  if (!isSelected('D63')) {
    notRun(g, `not selected by --only ${String(ONLY)}; the emitter was not run for this invocation`);
  }
  let code = 0;
  let out = '';
  if (isSelected('D63')) try {
    out = execFileSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts/gen-ui-css.ts'), '--check'], { stdio: 'pipe', cwd: ROOT }).toString();
  } catch (error) {
    code = (error as { status?: number }).status ?? 1;
    out = `${(error as { stdout?: Buffer }).stdout?.toString() ?? ''}${(error as { stderr?: Buffer }).stderr?.toString() ?? ''}`;
  }
  if (code !== 0) fail(g, `ui:css:check exited ${String(code)}:\n${out.trim().split('\n').map((l) => `    ${l}`).join('\n')}`);
  else pass(g, out.trim().split('\n').map((l) => l.trim()).join('; '));
}
/* ------------------------------------------------------------------ §D65: the shell, audited */

{
  const g = gate('D65', 'the Astro shell keeps one island, one context door, and the package\'s own rules');
  const SITE_ROOT = path.join(ROOT, 'apps/site');
  if (!fs.existsSync(SITE_ROOT)) {
    // This is the sentence `ui:check` printed for the shell until apps/site landed, and it is kept because a gate
    // whose subject disappears must say so rather than go green.
    notRun(g, 'apps/site does not exist, so the shell has no subject to audit (D65 is decided but undelivered)');
  } else {
    const siteFiles: { rel: string; text: string }[] = [];
    const walkSite = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro') continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkSite(abs); continue; }
        if (!entry.isFile() || !/\.(ts|tsx|astro|css)$/.test(entry.name)) continue;
        siteFiles.push({ rel: path.relative(ROOT, abs).split(path.sep).join('/'), text: fs.readFileSync(abs, 'utf8') });
      }
    };
    walkSite(path.join(SITE_ROOT, 'src'));
    if (siteFiles.length === 0) {
      fail(g, 'apps/site exists but has no sources under src/ — the walk found nothing, which is a vacuous pass waiting to happen');
    } else {
      const hits: string[] = [];
      const srcOf = (rel: string): string | undefined => siteFiles.find((f) => f.rel === rel)?.text;
      const inSrc = (predicate: (f: { rel: string; text: string }) => boolean): string[] => siteFiles.filter(predicate).map((f) => f.rel);

      // (1) One island per page, and the marketing page is not a React page at all. `client:*` is what Astro hands
      // to the framework, so this is the source-level statement of "the dashboard is one island": a second
      // hydration is two registries and two token stores (D65's own words), and it is visible here first.
      const pages = siteFiles.filter((f) => /\/pages\/[^/]+\.astro$/.test(f.rel));
      if (pages.length === 0) hits.push('apps/site/src/pages holds no .astro page, so the island count compared nothing');
      for (const page of pages) {
        // `visible`, not the blanked reading: in an .astro template the directive *is* an attribute value, and a
        // gate that strips strings cannot see the one thing it is counting. (Measured: with the blanked read, the
        // planted second island on `/` passed the gate.)
        const visible = stripComments(page.text, true);
        const directives = visible.match(/client:(?:load|visible|idle|media|only)/g) ?? [];
        if (directives.length > 1) hits.push(`${page.rel}: ${String(directives.length)} client:* directives on one page — D65 allows one island per page`);
        if (/index\.astro$/.test(page.rel) && directives.length > 0) hits.push(`${page.rel}: the landing route hydrates (${directives.join(', ')}), and "the landing page ships no JavaScript" was the reason Astro was chosen`);
      }

      // (2) One door for the contexts. `createShellContext` is memoised on its configuration and refuses a second,
      // different one (packages/ui/src/web/shell.tsx); that only means something if the shell is the only place a
      // page can build them. A page that constructs its own transport or bus is a second hydration wearing different
      // clothes, and it would not be caught by the singleton because the singleton is the thing being bypassed.
      const doors = inSrc((f) => /createShellContext\(/.test(stripComments(f.text)));
      if (doors.length === 0) hits.push('nothing in apps/site calls createShellContext, so the SDK and signal contexts are being built some other way (D65)');
      for (const rel of doors) if (!/\/islands\//.test(rel)) hits.push(`${rel}: createShellContext is called outside an island module — the one door must be one place`);
      for (const [pattern, why] of [
        [/\bSdkProvider\b/, 'SdkProvider used directly; the page context comes from createShellContext'],
        [/\bSignalsProvider\b/, 'SignalsProvider used directly; same reason'],
        [/\bnew PollTransport\(/, 'a transport built by the shell instead of by the one page context'],
        [/\bcreateSignalBus\(/, 'a second signal registry'],
        [/\bcreateTokenBag\(|\bcreateBrowserAuthSource\(/, 'a second token store or auth source, which is D65\'s named risk'],
      ] as const) {
        for (const rel of inSrc((f) => pattern.test(stripComments(f.text)))) hits.push(`${rel}: ${why}`);
      }

      // (3) Rule 1 and #258, over the app: the only `fetch` allowed in the shell is the issuer token call the SDK
      // cannot make for itself, and it may not be pointed at the control plane. A hand-supplied route table or a
      // typed `/api/v1/...` would be a second description of the API living in UI code.
      const fetchers = inSrc((f) => /\bfetch\(/.test(stripComments(f.text)));
      for (const rel of fetchers) if (!/\/lib\/browser-capabilities\.ts$/.test(rel)) hits.push(`${rel}: a fetch() in the shell outside lib/browser-capabilities.ts (rule 1: components reach the API through the SDK only)`);
      const caps = srcOf('apps/site/src/lib/browser-capabilities.ts');
      if (caps === undefined) hits.push('apps/site/src/lib/browser-capabilities.ts is missing — the injected issuer transport has no home, so fetch() has to live somewhere it should not');
      else if (/\/api\/v1|PLATFOLIO_URL/.test(caps)) hits.push('apps/site/src/lib/browser-capabilities.ts addresses the control plane — the injected requester exists for the issuer token endpoint and nothing else');
      for (const rel of inSrc((f) => /["'`]\/api\/v1/.test(stripComments(f.text, true)))) hits.push(`${rel}: a spec path typed into the shell — paths come from the generated ENDPOINTS table (#258)`);
      for (const rel of inSrc((f) => /\bendpoints\s*:/.test(stripComments(f.text)))) hits.push(`${rel}: a hand-supplied route table (PollTransportConfig.endpoints defaults to ENDPOINTS for exactly this reason)`);
      for (const rel of inSrc((f) => /from '@platfolio\/api-contract/.test(stripComments(f.text, true)))) hits.push(`${rel}: the shell imports the generated contract directly — it reaches the API through the SDK`);

      // (4) D64's honesty, and D63's tokens, in the shell's own files. The vocabulary is checked against literals
      // (`stripComments(text, true)`), because the thing this rule polices is copy; the timer and transport shapes
      // are checked against code.
      for (const file of siteFiles) {
        const clean = stripComments(file.text);
        const visible = stripComments(file.text, true);
        // Two readings of one file, in the same shape gate §R5 uses for the package: `clean` erases literals, so a
        // `WebSocket` inside a comment is not a claim; `visible` keeps strings, because the thing the state-word half
        // of this rule polices is *copy*, and copy only ever lives inside a literal.
        const haystackFor = (source: RegExp): string =>
          /EventSource|WebSocket/.test(source.source) ? clean : visible;
        for (const [pattern, why] of [
          [/\bEventSource\b/, 'EventSource'],
          [/\bWebSocket\b/, 'WebSocket'],
          [/(?<!aria-)\b(?:live|livestream|realtime|real-time)\b/gi, 'a push-implying state word'],
        ] as const) {
          pattern.lastIndex = 0;
          const haystack = haystackFor(pattern);
          // `test`, not `matchAll`. Two of these three patterns are deliberately non-global, and
          // `String.prototype.matchAll` refuses a non-global RegExp outright — measured: a TypeError raised inside
          // the gate, which took the whole `ui:check` report down with it and printed no statuses at all. One line
          // per file per rule is the shape the neighbouring gates report in, so the first hit is enough.
          if (pattern.test(haystack)) {
            // `search` rather than a match object: it accepts a non-global RegExp and returns the index, which is
            // all a one-line-per-file report needs in order to name the line.
            const at = haystack.search(pattern);
            hits.push(`${file.rel}:${String(Math.max(1, haystack.slice(0, at).split('\n').length))}: ${why} while §4's push operations are absent from the spec (rule 5: polling is never described or styled as push)`);
          }
        }
        if (/\bsetTimeout\(|\bsetInterval\(/.test(clean) && !/\/pages\/.*\.astro$/.test(file.rel)) {
          hits.push(`${file.rel}: a timer in the shell — freshness and the refresh schedule belong to the SDK and to whoever arms them (11 §9.2)`);
        }
      }

      // (5) D63: no new colours, typefaces or spacing steps invented in app CSS — the token sheet is imported, and
      // a literal here is a second source of truth about the design system. Measured against the generated tokens:
      // a hex colour is refused outright, and so is a `--ui-*` declaration, which would shadow the sheet.
      const tokenSheet = '@platfolio/ui/tokens.css';
      const cssFiles = siteFiles.filter((f) => f.rel.endsWith('.css') || /<style/.test(f.text));
      if (cssFiles.length === 0) hits.push('apps/site owns no stylesheet, so the token rule had nothing to read');
      for (const file of cssFiles) {
        const body = file.rel.endsWith('.css') ? file.text : (file.text.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? []).join('\n');
        const code = stripCssComments(body);
        for (const [pattern, why] of [
          [/#[0-9a-fA-F]{3,8}\b/, 'a colour literal'],
          [/rgba?\(/, 'an rgb()/rgba() colour'],
          [/hsla?\(/, 'an hsl()/hsla() colour'],
          [/--ui-[a-z0-9-]+\s*:/, 'a redeclared token — the generated sheet owns these, and shadowing one is a second source of truth about the design system'],
        ] as readonly (readonly [RegExp, string])[]) {
          if (pattern.test(code)) hits.push(`${file.rel}: ${why} (D63: no new colour in app code; import the token)`);
        }
        // A `font-family` is refused only when its value is not a token reference, because the sheet spells the
        // type scale as `--ui-font-*` and `font-family: var(--ui-font-body)` is the compliant form. Doing this per
        // declaration instead of with one broad pattern is what keeps the compliant case out of the report — the
        // mistake gate §R5's `aria-live` story records, in the other direction.
        for (const decl of code.match(/font-family:[^;]+;/g) ?? []) {
          if (!decl.includes('var(--ui-font-')) hits.push(`${file.rel}: \`${decl.trim()}\` names a typeface rather than a --ui-font-* token (D63)`);
        }
        // Lengths: `px` is refused and `rem`/`ch`/`fr` are not, with the reason here for a reviewer to read. The
        // package itself spells container thresholds in rem (`PRIMITIVES[*].wideFromRem`, `components.css`'s own
        // `0.25rem solid`), and there is no measure token in `tokens.ts`. A gate stricter than the rule it enforces
        // is a gate that gets switched off, which is the failure mode 11 §9 names more than once.
        if (/:\s*[^;]*\d+(\.\d+)?px/.test(code)) hits.push(`${file.rel}: a px length in app CSS — the spacing scale is --ui-space-* (D63)`);
        if (file.rel.endsWith('.css') && !file.text.includes(tokenSheet)) {
          hits.push(`${file.rel}: does not import ${tokenSheet} — app styles must build on the generated tokens, not beside them (D63)`);
        }
      }

      // (6) D47 in the shell: an endpoint is configuration. The names are declared in environment.yaml; the values
      // are never in this app's source, and a platfolio-owned hostname in a tracked file here is the same defect the
      // repository's endpoint rule refuses for generated Railway names.
      const CONFIG_HOSTS = /https?:\/\/[a-z0-9.-]*(platfolio\.dev|railway\.app)[a-z0-9.:/-]*/gi;
      for (const file of siteFiles) {
        const visible = stripComments(file.text, true);
        const found = visible.match(CONFIG_HOSTS);
        if (found !== null) hits.push(`${file.rel}: commits an endpoint (${[...new Set(found)].join(', ')}) — configuration, not source (D47)`);
      }
      const varNames = srcOf('apps/site/src/lib/site-config.ts')?.match(/'[A-Z][A-Z0-9_]{6,}'/g) ?? [];
      if (varNames.length === 0) hits.push('apps/site/src/lib/site-config.ts names no environment variable, so the shell is not reading its configuration from the deploy (D47)');

      // (7) If the artifact is present, read it: the zero-JS claim and the one-island claim are about what a browser
      // receives, and a source rule cannot show what a bundler did. `pnpm run site:build` produces it;
      // apps/site/test/build-output.test.ts asserts on it in every run of `pnpm run test`.
      const dist = path.join(SITE_ROOT, 'dist');
      if (fs.existsSync(dist)) {
        const landing = path.join(dist, 'index.html');
        if (fs.existsSync(landing)) {
          const html = fs.readFileSync(landing, 'utf8');
          if (/<script[\s>]/i.test(html)) hits.push('apps/site/dist/index.html ships a script tag, so the landing route is not the zero-JS page D65 chose Astro for (measured in the artifact, not the config)');
          if (html.includes('astro-island')) hits.push('apps/site/dist/index.html contains an island element');
        }
        const dash = path.join(dist, 'dashboard/index.html');
        if (fs.existsSync(dash)) {
          const islands = (fs.readFileSync(dash, 'utf8').match(/<astro-island/g) ?? []).length;
          if (islands !== 1) hits.push(`apps/site/dist/dashboard/index.html carries ${String(islands)} island elements (D65: one)`);
        }
        const chunks = fs.existsSync(path.join(dist, '_astro')) ? fs.readdirSync(path.join(dist, '_astro')).filter((f) => f.endsWith('.js')) : [];
        for (const chunk of chunks) {
          const bundle = fs.readFileSync(path.join(dist, '_astro', chunk), 'utf8');
          // Markers for the Node-only chain that made the first honest build fail: the pg driver's helper, the
          // in-memory SCM double, the manifest build planner, the Postgres store. If any of this comes back, a
          // shell file reached a package that imports `node:crypto` or `pg`, and the bundle breaks at the boundary
          // rather than at the deploy. Chosen as *module* names, not variable names: an earlier draft of this line
          // carried `PGPASSWORD` as a marker, and `check-environment-registry.ts` — which scans `scripts/` for
          // quoted uppercase names — promptly reported that the gate "referenced" a credential it was only naming.
          // `pool` was tried too, and matched inside React's own runtime: a gate that fires on the compliant
          // artifact is a gate somebody switches off.
          for (const marker of ['pgpass', 'postgres-store', 'MemoryScm', 'build-plan', 'node:crypto']) {
            if (bundle.includes(marker)) {
              hits.push(`apps/site/dist/_astro/${chunk} pulls in \`${marker}\` — the client bundle reached Node-only server code (the measured first-build failure: "createHash" is not exported by "__vite-browser-external")`);
            }
          }
          // The operator script by name, because that is the exact import the first honest build refused to bundle.
          if (/scripts\/browser-auth/.test(bundle)) {
            hits.push(`apps/site/dist/_astro/${chunk} carries the operator script's path — the client bundle reached scripts/browser-auth.ts again, which is the measured failure the policy module exists to prevent (node:crypto has no browser answer)`);
          }
        }
      } else {
        g.notes.push('artifact half not measured in this run: apps/site/dist is absent (run `pnpm run site:build`). The source rules above ran; the zero-JS and island-count claims are asserted by apps/site/test/build-output.test.ts, which builds first and is part of `pnpm run test`.');
      }

      if (hits.length) fail(g, ...[...new Set(hits)]);
      else pass(
        g,
        `${String(siteFiles.length)} shell files read (pages, islands, lib, styles)`,
        `${String(doors.length)} createShellContext call site(s): ${doors.join(', ') || 'none'}`,
        'one client:* per page, none on the landing route; no second transport, registry, token store or fetch in the shell; no spec path or route table typed into app code',
        'no push vocabulary, no timer in the shell, no colour literal or redeclared token in app CSS, no committed endpoint',
        fs.existsSync(dist) ? `and the built artifact was read too: zero scripts on /, one island on /dashboard, no Node-only chain in the ${String(chunksCount(dist))} emitted chunks` : 'artifact not built in this run (see the note above)',
      );
    }
  }
}

/** The chunk count for the PASS evidence line, read the same way the gate reads them. */
function chunksCount(dist: string): number {
  const dir = path.join(dist, '_astro');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).length : 0;
}

/* ------------------------------------------------------------------ declared but not implemented */

// One running gate and four that do not, listed apart rather than in one block — the first draft put §9.1 in the
// NOT RUN table while its own text said the checks were green, which is a gate reporting a limitation it does
// not have. A NOT RUN label has to mean "this did not execute", so §9.1 executes.
{
  const g = gate('9.1', 'contract floor (the gates above the UI inherit)');
  // `packages/ui` imports its server types from the generated table, so 11 §9.1's floor is not this package's
  // own check — it is `api:types:check` and `api:check`, both already in `verify`. What *is* checked here is the
  // edge this package is responsible for: that it really does import them, and restates none of them.
  const generatedPath = 'packages/api-contract/src/generated/types.ts';
  if (!fs.existsSync(path.join(ROOT, generatedPath))) {
    fail(g, `${generatedPath} is missing — there is no generated table to import from`);
  } else {
    const importers = listSources(SRC, () => true).filter((f) => f.text.includes('@platfolio/api-contract/generated/types'));
    if (importers.length === 0) {
      fail(g, 'no file in packages/ui imports the generated contract, so rule 1 is not actually wired through this package');
    } else {
      // Restated-shape witness: a local interface declaring the members of a server DTO would be #247 in a .tsx.
      const generated = fs.readFileSync(path.join(ROOT, generatedPath), 'utf8');
      const serverNames = [...generated.matchAll(/^export interface (\w+) \{/gm)].map((m) => m[1] as string);
      const restated = listSources(SRC, () => true).flatMap((f) => {
        const clean = stripComments(f.text);
        return serverNames
          .filter((name) => new RegExp(`\\binterface\\s+${name}\\b`).test(clean))
          .map((name) => `${f.rel}: re-declares server type ${name}`);
      });
      if (restated.length) fail(g, ...restated);
      else pass(
        g,
        `${importers.length} file(s) import the generated table; none re-declares a type named in it`,
        'the floor itself is `api:types:check` + `api:check`, both green in this same verify run — reported as inherited, not re-run here',
      );
    }
  }
}

for (const [id, title, why] of [
  ['9.7', 'same-slot matrix', 'needs a browser: there are now 6 registered components and each declares the slots it promises, so the subject exists -- what is missing is 320 px and 1280 px containers. 11 §8/§9 put Playwright in a later slice and this change does not smuggle a harness in beside a config nobody reviewed.'],
  ['9.8', 'a11y floor', 'needs axe-core and a layout engine, and neither is installed: no AA violations, focus trap/Esc-topmost/restore-on-pop and the target-size audit at 360 px all stay unrun. What IS checked today is structural and in test/components.test.ts (roles, label association by id, one polite region per list, the hit-target class on every control, the age beside every state word), plus the token arithmetic in test/contrast.test.ts. Focus order is not among them and is not claimed: renderToStaticMarkup never paints, so it cannot show where focus goes.'],
  ['9.9', 'draft contract', 'needs packages/ui/src/web/drafts.ts, which does not exist: 11 §5 is specified, not delivered, and UI-OD4 still owns the retention numbers. The half that does exist — `draftable` is an allowlist and a value-bearing path is refused at registration — is checked by test/contract.test.ts.'],
] as const) {
  notRun(gate(id, `${title} (declared elsewhere)`), why);
}

/* ------------------------------------------------------------------ output */

const selected = ONLY === null ? gates : gates.filter((g) => g.id === ONLY);
if (ONLY !== null && selected.length === 0) {
  console.error(`error: no gate with id "${ONLY}". Known ids: ${gates.map((g) => g.id).join(', ')}`);
  process.exit(2);
}

const bar = '─'.repeat(72);
console.log(`\nui:check — packages/ui gates (11 §9)${ONLY === null ? '' : ` — only §${ONLY}`}\n${bar}`);
for (const g of selected) {
  const mark = g.status === 'PASS' ? 'PASS   ' : g.status === 'FAILED' ? 'FAILED ' : 'NOT RUN';
  console.log(`${mark} §${g.id.padEnd(5)} ${g.title}`);
  for (const note of g.notes) console.log(`         · ${note}`);
  for (const failure of g.failures) console.log(`         ! ${failure}`);
}

const failed = selected.filter((g) => g.status === 'FAILED');
const skipped = selected.filter((g) => g.status === 'NOT RUN');
console.log(bar);
console.log(`${String(selected.length)} gate(s): ${String(selected.length - failed.length - skipped.length)} passed, ${String(failed.length)} failed, ${String(skipped.length)} NOT RUN`);
if (skipped.length) {
  console.log(`NOT RUN is not PASSED. ${String(skipped.length)} gate(s) above have no subject yet: §${skipped.map((g) => g.id).join(', §')}.`);
  console.log('Green here means "nothing in the code that exists today violates this", not "the architecture is protected".');
}
if (failed.length) {
  console.error(`\nui:check FAILED ${String(failed.length)} gate(s): §${failed.map((g) => g.id).join(', §')}`);
  process.exit(1);
}
console.log('ui:check passed (with the NOT RUN list above read as part of the result)');
