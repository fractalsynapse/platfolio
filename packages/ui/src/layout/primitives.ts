/**
 * The five layout primitives and the containment matrix (11 §2, rule 2).
 *
 * **The matrix is data, not prose.** `PRIMITIVES` declares, for each primitive, which other primitives it may
 * hold and which it may never hold; `assertPlacement()` is the one implementation of that question and it is
 * what a container calls before it renders a child. A containment rule written as a comment in a table in
 * `docs/design/11` is a rule that fails at review time; here it throws at construction time, and
 * `test/containment.test.ts` walks every cell of the matrix — including the refusals.
 *
 * Two things this file exists to make impossible:
 *
 * 1. **A primitive without a container.** `containerType` is a required field whose only legal value is
 *    `'inline-size'`. There is no default: an object literal that omits it does not compile, which is the
 *    mechanical half of gate §9.3 ("every layout primitive declares `container-type`").
 * 2. **A width query in a component.** Breakpoints live here, on the primitive, and reach CSS only through
 *    `renderLayoutCss()`. A component has no way to ask "how wide is the window" because nothing in this
 *    package exposes the window at all — see the `web/` boundary in `src/contract.ts`.
 */

export type LayoutSlot = 'stack' | 'split' | 'popout-sidebar' | 'overlay-sheet' | 'full-page';

/** Every slot, in the order 11 §2 lists them. The gate checks the table covers exactly these. */
export const LAYOUT_SLOTS = ['stack', 'split', 'popout-sidebar', 'overlay-sheet', 'full-page'] as const satisfies readonly LayoutSlot[];

export interface LayoutPrimitive {
  readonly slot: LayoutSlot;
  /** The class `layout.css` attaches the container to. One spelling, so no consumer may invent another. */
  readonly className: `ui-${string}`;
  /**
   * Required, and with no default. `container-type: inline-size` is what makes the container — and not the
   * viewport — the thing a component queries, which is the whole of rule 2.
   */
  readonly containerType: 'inline-size';
  /**
   * Which primitives may appear as a *layout* descendant of this one. Any registered non-layout component may
   * appear inside a primitive that permits content; this list governs layout-in-layout, because that is where
   * the matrix's refusals live.
   */
  readonly mayContain: readonly LayoutSlot[];
  /**
   * Explicit refusals. Redundant with `mayContain` by construction, and stated anyway so a future edit that
   * widens `mayContain` to include a refused slot trips a contradiction check in the test rather than quietly
   * becoming legal.
   */
  readonly mustNotContain: readonly LayoutSlot[];
  /**
   * Container width, in `rem`, above which the primitive composes wider than its floor. Every capability
   * exists below it too (rule 2: wide screens add simultaneity, never features), so this is a *layout*
   * threshold and never a feature flag. `null` means the primitive is the same at every width.
   */
  readonly wideFromRem: number | null;
  /**
   * The declarations applied to this primitive once its container crosses `wideFromRem`, as data. Living on the
   * primitive rather than in a stylesheet is what lets gate §9.3 read the breakpoints out of the source of
   * truth and check no width `@media` exists anywhere in the generated CSS.
   */
  readonly wideRule: readonly string[] | null;
  /** Maximum nesting depth of this primitive inside itself. `1` means it may not nest. */
  readonly maxSelfDepth: number;
  readonly note: string;
}

/**
 * The matrix, cell by cell, from 11 §2.
 *
 * `full-page` may contain anything because it is the route; `overlay-sheet` may not be embedded in a `stack`
 * because a sheet is pushed onto the page-level stack and there is exactly one sheet discipline per page;
 * `split` may not contain a second `split` because two-up inside two-up is a dashboard product, and D14's
 * non-goal list says no page builder.
 */
