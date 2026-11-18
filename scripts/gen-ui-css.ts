#!/usr/bin/env node
/**
 * `pnpm run ui:css` / `pnpm run ui:css:check` — the stylesheets in `packages/ui` are build artifacts (D63).
 *
 * This is `gen-api-types.ts` applied one layer down. The emitters live in the package they generate for
 * (`renderTokensCss()` in `packages/ui/src/tokens.ts`, `renderLayoutCss()` in
 * `packages/ui/src/layout/primitives.ts`, `renderContentCss()` in `packages/ui/src/layout/content.ts`,
 * `renderComponentCss()` in `packages/ui/src/components/style.ts`); this script only calls them and decides
 * whether to write or to compare. That keeps one implementation of "what the tokens, the primitives and the
 * components produce", so the two commands cannot be greener than each other and a stylesheet cannot drift from
 * the module that emits it.
 *
 * **Why this exists at all:** D63 puts the design tokens inside `packages/ui`. A hand-written `tokens.css`
 * beside a hand-written `tokens.ts` is two definitions of one fact — the exact defect every gate in this
 * repository exists to prevent, and the one that would have been introduced in this package's first commit if
 * the CSS had been written rather than generated.
 *
 * `--check` is the gate. `--write` is how you change a stylesheet: by changing the module.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { renderTokensCss } from '../packages/ui/src/tokens.ts';
import { renderLayoutCss } from '../packages/ui/src/layout/primitives.ts';
import { renderContentCss } from '../packages/ui/src/layout/content.ts';
import { renderComponentCss } from '../packages/ui/src/components/style.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Each artifact names its own source module, so a stale header points at the file to edit. */
const TARGETS = [
  { out: 'packages/ui/src/tokens.css', source: 'packages/ui/src/tokens.ts', render: renderTokensCss },
  { out: 'packages/ui/src/layout/layout.css', source: 'packages/ui/src/layout/primitives.ts', render: renderLayoutCss },
  // The content sheet is the fourth artifact and names its own source, for the reason `layout/content.ts` gives
  // in its header: a document's measure and column threshold are a different decision from a screen's slot, and
  // one digest per emitter is what makes "generated from" a claim a test can check rather than a comment.
  { out: 'packages/ui/src/layout/content.css', source: 'packages/ui/src/layout/content.ts', render: renderContentCss },
  { out: 'packages/ui/src/components/components.css', source: 'packages/ui/src/components/style.ts', render: renderComponentCss },
] as const;

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');
if (write === check) {
  console.error('error: pass exactly one of --write or --check');
  process.exit(2);
}

function digestOf(rel: string): string {
  return createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16);
}

const problems: string[] = [];
const written: string[] = [];

for (const target of TARGETS) {
  const generated = target.render(`sha256/${digestOf(target.source)}`);
  const outPath = path.join(ROOT, target.out);

  if (write) {
    const previous = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (previous === generated) continue;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, generated);
    written.push(target.out);
    continue;
  }

  if (!fs.existsSync(outPath)) {
    problems.push(`${target.out} is missing. Run \`pnpm run ui:css\`.`);
    continue;
  }
  const committed = fs.readFileSync(outPath, 'utf8');
  if (committed === generated) continue;
  const a = committed.split('\n');
  const b = generated.split('\n');
  let i = 0;
  while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
  problems.push(
    `${target.out} does not reproduce from ${target.source}. First difference at line ${String(i + 1)}:\n`
    + `    committed: ${JSON.stringify(a[i])}\n`
    + `    generated: ${JSON.stringify(b[i])}\n`
    + `    The stylesheet is generated. Edit ${target.source} and run \`pnpm run ui:css\`, or revert a hand edit.`,
  );
}

if (problems.length) {
  console.error(`ui:css failed with ${String(problems.length)} problem(s):`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

if (write) {
  console.log(written.length
    ? `ui:css wrote ${written.join(', ')}`
    : 'ui:css: both stylesheets already current; nothing written');
  process.exit(0);
}

for (const target of TARGETS) {
  const lines = fs.readFileSync(path.join(ROOT, target.out), 'utf8').split('\n').length;
  console.log(`  ${target.out} reproduces from ${target.source} byte for byte (${String(lines)} lines)`);
}
