/**
 * Design tokens (D63: they live here, in `packages/ui`, not in a `packages/tokens`).
 *
 * **This module is the source of truth and `src/tokens.css` is generated from it.** They are not two files kept
 * in step: `renderTokensCss()` below is the only writer, `scripts/gen-ui-css.ts` is the only caller that writes,
 * and `packages/ui/test/tokens-css.test.ts` regenerates the text and compares it byte for byte. A hand edit to
 * the CSS is a gate failure, exactly as a hand edit to `packages/api-contract/src/generated/types.ts` is.
 *
 * Values are not taste. Every colour pair in `CONTRAST_PAIRS` is checked against WCAG 2.2 in
 * `test/contrast.test.ts`, and the touch-target numbers are the minimums named in
 * [11 §8](../../../docs/design/11-ui-components-and-page-model.md) — 44 px primary, 24 px secondary with 8 px
 * spacing. Changing one here changes the generated stylesheet; changing one *only* in the stylesheet does not
 * change anything, and fails.
 */

export type ColorRole =
  | 'bg' | 'surface' | 'text' | 'textMuted' | 'border' | 'accent' | 'onAccent'
  | 'ok' | 'warn' | 'danger' | 'info';

/**
 * `text` roles must clear 4.5:1 against their background; `indicator` roles must clear 3:1; `decorative` roles
 * carry no contrast obligation and are labelled as such rather than quietly skipped. The classification is the
 * data, so the test cannot be talked into forgiving a colour by re-reading it.
 */
export type ContrastRole = 'text' | 'indicator' | 'decorative';

export interface TokenColor {
  readonly value: string;
  readonly contrast: ContrastRole;
  readonly note: string;
}

export interface TokenPalette {
  readonly scheme: 'light' | 'dark';
  readonly colors: Readonly<Record<ColorRole, TokenColor>>;
}

const c = (value: string, contrast: ContrastRole, note: string): TokenColor => ({ value, contrast, note });

/**
 * The light palette. Hues chosen for contrast first: `text` on `bg` measures 18.11:1 and the weakest text pair
 * in the set is 5.02:1, both above the AA 4.5 floor `test/contrast.test.ts` enforces.
 */
export const LIGHT: TokenPalette = {
  scheme: 'light',
  colors: {
    bg: c('#ffffff', 'decorative', 'Page background. Nothing sits on text-coloured ground without a listed pair.'),
    surface: c('#f6f7f9', 'decorative', 'Raised panel: a card, a sheet body, a table.'),
    text: c('#14161a', 'text', 'Primary text on bg/surface.'),
    textMuted: c('#5b6472', 'text', 'Secondary text, labels, timestamps including every age label (rule 5).'),
    border: c('#d4d8e0', 'decorative', 'Hairline separation only. Not a state indicator — see `accent`.'),
    accent: c('#1c3faa', 'text', 'Links, focus rings, the primary action. Doubles as an indicator at 8.97:1.'),
    onAccent: c('#ffffff', 'text', 'Foreground on an accent-filled surface.'),
    ok: c('#15803d', 'text', 'A state word, so it must be readable as text, not just visible as a colour.'),
    warn: c('#b45309', 'text', 'Ditto. Errors are text, never colour alone (11 §8).'),
    danger: c('#b42318', 'text', 'Destructive actions and their confirmations.'),
    info: c('#0c6b6b', 'text', 'Neutral notice.'),
  },
};

/**
 * The dark palette. Chosen independently rather than by inverting the light one: an inverted hue is not an
 * inverted contrast ratio, and every pair here is measured by the same test.
 */
export const DARK: TokenPalette = {
  scheme: 'dark',
  colors: {
    bg: c('#101216', 'decorative', 'Page background.'),
    surface: c('#181b21', 'decorative', 'Raised panel.'),
    text: c('#f2f4f8', 'text', 'Primary text.'),
    textMuted: c('#a8b0be', 'text', 'Secondary text and age labels.'),
    border: c('#2c313a', 'decorative', 'Hairline separation only.'),
    accent: c('#7aa2ff', 'text', 'Links, focus, primary action.'),
    onAccent: c('#0b1020', 'text', 'Foreground on an accent-filled surface.'),
    ok: c('#6ee7a8', 'text', 'State word.'),
    warn: c('#fccf6d', 'text', 'State word.'),
    danger: c('#ff9b9b', 'text', 'Destructive.'),
    info: c('#5eead4', 'text', 'Notice.'),
  },
};

export const PALETTES: readonly TokenPalette[] = [LIGHT, DARK];