export const PRIMITIVES = {
  stack: {
    slot: 'stack',
    className: 'ui-stack',
    containerType: 'inline-size',
    mayContain: ['stack'],
    mustNotContain: ['overlay-sheet', 'split', 'popout-sidebar', 'full-page'],
    wideFromRem: null,
    wideRule: null,
    maxSelfDepth: 2,
    note: 'Single ordered column: the default and the floor. One nested layout, and it is a stack.',
  },
  split: {
    slot: 'split',
    className: 'ui-split',
    containerType: 'inline-size',
    mayContain: ['stack', 'popout-sidebar'],
    mustNotContain: ['split', 'overlay-sheet', 'full-page'],
    wideFromRem: 48,
    wideRule: ['display: grid;', 'grid-template-columns: 24rem 1fr;'],
    maxSelfDepth: 1,
    note: 'Master + detail. Never two-up below 48rem: it degrades to a stack plus a pushed sheet.',
  },
  'popout-sidebar': {
    slot: 'popout-sidebar',
    className: 'ui-popout',
    containerType: 'inline-size',
    mayContain: ['stack'],
    // An overlay-sheet is refused because a sheet is page-level by rule. `popout-sidebar` in a sidebar is the
    // matrix's "no nested sidebar". A destructive action without its plan-hash confirmation surface is also
    // refused, but that is a property of the *component*, not of a slot-in-slot relation — see the note in
    // scripts/check-ui.ts on why that cell is reported NOT RUN rather than checked vacuously.
    mustNotContain: ['popout-sidebar', 'split', 'overlay-sheet', 'full-page'],
    wideFromRem: 64,
    wideRule: ['display: grid;', 'grid-template-columns: 1fr 20rem;'],
    maxSelfDepth: 1,
    note: 'One context panel plus its stack. Read-mostly; floats over the edge mid-width, occupies a track wide.',
  },
  'overlay-sheet': {
    slot: 'overlay-sheet',
    className: 'ui-sheet',
    containerType: 'inline-size',
    // A sheet may host a stack (its body) and one nested sheet — depth <= 2 per the matrix.
    mayContain: ['stack', 'overlay-sheet'],
    mustNotContain: ['split', 'popout-sidebar', 'full-page'],
    wideFromRem: 48,
    // A sheet is a rail at wide and a bottom sheet at the floor: the same contract, three homes (11 §2).
    wideRule: ['justify-self: end;', 'inline-size: min(100%, 24rem);'],
    maxSelfDepth: 2,
    note: 'The mobile stack entry: bottom sheet, dialog at mid widths, rail at wide. Same component, one contract, three homes.',
  },
  'full-page': {
    slot: 'full-page',
    className: 'ui-page',
    containerType: 'inline-size',
    mayContain: LAYOUT_SLOTS,
    mustNotContain: [],
    wideFromRem: null,
    wideRule: null,
    maxSelfDepth: 1,
    note: 'Route-level document. The only primitive that survives a reload as itself.',
  },
} as const satisfies Record<LayoutSlot, LayoutPrimitive>;

export const LAYOUT_PRIMITIVE_SLOTS = Object.keys(PRIMITIVES) as LayoutSlot[];

export class ContainmentError extends Error {
  readonly slot: LayoutSlot;
  readonly child: LayoutSlot;
  constructor(slot: LayoutSlot, child: LayoutSlot, reason: string) {
    super(`layout ${child} may not be placed in ${slot}: ${reason}`);
    this.name = 'ContainmentError';
    this.slot = slot;
    this.child = child;
  }
}

/** Is `child` allowed as a layout descendant of `parent`, given the chain already open? */
export function placementProblem(parent: LayoutSlot, child: LayoutSlot, ancestors: readonly LayoutSlot[] = []): string | null {
  const p: LayoutPrimitive = PRIMITIVES[parent];
  // Widened to the declared interface on purpose. `PRIMITIVES` is `as const`, so `mustNotContain` is a literal
  // tuple and `includes(layoutSlot)` would be refused for a value the compiler cannot prove is one of its
  // members -- which is exactly the question the function exists to ask.
  if ((p.mustNotContain as readonly LayoutSlot[]).includes(child)) {
    return child === 'overlay-sheet' && parent !== 'full-page' && parent !== 'overlay-sheet'
      ? 'a sheet is pushed onto the page-level stack, never embedded in a column (11 §2)'
      : `the matrix lists ${parent} as never containing ${child} (11 §2)`;
  }
  if (!(p.mayContain as readonly LayoutSlot[]).includes(child)) {
    return `${child} is not in the ${parent}'s mayContain list (11 §2)`;
  }
  if (child === parent) {
    const depth = 1 + ancestors.filter((a) => a === parent).length;
    if (depth > p.maxSelfDepth) {
      return depth === 3
        ? 'a third nested sheet is refused; depth is capped at 2 (11 §2)'
        : `${parent} may nest at most ${String(p.maxSelfDepth)} deep`;
    }
  }
  return null;
}

