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
  {
    selector: '.ui-workspace',
    declarations: ['font-family: system-ui, sans-serif;', 'outline: none;'],
    why: 'Use the platform UI font for the workspace and announce route changes by moving focus to its root.',
  },
  {
    selector: '.ui-workspace-header',
    declarations: [
      'display: flex;', 'align-items: center;', 'justify-content: space-between;', 'gap: var(--ui-space-3);',
      'padding: var(--ui-space-3) max(var(--ui-space-4), calc((100% - 68rem) / 2));',
      'background: var(--ui-color-surface);', 'border-block-end: 1px solid var(--ui-color-border);',
    ],
    why: 'The logo and the two context controls share one bar at every width.',
  },
  {
    selector: '.ui-workspace-tools',
    declarations: ['display: flex;', 'align-items: center;', 'gap: var(--ui-space-2);', 'min-inline-size: 0;'],
    why: 'Keep switching teams and account actions beside one another.',
  },
  {
    selector: '.ui-workspace-menu',
    declarations: ['position: relative;', 'min-inline-size: 0;'],
    why: 'Anchor each disclosure to its own trigger.',
  },
  {
    selector: '.ui-workspace-trigger',
    declarations: [
      'display: inline-flex;', 'align-items: center;', 'gap: var(--ui-space-3);', 'padding-inline: var(--ui-space-3);',
      'max-inline-size: 100%;', 'background: var(--ui-color-surface);', 'color: var(--ui-color-text);',
      'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-3);', 'font: inherit;',
      'font-weight: var(--ui-weight-title);', 'font-size: var(--ui-font-label);', 'cursor: pointer;',
    ],
    why: 'Give each workspace action a matching, readable control.',
  },
  {
    selector: '.ui-workspace-team-label',
    declarations: ['max-inline-size: min(12rem, 32vw);', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;'],
    why: 'Long team names leave space for the account button and are shown in full in the selector.',
  },
  {
    selector: '.ui-workspace-mark',
    declarations: ['display: grid;', 'place-items: center;', 'inline-size: 1.5em;', 'aspect-ratio: 1;', 'background: var(--ui-color-accent);', 'color: var(--ui-color-onAccent);', 'border-radius: var(--ui-space-2);'],
    why: 'Identify Platfolio with its own simple wordmark and accent.',
  },
  {
    selector: '.ui-workspace-avatar',
    declarations: ['display: grid;', 'place-content: center;', 'justify-items: center;', 'gap: 0.1em;', 'inline-size: 1.5em;', 'aspect-ratio: 1;', 'margin-inline: auto;', 'border-radius: 50%;', 'background: var(--ui-color-border);', 'color: var(--ui-color-textMuted);'],
    why: 'Give the account menu a compact fallback avatar.',
  },
  {
    selector: '.ui-workspace-avatar-head',
    declarations: ['inline-size: 0.4em;', 'aspect-ratio: 1;', 'border-radius: 50%;', 'background: currentColor;'],
    why: 'Form the head of a generic account icon.',
  },
  {
    selector: '.ui-workspace-avatar-body',
    declarations: ['inline-size: 0.8em;', 'block-size: 0.35em;', 'border-radius: 0.4em 0.4em 0 0;', 'background: currentColor;'],
    why: 'Form the shoulders of the account icon.',
  },
  {
    selector: '.ui-workspace-popover',
    declarations: [
      'position: absolute;', 'z-index: 1;', 'inset-block-start: 100%;', 'inset-inline-start: 0;', 'inline-size: max-content;',
      'min-inline-size: 11rem;', 'max-inline-size: min(19rem, 75vw);', 'max-block-size: min(22rem, 65vh);', 'overflow: auto;',
      'padding: var(--ui-space-2);', 'background: var(--ui-color-surface);', 'border: 1px solid var(--ui-color-border);',
      'border-radius: var(--ui-space-3);', 'font-size: var(--ui-font-label);',
    ],
    why: 'Use the control’s surface, border, and typography in its popup.',
  },
  {
    selector: '.ui-workspace-popover-end',
    declarations: ['inset-inline-start: auto;', 'inset-inline-end: 0;'],
    why: 'Keep right-hand disclosures within the screen.',
  },
  {
    selector: '.ui-workspace-menu-section',
    declarations: ['border-block-start: 1px solid var(--ui-color-border);', 'margin-block-start: var(--ui-space-2);', 'padding-block-start: var(--ui-space-2);'],
    why: 'Distinguish workspace actions from global links.',
  },
  {
    selector: '.ui-workspace-item',
    declarations: [
      'display: flex;', 'align-items: center;', 'inline-size: 100%;', 'padding: var(--ui-space-2) var(--ui-space-3);',
      'border: 0;', 'border-radius: var(--ui-space-2);', 'background: transparent;', 'font: inherit;',
      'color: var(--ui-color-text);', 'text-align: start;', 'text-decoration: none;', 'overflow-wrap: anywhere;',
    ],
    why: 'Links and actions share a predictable target and alignment.',
  },
  {
    selector: '.ui-workspace-main',
    declarations: ['inline-size: min(100%, 70rem);', 'margin-inline: auto;', 'padding: var(--ui-space-5) var(--ui-space-4) var(--ui-space-9);', 'outline: none;'],
    why: 'Give workspace pages a comfortable shared measure.',
  },
  {
    selector: '.ui-workspace-crumbs',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: var(--ui-space-2);', 'list-style: none;', 'margin: 0;', 'padding: 0;', 'font-size: var(--ui-font-caption);', 'color: var(--ui-color-textMuted);', 'overflow-wrap: anywhere;'],
    why: 'Let shallow breadcrumbs wrap without obscuring the selected context.',
  },
  {
    selector: '.ui-workspace-crumbs li',
    declarations: ['display: inline-flex;', 'gap: var(--ui-space-2);', 'min-inline-size: 0;'],
    why: 'Keep separators with their labels.',
  },
  {
    selector: '.ui-workspace-heading',
    declarations: ['display: flex;', 'align-items: baseline;', 'justify-content: space-between;', 'flex-wrap: wrap;', 'gap: var(--ui-space-2) var(--ui-space-4);'],
    why: 'Keep the observation time next to the data heading.',
  },
  {
    selector: '.ui-workspace-list',
    declarations: ['margin: 0;', 'padding: 0;', 'list-style: none;', 'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-3);', 'overflow: hidden;'],
    why: 'Use a single bordered surface for related workspace rows.',
  },
  {
    selector: '.ui-workspace-list li + li',
    declarations: ['border-block-start: 1px solid var(--ui-color-border);'],
    why: 'Separate the targets visually while keeping the list compact.',
  },
  {
    selector: '.ui-workspace-row',
    declarations: ['display: flex;', 'align-items: center;', 'justify-content: space-between;', 'gap: var(--ui-space-3);', 'flex-wrap: wrap;', 'padding: var(--ui-space-3) var(--ui-space-4);', 'color: var(--ui-color-text);', 'text-decoration: none;', 'overflow-wrap: anywhere;'],
    why: 'Let the entire row open its team, app, or environment.',
  },
  {
    selector: '.ui-workspace-item:hover, .ui-workspace-item:focus-visible, .ui-workspace-row:hover, .ui-workspace-row:focus-visible',
    declarations: ['background: var(--ui-color-bg);', 'text-decoration: underline;', 'outline-offset: -2px;'],
    why: 'Treat keyboard focus and pointer feedback consistently.',
  },
  {
    selector: '.ui-workspace-trigger:focus-visible, .ui-workspace-primary:focus-visible',
    declarations: ['outline: 2px solid var(--ui-color-accent);', 'outline-offset: 2px;'],
    why: 'Keep the focus indicator visible on both control surfaces.',
  },
  {
    selector: '.ui-workspace-meta',
    declarations: ['color: var(--ui-color-textMuted);', 'font-size: var(--ui-font-caption);'],
    why: 'Display secondary metadata and observation age with a readable token pair.',
  },
  {
    selector: '.ui-workspace-empty',
    declarations: ['padding: var(--ui-space-5);', 'border: 1px dashed var(--ui-color-border);', 'border-radius: var(--ui-space-3);', 'color: var(--ui-color-textMuted);'],
    why: 'Reserve space for the healthy empty state.',
  },
  {
    selector: '.ui-workspace-facts',
    declarations: ['display: grid;', 'gap: var(--ui-space-3);', 'overflow-wrap: anywhere;'],
    why: 'Keep reported environment fields legible on narrow screens.',
  },
  {
    selector: '.ui-workspace-facts dd',
    declarations: ['margin-inline-start: 0;'],
    why: 'Align values beneath their labels.',
  },
  {
    selector: '.ui-workspace-entry',
    declarations: ['margin: var(--ui-space-8) auto;', 'inline-size: min(calc(100% - 2rem), 28rem);', 'padding: var(--ui-space-6);', 'background: var(--ui-color-surface);', 'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-4);', 'font-family: system-ui, sans-serif;'],
    why: 'Give the sign-in transition a simple, portable surface.',
  },
  {
    selector: '.ui-workspace-entry-brand',
    declarations: ['margin: 0;', 'font-weight: var(--ui-weight-title);', 'color: var(--ui-color-accent);'],
    why: 'Keep the Platfolio name visible during authentication.',
  },
  {
    selector: '.ui-workspace-primary',
    declarations: ['padding-inline: var(--ui-space-5);', 'background: var(--ui-color-accent);', 'color: var(--ui-color-onAccent);', 'border: 0;', 'border-radius: var(--ui-space-3);', 'font: inherit;', 'cursor: pointer;'],
    why: 'Use the strong accent for the next step.',
  },
  {
    selector: '.ui-workspace-skip',
    declarations: ['position: absolute;', 'z-index: 2;', 'transform: translateY(-200%);', 'padding: var(--ui-space-3);', 'background: var(--ui-color-bg);'],
    why: 'Offer a keyboard shortcut to the page content.',
  },
  {
    selector: '.ui-workspace-skip:focus',
    declarations: ['transform: none;'],
    why: 'Reveal the shortcut when reached by keyboard.',
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
