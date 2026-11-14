/**
 * The proof that the infra contract version is DERIVED, not declared (D59).
 *
 * Deliberately NOT a test that asserts the current string equals some other string -- that was the
 * old `assert.equal(CONTRACT_VERSION, '1.0.0')`, and it proved only that two literals agreed. These
 * tests feed the classifier surfaces with a field removed, a declaration added, a declaration
 * widened and a union reordered, and assert the VERSION MOVES accordingly. If someone restores a
 * hand-authored version, this file still passes -- so the repo-state test at the bottom checks the
 * committed pair, and `check-contracts.ts` (which CI runs) is what fails loudly when the pair stops
 * reproducing. Together those are the falsifiable claim "there is no other source for the version".
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyBump, bumpFor, classify, digest, parseProvenance, parseVersion, renderBaseline,
  renderVersionFile, versionFileErrors,
} from '../../../scripts/check-contracts.ts';
import { CONTRACT_VERSION } from '../src/index.ts';

/** A surface line, in the shape emitSurface produces. */
const line = (file: string, text: string): string => `${file}: ${text}`;
const base = [
  line('infra.d.ts', 'export declare const CONTRACT_NAME: "infra.provider";'),
  line('infra.d.ts', 'export declare const OPERATIONS: readonly ["describe", "applyPlan"];'),
  line('infra.d.ts', 'export declare function planIssues(plan: unknown): Issue[];'),
].join('\n') + '\n';

test('a REMOVED declaration moves the version major', () => {
  const withField = base + line('infra.d.ts', 'cloneFrom: z.ZodOptional<z.ZodString>;') + '\n';
  const diff = classify(withField, base); // the field is gone in the new surface
  assert.equal(bumpFor(diff), 'major', `expected a removal to classify major, got ${JSON.stringify(diff.removed)}`);
  assert.equal(applyBump('1.0.0', bumpFor(diff)), '2.0.0');
  assert.equal(applyBump('2.4.7', bumpFor(diff)), '3.0.0', 'major resets minor and patch');
});

test('an ADDED declaration moves the version minor', () => {
  const grown = base + line('infra.d.ts', 'export declare const RETENTION: readonly ["instance", "survive"];') + '\n';
  const diff = classify(base, grown);
  assert.equal(bumpFor(diff), 'minor');
  assert.equal(applyBump('2.0.0', bumpFor(diff)), '2.1.0');
});

test('a WIDENED declaration (same name, bigger body) is major, not a removal or an addition', () => {
  const widened = base.replace(
    'OPERATIONS: readonly ["describe", "applyPlan"]',
    'OPERATIONS: readonly ["describe", "applyPlan", "readState"]',
  );
  const diff = classify(base, widened);
  assert.equal(diff.removed.length, 0, 'a widening withdraws nothing');
  assert.equal(diff.widened.length, 1, `expected one widened line, got ${JSON.stringify(diff.widened)}`);
  assert.equal(bumpFor(diff), 'major', 'a consumer switching exhaustively over the old shape breaks');
});

test('a pure REORDER is not a version decision at all', () => {
  // Same members, different inference order -- the union shuffle the classifier exists for. It is a
  // union line because membersOf pairs on `|`: the same shuffle in a TUPLE reads as widened, and the
  // widened test above already covers that shape.
  const withUnion = base + line('infra.d.ts', 'export type SecretSource = "database" | "service" | "shared-variable";') + '\n';
  const reordered = withUnion.replace('"database" | "service" | "shared-variable"', '"shared-variable" | "database" | "service"');
  assert.notEqual(reordered, withUnion, 'ANCHOR MISSING: union line not found');
  const diff = classify(withUnion, reordered);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.widened.length, 0);
  assert.ok(diff.reordered.length > 0, 'the classifier must still SEE the pair as a reorder');
  assert.equal(diff.netAdded.length, 0, 'a reordered counterpart must not count as a new declaration');
  assert.equal(bumpFor(diff), 'none', 'reordering derives no version decision');
  assert.equal(applyBump('2.0.0', bumpFor(diff)), '2.0.0');
});

