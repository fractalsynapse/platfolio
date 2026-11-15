import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTRAST_PAIRS, PALETTES, type ColorRole, type TokenPalette } from '../src/tokens.ts';

/**
 * The a11y claim in 11 §8 is arithmetic, so it is checked as arithmetic: "tokens ship AA contrast for text and
 * 3:1 for non-text indicators" is a sentence a designer can write and a palette can violate. Nothing here needs
 * a browser, which is why it runs today while §9.8's axe pass is reported NOT RUN.
 *
 * The ratios are computed from the hex values in `tokens.ts` — the generated CSS is not re-read, and no expected
 * ratio is stored anywhere. Storing the measured number would be a second description of the palette: the colour
 * would move, the recorded ratio would not, and the test would certify a value nobody has since measured.
 */

function channel(linear8: number): number {
  const s = linear8 / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const v = hex.replace('#', '');
  assert.match(v, /^[0-9a-fA-F]{6}$/, `"${hex}" is not a 6-digit hex colour; a 3-digit or 8-digit form would silently compute the wrong ratio`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(v.slice(i, i + 2), 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG 2.x §1.4.3 contrast ratio. */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

for (const palette of PALETTES as TokenPalette[]) {
  for (const pair of CONTRAST_PAIRS) {
    const fg = palette.colors[pair.foreground as ColorRole];
    const bg = palette.colors[pair.background as ColorRole];
    const measured = contrastRatio(fg.value, bg.value);
    test(`${palette.scheme}: ${pair.foreground} on ${pair.background} clears ${pair.minimum.toFixed(2)}:1 (${pair.why})`, () => {
      assert.ok(
        measured >= pair.minimum,
        `${palette.scheme} ${pair.foreground}(${fg.value}) on ${pair.background}(${bg.value}) measures ${measured.toFixed(2)}:1, below the ${pair.minimum.toFixed(2)}:1 this pair requires — ${pair.why}`,
      );
      // A pair set far above its floor is worth naming too: it usually means the minimum was typed in without
      // being looked up, and the next "tighten the palette" edit will move one of them without noticing.
      if (measured > pair.minimum + 8) {
        assert.ok(pair.minimum >= 3, `${pair.foreground} on ${pair.background} measures ${measured.toFixed(2)}:1 against a floor of ${pair.minimum.toFixed(2)}:1 — check the floor is the intended one`);
      }
    });
  }
}

test('the ratio function is pinned against a known value, so a wrong formula cannot pass every pair', () => {
  // #000 on #fff is the one contrast figure that is not in dispute: WCAG defines it as 21:1. A test that only
  // compares palette entries to each other would pass under a formula that always returned, say, 12 — every
  // pair would clear a 4.5 floor and the whole suite would be fiction. This is the assertion that makes the
  // numbers above mean what they say.
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), 21, 'the ratio is symmetric');
  assert.equal(contrastRatio('#777777', '#777777'), 1, 'identical colours are 1:1, not 0:1');
  // And a mid grey, checked by hand against the spec's worked example, so the exponent is right and not merely
  // monotonic.
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.02, `expected ~4.48:1, got ${contrastRatio('#777777', '#ffffff').toFixed(3)}`);
});

test('every palette declares the same roles in both schemes', () => {
  const [light, dark] = PALETTES;
  assert.ok(light && dark, 'expected exactly two palettes');
  assert.deepEqual(Object.keys(dark.colors), Object.keys(light.colors), 'a role exists in one scheme and not the other, so one scheme renders undefined colours');
  for (const role of Object.keys(light.colors) as ColorRole[]) {
    assert.equal(dark.colors[role].contrast, light.colors[role].contrast, `${role}: the two schemes disagree about what the colour owes the reader`);
  }
});

test('no text-role colour is exempted from a listed pair, and no decorative colour claims one', () => {
  // The failure this guards is omission, not measurement: a new `focus` role that no CONTRAST_PAIRS entry
  // mentions would never be measured at all, and the suite above would still report every pair passing.
  const foregrounds = new Set(CONTRAST_PAIRS.map((p) => p.foreground));
  for (const palette of PALETTES) {
    for (const role of Object.keys(palette.colors) as ColorRole[]) {
      const obligation = palette.colors[role].contrast;
      if (obligation === 'decorative') {
        assert.ok(role === 'bg' || role === 'surface' || role === 'border',
          `${palette.scheme}.${role} is labelled decorative but is not one of the three roles that carry no duty — relabel it or list its pair`);
        continue;
      }
      assert.ok(foregrounds.has(role), `${palette.scheme}.${role} is labelled "${obligation}" and appears in no CONTRAST_PAIRS entry, so it is measured by nobody`);
      const required = obligation === 'text' ? 4.5 : 3;
      const strongest = Math.max(...CONTRAST_PAIRS.filter((p) => p.foreground === role).map((p) => p.minimum));
      assert.ok(strongest >= required,
        `${palette.scheme}.${role} is a ${obligation} role but its listed pairs only require ${strongest.toFixed(2)}:1, below the ${required.toFixed(2)}:1 that label means`);
    }
  }
});