/** The throwing form, for a container that is about to render a child it should not. */
export function assertPlacement(parent: LayoutSlot, child: LayoutSlot, ancestors: readonly LayoutSlot[] = []): void {
  const problem = placementProblem(parent, child, ancestors);
  if (problem) throw new ContainmentError(parent, child, problem);
}

/** Every `(parent, child)` pair the matrix forbids, for the test to assert against. */
export function refusedPlacements(): [LayoutSlot, LayoutSlot][] {
  const out: [LayoutSlot, LayoutSlot][] = [];
  for (const parent of LAYOUT_SLOTS) {
    for (const child of LAYOUT_SLOTS) {
      if (placementProblem(parent, child) !== null) out.push([parent, child]);
    }
  }
  return out;
}

export function allowedPlacements(): [LayoutSlot, LayoutSlot][] {
  const out: [LayoutSlot, LayoutSlot][] = [];
  for (const parent of LAYOUT_SLOTS) {
    for (const child of LAYOUT_SLOTS) {
      if (placementProblem(parent, child) === null) out.push([parent, child]);
    }
  }
  return out;
}

/**
 * The one CSS emitter for layout. `src/layout/layout.css` is generated from this, byte for byte, by
 * `scripts/gen-ui-css.ts` — the same discipline `tokens.css` and the API types are held to.
 *
 * Note what does **not** appear: any `@media` with a width. Every threshold is an `@container` query against
 * the primitive's own container, which is what lets the same sheet be a bottom sheet on a phone and a rail in
 * a 1920 px split — the container is the fact, the window is a guess about a device.
 */
/**
 * One declaration per line of `wideRule`, at two-space indent. `wideRule` is a list rather than a blob of CSS
 * precisely so the emitter owns the formatting and a primitive owns the fact.
 */
function indentDeclarations(rule: readonly string[]): string {
  return rule.map((line) => `    ${line}`).join('\n');
}

export function renderLayoutCss(digest: string): string {
  const containers = LAYOUT_SLOTS.map((slot) => {
    const p: LayoutPrimitive = PRIMITIVES[slot];
    return `.${p.className} {\n  container-type: ${p.containerType};\n  /* ${slot}: ${p.note} */\n}`;
  }).join('\n\n');

  const compositions = LAYOUT_SLOTS
    .map((slot): LayoutPrimitive => PRIMITIVES[slot])
    .filter((p): p is LayoutPrimitive & { wideRule: readonly string[]; wideFromRem: number } =>
      p.wideRule !== null && p.wideFromRem !== null)
    .map((p) => `/* ${p.slot} adds simultaneity when its own container has room. Nothing appears here that is\n   not also reachable at the floor width -- rule 2, and gate 9.11 is the check on that claim. */\n@container (min-width: ${String(p.wideFromRem)}rem) {\n  .${p.className as string} {\n${indentDeclarations(p.wideRule)}\n  }\n}`)
    .join('\n\n');

  return `/*
 * GENERATED FILE -- DO NOT EDIT. The writer is \`renderLayoutCss()\` in packages/ui/src/layout/primitives.ts.
 *
 * Source: packages/ui/src/layout/primitives.ts
 * Input digest: ${digest}
 *
 * Reproduce with \`pnpm run ui:css\`; \`pnpm run ui:css:check\` fails when this stops matching the primitive
 * table. Gate 9.3 audits this file too: it contains \`@container\` width queries and no \`@media\` width query,
 * because a window breakpoint tells a component what device it is on and a container query tells it how much
 * room it has.
 */

${containers}

${compositions}
`;
}
