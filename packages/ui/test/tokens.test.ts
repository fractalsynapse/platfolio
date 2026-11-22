import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CONTRAST_PAIRS, DARK, LIGHT, PALETTES, renderTokensCss, SPACING, TOUCH, TYPE, type ColorRole } from '../src/tokens.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_REL = 'packages/ui/src/tokens.css';
const SOURCE_REL = 'packages/ui/src/tokens.ts';

/**
 * Recomputed here rather than imported from the emitter. `tokens.ts` must not read the filesystem to describe
 * itself — a module that emits a stylesheet should not need `node:fs`, and the last test in this file asserts
 * that it does not. So the digest is the consumer's job, exactly as `gen-ui-css.ts` treats it.
 */
const digestOf = (rel: string): string =>
  `sha256/${createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16)}`;

/**
 * The stylesheet is generated, so the same byte-for-byte discipline `api:types:check` holds the API types to
 * applies here — and lives in the test suite as well as in the script, for the reason `generated-types.test.ts`
 * gives: `pnpm run test` must not pass on a tree where the committed CSS no longer comes from the committed
 * token module.
 */
test('the committed tokens.css reproduces from the token module, byte for byte', () => {
  const committed = fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8');
  const regenerated = renderTokensCss(digestOf(SOURCE_REL));
  if (committed !== regenerated) {
    const a = committed.split('\n');
    const b = regenerated.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    assert.fail(
      `${OUT_REL} does not reproduce from packages/ui/src/tokens.ts. First difference at line ${String(i + 1)}:\n`
      + `  committed: ${JSON.stringify(a[i])}\n  generated: ${JSON.stringify(b[i])}\n`
      + 'Run `pnpm run ui:css` and commit the regenerated file with the token change it came from.',
    );
  }
  assert.match(committed, /GENERATED FILE -- DO NOT EDIT/);
});

test('the digest in the header is recomputed, not parsed back out of the file', () => {
  // The same reasoning as generated-types.test.ts: a header edited to match a stale input is exactly how a
  // generated file keeps looking current after its source moved.
  const committed = fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8');
  const digest = digestOf(SOURCE_REL);
  assert.ok(committed.includes(`Input digest: ${digest}`), `header does not name this source (expected ${digest})`);
  const changed = renderTokensCss('sha256/0000000000000000');
  assert.notEqual(changed, committed, 'the digest is decoration if changing it does not change the output');
});

test('generation is deterministic and total over the token data', () => {
  const a = renderTokensCss('sha256/x');
  assert.equal(a, renderTokensCss('sha256/x'), 'two runs in one process must agree');
  for (const palette of PALETTES) {
    for (const role of Object.keys(palette.colors) as ColorRole[]) {
      assert.ok(a.includes(`--ui-color-${role}: ${palette.colors[role].value};`), `no declaration emitted for ${palette.scheme}.${role}`);
    }
  }
  for (const step of Object.keys(SPACING)) assert.ok(a.includes(`--ui-space-${step}:`), `spacing ${step} missing`);
  for (const step of Object.keys(TYPE)) {
    assert.ok(a.includes(`--ui-font-${step}:`), `font ${step} missing`);
    assert.ok(a.includes(`--ui-leading-${step}:`), `leading ${step} missing`);
  }
});

test('every token declaration uses the one namespace', () => {
  const css = renderTokensCss('sha256/x');
  const customProps = [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string);
  assert.ok(customProps.length > 30, `only ${String(customProps.length)} custom properties emitted — the walk is not finding them`);
  const stray = customProps.filter((n) => !n.startsWith('--ui-'));
  assert.deepEqual(stray, [], `tokens outside the --ui- namespace: ${stray.join(', ')}`);
});

test('the touch-target minimums 11 §8 names are in the stylesheet', () => {
  const css = renderTokensCss('sha256/x');
  assert.equal(TOUCH.targetPrimary, '44px', 'primary touch target is WCAG-independent here: 11 §8 chooses 44 because the primary surface is the phone');
  assert.equal(TOUCH.targetSecondary, '24px', '24 px is the WCAG 2.2 §2.5.8 floor');
  assert.ok(css.includes(`--ui-target-primary: 44px;`), 'the 44 px minimum is not reaching CSS');
  assert.ok(css.includes(`--ui-gap-secondary: 8px;`), 'the 8 px secondary spacing is not reaching CSS');
});

test('spacing and type are rem, so 200 % text scaling actually scales them (11 §8)', () => {
  for (const [step, value] of Object.entries(SPACING)) {
    assert.match(value, /rem$/, `--ui-space-${step} is ${value}: a px gap does not grow with the user font and the layout that "holds" at 16 px clips at 32`);
  }
  for (const [step, t] of Object.entries(TYPE)) {
    assert.match(t.size, /rem$/, `--ui-font-${step} is px`);
    assert.match(t.line, /rem$/, `--ui-leading-${step} is px`);
  }
});

test('there is exactly one light and one dark palette, and both are emitted', () => {
  assert.deepEqual(PALETTES.map((p) => p.scheme), ['light', 'dark']);
  const css = renderTokensCss('sha256/x');
  // The dark values must be inside the prefers-color-scheme block, which is the only window query this package
  // is allowed: 11 §2 acceptance (a) names `prefers-*` as the exception to the no-@media rule.
  const block = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'no prefers-color-scheme: dark block');
  for (const role of Object.keys(DARK.colors) as ColorRole[]) {
    assert.ok(block[1]?.includes(`--ui-color-${role}: ${DARK.colors[role].value};`), `dark ${role} not inside the dark block`);
  }
  for (const role of Object.keys(LIGHT.colors) as ColorRole[]) {
    assert.ok(!block[1]?.includes(`--ui-color-${role}: ${LIGHT.colors[role].value};`) || DARK.colors[role].value === LIGHT.colors[role].value,
      `light ${role} leaked into the dark block`);
  }
});

test('the token module declares no browser or Node surface of its own', () => {
  // It emits a stylesheet; it does not read one. D63 puts tokens in this package, which means the package that
  // owns the facts must not be the package that touches a DOM to publish them.
  const src = fs.readFileSync(path.join(ROOT, 'packages/ui/src/tokens.ts'), 'utf8');
  for (const forbidden of ['node:fs', 'node:path', 'document.', 'window.', 'localStorage']) {
    assert.ok(!src.includes(forbidden), `tokens.ts mentions ${forbidden}`);
  }
});

test('CONTRAST_PAIRS covers every text-role colour in both schemes, so no pair is skipped by omission', () => {
  const covered = new Set(CONTRAST_PAIRS.map((p) => `${p.foreground}/${p.background}`));
  for (const palette of PALETTES) {
    for (const role of Object.keys(palette.colors) as ColorRole[]) {
      if (palette.colors[role].contrast !== 'text') continue;
      const onBg = covered.has(`${role}/bg`);
      const onAccent = covered.has(`${role}/accent`) || role === 'onAccent';
      assert.ok(onBg || onAccent, `${palette.scheme}: text-role colour ${role} has no listed pair — it would pass the contrast test by never being asked`);
    }
  }
  // The decorative roles are labelled, not silently absent: a role that owes nothing says so.
  assert.equal(LIGHT.colors.border.contrast, 'decorative', 'border is a hairline, not an indicator; mislabelling it is how a 1.4:1 colour inherits a 3:1 duty');
});
