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
import { lineOf, stripComments, stripCssComments } from './ui-source-scan.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
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
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
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

/* ------------------------------------------------------------------ §9.2 rogue data and storage */

{
  const g = gate('9.2', 'no rogue data or storage');
  const sources = listSources(SRC, (rel) => rel.endsWith('.ts'));
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
  const sheets = ['packages/ui/src/tokens.css', 'packages/ui/src/layout/layout.css']
    .filter((rel) => fs.existsSync(path.join(ROOT, rel)))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));
  if (sheets.length === 0) {
    fail(g, 'no generated stylesheets found — run `pnpm run ui:css`');
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
      else pass(g95, `${String(ids.length)} component id(s) resolve, each with a StandardSchema props definition`);
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
  } else {
    // The structural half that CAN run: nothing in the contract types admits a slot-specific read set, so a
    // component cannot declare "wide screens get this operation". If that field is ever added, this bites.
    const contractText = fs.readFileSync(path.join(SRC, 'contract.ts'), 'utf8');
    const perSlotReads = /reads\w*(?:Wide|Narrow|Desktop|Mobile|BySlot)/i.test(contractText)
      || /Record<LayoutSlot,[^>]*OperationId/.test(contractText);
    if (perSlotReads) {
      fail(g, 'contract.ts declares a slot-dependent `reads` shape — a capability that exists only at one width is rule 2\'s definition of a fail');
    } else {
      pass(g, `${String(ids.length)} component(s), and no per-slot read set is expressible in the contract type`, 'per-screen 360/1920 comparison still NOT RUN until screens exist');
    }
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
        [/\b(?:live|livestream|realtime|real-time)\b/gi, 'a push-implying state word', visible],
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

function runTsc(fixture: string): { code: number; output: string } {
  try {
    execFileSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'node_modules/typescript/bin/tsc'),
      '--noEmit', '--strict', '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext',
      '--skipLibCheck', '--exactOptionalPropertyTypes', '--noUncheckedIndexedAccess', '--verbatimModuleSyntax',
      '--allowImportingTsExtensions', '--erasableSyntaxOnly', '--noUnusedLocals', '--types', 'node', fixture],
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
  ['9.7', 'same-slot matrix', 'needs a browser and a registered component at 320 px and 1280 px. 11 §8/§9 put Playwright in a later slice; this task forbids smuggling a harness in with a config nobody reviewed.'],
  ['9.8', 'a11y floor', 'needs rendered fixtures for axe-core. The token half — every contrast pair in CONTRAST_PAIRS, and the 44/24/8 px minimums — IS checked today, in test/contrast.test.ts, because those are arithmetic over data.'],
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
