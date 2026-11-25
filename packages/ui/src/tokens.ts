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
    bg: c('#f5f7fa', 'decorative', 'Workspace canvas from the mockup.'),
    surface: c('#ffffff', 'decorative', 'Header and raised panels.'),
    text: c('#202c3d', 'text', 'Primary text on bg and surface.'),
    textMuted: c('#495b71', 'text', 'Secondary text, labels and timestamps.'),
    border: c('#ccd5e0', 'decorative', 'Hairline separation.'),
    accent: c('#1755a0', 'text', 'Links and keyboard focus.'),
    onAccent: c('#ffffff', 'text', 'Foreground on an accent-filled surface.'),
    ok: c('#195a3c', 'text', 'Successful status.'),
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

/**
 * Line measures (D63: the value lives here, and `layout/content.ts` is the only thing that references it).
 *
 * `ch`, not `rem` or `px`, because a readable line is a count of *characters*: `ch` is the advance width of the
 * `0` glyph in the element's resolved font, so the measure holds when the typeface or the user's font size
 * changes and a fixed width does not.
 *
 * Provenance, stated because there is no in-repo authority for the number: 11 §8 mandates touch targets, focus
 * order and screen-reader semantics, and says nothing about line length. `68ch` is what
 * `apps/site/src/styles/site.css` shipped by hand before this token existed, and #267 item 5 moved it without
 * changing what the page renders -- the difference between a value a page chose and a value the design system
 * owns. The 60–75 character convention it sits inside is general typography, recorded here as context rather
 * than cited as a decision this project made.
 *
 * One role, on purpose. A second measure needs a second page that needs it, and `layout/content.ts` is where a
 * third content primitive would have to be declared before any stylesheet could name one.
 */
export const MEASURE = { content: '68ch' } as const;
export type MeasureRole = keyof typeof MEASURE;

/** The custom-property name for a measure role, spelled the way `colorVar` spells a colour role. */
export function measureVar(role: MeasureRole): string {
  return `--ui-measure-${role}`;
}

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
  lines.push(`${indent}--ui-font-family-system: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;`);
  lines.push(`${indent}--ui-workspace-width: 82rem;`);
  lines.push(`${indent}--ui-color-brand: #253a58;`);
  lines.push(`${indent}--ui-color-action: #206843;`);
  lines.push(`${indent}--ui-color-action-hover: #185638;`);
  lines.push(`${indent}--ui-color-accent-surface: #e9f1fd;`);
  lines.push(`${indent}--ui-color-check-surface: #e6f4eb;`);
  lines.push(`${indent}--ui-color-context: #f8fafd;`);
  lines.push(`${indent}--ui-color-control-border: #a7b5c6;`);
  lines.push(`${indent}--ui-panel-shadow: 0 1px 2px #192e4710;`);
  lines.push(`${indent}--ui-menu-shadow: 0 0.5rem 1rem #20354c20;`);
  for (const role of Object.keys(MEASURE) as MeasureRole[]) lines.push(`${indent}${measureVar(role)}: ${MEASURE[role]};`);
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
  :root:not([data-ui-scheme="light"]) {
    color-scheme: dark;

${colorDeclarations(dark, '    ')}
  }
}
`;
}
