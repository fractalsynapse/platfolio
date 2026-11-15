#!/usr/bin/env node
/**
 * `pnpm run spec:gen` -- write the generated components; `pnpm run spec:check` -- prove they still reproduce.
 *
 * The rule this serves is #247's, and it is AGENTS.md's: where a shape is shared with a capability contract,
 * the StandardSchema is the source and the specification is *generated or compared against it -- never
 * re-invented*. The comparison half existed. This is the generation half, and it changes what a spec edit
 * means: a shared component is now a build artifact, so the only way to change one is to change the
 * definition and regenerate.
 *
 *  - `scripts/gen-api-spec.ts` (this file) is the only writer of `components.schemas` for the generated set.
 *    The emitter is `packages/api-contract/src/spec-components.ts` and the YAML writer is
 *    `spec-yaml.ts`; this script reads the file, calls them, and decides whether to write or to compare.
 *  - `--check` regenerates in memory and compares byte-for-byte. It never writes, and it names the component
 *    and the first differing line -- `api:types:check` set that pattern, and the reason is the same: a gate
 *    that says "stale" without saying where is a gate people route around.
 *  - **A refusal stops the run.** If a definition cannot be expressed -- a `.transform()`, a recursive shape,
 *    an annotation pointing at a field that no longer exists, a keyword the writer does not own -- nothing is
 *    written and the schema and path are named. Approximating is the failure this replaces.
 *
 * What is deliberately NOT touched: `paths:`, `info`, `tags`, `securitySchemes`, `components.responses`, and
 * every component with no code-side definition. The merge splices only the character ranges of the
 * components the generator owns, which is what lets a whole-file byte comparison be the right check -- and
 * what makes a hand edit anywhere in the generated blocks show up as a difference rather than as a merge
 * conflict.
 *
 * Prose is not lost by that rule, but it does move: field `description`, `format`, `example` and the
 * maintenance comments live in `packages/api-contract/src/spec-annotations.ts`, in code, keyed by component
 * and property path. That file's header says why. Editing a description inside a generated component of
 * `openapi.yaml` is therefore an edit that `--check` will undo on the next run.
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { contractSide, regenerate, specComponentNames } from '../packages/api-contract/src/spec-components.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC_PATH = path.join(ROOT, 'apps/control-plane/openapi.yaml');
const CONTRACTS_MODULE = path.join(ROOT, 'packages/contracts/src/index.ts');
const MODE: 'write' | 'check' | 'stdout' = process.argv.includes('--write') ? 'write' : process.argv.includes('--stdout') ? 'stdout' : 'check';

if (process.argv.slice(2).some((a) => !['--write', '--check', '--stdout'].includes(a))) {
  console.error('usage: tsx scripts/gen-api-spec.ts [--check|--write|--stdout]  (default --check)');
  process.exit(2);
}
if (!existsSync(SPEC_PATH)) {
  console.error(`spec:${MODE === 'write' ? 'gen' : 'check'} failed -- no spec at ${rel(SPEC_PATH)}. The rule is spec-first, so there is nothing to generate into.`);
  process.exit(1);
}

const committed = await fs.readFile(SPEC_PATH, 'utf8');
const exported = Object.entries(await import(CONTRACTS_MODULE));
// The same derivation the gate builds: name-matched definitions plus the composed response shapes.
const derivation = contractSide(exported);
const names = specComponentNames(committed);
const result = regenerate(committed, names, derivation.all, derivation.undervisitable);

// Two kinds of finding, kept apart because they want opposite responses: a refusal means the generator did
// not know what to write, so writing would be guessing; staleness means it knew and the file disagrees, so
// writing IS the repair.
if (result.refusals.length) {
  console.error(`spec:${MODE === 'write' ? 'gen' : 'check'} failed -- the generator refuses to write this document.`);
  for (const refusal of result.refusals) console.error(` - ${refusal}`);
  console.error('  Nothing was written. A refusal is not a formatting problem: fix the definition, or say what the document means in packages/api-contract/src/spec-annotations.ts.');
  process.exit(1);
}
if (result.stale.length && MODE !== 'write') {
  console.error(`spec:${MODE === 'check' ? 'check' : 'gen'} failed -- the committed document is not what the schemas produce.`);
  for (const finding of result.stale) console.error(` - ${finding}`);
  console.error('  Fix: `pnpm run spec:gen`, then commit the regenerated components together with the schema change they came from, and `pnpm run api:types` so the client types follow.');
  process.exit(1);
}
if (result.stale.length) {
  console.log(`spec:gen -- ${String(result.stale.length)} staleness finding(s) repaired by regenerating:`);
  for (const finding of result.stale.slice(0, 4)) console.log(`  ${finding}`);
  if (result.stale.length > 4) console.log(`  ... and ${String(result.stale.length - 4)} more`);
}

if (MODE === 'stdout') {
  process.stdout.write(result.text);
  process.exit(0);
}

if (MODE === 'check') {
  console.log(`spec:check passed -- ${rel(SPEC_PATH)} reproduces byte-for-byte from ${String(result.components.length)} generated component definition(s) (${String(committed.split('\n').length)} lines, ${String(committed.length)} bytes).`);
  console.log(`  generated: ${result.components.map((c) => c.name).join(', ')}`);
  console.log(`  hand-written: ${names.filter((n) => !result.components.some((c) => c.name === n)).join(', ')}`);
  process.exit(0);
}

await fs.writeFile(SPEC_PATH, result.text, 'utf8');
console.log(`wrote ${rel(SPEC_PATH)} -- ${String(result.components.length)} component(s) generated from packages/contracts, ${String(result.text.length)} bytes, ${String(result.text.split('\n').length)} lines`);
console.log('  next: `pnpm run api:types` regenerates the client types the changed document implies, and `pnpm run spec:check` proves this file still reproduces.');

function rel(target: string): string {
  return path.relative(ROOT, target);
}