/** Foreground/background combinations the contrast test measures. Both directions are listed where they differ. */
export interface ContrastPair {
  readonly foreground: ColorRole;
  readonly background: ColorRole;
  readonly minimum: number;
  readonly why: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { foreground: 'text', background: 'bg', minimum: 4.5, why: 'body copy' },
  { foreground: 'text', background: 'surface', minimum: 4.5, why: 'copy on a raised panel' },
  { foreground: 'textMuted', background: 'bg', minimum: 4.5, why: 'the age label is load-bearing, not caption decoration (rule 5)' },
  { foreground: 'textMuted', background: 'surface', minimum: 4.5, why: 'an age label inside a sheet' },
  { foreground: 'accent', background: 'bg', minimum: 4.5, why: 'a link is text' },
  { foreground: 'accent', background: 'surface', minimum: 3, why: 'a focus ring is a non-text indicator' },
  { foreground: 'onAccent', background: 'accent', minimum: 4.5, why: 'the label on the primary action' },
  { foreground: 'ok', background: 'bg', minimum: 4.5, why: 'a state word' },
  { foreground: 'warn', background: 'bg', minimum: 4.5, why: 'a state word' },
  { foreground: 'danger', background: 'bg', minimum: 4.5, why: 'a state word' },
  { foreground: 'info', background: 'bg', minimum: 4.5, why: 'a notice' },
];

/**
 * Spacing and type are `rem`, not `px`, for a reason 11 §8 states as an acceptance criterion: layouts must hold
 * at 200 % text scaling. A rem scale grows with the user's font setting; a px scale does not, and the layout
 * that "holds" at 16 px is the one that clips at 32.
 *
 * The only px tokens are the touch targets, which are physical-size requirements (WCAG 2.5.8) and would be
 * wrong to scale with type.
 */
export const SPACING = {
  0: '0rem', 1: '0.125rem', 2: '0.25rem', 3: '0.5rem', 4: '0.75rem',
  5: '1rem', 6: '1.5rem', 7: '2rem', 8: '3rem', 9: '4rem',
} as const;
export type SpacingStep = keyof typeof SPACING;

/** Five steps is a type scale; more is an invitation to pick a number instead of a step. */
export const TYPE = {
  caption: { size: '0.8125rem', line: '1.25rem', weight: '400' },
  label: { size: '0.875rem', line: '1.25rem', weight: '500' },
  body: { size: '1rem', line: '1.5rem', weight: '400' },
  title: { size: '1.25rem', line: '1.75rem', weight: '600' },
  headline: { size: '1.5rem', line: '2rem', weight: '600' },
} as const;
export type TypeStep = keyof typeof TYPE;

/** 11 §8, verbatim in effect: 44 primary, 24 secondary with 8 between. */
export const TOUCH = {
  targetPrimary: '44px',
  targetSecondary: '24px',
  gapSecondary: '8px',
  /** Not from 11: the rules doc holds at 320 px, so the narrowest container a layout may assume. */
  minContainer: '320px',
} as const;

const prefix = (role: ColorRole): string => `--ui-color-${role}`;

/** The custom-property name for a colour role. One spelling, so no consumer may invent another. */
export function colorVar(role: ColorRole): string {
  return prefix(role);
}

function colorDeclarations(palette: TokenPalette, indent: string): string {
  return Object.entries(palette.colors)
    .map(([role, token]) => `${indent}${prefix(role as ColorRole)}: ${token.value};`)
    .join('\n');
}

function scalarDeclarations(indent: string): string {
  const lines: string[] = [];
  for (const [step, value] of Object.entries(SPACING)) lines.push(`${indent}--ui-space-${step}: ${value};`);
  for (const [step, t] of Object.entries(TYPE)) {
    lines.push(`${indent}--ui-font-${step}: ${t.size};`);
    lines.push(`${indent}--ui-leading-${step}: ${t.line};`);
    lines.push(`${indent}--ui-weight-${step}: ${t.weight};`);
  }
  lines.push(`${indent}--ui-target-primary: ${TOUCH.targetPrimary};`);
  lines.push(`${indent}--ui-target-secondary: ${TOUCH.targetSecondary};`);
  lines.push(`${indent}--ui-gap-secondary: ${TOUCH.gapSecondary};`);
  lines.push(`${indent}--ui-container-min: ${TOUCH.minContainer};`);
  return lines.join('\n');
}

/**
 * The one CSS emitter. `--ui-*` is the only namespace it writes, and the only thing it writes.
 *
 * The `color-scheme` declaration and the `prefers-color-scheme` block are the deliberate shape: **the only
 * window-level query in the whole package is a `prefers-*` one**, which 11 §2 acceptance (a) permits by name.
 * A `@media (width …)` here would be gate §9.3 failing on its own package, which is the point of generating
 * the file rather than hand-writing it.
 */
export function renderTokensCss(digest: string): string {
  const light = LIGHT, dark = DARK;
  return `/*
 * GENERATED FILE -- DO NOT EDIT. The writer is \`renderTokensCss()\` in packages/ui/src/tokens.ts and it is the
 * only one: this text is not worth editing by hand, because every line reproduces from the token module.
 *
 * Source: packages/ui/src/tokens.ts (the module you are reading; this file is its output)
 * Input digest: ${digest}
 *
 * Reproduce it with \`pnpm run ui:css\`. \`pnpm run ui:css:check\` fails when this file stops matching what the
 * token module produces -- the same discipline \`api:types:check\` holds the API types to, for the same reason:
 * a generated artifact nobody can prove still reproduces is a second description of the thing it claims to
 * describe.
 *
 * D63: design tokens are CSS custom properties inside \`packages/ui\`. There is no \`packages/tokens\`.
 */

:root {
  color-scheme: light;
${scalarDeclarations('  ')}

${colorDeclarations(light, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;

${colorDeclarations(dark, '    ')}
  }
}
`;
}
