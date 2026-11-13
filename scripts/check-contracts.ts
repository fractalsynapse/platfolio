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
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(ROOT, 'packages/contracts/api.md');
const WORK = path.join(ROOT, '.tmp-contracts');

function run(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: (r.status ?? 1) === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Emit .d.ts for the contracts package only, then keep the exported surface lines. */
function emitSurface(): string {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const tsc = path.join(ROOT, 'node_modules/typescript/bin/tsc');
  const r = run(process.execPath, [
    tsc, '--declaration', '--emitDeclarationOnly', '--declarationDir', WORK,
    '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext',
    '--skipLibCheck', '--strict', '--allowImportingTsExtensions', 'packages/contracts/src/index.ts',
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
  if (fs.existsSync(WORK)) walk(WORK);
  if (found.length === 0) throw new Error(`no declaration files emitted under ${path.relative(ROOT, WORK)}`);
  const lines: string[] = [];
  for (const abs of found.sort()) {
    const f = path.relative(WORK, abs);
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
  fs.rmSync(WORK, { recursive: true, force: true });
  return `${lines.sort().join('\n')}\n`;
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

const surface = emitSurface();
const update = process.argv.includes('--update');
const previous = fs.existsSync(BASELINE) ? fs.readFileSync(BASELINE, 'utf8') : '';
const previousSurface = previous.split('\n```txt\n')[1]?.split('\n```')[0] ?? '';

// Classify the change before touching the baseline. `--update` used to write and exit 0 whatever the diff
// contained, so a breaking removal and an additive line looked identical in the log: the tool's silence read
// as success, and the version decision went unrecorded. Removals must now be acknowledged with a reason --
// "additive -> minor, removal -> major" is only a rule if something enforces which side a change falls on.
// Classify honestly. A line diff cannot tell "a declaration disappeared" from "the same declaration got
// bigger", and those are different version decisions: one is a removal, the other a widening that breaks
// anyone switching exhaustively while deleting nothing. Reporting only a count made the ack a guess -- it is
// how I called a widened tuple "additive" while the gate called it MAJOR, both defensible and neither useful.
const keyOf = (line: string): string => line.split(/[({[]/)[0]!.trim();
const classify = (from: string, to: string) => {
  const norm = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const prev = new Set(norm(from));
  const next = new Set(norm(to));
  const added = [...next].filter((l) => !prev.has(l));
  const gone = [...prev].filter((l) => !next.has(l));
  const nextKeys = new Set([...next].map(keyOf));
  // Same declaration head, different body: widened, not withdrawn.
  const widened = gone.filter((l) => nextKeys.has(keyOf(l)));
  const removed = gone.filter((l) => !nextKeys.has(keyOf(l)));
  return { added, widened, removed };
};
const ack = process.argv.find((a) => a.startsWith('--ack-breaking='))?.slice('--ack-breaking='.length);
const diff = classify(previousSurface, surface);
const breaking = diff.removed.length + diff.widened.length;

if (update && breaking > 0 && !ack) {
  if (diff.removed.length > 0) {
    console.error(`${String(diff.removed.length)} public surface line(s) genuinely REMOVED -- a major bump, not a baseline refresh:`);
    for (const line of diff.removed.slice(0, 12)) console.error(`  - ${line.slice(0, 140)}`);
  }
  if (diff.widened.length > 0) {
    console.error(`${String(diff.widened.length)} declaration(s) WIDENED rather than removed (same name, larger body). Nothing disappeared; a consumer switching exhaustively over the old shape still breaks:`);
    for (const line of diff.widened.slice(0, 6)) console.error(`  ~ ${line.slice(0, 140)}`);
  }
  console.error('\nIf intentional: tsx scripts/check-contracts.ts --update --ack-breaking="<why this is acceptable now>"');
  process.exit(1);
}

if (update) {
  console.log(breaking > 0
    ? `BREAKING accepted: ${String(diff.removed.length)} removed, ${String(diff.widened.length)} widened -> derived bump MAJOR. Reason: ${ack ?? 'NOT STATED'}`
    : `additive only: ${String(diff.added.length)} line(s) added -> derived bump MINOR`);
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `# contracts public surface

Generated by \`scripts/check-contracts.ts --update\`. A change here is a version decision:
additive -> minor; removal or tightening that an implementation relies on -> major.
Digest: \`${digest(surface)}\`

\`\`\`txt
${surface}\`\`\`
`, 'utf8');
  console.log(`baseline updated (${digest(surface)}, ${surface.split('\n').filter(Boolean).length} exported lines)`);
  process.exit(0);
}

if (!previous) {
  console.error('error: no baseline at packages/contracts/api.md; run `tsx scripts/check-contracts.ts --update` and commit it');
  process.exit(1);
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
  console.error(`\nIf intentional: run \`tsx scripts/check-contracts.ts --update\` and state the derived bump\n(major when a capability or field is removed or tightened, minor when added) in the commit.`);
  process.exit(1);
}
console.log(`contracts surface matches baseline (${beforeLines.length} exported declarations)`);
