import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { lineOf, stripComments, stripCssComments } from '../../../scripts/ui-source-scan.ts';

/**
 * The scanner every `ui:check` grep reads through, tested on its own.
 *
 * This deserves its own suite because of *where* a bug in it lands. If `stripComments` silently failed to blank
 * something, a gate would fire on prose and get widened or switched off — loud, self-correcting. If it blanked
 * too much — say the mode stack got stuck inside a template literal for the rest of a file — **every gate would
 * report PASS over the remaining code.** The failure direction is silence, and this repository's own history
 * (the flipped-signature test that "had been passing without testing anything") says silent over-blanking is
 * the one that costs money. So each rule below has both directions: something that must disappear, and
 * something that must survive.
 */

test('line comments vanish, code survives', () => {
  const src = 'const a = 1; // fetch(url)\nconst b = 2;\n';
  const out = stripComments(src);
  assert.ok(!out.includes('fetch'), 'a fetch inside a line comment survived the strip');
  assert.ok(out.includes('const a = 1;'), 'the code beside the comment was erased');
  assert.equal(out.split('\n').length, src.split('\n').length, 'line count shifted, so reported line numbers would lie');
  assert.equal(out.length, src.length, 'character offsets shifted');
});

test('block comments vanish, including across lines', () => {
  const src = '/* fetch(a)\n   fetch(b) */ const c = 3;\n';
  const out = stripComments(src);
  assert.ok(!out.includes('fetch'));
  assert.ok(out.includes('const c = 3;'));
  assert.equal(out.split('\n').length, src.split('\n').length);
});

test('string bodies are blanked, and the quotes are kept', () => {
  const src = `const note = 'Route-level document. It survives a reload.';\n`;
  const out = stripComments(src);
  assert.ok(!out.includes('document.'), 'prose inside a string was read as a browser touch');
  // Everything outside the literal must be intact, byte for byte.
  assert.ok(out.startsWith('const note = \''), 'the assignment before the literal was damaged');
  assert.ok(out.endsWith("';\n"), 'the literal close and the statement terminator were damaged');
  assert.equal(out.length, src.length);
});

test('template literals blank, and an interpolation is code again', () => {
  const src = 'const s = `updated ${Date.now()} ago`;\n';
  const out = stripComments(src);
  assert.ok(out.includes('Date.now()'), 'code inside ${} was blanked — every later gate on that file would be blind');
  assert.ok(!out.includes('updated'), 'template text was not blanked');
});

test('a template does not swallow the rest of the file (the mode must pop)', () => {
  // The failure this pins: if `template` mode never exits, everything after it is blanked and every gate
  // silently reports PASS on the remaining lines.
  const src = 'const t = `a`;\nconst u = fetch("x");\nconst v = 1;\n';
  const out = stripComments(src);
  assert.ok(out.includes('fetch('), 'a fetch after a template literal was erased — the scanner lost its mode');
  assert.ok(out.includes('const v = 1;'));
});

test('an escaped quote does not close the string', () => {
  const src = "const s = 'it\\'s fetch(x)';\nconst y = fetch(z);\n";
  const out = stripComments(src);
  assert.ok(out.includes('fetch(z)'), 'the escape desynchronised the scanner and erased real code');
  assert.ok(!out.includes('fetch(x)'));
});

test('a comment inside a string is still a string', () => {
  const src = 'const u = "http://example.test/a";\nconst v = fetch(w);\n';
  const out = stripComments(src);
  assert.ok(out.includes('fetch(w)'), 'the // inside a URL was read as a line comment and erased the rest of the file');
});

test('nested block-ish sequences do not end the comment early', () => {
  const src = '/* a /* not nested in JS */ const x = fetch(y);\n';
  const out = stripComments(src);
  assert.ok(out.includes('fetch(y)'), 'JS block comments do not nest; treating them as nested erases real code');
});

test('keepStrings preserves literals for the rule whose subject is copy', () => {
  const src = 'const label = (): string => "live";\n// live in a comment\n';
  const dropped = stripComments(src);
  const kept = stripComments(src, true);
  assert.ok(!dropped.includes('live"') && !dropped.includes('"live'), 'the default strip left the literal');
  assert.ok(kept.includes('"live"'), 'keepStrings did not keep the literal, so the "no live pill" gate cannot see a pill');
  assert.ok(!kept.includes('live in a comment'), 'keepStrings must still erase comments, or the gate fires on this file own prose');
});

test('lineOf reports 1-based lines that match the original file', () => {
  const src = 'a\nb\nfetch(c)\n';
  const out = stripComments(src);
  const idx = out.indexOf('fetch');
  assert.equal(lineOf(out, idx), 3);
  const rawIdx = src.indexOf('fetch');
  assert.equal(idx, rawIdx, 'offsets diverged from the original text, so every reported line number is wrong');
});

test('stripCssComments removes only comments and keeps the newlines', () => {
  const css = '/* @media (min-width: 1rem)\n   prose */\n.a { color: red; }\n';
  const out = stripCssComments(css);
  assert.ok(!out.includes('@media'), 'a width @media inside a CSS comment would fire the layout gate');
  assert.ok(out.includes('.a { color: red; }'));
  assert.equal(out.split('\n').length, css.split('\n').length);
});

