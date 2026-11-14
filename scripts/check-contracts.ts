#!/usr/bin/env node
/**
 * Contract drift gate for `packages/contracts`.
 *
 * The public surface of the contracts package is what third-party providers compile against, so a
 * change to it is a version decision (docs/design/10: "version bumps are derived from the contracts
 * diff, not from a reviewer's memory"). This emits the declaration file, normalizes it, and compares
 * against the committed baseline.
 *
 *   tsx scripts/check-contracts.ts            # fail if the surface drifted
 *   tsx scripts/check-contracts.ts --update   # rewrite the baseline (state the bump in the commit)
 *
 * The version is DERIVED, never declared (D59). The committed baseline carries it in a `Version:`
 * header line beside the `Digest:` line that was already there, and every `--update` recomputes it:
 * the next version is the recorded one moved by whatever bump the surface diff implies
 * (removal/widening -> major, new declaration -> minor, pure reorder -> nothing, per the classifier
 * below). The generated file `packages/contracts/src/generated/contract-version.ts` — the only place
 * the contracts package states its version — is a pure function of those header lines, so the verify
 * mode reproduces it byte-for-byte or fails loudly. There is no fallback default anywhere: an absent
 * or stale generated file, or a baseline whose header predates version tracking, is a gate failure
 * that names the one command to run.
 *
 * One migration path is not a fallback: when the committed baseline carries no `Version:` line yet,
 * `--update` seeds the record by replaying the ONE diff that a version was ever declared against —
 * the surface as of the commit that introduced the hand-authored `CONTRACT_VERSION` literal (found
 * through git, emitted through this same tool over a `git archive` of that tree, so no format noise
 * from the evolution of this checker) against the surface today. Whatever bump that says is applied
 * to the version the literal declared at that commit. It runs exactly once, on the first --update
 * after version tracking lands; after that the recorded `Version:` line is the only seed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(ROOT, 'packages/contracts/api.md');
const VERSION_FILE = path.join(ROOT, 'packages/contracts/src/generated/contract-version.ts');
const WORK = path.join(ROOT, '.tmp-contracts');
const CONTRACTS_SRC = 'packages/contracts/src';
/** The hand-authored literal D59 deletes; its introducing commit is the migration epoch. */
const EPOCH_SYMBOL = 'export const CONTRACT_VERSION =';

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: (r.status ?? 1) === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function git(args: string[]): string {
  const r = run('git', args);
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed: ${r.out.trim()}`);
  return r.out;
}

/** Emit .d.ts for the contracts package only, then keep the exported surface lines.
 * `srcRoot`/`emitDir` default to the live tree; the seed epoch re-runs this over an extracted
 * historical tree so the epoch surface is produced by TODAY's formatting rules, not the old ones. */
export function emitSurface(srcRoot = 'packages/contracts/src/index.ts', emitDir = WORK): string {
  fs.rmSync(emitDir, { recursive: true, force: true });
  fs.mkdirSync(emitDir, { recursive: true });
  const tsc = path.join(ROOT, 'node_modules/typescript/bin/tsc');
  const r = run(process.execPath, [
    tsc, '--declaration', '--emitDeclarationOnly', '--declarationDir', emitDir,
    '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext',
    '--skipLibCheck', '--strict', '--allowImportingTsExtensions', srcRoot,
  ]);
  if (!r.ok) throw new Error(`tsc failed:\n${r.out}`);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.d.ts')) found.push(abs);
    }
  };
  if (fs.existsSync(emitDir)) walk(emitDir);
  if (found.length === 0) throw new Error(`no declaration files emitted under ${path.relative(ROOT, emitDir)}`);
  const lines: string[] = [];
  for (const abs of found.sort()) {
    const f = path.relative(emitDir, abs);
    for (const raw of fs.readFileSync(abs, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('*') || line.startsWith('/*') || line.startsWith('//') || line.startsWith('import')) continue;
      // Keep every declaration line, not just the ones that start with `export`. The original filter
      // captured only a type's first line, so a member-level change -- a new constructor option, a
      // renamed field on an interface -- left the baseline untouched and the gate reported "matches".
      // A drift gate that cannot see the drift is worse than none, because it is trusted.
      if (/^(export|declare|readonly|[a-zA-Z_$][\w$]*[?]?\s*[:({<])/.test(line)) lines.push(`${f}: ${line}`);
    }
  }
  fs.rmSync(emitDir, { recursive: true, force: true });
  return `${lines.sort().join('\n')}\n`;
}

export function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** The surface body of a baseline: between the first ``` fence and the next one, tolerating the
 * optional language tag. Both the committed file and the epoch-extracted file are read with this. */
function surfaceOf(baseline: string): string {
  const open = baseline.match(/^```[^\n]*\n/m);
  if (!open || open.index === undefined) return '';
  const rest = baseline.slice(open.index + open[0].length);
  const close = rest.indexOf('\n```');
  return close < 0 ? rest : rest.slice(0, close);
}

/* --------------------------------------------------------------- version derivation (exported for tests) */

export type SurfaceDiff = ReturnType<typeof classify>;

// Classify the change before touching the baseline. `--update` used to write and exit 0 whatever the diff
// contained, so a breaking removal and an additive line looked identical in the log: the tool's silence read
// as success, and the version decision went unrecorded. Removals must now be acknowledged with a reason --
// "additive -> minor, removal -> major" is only a rule if something enforces which side a change falls on.
// Classify honestly. A line diff cannot tell "a declaration disappeared" from "the same declaration got
// bigger", and those are different version decisions: one is a removal, the other a widening that breaks
// anyone switching exhaustively while deleting nothing. Reporting only a count made the ack a guess -- it is
// how I called a widened tuple "additive" while the gate called it MAJOR, both defensible and neither useful.
const keyOf = (line: string): string => line.split(/[({[]/)[0]!.trim();
export function classify(from: string, to: string) {
  const norm = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const prev = new Set(norm(from));
  const next = new Set(norm(to));
  const added = [...next].filter((l) => !prev.has(l));
  const gone = [...prev].filter((l) => !next.has(l));
  const nextKeys = new Set([...next].map(keyOf));
  // Same declaration head, different body: widened, not withdrawn.
  const widened = gone.filter((l) => nextKeys.has(keyOf(l)));
  const stillGone = gone.filter((l) => !nextKeys.has(keyOf(l)));
  // Reordering is not a version decision. TypeScript prints an inline union in inference order, so
  // `"database" | "service" | ...` becoming `"service" | "database" | ...` shows up in a line diff as one line
  // deleted and another added -- and this gate demanded a breaking ack for exactly that, while I very nearly
  // accepted a MAJOR for a type that had not changed. Same members, different order, same type: compare the
  // member set before calling anything a removal.
  const membersOf = (line: string): string => {
    // Pair by what a line IS: the declaration up to where the member list begins, plus the sorted members.
    // keyOf cannot serve (an inline union line has no bracket, so it returns the whole line), and slicing at the
    // first '|' swallows the first member -- which is how a first attempt still reported a pure reordering as a
    // removal. Cut at the opening quote of the list; everything after it is members.
    const listStart = line.search(/["'[{]/);
    if (listStart < 0) return `${keyOf(line)}::`;
    const head = line.slice(0, listStart).trim();
    const members = line.slice(listStart).replace(/[;{}()]/g, '');
    return `${head}::${members.split('|').map((x) => x.trim()).sort().join('|')}`;
  };
  const addedByMembers = new Set(added.map((l) => membersOf(l)));
  const reordered = stillGone.filter((l) => addedByMembers.has(membersOf(l)));
  const removed = stillGone.filter((l) => !addedByMembers.has(membersOf(l)));
  // The same pairing read the other way: a pure reorder shows up in `added` too (that is what a reorder IS in
  // a line diff). If the total derivation counted those as new declarations, reordering -- which this file
  // goes out of its way to say is NOT a version decision -- would bump MINOR anyway. `netAdded` is `added`
  // minus the counterparts of reordered lines, so "nothing left but reorders" derives no bump at all.
  const reorderedCounterparts = new Set(reordered.map((l) => membersOf(l)));
  const netAdded = added.filter((l) => !reorderedCounterparts.has(membersOf(l)));
  return { added, widened, removed, reordered, netAdded };
}

export type Bump = 'major' | 'minor' | 'none';

/** The bump a diff implies. Breaking (removed/widened) outranks additive; a diff that is nothing but
 * reordering implies no version decision at all. */
export function bumpFor(diff: SurfaceDiff): Bump {
  if (diff.removed.length + diff.widened.length > 0) return 'major';
  if (diff.netAdded.length > 0) return 'minor';
  return 'none';
}

/** Move a version by a bump. Patch is never derived -- the surface diff cannot tell a bugfix from
 * nothing -- so minor resets it, matching semver's own reset rules. */
export function applyBump(version: string, bump: Bump): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`not a derived semver: "${version}"`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (bump === 'major') return `${String(major + 1)}.0.0`;
  if (bump === 'minor') return `${String(major)}.${String(minor + 1)}.0`;
  return version;
}

const VERSION_RE = /^Version: (\d+\.\d+\.\d+)$/m;
const BUMP_RE = /^Bump: (.+)$/m;
const DIGEST_RE = /^Digest: `([0-9a-f]+)`$/m;

/** The version the committed baseline records, or null when it predates version tracking. */
export function parseVersion(baseline: string): string | null {
  return baseline.match(VERSION_RE)?.[1] ?? null;
}

export function parseProvenance(baseline: string): string {
  return baseline.match(BUMP_RE)?.[1] ?? '';
}

/** The ONLY home of the contracts version string. The value is annotated `string`, deliberately NOT
 * `'x.y.z' as const`: a literal type would publish the version INTO the emitted declaration surface,
 * and every derived bump would then read back as a removed declaration -- the gate flagging its own
 * arithmetic as a breaking change. The baseline digest line binds the file to a specific baseline. */
export function renderVersionFile(version: string, provenance: string, baselineDigest: string): string {
  return `/**
 * GENERATED by \`scripts/check-contracts.ts --update\` -- DO NOT EDIT, there is nothing here to edit
 * by hand. (D59: "we should never specify a version on contracts"; the value is derived from the
 * public-surface baseline in packages/contracts/api.md, and \`check-contracts\` without \`--update\`
 * reproduces this file from that baseline or fails.)
 *
 * Typed \`string\` on purpose: a literal type would put the version into the emitted declaration
 * surface, so every version bump would classify as a REMOVED declaration and the drift gate would
 * demand a breaking ack for its own arithmetic.
 *
 * Derived from the baseline digest \`${baselineDigest}\`.
 * ${provenance || 'Bump: (no provenance recorded)'}
 */
export const CONTRACT_VERSION: string = '${version}';
`;
}

/** Full baseline text for a surface at a recorded version with a provenance line. Exported so the
 * reproduce check and the tests build the same bytes -- a check against a format only one call site
 * knows is a check that passes because it parses nothing. */
export function renderBaseline(surface: string, version: string, provenance: string): string {
  return `# contracts public surface

Generated by \`scripts/check-contracts.ts --update\`. A change here is a version decision:
additive -> minor; removal or tightening that an implementation relies on -> major.
The \`Version:\` line is the derived contract version (D59) and the \`Bump:\` line says how it got there;
\`packages/contracts/src/generated/contract-version.ts\` is a generated reflection of the two.
Version: ${version}
Bump: ${provenance}
Digest: \`${digest(surface)}\`

\`\`\`txt
${surface}\`\`\`
`;
}

/**
 * Does the generated version file reproduce, byte for byte, from the committed baseline header?
 * Returns one loud message per way it does not; an empty array means the pair agrees. No defaults:
 * every branch here names the failing fact, because "absent" and "stale" must not become 1.0.0.
 */
export function versionFileErrors(baseline: string, fileText: string | null): string[] {
  const errors: string[] = [];
  const version = parseVersion(baseline);
  if (version === null) {
    return ['the committed baseline (packages/contracts/api.md) carries no `Version:` line, so the derived version has no record to reproduce from -- run `tsx scripts/check-contracts.ts --update` and commit the result (D59)'];
  }
  if (!DIGEST_RE.test(baseline)) {
    return ['the committed baseline carries no `Digest:` line; the generated file binds itself to that digest, so it cannot be reproduced -- regenerate with `tsx scripts/check-contracts.ts --update`'];
  }
  const expected = renderVersionFile(version, parseProvenance(baseline), baseline.match(DIGEST_RE)![1]!);
  if (fileText === null) {
    errors.push(`packages/contracts/src/generated/contract-version.ts is missing -- run \`tsx scripts/check-contracts.ts --update\` (D59: the version is derived, so the file is generated, and its absence is never defaulted)`);
  } else if (fileText !== expected) {
    errors.push('packages/contracts/src/generated/contract-version.ts does not reproduce from the committed baseline -- its version, provenance or baseline digest disagrees with packages/contracts/api.md; run `tsx scripts/check-contracts.ts --update` and commit both files together');
  }
  return errors;
}

/**
 * The migration seed, used ONLY when the committed baseline has no `Version:` line (the state D59 lands
 * in: the hand-authored literal was never recorded in the baseline). Replays the one comparison a
 * declared version was ever honestly made against: the surface at the commit that introduced
 * `CONTRACT_VERSION` (with the version literal it declared there) versus the surface today, both
 * emitted by THIS tool so checker-format changes cannot masquerade as contract removals.
 */
export function seedFromEpoch(): { version: string; surface: string; commit: string } {
  const history = git(['log', '--full-history', '--no-merges', '--format=%H', '-S', EPOCH_SYMBOL, '--', `${CONTRACTS_SRC}/infra.ts`]).trim().split('\n').filter(Boolean);
  const commit = history[history.length - 1];
  if (!commit || history.length === 0) {
    throw new Error(`cannot seed the contract version: no commit in history introduces \`${EPOCH_SYMBOL}\` in ${CONTRACTS_SRC}/infra.ts (git log found none)`);
  }
  const source = git(['show', `${commit}:${CONTRACTS_SRC}/infra.ts`]);
  const declared = source.match(/CONTRACT_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
  if (!declared) throw new Error(`the epoch commit ${commit.slice(0, 8)} does not carry a hand-authored CONTRACT_VERSION literal to seed from`);
  // Extract the historical source with today's toolchain. `git archive` only reads the object store;
  // the emitted surface is what the classifier compares, so a format drift in the checker itself
  // (the 11-13 "keep every declaration line" fix) cannot fabricate removals.
  const work = path.join(ROOT, '.tmp-contracts-epoch');
  fs.rmSync(work, { recursive: true, force: true });
  try {
    const srcDir = path.join(work, CONTRACTS_SRC);
    fs.mkdirSync(srcDir, { recursive: true });
    const archive = spawnSync('git', ['archive', `${commit}:${CONTRACTS_SRC}`], { cwd: ROOT });
    if (archive.status !== 0) throw new Error(`git archive of ${commit.slice(0, 8)}:${CONTRACTS_SRC} failed`);
    fs.writeFileSync(path.join(work, 'tar-in.bin'), archive.stdout);
    const untar = spawnSync('tar', ['-xf', path.join(work, 'tar-in.bin'), '-C', srcDir], { cwd: ROOT });
    if (untar.status !== 0) throw new Error(`extracting the epoch tree failed: ${untar.stderr?.toString() ?? ''}`);
    // zod resolves from the live workspace's node_modules -- same layout, one directory deeper.
    fs.symlinkSync(path.join(ROOT, 'packages/contracts/node_modules'), path.join(srcDir, 'node_modules'), 'dir');
    const surface = emitSurface(path.join(srcDir, 'index.ts'), path.join(work, 'out'));
    return { version: declared[1]!, surface, commit };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The version a baseline update must record, with its provenance and the diff that ack gates on.
 * Pure given the surfaces: exported so a test can prove the whole chain (surface diff -> bump ->
 * next version) instead of asserting a string someone typed. */
export function deriveUpdate(currentSurface: string, baseline: string): { version: string; provenance: string; diff: SurfaceDiff; from: string } {
  const recorded = parseVersion(baseline);
  const counts = (d: SurfaceDiff): string => `${String(d.removed.length)} removed, ${String(d.widened.length)} widened, ${String(d.netAdded.length)} added, ${String(d.reordered.length)} reordered`;
  if (recorded !== null) {
    const diff = classify(surfaceOf(baseline), currentSurface);
    const bump = bumpFor(diff);
    return {
      from: recorded,
      version: applyBump(recorded, bump),
      provenance: `${bump.toUpperCase()} ${recorded} -> ${applyBump(recorded, bump)} (surface diff: ${counts(diff)})`,
      diff,
    };
  }
  const epoch = seedFromEpoch();
  const diff = classify(epoch.surface, currentSurface);
  const bump = bumpFor(diff);
  return {
    from: epoch.version,
    version: applyBump(epoch.version, bump),
    provenance: `${bump.toUpperCase()} ${epoch.version} -> ${applyBump(epoch.version, bump)} (seeded from declared-version epoch ${epoch.commit.slice(0, 8)}; the baseline carried no Version: line; surface diff since: ${counts(diff)})`,
    diff,
  };
}

/* ------------------------------------------------------------------------ main */

async function main(): Promise<void> {
  const surface = emitSurface();
  const update = process.argv.includes('--update');
  const previous = fs.existsSync(BASELINE) ? fs.readFileSync(BASELINE, 'utf8') : '';
  const previousSurface = surfaceOf(previous);
  if (!previous) {
    console.error('error: no baseline at packages/contracts/api.md; the version is derived from it, so there is nothing to derive without one. Run `tsx scripts/check-contracts.ts --update` against a committed baseline.');
    process.exit(1);
  }

  if (update) {
    const derived = deriveUpdate(surface, previous);
    const breaking = derived.diff.removed.length + derived.diff.widened.length;
    const ack = process.argv.find((a) => a.startsWith('--ack-breaking='))?.slice('--ack-breaking='.length);
    if (breaking > 0 && !ack) {
      if (derived.diff.removed.length > 0) {
        console.error(`${String(derived.diff.removed.length)} public surface line(s) genuinely REMOVED -- a major bump, not a baseline refresh:`);
        for (const line of derived.diff.removed.slice(0, 12)) console.error(`  - ${line.slice(0, 140)}`);
      }
      if (derived.diff.widened.length > 0) {
        console.error(`${String(derived.diff.widened.length)} declaration(s) WIDENED rather than removed (same name, larger body). Nothing disappeared; a consumer switching exhaustively over the old shape still breaks:`);
        for (const line of derived.diff.widened.slice(0, 6)) console.error(`  ~ ${line.slice(0, 140)}`);
      }
      console.error(`\nThe derived bump is ${derived.version} (${derived.from} -> ${derived.version}); acknowledging it is a version decision, not a formatting one.`);
      console.error('If intentional: tsx scripts/check-contracts.ts --update --ack-breaking="<why this is acceptable now>"');
      process.exit(1);
    }
    const provenance = ack ? `${derived.provenance}; acknowledged: ${ack}` : derived.provenance;
    console.log(`derived version ${derived.from} -> ${derived.version} (${provenance})`);
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, renderBaseline(surface, derived.version, provenance), 'utf8');
    fs.mkdirSync(path.dirname(VERSION_FILE), { recursive: true });
    fs.writeFileSync(VERSION_FILE, renderVersionFile(derived.version, provenance, digest(surface)), 'utf8');
    console.log(`baseline updated (${digest(surface)}, ${surface.split('\n').filter(Boolean).length} exported lines; generated ${path.relative(ROOT, VERSION_FILE)})`);
    process.exit(0);
  }

  /** Canonical form: sorted, non-empty, trimmed lines. Comparing raw strings let a trailing newline
   * read as a contract change while reporting zero differences, which is worse than no gate at all. */
  function canonical(text: string): string[] {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).sort();
  }

  const beforeLines = canonical(previousSurface);
  const afterLines = canonical(surface);
  const before = new Set(beforeLines);
  const after = new Set(afterLines);
  const same = beforeLines.length === afterLines.length && beforeLines.every((l, i) => l === afterLines[i]);

  if (!same) {
    const added = afterLines.filter((l) => !before.has(l));
    const removed = beforeLines.filter((l) => !after.has(l));
    console.error('contracts surface drifted from the committed baseline:');
    for (const l of removed) console.error(`  - ${l}`);
    for (const l of added) console.error(`  + ${l}`);
    if (!added.length && !removed.length) console.error('  (line sets identical; ordering or count differs — regenerate the baseline)');
    const pending = bumpFor(classify(previousSurface, surface));
    const recorded = parseVersion(previous);
    console.error(`\nthis diff derives bump ${pending.toUpperCase()}${recorded ? `: ${recorded} -> ${applyBump(recorded, pending)}` : ' (no Version: recorded on the baseline yet)'}.`);
    console.error(`If intentional: run \`tsx scripts/check-contracts.ts --update\` -- it records the derived version in the baseline and regenerates packages/contracts/src/generated/contract-version.ts (D59).`);
    process.exit(1);
  }

  const fileText = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8') : null;
  const errors = versionFileErrors(previous, fileText);
  if (errors.length > 0) {
    for (const e of errors) console.error(`contract version gate: ${e}`);
    process.exit(1);
  }
  console.log(`contracts surface matches baseline (${beforeLines.length} exported declarations, derived Version: ${parseVersion(previous)})`);
}

// Importable without side effects: the tests below feed the classifier surfaces directly, and `tsx --test`
// loading this module must not re-run tsc or, worse, call process.exit on an argument the test runner owns.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  await main();
}
