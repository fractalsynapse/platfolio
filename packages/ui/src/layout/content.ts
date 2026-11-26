/**
 * The content-layout primitives (11 §2, rule 2, D63): how a *document* composes, beside how a *screen* does.
 *
 * **Why these are not more `LayoutSlot`s.** The five slots in `primitives.ts` are the screen's composition
 * vocabulary: a `ComponentContract.slots` names one, `assertPlacement()` refuses a cell of the matrix, and gate
 * §9.11's parity arithmetic walks `floorSlots`. A marketing page needs different things — a readable line with a
 * block rhythm, and a group of blocks that is one column at the floor and three when its container has room — and
 * putting those in the slot matrix would make `prose` a slot a component claims to render in, which is a claim
 * about a component that is not true. So this is its own table with its own emitter, and the containment rule it
 * inherits from `primitives.ts` is identical: **the primitive declares the container, the threshold is data, and
 * the window is never consulted.**
 *
 * **Why this file exists at all.** `apps/site/src/styles/site.css` hand-rolled `@container (min-width: 48rem)`
 * and a `68ch` measure because there was no primitive to import, and the comment beside it argued truthfully that
 * gate §D65 permits `rem`/`ch`/`fr` because refusing them would refuse this package's own generated CSS. That
 * permission was a gap wearing a rationale, and this kind of gap grows: the next marketing page adds a second
 * breakpoint in a second file, and two owners decide one composition. The primitives are here now, `ui:check`
 * §D65 refuses a width query in app CSS by name, and `test/gates-falsify.test.ts` plants one to prove it bites.
 *
 * **What is deliberately not here.**
 *
 *  - *A third primitive.* The line measure is `MEASURE.content` in `tokens.ts` — one value, referenced through
 *    `measureVar()` — not a separate class. `prose` is that measure plus a block rhythm; a page that wants only
 *    the cap can take the token directly, and inventing `ui-measure` beside `ui-prose` would be two names for one
 *    decision. Two primitives, both used by the only page that had been hand-rolling them, is the whole surface.
 *  - *React wrappers.* `layout/index.ts` has one per slot because screens compose in React. A content primitive
 *    is a class on markup in a page that must ship no JavaScript (D65's zero-script landing route), so a
 *    component here would be an unused abstraction priced at a client chunk. If a screen ever needs one, it
 *    arrives as a registered contract with `slots`, not as a special case beside this table.
 *  - *Page chrome.* The header, footer and their padding stay in `apps/site`: that is this shell's furniture, not
 *    a reusable content composition, and D63's token rule plus §D65 already audit it.
 */
import { measureVar, type SpacingStep } from '../tokens.ts';

export type ContentSlot = 'prose' | 'columns';

/**
 * One content primitive, as data.
 *
 * The shape is `LayoutPrimitive`'s, narrowed: no `mayContain`/`mustNotContain` (a document composition does not
 * inherit a screen composition's refusals) and no `floorSlots` (§9.11's parity is about API capability, and
 * nothing emitted here is reachable only when wide — `columns` proves it: the same blocks, one column at the
 * floor).
 */
export interface ContentPrimitive {
  readonly slot: ContentSlot;
  /** The class the generated sheet attaches this primitive to. One spelling, so no consumer may invent another. */
  readonly className: `ui-${string}`;
  /** Required, no default. This is rule 2: the container is declared by the primitive that queries it. */
  readonly containerType: 'inline-size';
  /** Whether this primitive caps its own line measure. The length is a token, never a number written here. */
  readonly measure: boolean;
  /** The block rhythm, as a spacing step from `tokens.ts`. `null` means the primitive declares no gap. */
  readonly gapStep: SpacingStep | null;
  /**
   * The container width, in `rem`, above which the primitive composes wider than its floor. `null` means the
   * shape is the same at every width. A *layout* threshold and never a feature flag — rule 2.
   */
  readonly wideFromRem: number | null;
  /** How many tracks `columns` uses at wide, and the gap between them. Both `null` on the primitives that never go multi-column. */
  readonly tracks: number | null;
  /** An explicitly selected two-panel composition for a document with two related sections. */
  readonly pairedTracks?: 2;
  readonly contextTracks?: readonly string[];
  readonly wideGapStep: SpacingStep | null;
  readonly note: string;
}

/**
 * The table: two entries, each one a decision `apps/site` used to make for itself in a stylesheet.
 *
 * `prose`'s gap step is `7` — `2rem` — because that is the rhythm the marketing page's `main` already shipped
 * with between its sections, and `columns` keeps `5` at the floor and `6` at wide for the same reason. A
 * primitive that silently restyles the only page that adopts it is a change nobody reviewed, so the numbers are
 * inherited and the inheritance is written down here rather than discovered in a diff.
 */
export const CONTENT_TABLE = {
  prose: {
    slot: 'prose',
    className: 'ui-prose',
    containerType: 'inline-size',
    measure: true,
    gapStep: 7,
    wideFromRem: null,
    tracks: null,
    wideGapStep: null,
    note: 'The readable line and the rhythm between its blocks: the sections of a document, a sheet body, running text. One column at every width.',
  },
  columns: {
    slot: 'columns',
    className: 'ui-columns',
    containerType: 'inline-size',
    measure: false,
    gapStep: 5,
    wideFromRem: 48,
    tracks: 3,
    pairedTracks: 2,
    contextTracks: ['minmax(0, 1.65fr)', 'minmax(0, 1fr)'],
    wideGapStep: 6,
    note: 'A group of blocks: one column at the floor, three when its container has room. Less scrolling, no new capability.',
  },
} as const satisfies Record<ContentSlot, ContentPrimitive>;

