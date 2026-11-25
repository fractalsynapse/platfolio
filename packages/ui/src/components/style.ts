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
    selector: '.ui-workspace-links',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'gap: var(--ui-space-4);'],
    why: 'Place related workspace actions together at each supported width.',
  },
  {
    selector: '.ui-template-card',
    declarations: ['max-inline-size: 27rem;', 'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-4);',
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
    declarations: ['padding: var(--ui-space-5);'],
    why: 'Group the source metadata and launch action below the card title.',
  },
  {
    selector: '.ui-template-card-actions',
    declarations: ['display: flex;', 'flex-wrap: wrap;', 'justify-content: space-between;', 'gap: var(--ui-space-2);',
      'padding: 0.75rem 1rem;', 'border-block-start: 1px solid var(--ui-color-border);'],
    why: 'Keep template details and setup actions in the footer.',
  },
  {
    selector: '.ui-workspace-form',
    declarations: ['display: grid;', 'gap: var(--ui-space-3);', 'max-inline-size: 28rem;', 'margin-block: var(--ui-space-4);'],
    why: 'Keep labels and fields together and limit the line length on wider screens.',
  },
  {
    selector: '.ui-workspace-form input:not([type="checkbox"])',
    declarations: ['inline-size: 100%;', 'min-inline-size: 0;', 'min-block-size: var(--ui-target-primary);', 'padding: var(--ui-space-2) var(--ui-space-3);', 'border: 1px solid var(--ui-color-border);', 'border-radius: var(--ui-space-3);', 'background: var(--ui-color-bg);', 'color: var(--ui-color-text);', 'font: inherit;'],
    why: 'Use the same field surface as authentication and preserve the primary input target.',
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
    selector: '.ui-workspace-form input:focus-visible',
    declarations: ['outline: 2px solid var(--ui-color-accent);', 'outline-offset: 2px;'],
    why: 'Make keyboard focus visible on workspace fields.',
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
    declarations: ['color: var(--ui-color-accent);'],
    why: 'Use the same blue disclosure marker as the mockup.',
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
    selector: '.ui-workspace-mark',
    declarations: ['display: grid;', 'place-items: center;', 'inline-size: 2.15rem;', 'aspect-ratio: 1;', 'background: var(--ui-color-brand);', 'color: var(--ui-color-onAccent);', 'border-radius: 0.55rem;', 'font-weight: 750;'],
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
    selector: '.ui-public-main',
    declarations: ['max-inline-size: 68rem;', 'margin-inline: auto;', 'padding: 1.25rem 1rem 2.75rem;'],
    why: 'Use the mockup’s narrower public page measure.',
  },
  {
    selector: '.ui-welcome',
    declarations: ['padding: clamp(1.1rem, 4%, 3rem);', 'border: 1px solid var(--ui-color-border);',
      'border-radius: 1.2rem;', 'background: linear-gradient(135deg, var(--ui-color-surface), var(--ui-color-accent-surface));'],
    why: 'Place the public welcome and hosting steps inside the same panel.',
  },
  {
    selector: '.ui-public-intro',
    declarations: ['min-inline-size: 0;'],
    why: 'Keep the landing page heading and actions together in both layouts.',
  },
  {
    selector: '.ui-public-intro h1',
    declarations: ['max-inline-size: 14ch;', 'margin: 0;', 'font-size: 2.48rem;', 'line-height: 1.12;', 'letter-spacing: -0.042em;'],
    why: 'Match the mockup’s landing-page title.',
  },
  {
    selector: '.ui-public-intro p',
    declarations: ['max-inline-size: 62ch;', 'color: var(--ui-color-textMuted);', 'margin-block: 0.45rem 1.35rem;'],
    why: 'Preserve the line measure of the mockup’s introductory copy.',
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
    selector: '.ui-hosting-steps li p',
    declarations: ['margin: 0.2rem 0 0;', 'color: var(--ui-color-textMuted);', 'font-size: var(--ui-font-label);'],
    why: 'Group each explanation with its step label.',
  },
  {
    selector: '.ui-workspace-main h1',
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
    declarations: ['margin: 0.45rem 0 0;', 'color: var(--ui-color-textMuted);'],
    why: 'Keep the short page description beside its title.',
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
    selector: '.ui-workspace-segments a',
    declarations: ['display: inline-flex;', 'align-items: center;', 'min-block-size: var(--ui-target-primary);', 'padding-inline: 0.62rem;',
      'border-radius: var(--ui-space-2);', 'color: var(--ui-color-text);', 'font-size: 0.87rem;', 'text-decoration: none;'],
    why: 'Keep nearby tabs readable and easy to tap.',
  },
  {
    selector: '.ui-workspace-segments a[aria-current="page"]',
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
      'color: var(--ui-color-text);', 'text-decoration: none;', 'font-size: 0.91rem;', 'font-weight: 650;'],
    why: 'Use the mockup’s bordered secondary actions.',
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
    declarations: ['display: inline-flex;', 'align-items: center;', 'justify-content: center;', 'padding-inline: var(--ui-space-5);', 'text-decoration: none;', 'background: var(--ui-color-action);', 'color: var(--ui-color-onAccent);', 'border: 0;', 'border-radius: var(--ui-space-3);', 'font: inherit;', 'cursor: pointer;'],
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
