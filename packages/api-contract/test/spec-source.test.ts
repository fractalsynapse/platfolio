import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { checkSpecSource, parseSpecSource } from '../src/spec-source.ts';

/**
 * The two failures a specification document can have BEFORE anything reads its meaning (#247).
 *
 * Both of these classes reached this repository on the same day, from two different agents, and the first one
 * was only discovered because a second agent happened to run a gate while the file was broken. A guard that
 * has never been falsified is not a guard, so each case below is exercised on a deliberately malformed
 * document -- the real one, mutated, rather than a toy that might not carry the same hazard.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SPEC_REL = 'apps/control-plane/openapi.yaml';
const specText = await fs.readFile(path.join(ROOT, SPEC_REL), 'utf8');

test('a document that does not parse is reported, never crashed', () => {
  // The shipped defect: `description: Names ... Distinct from `refused`: this is ...` -- a plain scalar with
  // ": " in it, which YAML reads as a nested mapping. `loadSpec` THROWS on this, which is right for a server
  // and wrong for a gate: the stack trace buried every other finding in `verify`.
  const broken = specText.replace(
    "description: 'Names suppressed because the provider''s deploy ceiling was already spent.",
    'description: Names suppressed because the provider\'s deploy ceiling was already spent.',
  );
  assert.notEqual(broken, specText, 'the mutation must apply, or this test proves nothing at all');

  const result = parseSpecSource(broken, SPEC_REL);
  assert.equal(result.ok, false, 'a malformed document must not be reported as readable');
  if (result.ok) return;
  assert.equal(result.problems.length, 1, `one problem, not a stack trace, got ${JSON.stringify(result.problems)}`);
  const finding = result.problems[0] ?? '';
  assert.match(finding, /does not parse/);
  assert.match(finding, /openapi\.yaml/);
  assert.match(finding, /line 16\d\d, column \d+/);
  assert.match(finding, /the line reads:/);
  assert.match(finding, /quote the value/i);
  // And the position is stated once, not twice -- the small thing that decides whether a gate is read.
  assert.equal((finding.match(/at line 16/g) ?? []).length, 1, `the position must not be duplicated: ${finding}`);

  // The intact document still passes, so this is not a check that fires on everything.
  assert.equal(parseSpecSource(specText, SPEC_REL).ok, true, 'the shipped spec must parse');
});

test('a plain scalar followed by # is caught: prose that silently became a comment', () => {
  // Measured on the real YAML parser, this case parses CLEANLY and loses text:
  //   description: Names # not a comment here   ->   "Names"
  // No exception, no warning, no invalid document. The sentence a person typed is shorter than the sentence
  // they wrote, and it reaches a client as a description that contradicts the code.
  const hazard = "x:\n  description: Names # and this part became a comment\n";
  const findings = checkSpecSource(hazard, 'hazard.yaml');
  assert.equal(findings.length, 1, `the silent truncation must be reported, got ${JSON.stringify(findings)}`);
  assert.match(findings[0] ?? '', /became a COMMENT/);
  assert.match(findings[0] ?? '', /line 2/);
  // Proving the finding is about the VALUE and not the comment syntax: the swallowed text is what is missing.
  const parsed = parseSpecSource<{ x: { description: string } }>(hazard, 'hazard.yaml');
  assert.equal(parsed.ok && parsed.doc.x.description, 'Names', 'the parser really does hand back the truncated value');

  // Quoting it makes the finding go away, which is the whole point: the rule is about the writing style.
  assert.deepEqual(checkSpecSource("x:\n  description: 'Names # and this part is kept'\n", 'safe.yaml'), []);
  assert.deepEqual(checkSpecSource('x:\n  description: |\n    Names # kept, in a block\n', 'safe.yaml'), []);
});

test('a comma inside a flow-mapped description is caught: prose that became a keyword', () => {
  // The other silent one, and the one `unexpressedKeywords()` discovered after the fact:
  //   a: { description: Names, because prose, minLength: 3 }
  //     -> { description: 'Names', 'because prose': null, minLength: 3 }
  // A NEW KEYWORD appears, Ajv runs non-strict so it is accepted, and the description is now two words short.
  const hazard = 'x:\n  a: { type: string, description: Names suppressed, because the ceiling was spent, minLength: 3 }\n';
  const findings = checkSpecSource(hazard, 'hazard.yaml');
  assert.ok(findings.some((f) => /being read as a KEY/.test(f)), `a prose fragment read as a key must be reported, got ${JSON.stringify(findings)}`);
  assert.match(findings.join('\n'), /because the ceiling was spent/);
  assert.match(findings.join('\n'), /line 2/);

  // The same text, quoted, is not a finding. And neither is legitimate flow punctuation in a legitimate value.
  assert.deepEqual(checkSpecSource("x:\n  a: { type: string, description: 'Names suppressed, because English', minLength: 3 }\n", 'safe.yaml'), []);
  assert.deepEqual(checkSpecSource("x:\n  tags: [operational, identity]\n", 'safe.yaml'), []);
  assert.deepEqual(checkSpecSource("x:\n  enum: [a, b]\n  required: [a]\n", 'safe.yaml'), []);
});

test('the shipped document is clean under both rules -- or the rules are noise', () => {
  // This is the assertion that keeps the two checks above from becoming a lint people switch off: on the real
  // 2,200-line file, with all its prose, both rules find nothing. If a future edit makes them fire on
  // legitimate text, the right response is to narrow the rule, not to quote half the file.
  const findings = checkSpecSource(specText, SPEC_REL);
  assert.deepEqual(findings, [], `the shipped spec trips its own quoting rules:\n${findings.join('\n')}`);
});