test('an EMPTY diff leaves the version exactly where the record says', () => {
  const diff = classify(base, base);
  assert.equal(bumpFor(diff), 'none');
  assert.equal(applyBump(CONTRACT_VERSION, 'none'), CONTRACT_VERSION);
});

/* ------------------------------------------------ the generated file reproduces from the baseline */

test('the version file round-trips with the baseline, and drift is loud', () => {
  const provenance = 'MAJOR 1.0.0 -> 2.0.0 (surface diff: 1 removed, 0 widened, 0 added, 0 reordered)';
  const baseline = renderBaseline(base, '2.0.0', provenance);
  const fileText = renderVersionFile('2.0.0', provenance, digest(base));
  assert.equal(parseVersion(baseline), '2.0.0', 'the baseline header records the version');
  assert.equal(parseProvenance(baseline), provenance, 'and how it got there');
  assert.deepEqual(versionFileErrors(baseline, fileText), [], 'a faithful pair produces no errors');

  // Tamper each binding in turn: every one must be caught by name, not silently defaulted.
  const tampered = fileText.replace("'2.0.0'", "'1.0.0'");
  assert.match(versionFileErrors(baseline, tampered).join('\n'), /does not reproduce/);
  assert.match(versionFileErrors(baseline, null).join('\n'), /is missing/);
  const staleBaseline = baseline.replace(digest(base), '0'.repeat(16));
  assert.match(versionFileErrors(staleBaseline, fileText).join('\n'), /does not reproduce/);
  const noProvenance = baseline.replace(/^Bump: .*$/m, '');
  assert.match(versionFileErrors(noProvenance, fileText).join('\n'), /does not reproduce/);
  const noVersion = baseline.replace(/^Version: .*$/m, '');
  assert.match(versionFileErrors(noVersion, fileText).join('\n'), /no `Version:` line/);
});

test('no source file outside the generated artifact assigns the contract version', () => {
  // The rule D59 deletes is "a version you can edit". This walks the contracts sources and fails if any
  // file other than the generated one assigns CONTRACT_VERSION from a string literal -- restoring the
  // old `export const CONTRACT_VERSION = '1.0.0' as const;` line here is what this test is for. The
  // lookbehind keeps OTHER contracts (IDENTITY_/STORE_) out of scope -- D59 governs this version only.
  const src = path.resolve(import.meta.dirname, '../src');
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const rel = path.relative(src, abs);
      if (rel.startsWith('generated' + path.sep) || rel.startsWith('generated/')) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const assignment = text.match(/(?<![_A-Za-z0-9])CONTRACT_VERSION\s*(?::[^=;]+)?=\s*['"`\d]/);
      if (assignment) offenders.push(`${rel}: ${assignment[0]}`);
    }
  };
  walk(src);
  assert.deepEqual(offenders, [], 'hand-authored contract version literal found (D59 forbids it; the value lives only in src/generated/contract-version.ts, written by check-contracts --update)');
});

test('the committed baseline and the generated file agree, or the pair is named as pre-migration', () => {
  // State-sensitive on purpose: BEFORE the orchestration regeneration lands, api.md legitimately has
  // no Version: line and the gate must say so loudly; AFTER it, the real pair must reproduce
  // byte-for-byte. Either branch is a falsifiable assertion about real repo files; neither is a tautology.
  const root = path.resolve(import.meta.dirname, '../../..');
  const baseline = fs.readFileSync(path.join(root, 'packages/contracts/api.md'), 'utf8');
  const file = path.join(root, 'packages/contracts/src/generated/contract-version.ts');
  const fileText = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const errors = versionFileErrors(baseline, fileText);
  if (parseVersion(baseline) === null) {
    assert.equal(errors.length, 1, `pre-migration baseline must fail with exactly the seed message, got ${JSON.stringify(errors)}`);
    assert.match(errors[0]!, /no `Version:` line/);
  } else {
    assert.deepEqual(errors, [], 'the committed pair does not reproduce -- run tsx scripts/check-contracts.ts --update');
    // The version the package reports IS the version the baseline records. If either side is a
    // hand-authored literal again, or one drifts from the other, this names it.
    assert.equal(CONTRACT_VERSION, parseVersion(baseline));
  }
});
