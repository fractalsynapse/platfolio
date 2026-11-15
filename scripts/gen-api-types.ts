#!/usr/bin/env node
/**
 * `pnpm run api:types` -- write the client types; `pnpm run api:types:check` -- prove they still reproduce.
 *
 * The rule this serves: types used by a client are generated from the specification, not hand-written beside it
 * (D41, and the reason issue #247 exists). A generated file is only trustworthy if exactly one thing writes it
 * and something checks that what it wrote is still true of the input, so:
 *
 *   - `scripts/gen-api-types.ts` (this file) is the only writer. The emitter is
 *     `packages/api-contract/src/generate-types.ts`; this script only reads the spec, calls it, and decides
 *     whether to write or to compare.
 *   - `--check` regenerates in memory and compares byte-for-byte with the committed file. It never writes.
 *     Any difference -- including the file being absent -- fails, naming the command that fixes it.
 *
 * There is no timestamp and no randomness in the output, and the input digest travels in the header, so a
 * difference here is always a difference between the spec and the types, never between two runs.
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSpec } from '../packages/api-contract/src/index.ts';
import { generateApiTypes, unexpressedKeywords } from '../packages/api-contract/src/generate-types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC_PATH = path.join(ROOT, 'apps/control-plane/openapi.yaml');
const OUT_PATH = path.join(ROOT, 'packages/api-contract/src/generated/types.ts');
const MODE = process.argv.slice(2).find((a) => a.startsWith('--')) ?? '--write';

if (MODE !== '--write' && MODE !== '--check' && MODE !== '--stdout') {
  console.error(`usage: tsx scripts/gen-api-types.ts [--write|--check|--stdout]  (default --write)`);
  process.exit(2);
}
if (!existsSync(SPEC_PATH)) {
  console.error(`error: no spec at ${rel(SPEC_PATH)}. The rule is spec-first, so there is nothing to generate types from.`);
  process.exit(1);
}

const source = await fs.readFile(SPEC_PATH, 'utf8');
const doc = loadSpec(source);
const generated = generateApiTypes(doc, { specPath: rel(SPEC_PATH), source });

// Anything the document says that no generated client will ever read. Reported in every mode, because the
// alternative is a prose sentence silently disappearing into a keyword nobody consumes.
const unheard = unexpressedKeywords(doc);
if (unheard.length) {
  console.warn(`warning: ${rel(SPEC_PATH)} carries ${String(unheard.length)} schema keyword(s) that nothing downstream reads:`);
  for (const line of heardSlice(unheard)) console.warn(`  - ${line}`);
  console.warn('  A flow scalar with an unquoted comma/colon parses as a short description plus a new key; Ajv\'s non-strict mode and checkSpec both pass it. Quote the value.');
}

if (MODE === '--stdout') {
  process.stdout.write(generated);
  process.exit(0);
}

if (MODE === '--check') {
  if (!existsSync(OUT_PATH)) {
    console.error(`api:types:check failed -- ${rel(OUT_PATH)} does not exist. Generate it with \`pnpm run api:types\` and commit the result.`);
    process.exit(1);
  }
  const committed = await fs.readFile(OUT_PATH, 'utf8');
  if (committed === generated) {
    const lines = generated.split('\n').length;
    console.log(`api:types:check passed -- ${rel(OUT_PATH)} reproduces from ${rel(SPEC_PATH)} byte-for-byte (${String(lines)} lines, ${String(generated.length)} bytes)`);
    process.exit(0);
  }
  const diff = firstDifferences(committed, generated);
  console.error(`api:types:check failed -- ${rel(OUT_PATH)} does not reproduce from the committed ${rel(SPEC_PATH)}.`);
  console.error('  The spec is the source, so the committed file is stale (or was edited by hand, which is the same finding).');
  console.error('  Fix: `pnpm run api:types` and commit the regenerated file with the spec change it came from.');
  console.error(`  Sizes: committed ${String(committed.length)} bytes / regenerated ${String(generated.length)} bytes.`);
  for (const line of diff) console.error(`  ${line}`);
  process.exit(1);
}

await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
const previous = existsSync(OUT_PATH) ? await fs.readFile(OUT_PATH, 'utf8') : undefined;
if (previous === generated) {
  console.log(`api:types -- ${rel(OUT_PATH)} already current (${String(generated.split('\n').length)} lines, ${String(generated.length)} bytes); nothing written`);
  process.exit(0);
}
await fs.writeFile(OUT_PATH, generated, 'utf8');
console.log(`wrote ${rel(OUT_PATH)} from ${rel(SPEC_PATH)} -- ${String(generated.split('\n').length)} lines, ${String(generated.length)} bytes${previous === undefined ? ' (new file)' : ''}`);

function rel(target: string): string {
  return path.relative(ROOT, target);
}

/** How many of the unheard-keyword findings to print before pointing at the count instead. */
function heardSlice(lines: string[]): string[] {
  return lines.slice(0, 8);
}

/** A short, readable first difference: line numbers and text, not a full diff engine. */
function firstDifferences(committed: string, generated: string): string[] {
  const a = committed.split('\n');
  const b = generated.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < 6; i += 1) {
    if (a[i] === b[i]) continue;
    out.push(`line ${String(i + 1)} committed: ${JSON.stringify(a[i] ?? '<eof>')}`);
    out.push(`line ${String(i + 1)} generated: ${JSON.stringify(b[i] ?? '<eof>')}`);
  }
  return out;
}
