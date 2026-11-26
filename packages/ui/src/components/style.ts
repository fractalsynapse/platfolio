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
    selector: '.ui-setup-steps',
    declarations: ['display: grid;', 'gap: var(--ui-space-4);', 'margin-block: var(--ui-space-4);'],
    why: 'Keep the connection cards in setup order at every width.',
  },
  {
    selector: '.ui-setup-panel',
    declarations: ['min-inline-size: 0;', 'padding: var(--ui-space-5);', 'background: var(--ui-color-surface);', 'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-4);', 'overflow-wrap: anywhere;'],
    why: 'Match the mockup’s reusable connection panels and keep long names within the card.',
  },
  {
    selector: '.ui-setup-status',
    declarations: ['display: inline-block;', 'padding: var(--ui-space-1) var(--ui-space-2);', 'border-radius: var(--ui-space-4);', 'background: var(--ui-color-bg);', 'color: var(--ui-color-textMuted);', 'font-size: var(--ui-font-caption);'],
    why: 'Keep setup status visible next to each card title.',
  },
  {
    selector: '.ui-setup-status[data-tone="success"]',
    declarations: ['background: color-mix(in srgb, var(--ui-color-ok) 12%, var(--ui-color-surface));', 'color: var(--ui-color-ok);'],
    why: 'Use the same readable success badge for verification and active rules.',
  },
  {
    selector: '.ui-setup-status[data-tone="attention"]',
    declarations: ['background: color-mix(in srgb, var(--ui-color-warn) 10%, var(--ui-color-surface));', 'color: var(--ui-color-warn);'],
    why: 'Identify a state that needs attention with a word and a tinted badge.',
  },
  {
    selector: '.ui-workspace-links',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: var(--ui-space-4);'],
    why: 'Place related workspace actions together at each supported width.',
  },
  {
    selector: '.ui-template-card',
    declarations: ['display: flex;', 'flex-direction: column;', 'block-size: 100%;', 'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-4);',
      'background: var(--ui-color-surface);', 'box-shadow: var(--ui-panel-shadow);', 'overflow: hidden;'],
    why: 'Keep the starter details and action on one bordered card.',
  },
  {
    selector: '.ui-template-card header',
    declarations: ['padding: 0.9rem 1.1rem 1rem;', 'color: var(--ui-color-template-ink);',
      'background: linear-gradient(125deg, var(--ui-color-template-web-start), var(--ui-color-template-web-end));'],
    why: 'Use the mockup’s template gradient and foreground.',
  },
  {
    selector: '.ui-template-card[data-category="background-workers"] header',
    declarations: ['background: linear-gradient(125deg, var(--ui-color-template-worker-start), var(--ui-color-template-worker-end));'],
    why: 'Use the worker category gradient from the template catalog.',
  },
  {
    selector: '.ui-template-card[data-category="identity"] header',
    declarations: ['background: linear-gradient(125deg, var(--ui-color-template-identity-start), var(--ui-color-template-identity-end));'],
    why: 'Use the sign-in category gradient from the template catalog.',
  },
  {
    selector: '.ui-template-card header h2',
    declarations: ['margin: 0;', 'font-size: 1.22rem;', 'line-height: 1.22;'],
    why: 'Keep the name directly under the type inside the colored header.',
  },
  {
    selector: '.ui-template-card-type',
    declarations: ['display: flex;', 'justify-content: space-between;', 'gap: var(--ui-space-2);', 'margin: 0 0 0.55rem;',
      'font-size: 0.75rem;', 'font-weight: 650;'],
    why: 'Keep the category and mode together above the template name.',
  },
  {
    selector: '.ui-template-card-meta',
    declarations: ['display: flex;', 'justify-content: space-between;', 'flex-wrap: wrap;', 'gap: var(--ui-space-2);',
      'padding: 0.6rem 1.1rem;', 'border-block-end: 1px solid var(--ui-color-border);',
      'background: var(--ui-color-context);', 'color: var(--ui-color-textMuted);', 'font-size: var(--ui-font-caption);'],
    why: 'Show publisher and pinned version immediately beneath the gradient.',
  },
  {
    selector: '.ui-template-card-body',
    declarations: ['flex: 1;', 'padding: var(--ui-space-5);'],
    why: 'Group the capabilities below the card title and line up action rows.',
  },
  {
    selector: '.ui-template-card-body p',
    declarations: ['margin: 0 0 var(--ui-space-3);'],
    why: 'Group the capabilities with the description they expand.',
  },
  {
    selector: '.ui-template-highlights, .ui-template-catalog',
    declarations: ['list-style: none;', 'margin: 0;', 'padding: 0;'],
    why: 'Keep catalog cards and their capabilities aligned with their containers.',
  },
  {
    selector: '.ui-template-highlights',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: var(--ui-space-2);'],
    why: 'Show all capabilities on small and large cards.',
  },
  {
    selector: '.ui-template-card-specs',
    declarations: ['border-block-start: 1px solid var(--ui-color-border);', 'padding-inline: var(--ui-space-5);'],
    why: 'Separate template specifications from the description and actions.',
  },
  {
    selector: '.ui-template-catalog [hidden], .ui-template-search[hidden]',
    declarations: ['display: none;'],
    why: 'Keep the Astro filter hidden until ready and remove unmatched cards from the grid.',
  },
  {
    selector: '.ui-template-search .ui-workspace-input',
    declarations: ['appearance: base-select;'],
    why: 'Use the design system on the native Astro catalog select and its picker where supported.',
  },
  {
    selector: '.ui-template-search .ui-workspace-input::picker(select)',
    declarations: ['appearance: base-select;', 'border: 1px solid var(--ui-color-control-border);', 'border-radius: var(--ui-space-3);',
      'background: var(--ui-color-surface);', 'color: var(--ui-color-text);', 'font: inherit;', 'box-shadow: var(--ui-menu-shadow);'],
    why: 'Match the catalog picker’s border, font and surface to its trigger.',
  },
  {
    selector: '.ui-template-card-actions',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'justify-content: space-between;', 'gap: var(--ui-space-2);',
      'padding: 0.75rem 1rem;', 'border-block-start: 1px solid var(--ui-color-border);'],
    why: 'Keep template details and setup actions in the footer.',
  },
  {
    selector: '.ui-workspace-form',
    declarations: ['display: grid;', 'gap: 0.55rem;', 'max-inline-size: 29rem;', 'margin-block: var(--ui-space-4);'],
    why: 'Keep labels and fields together and limit the line length on wider screens.',
  },
  {
    selector: '.ui-workspace-form input:not([type="checkbox"], [type="hidden"]), .ui-workspace-input',
    declarations: ['inline-size: 100%;', 'min-inline-size: 0;', 'min-block-size: var(--ui-target-primary);', 'padding: 0.52rem 0.72rem;', 'border: 1px solid var(--ui-color-control-border);', 'border-radius: var(--ui-space-3);', 'background: var(--ui-color-surface);', 'color: var(--ui-color-text);', 'font: inherit;'],
    why: 'Use the same field surface as authentication and preserve the primary input target.',
  },
  {
    selector: '.ui-workspace-form label, .ui-workspace-label',
    declarations: ['font-size: var(--ui-font-label);', 'font-weight: 680;'],
    why: 'Share the same field labels across workspace and authentication forms.',
  },
  {
    selector: '.ui-workspace-form fieldset',
    declarations: ['display: grid;', 'gap: var(--ui-space-1);', 'min-inline-size: 0;', 'margin: 0;', 'padding: var(--ui-space-2) var(--ui-space-3);',
      'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-3);'],
    why: 'Group related choices on the same surface as other form fields.',
  },
  {
    selector: '.ui-workspace-form fieldset label',
    declarations: ['display: flex;', 'align-items: center;', 'gap: var(--ui-space-2);', 'min-block-size: var(--ui-target-primary);', 'cursor: pointer;'],
    why: 'Make the whole checkbox label a comfortable target while keeping the control compact.',
  },
  {
    selector: '.ui-workspace-form input[type="checkbox"]',
    declarations: ['inline-size: 1rem;', 'block-size: 1rem;', 'margin: 0;', 'accent-color: var(--ui-color-accent);'],
    why: 'Use the active theme colour and the same control size in every choice group.',
  },
  {
    selector: '.ui-workspace-form input:focus-visible, .ui-workspace-input:focus-visible, .ui-auth-card a:focus-visible',
    declarations: ['outline: 3px solid var(--ui-color-accent);', 'outline-offset: 3px;'],
    why: 'Make keyboard focus visible on form fields and authentication links.',
  },
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
    declarations: ['color: var(--ui-color-textMuted);', 'font-size: var(--ui-font-caption);'],
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
    declarations: ['display: inline-flex;', 'align-items: baseline;', 'flex-wrap: wrap;', 'gap: var(--ui-space-2);', 'color: var(--ui-color-text);'],
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
    declarations: ['background: var(--ui-color-surface);', 'border-block-end: 1px solid var(--ui-color-border);'],
    why: 'Match the mockup’s white header across the workspace.',
  },
  {
    selector: '.ui-workspace-header-inner',
    declarations: ['display: flex;', 'align-items: center;', 'justify-content: space-between;', 'gap: 0.55rem;',
      'min-block-size: 4rem;', 'max-inline-size: var(--ui-workspace-width);', 'margin-inline: auto;', 'padding: 0.4rem 1rem;'],
    why: 'Place the wordmark and workspace controls on the same measured bar.',
  },
  {
    selector: '.ui-workspace-tools',
    declarations: ['display: flex;', 'align-items: center;', 'justify-content: flex-end;', 'gap: 0.55rem;', 'min-inline-size: 0;', 'flex: 1 1 auto;'],
    why: 'Keep the workspace selector beside the user icon.',
  },
  {
    selector: '.ui-workspace-tools > .ui-workspace-menu:first-child',
    declarations: ['flex: 0 1 14rem;'],
    why: 'Let the workspace selector use the mockup’s full width on desktop and shrink on phones.',
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
    selector: '.ui-workspace-trigger[data-kind="wordmark"], .ui-workspace-trigger[data-kind="avatar"]',
    declarations: ['background: transparent;', 'border: 0;', 'padding: 0;', 'gap: 0.45rem;'],
    why: 'The logo and avatar open menus without an extra button frame.',
  },
  {
    selector: '.ui-workspace-trigger[data-kind="wordmark"], .ui-workspace-wordmark',
    declarations: ['font-size: 1.07rem;', 'font-weight: 750;', 'white-space: nowrap;'],
    why: 'Match the mockup wordmark.',
  },
  {
    selector: '.ui-workspace-trigger[data-kind="selector"]',
    declarations: ['inline-size: 100%;', 'justify-content: space-between;', 'padding-inline: 0.65rem;', 'font: inherit;',
      'border-color: var(--ui-color-control-border);', 'border-radius: 0.5rem;'],
    why: 'The selector uses the same appearance as the form controls in the mockup.',
  },
  {
    selector: '.ui-workspace-trigger[data-kind="selector"] > span:last-child',
    declarations: ['flex: none;', 'inline-size: 0.4rem;', 'block-size: 0.4rem;', 'border-inline-end: 1.5px solid currentColor;',
      'border-block-end: 1.5px solid currentColor;', 'transform: translateY(-20%) rotate(45deg);', 'font-size: 0;'],
    why: 'Use the same chevron as the mockup selector.',
  },
  {
    selector: '.ui-workspace-trigger[data-kind="avatar"]',
    declarations: ['justify-content: center;', 'border-radius: 50%;'],
    why: 'Retain the full hit target around the circular avatar.',
  },
  {
    selector: '.ui-workspace-wordmark',
    declarations: ['display: inline-flex;', 'align-items: center;', 'gap: 0.45rem;', 'color: inherit;', 'text-decoration: none;'],
    why: 'Use the same wordmark on public and signed-in pages.',
  },
  {
    selector: '.ui-workspace-team-label',
    declarations: ['min-inline-size: 0;', 'overflow: hidden;', 'text-overflow: ellipsis;', 'white-space: nowrap;'],
    why: 'Long team names leave space for the account button and are shown in full in the selector.',
  },
  {
    selector: '.ui-workspace-mark, .ui-auth-wordmark::before',
    declarations: ['display: grid;', 'flex: none;', 'place-items: center;', 'inline-size: 2.15rem;', 'aspect-ratio: 1;', 'background: var(--ui-color-brand);', 'color: var(--ui-color-onAccent);', 'border-radius: 0.55rem;', 'font-weight: 750;'],
    why: 'Identify Platfolio with its own simple wordmark and accent.',
  },
  {
    selector: '.ui-workspace-avatar',
    declarations: ['display: grid;', 'place-content: center;', 'justify-items: center;', 'gap: 0.1em;', 'inline-size: 2.15rem;', 'aspect-ratio: 1;', 'margin-inline: auto;', 'border-radius: 50%;', 'background: var(--ui-color-accent-surface);', 'color: var(--ui-color-accent);', 'font-size: 0.78rem;', 'font-weight: 750;'],
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
      'border-radius: 0.8rem;', 'font: inherit;', 'box-shadow: var(--ui-menu-shadow);',
    ],
    why: 'Use the control’s surface, border, and typography in its popup.',
  },
  {
    selector: '.ui-workspace-popover-end',
    declarations: ['inset-inline-start: auto;', 'inset-inline-end: 0;'],
    why: 'Keep right-hand disclosures within the screen.',
  },
  {
    selector: '.ui-workspace-popover[data-kind="selector"]',
    declarations: ['inline-size: 100%;', 'min-inline-size: min(100%, 11rem);', 'max-inline-size: none;',
      'border-color: var(--ui-color-control-border);', 'border-radius: 0.5rem;'],
    why: 'Match the selector popup to its trigger’s measure, border, and rounding.',
  },
  {
    selector: '.ui-workspace-popover[data-kind="selector"] [aria-pressed="true"], .ui-workspace-item[aria-current="true"]',
    declarations: ['background: var(--ui-color-accent-surface);', 'color: var(--ui-color-accent);', 'font-weight: var(--ui-weight-title);'],
    why: 'Show the current choice inside any workspace selection popup.',
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
    declarations: ['inline-size: min(100%, var(--ui-workspace-width));', 'margin-inline: auto;', 'padding: 1.45rem 1rem 2.75rem;', 'outline: none;'],
    why: 'Give workspace pages a comfortable shared measure.',
  },
  {
    selector: '.ui-workspace-main .ui-screen-stack',
    declarations: ['gap: 0;'],
    why: 'Let workspace headings, tabs, and page actions own their spacing, without a second gap from the screen slot.',
  },
  {
    selector: '.ui-workspace-main .ui-screen-stack > .ui-workspace-panel + .ui-workspace-panel, .ui-workspace-main .ui-screen-stack > .ui-columns + .ui-workspace-panel',
    declarations: ['margin-block-start: var(--ui-space-5);'],
    why: 'Separate adjacent content panels after the page header and tabs.',
  },
  {
    selector: '.ui-workspace-crumbs',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'align-items: baseline;', 'gap: 0.2rem 0.4rem;', 'list-style: none;',
      'margin: 0 0 0.6rem;', 'padding: 0;', 'font-size: 0.8rem;', 'line-height: normal;', 'color: var(--ui-color-textMuted);', 'overflow-wrap: anywhere;'],
    why: 'Let shallow breadcrumbs wrap without obscuring the selected context.',
  },
  {
    selector: '.ui-workspace-crumbs li',
    declarations: ['display: flex;', 'align-items: baseline;', 'gap: 0.4rem;', 'min-inline-size: 0;'],
    why: 'Keep separators with their labels.',
  },
  {
    selector: '.ui-workspace-crumbs a',
    declarations: ['display: inline-block;', 'padding-block: 0.25rem;', 'text-underline-offset: 0.15em;'],
    why: 'Match the breadcrumb’s link spacing and underline.',
  },
  {
    selector: '.ui-workspace-crumbs [aria-current="page"]',
    declarations: ['font-weight: 650;'],
    why: 'Give the current breadcrumb the same emphasis as the mockup.',
  },
  {
    selector: '.ui-public-main',
    declarations: ['inline-size: min(100% - 2rem, 68rem);', 'margin: 1.25rem auto 2.75rem;'],
    why: 'Use the mockup’s narrower public page measure.',
  },
  {
    selector: '.ui-welcome',
    declarations: ['padding: clamp(1.1rem, 4%, 3rem);', 'align-items: center;', 'border: 1px solid var(--ui-color-border);',
      'border-radius: 1.2rem;', 'background: linear-gradient(135deg, var(--ui-color-surface), var(--ui-color-accent-surface));'],
    why: 'Place the public welcome and hosting steps inside the same panel.',
  },
  {
    selector: '.ui-public-intro',
    declarations: ['min-inline-size: 0;', 'inline-size: 100%;'],
    why: 'Keep the landing page heading and actions together in both layouts.',
  },
  {
    selector: '.ui-public-intro h1',
    declarations: ['max-inline-size: 14ch;', 'margin: 0;', 'font-size: var(--ui-welcome-title-size, 2.48rem);', 'line-height: 1.12;', 'letter-spacing: -0.042em;'],
    why: 'Match the mockup’s landing-page title.',
  },
  {
    selector: '.ui-public-intro p',
    declarations: ['max-inline-size: 62ch;', 'color: var(--ui-color-textMuted);', 'margin-block: 0.45rem 1.35rem;'],
    why: 'Preserve the line measure of the mockup’s introductory copy.',
  },
  {
    selector: '.ui-welcome > .ui-workspace-panel',
    declarations: ['inline-size: 100%;', 'padding: var(--ui-welcome-panel-padding, 1.05rem);'],
    why: 'Keep the hosting card the full width of its column.',
  },
  {
    selector: '.ui-hosting-steps',
    declarations: ['padding-inline-start: var(--ui-space-6);', 'margin: 0;'],
    why: 'Display the hosting steps as an ordered list within the card.',
  },
  {
    selector: '.ui-hosting-steps li',
    declarations: ['padding-block: 0.55rem;'],
    why: 'Space the hosting steps for scanning.',
  },
  {
    selector: '.ui-hosting-steps li + li',
    declarations: ['border-block-start: 1px solid var(--ui-color-border);'],
    why: 'Separate consecutive steps visually.',
  },
  {
    selector: '.ui-hosting-steps li::marker',
    declarations: ['color: var(--ui-color-accent);', 'font-weight: 730;'],
    why: 'Use the mockup’s colored step numbers.',
  },
  {
    selector: '.ui-hosting-steps strong',
    declarations: ['font-size: 0.92rem;'],
    why: 'Separate each step’s label from its description.',
  },
  {
    selector: '.ui-workspace-panel .ui-hosting-steps li p',
    declarations: ['margin: 0.2rem 0 0;', 'color: var(--ui-color-textMuted);', 'font-size: 0.85rem;'],
    why: 'Group each explanation with its step label.',
  },
  {
    selector: '.ui-workspace-main h1, .ui-public-main .ui-workspace-page-heading h1',
    declarations: ['margin: 0;', 'font-size: clamp(2.05rem, 3.4cqi, 2.65rem);', 'line-height: 1.12;', 'letter-spacing: -0.042em;', 'overflow-wrap: anywhere;'],
    why: 'Use the mockup’s page heading and weight throughout the workspace.',
  },
  {
    selector: '.ui-workspace-page-heading',
    declarations: ['margin-block-end: 1.35rem;'],
    why: 'Use the mockup page rhythm between the title and its navigation.',
  },
  {
    selector: '.ui-workspace-page-heading p',
    declarations: ['margin: 0.45rem 0 0;', 'max-inline-size: 62ch;', 'line-height: 1.55;', 'color: var(--ui-color-textMuted);'],
    why: 'Keep the short page description beside its title.',
  },
  {
    selector: '.ui-workspace-page-heading:has(+ .ui-workspace-tabs)',
    declarations: ['margin-block-end: 0.8rem;'],
    why: 'Keep team tabs directly under the page title without a second row of spacing.',
  },
  {
    selector: '.ui-workspace-tabs',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: 0.15rem 0.25rem;', 'margin-block: var(--ui-space-3) var(--ui-space-5);',
      'border-block-end: 1px solid var(--ui-color-border);'],
    why: 'Keep the mockup’s tabs visible on mobile by allowing them to wrap.',
  },
  {
    selector: '.ui-workspace-tabs a',
    declarations: ['display: inline-flex;', 'align-items: center;', 'min-block-size: var(--ui-target-primary);',
      'padding-inline: 0.6rem;', 'border-block-end: 2px solid transparent;', 'border-radius: 0.4rem 0.4rem 0 0;',
      'font-size: 0.86rem;', 'font-weight: 620;', 'color: var(--ui-color-text);', 'text-decoration: none;'],
    why: 'Make navigation look and behave like the mockup tabs.',
  },
  {
    selector: '.ui-workspace-tabs a[aria-current="page"]',
    declarations: ['background: var(--ui-color-surface);', 'border-block-end-color: var(--ui-color-accent);', 'color: var(--ui-color-accent);'],
    why: 'Show the selected tab with the mockup’s underline.',
  },
  {
    selector: '.ui-environment-navigation',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: 0.55rem 1rem;', 'margin-block-end: var(--ui-space-4);'],
    why: 'Keep environment targets beside their pages when the container has room.',
  },
  {
    selector: '.ui-workspace-segments',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'inline-size: fit-content;', 'gap: var(--ui-space-1);',
      'padding: var(--ui-space-1);', 'margin-block-end: var(--ui-space-3);', 'border: 1px solid var(--ui-color-border);',
      'border-radius: var(--ui-space-3);', 'background: var(--ui-color-context);'],
    why: 'Share the mockup’s segmented navigation between account sections and environment controls.',
  },
  {
    selector: '.ui-account-settings',
    declarations: ['max-inline-size: 57rem;'],
    why: 'Keep account settings and the team roster at the mockup’s reading width.',
  },
  {
    selector: '.ui-account-settings > .ui-workspace-segments',
    declarations: ['padding: 0.22rem;', 'margin-block-end: 1.1rem;'],
    why: 'Match the account and team sub-tabs’ gap from their related card.',
  },
  {
    selector: '.ui-profile-avatar .ui-workspace-avatar',
    declarations: ['inline-size: 4.25rem;', 'block-size: 4.25rem;', 'font-size: 1.15rem;'],
    why: 'Preview the same initials used by the header.',
  },
  {
    selector: '.ui-workspace-segments a, .ui-workspace-segments button',
    declarations: ['display: inline-flex;', 'align-items: center;', 'min-block-size: var(--ui-target-primary);', 'padding-inline: 0.62rem;',
      'border: 0;', 'border-radius: var(--ui-space-2);', 'color: var(--ui-color-text);', 'background: transparent;',
      'font: inherit;', 'font-size: 0.87rem;', 'text-decoration: none;', 'cursor: pointer;'],
    why: 'Keep nearby tabs readable and easy to tap.',
  },
  {
    selector: '.ui-workspace-segments a[aria-current="page"], .ui-workspace-segments button[aria-pressed="true"]',
    declarations: ['background: var(--ui-color-surface);', 'color: var(--ui-color-accent);', 'box-shadow: 0 1px 3px color-mix(in srgb, var(--ui-color-text) 12%, transparent);'],
    why: 'Show the selected environment or page without a colored underline.',
  },
  {
    selector: '.ui-workspace-panel',
    declarations: ['min-inline-size: 0;', 'padding: 1.13rem;', 'background: var(--ui-color-surface);',
      'border: 1px solid var(--ui-color-border);', 'border-radius: 0.65rem;', 'box-shadow: var(--ui-panel-shadow);'],
    why: 'Use the bordered card surface, spacing, and shadow from the mockup.',
  },
  {
    selector: '.ui-workspace-panel[data-context]',
    declarations: ['background: var(--ui-color-context);'],
    why: 'Match the subtly tinted App details card.',
  },
  {
    selector: '.ui-workspace-panel h2',
    declarations: ['margin: 0 0 0.8rem;', 'font-size: 1.13rem;', 'line-height: 1.3;', 'letter-spacing: -0.018em;'],
    why: 'Use the mockup’s card title typography.',
  },
  {
    selector: '.ui-workspace-panel p',
    declarations: ['margin: 0 0 0.8rem;', 'line-height: 1.55;'],
    why: 'Keep the card text and its following controls grouped.',
  },
  {
    selector: '.ui-workspace-secondary',
    declarations: ['display: inline-flex;', 'align-items: center;', 'justify-content: center;', 'padding: 0.55rem 0.9rem;',
      'border: 1px solid var(--ui-color-border);', 'border-radius: 0.6rem;', 'background: var(--ui-color-surface);',
      'color: var(--ui-color-text);', 'text-decoration: none;', 'font-size: 0.91rem;', 'font-weight: 650;', 'line-height: 1.25;'],
    why: 'Use the mockup’s bordered secondary actions.',
  },
  {
    selector: '.ui-workspace-resource',
    declarations: ['display: grid;', 'grid-template-columns: auto minmax(0, 1fr) auto;', 'align-items: center;',
      'gap: 0.75rem;', 'min-block-size: 3.85rem;', 'padding: 0.68rem 0.55rem;', 'border-radius: 0.6rem;',
      'color: inherit;', 'line-height: normal;', 'text-decoration: none;'],
    why: 'Use the mockup’s shared row for links to teams and apps.',
  },
  {
    selector: '.ui-workspace-resource:is(a):hover',
    declarations: ['background: var(--ui-color-bg);'],
    why: 'Make it clear that the full resource row is a link.',
  },
  {
    selector: '.ui-workspace-resource:has(> .ui-workspace-resource-text:first-child)',
    declarations: ['grid-template-columns: minmax(0, 1fr) auto auto;'],
    why: 'Allow the text to wrap first on rows that have a status badge instead of a leading icon.',
  },
  {
    selector: '.ui-workspace-resource-text',
    declarations: ['display: grid;', 'min-inline-size: 0;', 'gap: 0.2rem;', 'overflow-wrap: anywhere;'],
    why: 'Match the two-line mockup row and let long labels wrap.',
  },
  {
    selector: '.ui-workspace-resource-text > span',
    declarations: ['font-size: 0.87rem;', 'color: var(--ui-color-textMuted);'],
    why: 'Give the role and instance count their original visual weight.',
  },
  {
    selector: '.ui-workspace-resource-chevron',
    declarations: ['color: var(--ui-color-textMuted);', 'font-size: 1.3rem;'],
    why: 'Place the navigation chevron at the end of each resource row.',
  },
  {
    selector: '.ui-environment-list',
    declarations: ['margin: 0;', 'padding: 0;', 'list-style: none;'],
    why: 'Use dividers inside one panel instead of bordering each list.',
  },
  {
    selector: '.ui-environment-list > li + li',
    declarations: ['border-block-start: 1px solid var(--ui-color-border);'],
    why: 'Separate the environment rows without nested card outlines.',
  },
  {
    selector: '.ui-environment-summary',
    declarations: ['display: grid;', 'grid-template-columns: auto minmax(0, 1fr) auto;', 'align-items: center;', 'gap: 0.65rem;',
      'padding: 0.68rem 0.55rem;', 'border-radius: 0.6rem;', 'color: var(--ui-color-text);', 'text-decoration: none;'],
    why: 'Keep the environment marker, summary and open indicator aligned on narrow screens.',
  },
  {
    selector: '.ui-environment-summary:hover, .ui-workspace-tabs a:hover, .ui-workspace-secondary:hover',
    declarations: ['background: var(--ui-color-accent-surface);'],
    why: 'Use the mockup’s visible hover surface.',
  },
  {
    selector: '.ui-environment-symbol',
    declarations: ['display: grid;', 'place-items: center;', 'inline-size: 2.15rem;', 'aspect-ratio: 1;',
      'border-radius: 0.55rem;', 'background: var(--ui-color-accent-surface);', 'color: var(--ui-color-accent);'],
    why: 'Give each environment the compact visual landmark shown in the mockup.',
  },
  {
    selector: '.ui-environment-shortcuts',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: 0.15rem 0.35rem;', 'padding: 0 0.35rem 0.45rem;'],
    why: 'Keep environment capabilities directly accessible from the overview.',
  },
  {
    selector: '.ui-environment-shortcuts a',
    declarations: ['display: inline-flex;', 'align-items: center;', 'min-block-size: var(--ui-target-primary);', 'padding-inline: 0.45rem;',
      'border-radius: 0.35rem;', 'font-size: 0.83rem;', 'font-weight: 650;', 'text-decoration: none;'],
    why: 'Match the mockup shortcuts and keep their touch targets usable.',
  },
  {
    selector: '.ui-environment-shortcuts a:hover',
    declarations: ['background: var(--ui-color-accent-surface);', 'text-decoration: underline;'],
    why: 'Show clear feedback on the environment actions.',
  },
  {
    selector: '.ui-environment-summary small',
    declarations: ['display: block;', 'color: var(--ui-color-textMuted);', 'font-size: 0.83rem;', 'overflow-wrap: anywhere;'],
    why: 'Put observation time on the secondary line of the environment row.',
  },
  {
    selector: '.ui-environment-summary .ui-state-word',
    declarations: ['display: inline-block;', 'padding: 0.1rem 0.45rem;', 'border-radius: 1rem;', 'background: var(--ui-color-bg);',
      'font-size: 0.73rem;', 'font-weight: 700;', 'text-transform: capitalize;'],
    why: 'Use a readable compact status badge without hiding the state.',
  },
  {
    selector: '.ui-environment-summary .ui-tone-ok .ui-state-word',
    declarations: ['background: var(--ui-color-check-surface);', 'color: var(--ui-color-ok);'],
    why: 'Use the mockup’s green status treatment when the environment is active.',
  },
  {
    selector: '.ui-environment-summary .ui-age',
    declarations: ['display: block;', 'font-size: 0.83rem;'],
    why: 'Keep the server observation time on its own readable line.',
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
    selector: '.ui-auth-card',
    declarations: ['margin: 2.25rem auto 3rem;', 'inline-size: min(calc(100% - 2rem), 30rem);',
      'padding: clamp(1.2rem, 6%, 1.85rem);', 'box-sizing: border-box;'],
    why: 'Share the mockup’s centered card between the site entry and Keycloak.',
  },
  {
    selector: '.ui-auth-card h1',
    declarations: ['margin: 0 0 1.4rem;', 'font-size: 1.88rem;', 'line-height: 1.12;', 'letter-spacing: -0.042em;', 'overflow-wrap: anywhere;'],
    why: 'Match the title on the mockup authentication cards.',
  },
  {
    selector: '.ui-auth-wordmark::before',
    declarations: ['content: "P" / "";'],
    why: 'Add the decorative mark to the wordmark rendered by Keycloak.',
  },
  {
    selector: '.ui-workspace-form-panel',
    declarations: ['max-inline-size: 42rem;'],
    why: 'Keep single-column forms and their panels at the mockup’s measure.',
  },
  {
    selector: '.ui-template-search',
    declarations: ['margin-block: 0;', 'max-inline-size: none;'],
    why: 'Let template search use the full width of its card.',
  },
  {
    selector: '.ui-workspace-page-actions',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: var(--ui-space-3);', 'margin-block-end: var(--ui-space-5);'],
    why: 'Keep page actions above the related card.',
  },
  {
    selector: '.ui-workspace-dialog',
    declarations: ['inline-size: min(100% - 2rem, 32rem);', 'max-block-size: calc(100% - 2rem);', 'margin: auto;',
      'color: var(--ui-color-text);', 'overflow: auto;'],
    why: 'Use the same card surface inside a keyboard-accessible confirmation dialog.',
  },
  {
    selector: '.ui-workspace-dialog::backdrop',
    declarations: ['background: color-mix(in srgb, var(--ui-color-text) 48%, transparent);'],
    why: 'Keep the dialog distinct from the inactive page.',
  },
  {
    selector: '.ui-activity-history',
    declarations: ['padding: 0.55rem 0.65rem;', 'border: 1px solid var(--ui-color-border);',
      'border-radius: 0.5rem;', 'background: var(--ui-color-bg);'],
    why: 'Put the date range and bars together on the mockup’s inset surface.',
  },
  {
    selector: '.ui-activity-bars',
    declarations: ['display: grid;', 'grid-template-columns: repeat(14, minmax(0, 1fr));', 'align-items: end;',
      'gap: 0.24rem;', 'min-block-size: 2.25rem;', 'margin: 0;', 'padding: 0;', 'list-style: none;'],
    why: 'Match the mockup’s compact 14-day activity chart.',
  },
  {
    selector: '.ui-activity-bars li',
    declarations: ['block-size: max(0.35rem, calc(var(--ui-activity-level, 0) * 0.75rem));',
      'background: var(--ui-color-border);', 'border-radius: 0.22rem 0.22rem 0.1rem 0.1rem;'],
    why: 'Scale the bar to the observed record count with a marker for inactive days.',
  },
  {
    selector: '.ui-activity-bars li[data-tone="success"]',
    declarations: ['background: var(--ui-color-ok);'],
    why: 'Show days with deployments verified by their hosting provider.',
  },
  {
    selector: '.ui-activity-bars li[data-tone="attention"]',
    declarations: ['background: var(--ui-color-warn);'],
    why: 'Distinguish confirmed availability changes in the same history layout.',
  },
  {
    selector: '.ui-activity-range',
    declarations: ['display: flex;', 'justify-content: space-between;', 'gap: var(--ui-space-2);', 'margin-block-start: var(--ui-space-3);'],
    why: 'Label the date range below both charts.',
  },
  {
    selector: '.ui-activity-timeline',
    declarations: ['margin: 0;', 'padding: 0;', 'list-style: none;'],
    why: 'Use the same open timeline across activity and status pages.',
  },
  {
    selector: '.ui-activity-timeline li',
    declarations: ['position: relative;', 'margin-inline-start: 0.35rem;', 'padding: 0 0 0.85rem 0.95rem;',
      'border-inline-start: 1px solid var(--ui-color-border);', 'overflow-wrap: anywhere;'],
    why: 'Keep timeline entries readable in the same bordered panel at every width.',
  },
  {
    selector: '.ui-activity-timeline li::before',
    declarations: ['content: "";', 'position: absolute;', 'inset-block-start: 0.35rem;', 'inset-inline-start: -0.25rem;',
      'inline-size: 0.45rem;', 'aspect-ratio: 1;', 'border-radius: 50%;', 'background: var(--ui-color-accent);'],
    why: 'Use the same timeline marker for any event kind.',
  },
  {
    selector: '.ui-activity-timeline h3',
    declarations: ['margin: var(--ui-space-2) 0 0;', 'font-size: 0.98rem;', 'line-height: 1.3;'],
    why: 'Show the event text below its date and label.',
  },
  {
    selector: '.ui-workspace-primary',
    declarations: ['display: inline-flex;', 'align-items: center;', 'justify-content: center;', 'padding: 0.55rem 0.9rem;', 'text-decoration: none;', 'background: var(--ui-color-action);', 'color: var(--ui-color-onAccent);', 'border: 1px solid transparent;', 'border-radius: 0.6rem;', 'font: inherit;', 'font-size: 0.91rem;', 'font-weight: 650;', 'line-height: 1.25;', 'cursor: pointer;'],
    why: 'Use the strong accent for the next step.',
  },
  {
    selector: '.ui-workspace-primary:hover:not(:disabled)',
    declarations: ['background: color-mix(in srgb, var(--ui-color-action) 86%, black);'],
    why: 'Give primary actions the same hover response in the app and Keycloak.',
  },
  {
    selector: '.ui-notification-rules',
    declarations: ['border: 1px solid var(--ui-color-border);', 'border-radius: 0.65rem;'],
    why: 'Group rules in a single list surface.',
  },
  {
    selector: '.ui-notification-rule',
    declarations: ['display: grid;', 'gap: 0.65rem;', 'padding: 0.95rem;', 'min-inline-size: 0;'],
    why: 'Give a rule room for its event, scope and actions.',
  },
  {
    selector: '.ui-notification-rule-header',
    declarations: ['display: grid;', 'grid-template-columns: auto minmax(0, 1fr) auto;', 'align-items: start;', 'gap: 0.65rem;'],
    why: 'Place the event mark, title and status in a single readable row.',
  },
  {
    selector: '.ui-notification-rule-header h3',
    declarations: ['margin: 0;', 'font-size: 0.98rem;', 'line-height: 1.3;', 'overflow-wrap: anywhere;'],
    why: 'Keep the rule name distinct from its scope.',
  },
  {
    selector: '.ui-notification-rule-details',
    declarations: ['grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.25rem), 1fr));',
      'margin: 0;', 'padding: 0.55rem 0.65rem;', 'border-radius: 0.45rem;', 'background: var(--ui-color-bg);',
      'font-size: var(--ui-font-label);'],
    why: 'Show each rule’s available metadata on a quieter surface.',
  },
  {
    selector: '.ui-notification-rule .ui-workspace-links',
    declarations: ['gap: 0.3rem;'],
    why: 'Keep rule actions together above the next entry.',
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