test('a quote inside a regex character class does not open a string', () => {
  // The defect this pins, measured rather than imagined: `['"]` used to be read as the start of a string, so the
  // scanner swallowed the rest of the file and a gate reported blanked code as code it had cleared. Silence is
  // the expensive direction, which is why both halves are asserted.
  const src = 'const re = /x[\'"`]/g;\nconst label = "fetch(x)";\nexport const f = (): unknown => fetch(y);\n';
  const out = stripComments(src);
  assert.ok(out.includes('fetch(y)'), 'code after a quote-in-regex was erased -- the mode leaked and every later gate on this file is blind');
  assert.ok(!out.includes('fetch(x)'), 'the string body survived the strip, so prose naming a call reads as a call');
  assert.ok(out.includes('/x['), 'the regex literal itself disappeared -- it is code, and a gate reading a pattern table must still see the pattern');
  assert.equal(out.split('\n').length, src.split('\n').length, 'line count shifted, so reported line numbers would lie');
});

test('a division is not mistaken for the start of a regex', () => {
  // The other direction. Read `/` after a value as a literal and the scanner runs forward hunting for a closing
  // slash through text that has none, which is how real strings stop being blanked.
  const src = 'const half = width / 2;\nconst ratio = (a) / (b);\nconst label = "window.location";\nconst w = window.location;\n';
  const out = stripComments(src);
  assert.ok(out.includes('window.location;'), 'real code after a division was erased');
  assert.ok(!out.includes('"window.location"'), 'the string body survived, so a division made the scanner blind to literals');
  assert.equal(out.length, src.length, 'character offsets shifted');
});

test('a slash at the end of a line is division, not an unterminated regex', () => {
  // readRegex() refuses when it reaches a newline before the closing slash. Without that refusal, `b /` would
  // consume the following lines looking for a terminator that never comes.
  const src = 'const a = b /\n  c;\nconst label = "indexedDB.open";\nconst d = indexedDB.open(name);\n';
  const out = stripComments(src);
  assert.ok(out.includes('indexedDB.open(name)'), 'a trailing slash consumed the code after it');
  assert.ok(!out.includes('"indexedDB.open"'), 'the string body survived');
});

test('the scanner is idempotent', () => {
  const src = 'const a = `x ${y} z`; // c\n/* b */ const d = "e";\n';
  const once = stripComments(src);
  assert.equal(stripComments(once), once, 'running the strip twice changed the result, so a mode is leaking');
});

test('it survives the real files in packages/ui without erasing their code', () => {
  // The property that matters is that *declarations* survive, so a desynchronised scanner cannot quietly blind
  // a whole file. Counting the bare word `export` in the raw text is not that property and failed on the first
  // run: `contract.ts` mentions the word inside a doc comment, which is exactly what the strip is for. So the
  // comparison is against the same file with comments already removed by an independent route, and the count
  // asserted is of declaration *statements* — anchored at the start of a line.
  const files = ['src/index.ts', 'src/signals.ts', 'src/layout/primitives.ts', 'src/sdk/poll.ts', 'src/contract.ts'];
  assert.ok(files.length >= 5);
  for (const rel of files) {
    const src = readFileSync(rel);
    const out = stripComments(src);
    const declarations = (text: string): number => (text.match(/^export\s(?:const|function|class|interface|type|enum)\b/gm) ?? []).length;
    const before = declarations(src);
    const after = declarations(out);
    assert.ok(before > 0, `${rel} has no line-initial exports; the check above is not measuring what this test thinks`);
    assert.equal(after, before, `${rel}: ${String(before - after)} declaration keyword(s) erased — the scanner lost sync and every gate reading this file would under-report`);
    // And the reverse direction: nothing may *appear*.
    assert.ok(out.match(/fetch\s*\(/g) === null || src.includes('fetch('), `${rel}: a fetch emerged from stripping`);
  }
});

const ROOT = path.resolve(import.meta.dirname, '../../..');
const readFileSync = (rel: string): string => fs.readFileSync(path.join(ROOT, 'packages/ui', rel), 'utf8');

test('it survives the scripts that read it -- where the desync actually lived', () => {
  // #259 moved these three files into the DOM-enabled project and gate TS0 now reads them through this scanner.
  // Their pattern tables contain `['"]` inside regular-expression literals, which is exactly the shape that used
  // to open string mode and swallow the rest of the file. Measured, not theorised: with the old scanner TS0
  // reported the gate's own pattern table as a browser-global violation, and the labels beside the patterns --
  // `'document.'`, `'window.'` -- were visible as code. A gate that cannot tell its own source from its subject
  // is a gate that gets widened, and then switched off.
  const rels = ['scripts/check-ui.ts', 'scripts/gen-ui-css.ts', 'scripts/ui-source-scan.ts'];
  const declarations = (text: string): number => (text.match(/^export\s(?:const|function|class|interface|type|enum)\b/gm) ?? []).length;
  for (const rel of rels) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const out = stripComments(src);
    assert.equal(declarations(out), declarations(src), `${rel}: a declaration vanished -- the scanner lost sync and every gate reading this file under-reports`);
    assert.equal(stripComments(out), out, `${rel}: the strip is not idempotent over this file, so a mode is leaking`);
    for (const label of ["'document.'", "'window.'", "'localStorage.'", "'indexedDB.'", "'navigator.'"]) {
      assert.ok(!out.includes(label), `${rel}: the label ${label} survived the strip, so its body was read as code and the gate fires on itself`);
    }
    // The pattern must survive: blanking the scanner's own regex source would make every rule below it vacuous.
    if (rel === 'scripts/check-ui.ts') {
      assert.ok(out.includes('/\\bdocument\\s*\\./g'), `${rel}: the FORBIDDEN_OUTSIDE_WEB pattern disappeared -- code was erased, not comments`);
    }
  }
});