/** Every content slot, in the order the sheet emits them. Gate §9.3 checks the sheet covers exactly these. */
export const CONTENT_SLOTS = ['prose', 'columns'] as const satisfies readonly ContentSlot[];

/** The class names this table owns, so a page cannot invent a third one and call it a primitive. */
export const CONTENT_CLASSES = CONTENT_SLOTS.map((slot) => CONTENT_TABLE[slot].className);

export function isContentClass(name: string): boolean {
  return (CONTENT_CLASSES as readonly string[]).includes(name);
}

/**
 * The declarations one primitive emits, in one order, from one table.
 *
 * Exported because `test/content.test.ts` asks it directly: the byte-for-byte check on the committed sheet proves
 * the file matches the emitter, and this proves the emitter matches the *table* — that `measure: true` really
 * produces a `max-inline-size`, that it names the token rather than a length, and that a primitive with no
 * threshold emits no query at all.
 */
export function contentDeclarations(p: ContentPrimitive): string[] {
  const out: string[] = [`container-type: ${p.containerType};`];
  if (p.measure) out.push(`max-inline-size: var(${measureVar('content')});`, 'margin-inline: auto;');
  if (p.slot === 'prose') out.push('display: flex;', 'flex-direction: column;');
  if (p.slot === 'columns') out.push('display: flex;', 'flex-direction: column;');
  if (p.gapStep !== null) out.push(`gap: var(--ui-space-${String(p.gapStep)});`);
  return out;
}

/** The wide declarations, or `null` when the primitive has no threshold. `columns` is the only one that does. */
export function contentWideDeclarations(p: ContentPrimitive): string[] | null {
  if (p.wideFromRem === null || p.tracks === null) return null;
  return [
    'display: grid;',
    `grid-template-columns: repeat(${String(p.tracks)}, minmax(0, 1fr));`,
    ...(p.wideGapStep === null ? [] : [`gap: var(--ui-space-${String(p.wideGapStep)});`]),
  ];
}

/**
 * The one CSS emitter. `src/layout/content.css` is its output, `scripts/gen-ui-css.ts` is the only caller that
 * writes, and `pnpm run ui:css:check` fails when the committed file stops matching this table.
 *
 * No `@media` naming a width appears here and none may be added: gate §9.3 audits all four generated sheets for
 * that shape, and gate §D65 audits `apps/site` for the same one, so the rule is written once in the package and
 * checked on both sides of the boundary.
 */
export function renderContentCss(digest: string): string {
  const blocks = CONTENT_SLOTS.map((slot) => {
    const p: ContentPrimitive = CONTENT_TABLE[slot];
    const base = contentDeclarations(p).map((d) => `  ${d}`).join('\n');
    const head = `.${p.className} {\n${base}\n  /* ${p.slot}: ${p.note} */\n}`;
    const wide = contentWideDeclarations(p);
    if (wide === null) return head;
    const pair = p.pairedTracks ? `\n  .${p.className}[data-columns="${p.pairedTracks}"] {\n    grid-template-columns: repeat(${p.pairedTracks}, minmax(0, 1fr));\n    align-items: center;\n  }` : '';
    const context = p.contextTracks ? `\n  .${p.className}[data-columns="main-context"] {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: var(--ui-space-5);
  }
  .${p.className}[data-columns="main-context"]:has(> :nth-child(2)) {
    grid-template-columns: ${p.contextTracks.join(' ')};
  }
  .${p.className}[data-columns="main-context"][data-context-first]:has(> :nth-child(2)) {
    grid-template-columns: ${[...p.contextTracks].reverse().join(' ')};
  }` : '';
    return `${head}\n\n/* ${p.slot} adds simultaneity when its own container has room. Nothing that exists only at\n   this width is a capability -- rule 2, and the reason a content threshold lives here rather than in an\n   app stylesheet, where gate \u00a7D65 refuses it as a second owner of one decision. */\n@container (min-width: ${String(p.wideFromRem)}rem) {\n  .${p.className} {\n${wide.map((d) => `    ${d}`).join('\n')}\n  }${pair}${context}\n}`;
  }).join('\n\n');

  return `/*
 * GENERATED FILE -- DO NOT EDIT. The writer is \`renderContentCss()\` in packages/ui/src/layout/content.ts.
 *
 * Source: packages/ui/src/layout/content.ts
 * Input digest: ${digest}
 *
 * Reproduce with \`pnpm run ui:css\`; \`pnpm run ui:css:check\` fails when this stops matching the table. Gate
 * \u00a79.3 audits this sheet with the other three: \`@container\` width queries belong to primitives, a width
 * \`@media\` is refused anywhere in the package, and gate \u00a7D65 refuses a width query in *app* CSS -- because an
 * app that owns a breakpoint has started a second description of how content composes, which is the defect this
 * sheet exists to remove.
 */

${blocks}
`;
}
