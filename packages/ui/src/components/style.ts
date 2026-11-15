import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * The component stylesheet, generated from this module the same way `tokens.css` is generated from
 * `tokens.ts` (D63: one package owns components *and* the CSS they need, and a stylesheet beside a module is two
 * descriptions of one fact unless one of them is an artifact).
 *
 * Why this exists at all: 11 §8 sets a floor in numbers -- primary targets at least 44×44 CSS px, secondary at
 * 24 with 8 between -- and `tokens.ts` carries those as `--ui-target-primary`, `--ui-target-secondary` and
 * `--ui-gap-secondary`. A token nobody references is a wish. The rules below are the only place in this package
 * that references them, so "the hit-target minimum comes from the tokens" is a statement about generated CSS
 * rather than about intent, and a gate can read it.
 *
 * `box-sizing: border-box` is stated rather than assumed, because a minimum that the padding eats is not a
 * minimum. `min-inline-size`/`min-block-size` rather than `width`/`height` so the floor survives the 200 % text
 * scaling 11 §8 requires layouts to hold at.
 *
 * What this file cannot prove, and the change notes say so: a static markup test shows that an element carries
 * the class. It cannot show the box the browser ends up painting -- that is 11 §9.8's target-size audit and it
 * needs a layout engine, so it is reported NOT RUN rather than redefined as a passed gate.
 */

export interface ComponentRule {
  readonly selector: `.${string}`;
  readonly declarations: readonly string[];
  readonly why: string;
}

/** The classes a component may attach, each with the reason it exists. One list; the CSS is emitted from it. */
export const COMPONENT_RULES = [
  {
    selector: '.ui-hit-primary',
    declarations: [
      'box-sizing: border-box;',
      'min-inline-size: var(--ui-target-primary);',
      'min-block-size: var(--ui-target-primary);',
    ],
    why: '11 §8: the primary surface is the phone, so a row, a select and the action a person aims at are 44 CSS px before anything else is decided.',
  },
  {
    selector: '.ui-hit-secondary',
    declarations: [
      'box-sizing: border-box;',
      'min-inline-size: var(--ui-target-secondary);',
      'min-block-size: var(--ui-target-secondary);',
      'gap: var(--ui-gap-secondary);',
    ],
    why: 'Secondary controls clear WCAG 2.2 §2.5.8 at 24 px with 8 px between, which is the floor 11 §8 states rather than a number invented here.',
  },
  {
    selector: '.ui-age',
    declarations: ['color: var(--ui-color-textMuted);'],
    why: 'Rule 5: the age label is load-bearing, not caption decoration, and `textMuted` on `surface` is a listed contrast pair rather than a grey someone picked.',
  },
  {
    selector: '.ui-age--doubtful',
    declarations: ['color: var(--ui-color-warn);'],
    why: 'An observation older than the interval that keeps it current changes colour *and* keeps its words: 11 §8 says an error is never colour alone, and neither is a doubt.',
  },
  {
    selector: '.ui-list',
    declarations: ['list-style: none;', 'margin: 0;', 'padding: 0;'],
    why: 'The row list is a `ul` for the screen reader and a plain column for the layout; resetting the marker is the only way both are true at once.',
  },
  {
    selector: '.ui-state',
    declarations: ['color: var(--ui-color-text);'],
    why: 'The state word is text on purpose. Tone arrives as a word first and a colour second, which is the difference between a state and a dot.',
  },
  {
    selector: '.ui-selected',
    declarations: ['border-inline-start: 0.25rem solid var(--ui-color-accent);'],
    why: 'The selected row is marked by an edge and by `aria-current`, not by colour alone.',
  },
  {
    selector: '.ui-sr-only',
    declarations: [
      'inline-size: 1px;',
      'block-size: 1px;',
      'overflow: hidden;',
      'clip-path: inset(50%);',
      'position: absolute;',
      'white-space: nowrap;',
    ],
    why: 'The explanation that belongs to a screen reader and not to the layout. 11 §8: errors are text, never colour alone -- and some of that text has to be said without pushing a column apart.',
  },
] as const satisfies readonly ComponentRule[];

/** The class names a component in this package is allowed to use. Read by `test/components.test.ts`. */
export const COMPONENT_CLASSES = COMPONENT_RULES.map((rule) => rule.selector.slice(1));

export function isComponentClass(name: string): boolean {
  return (COMPONENT_CLASSES as readonly string[]).includes(name);
}

/**
 * The one emitter. `src/components/components.css` is its output, `scripts/gen-ui-css.ts` is the only caller
 * that writes, and `pnpm run ui:css:check` fails when the committed file stops matching this module -- the same
 * discipline `api:types:check` holds the generated contract to, for the same reason: a generated artifact nobody
 * can prove still reproduces is a second description of the thing it claims to describe.
 *
 * No width `@media` appears here and none may be added: a breakpoint is a property of a layout primitive
 * (`layout/primitives.ts`, generated into `layout.css`), never of a component class.
 */
export function renderComponentCss(digest: string): string {
  const blocks = COMPONENT_RULES.map((rule) => {
    const declarations = rule.declarations.map((line) => `  ${line}`).join('\n');
    return `/* ${rule.why} */\n${rule.selector} {\n${declarations}\n}`;
  }).join('\n\n');

  return `/*
 * GENERATED FILE -- DO NOT EDIT. The writer is \`renderComponentCss()\` in
 * packages/ui/src/components/style.ts and it is the only one.
 *
 * Source: packages/ui/src/components/style.ts
 * Input digest: ${digest}
 *
 * Reproduce with \`pnpm run ui:css\`; \`pnpm run ui:css:check\` fails when this stops matching the module. The
 * numbers in here are not literals: they reference the custom properties in ../tokens.css, which is what makes
 * 11 §8's hit-target floor a token fact rather than a duplicated measurement (D63). No width \`@media\` query
 * appears in this file -- a threshold belongs to a layout primitive's \`@container\` rule, and gate §9.3 audits
 * both sheets for the difference.
 */

${blocks}
`;
}

/** The same StandardSchema question `contract.ts` asks, kept local so the components file does not import a gate. */
export type PropsSchema<T> = StandardSchemaV1<unknown, T>;
