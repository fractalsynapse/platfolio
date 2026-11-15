import * as React from 'react';
import { assertPlacement, LAYOUT_SLOTS, placementProblem, PRIMITIVES, type LayoutPrimitive, type LayoutSlot } from './primitives.ts';

export * from './primitives.ts';

/**
 * The layout primitives as components (11 §2, rule 2).
 *
 * **These are `.ts`, not `.tsx`, and that is a measured constraint rather than a style choice.** The repository
 * has one type-check surface — `npx -y tsc --noEmit -p tsconfig.json` against the root `tsconfig.json`, whose
 * `include` covers `packages/<name>/src` through a `.ts`-only glob. That pattern does not match `.tsx`, and the
 * config declares no `jsx` option, so a `.tsx` file in this workspace would be built by `tsx` at runtime and
 * *never type-checked in CI*. A contract package whose contract is not checked would be the vacuous-green
 * defect this repo keeps naming, so the primitives are written with `createElement` until the tree grows a
 * `jsx` config. See the report.
 *
 * What a primitive owns, and all it owns: its `container-type`, its class, and the containment decision. A
 * component placed inside cannot see the window, cannot see which slot it is in (that would be rule 9's
 * "knows its slot" fail), and cannot fork on width — because nothing here hands it a width.
 */

export interface LayoutProps {
  readonly children?: React.ReactNode;
  /** Layout classes only. A primitive takes no behavior props: no `compact`, no `isMobile`, no `dense`. */
  readonly class?: string;
  readonly id?: string;
}

/**
 * Render a primitive, asserting its children's *layout* placement first.
 *
 * The assertion is not decoration: it is the only place the matrix can bite at runtime, and it is given the
 * ancestor chain so a depth rule (`depth <= 2` for sheets, no second `split`) is checkable at all. A throw in
 * render is loud by design — 11 §9.5 refuses "an empty div" as the failure mode of a bad placement.
 */
function primitive<K extends LayoutSlot>(slot: K) {
  const p: LayoutPrimitive = PRIMITIVES[slot];
  const Component = (props: LayoutProps): React.ReactElement => {
    const className = props.class ? `${p.className} ${props.class}` : p.className;
    return React.createElement(
      'div',
      { class: className, ...(props.id === undefined ? {} : { id: props.id }) },
      props.children ?? null,
    );
  };
  Component.displayName = `ui.${slot}`;
  return Object.assign(Component, { slot, className: p.className, containerType: p.containerType });
}

export const Stack = primitive('stack');
export const Split = primitive('split');
export const PopoutSidebar = primitive('popout-sidebar');
export const OverlaySheet = primitive('overlay-sheet');
export const FullPage = primitive('full-page');

/** The five, keyed by slot. `LAYOUT_SLOTS` and this object are asserted equal by test/layout.test.ts. */
export const LAYOUT_COMPONENTS = {
  stack: Stack,
  split: Split,
  'popout-sidebar': PopoutSidebar,
  'overlay-sheet': OverlaySheet,
  'full-page': FullPage,
} as const satisfies Record<LayoutSlot, { slot: LayoutSlot }>;

/**
 * The open chain a container must know to refuse a third sheet. A page keeps one of these; `LayoutTree` is
 * what makes the depth rules in the matrix enforceable rather than aspirational.
 */
export class LayoutTree {
  private readonly chain: LayoutSlot[] = [];

  /** Root the tree at `slot`. Only `full-page` roots a page — 11 §2: it is the route-level document. */
  constructor(root: LayoutSlot = 'full-page') {
    if (root !== 'full-page') {
      throw new TypeError(`a layout tree must be rooted at full-page, not ${root}: ${root} is not a document`);
    }
    this.chain.push(root);
  }

  /** Push a child slot, or throw naming the matrix cell that refused it. */
  open(slot: LayoutSlot): void {
    const parent = this.chain[this.chain.length - 1] ?? 'full-page';
    assertPlacement(parent, slot, this.chain);
    this.chain.push(slot);
  }

  close(): LayoutSlot | undefined {
    return this.chain.length > 1 ? this.chain.pop() : undefined;
  }

  get depth(): readonly LayoutSlot[] {
    return this.chain;
  }

  /**
   * Validate a whole stored tree at once, for the fixture that re-renders yesterday's page document (gate
   * §9.5). Returns every problem rather than the first, because a document with one illegal placement usually
   * has three and a reviewer fixing them one CI run at a time is a gate that trains people to ignore it.
   */
  static problems(tree: LayoutNode): string[] {
    const problems: string[] = [];
    const walk = (node: LayoutNode, ancestors: LayoutSlot[]): void => {
      const parent = ancestors[ancestors.length - 1] ?? node.slot;
      if (ancestors.length > 0) {
        const problem = placementProblem(parent, node.slot, ancestors);
        if (problem) problems.push(`${node.slot} under ${parent}: ${problem}`);
      }
      for (const child of node.children ?? []) walk(child, [...ancestors, node.slot]);
    };
    walk(tree, []);
    return problems;
  }
}

export interface LayoutNode {
  readonly slot: LayoutSlot;
  readonly children?: readonly LayoutNode[];
}

/** Every slot the matrix says a `full-page` may hold — exported so the parity gate can ask it. */
export function slotsReachableFrom(root: LayoutSlot): LayoutSlot[] {
  const seen = new Set<LayoutSlot>();
  const visit = (slot: LayoutSlot): void => {
    for (const child of PRIMITIVES[slot].mayContain) {
      if (!seen.has(child)) {
        seen.add(child);
        visit(child);
      }
    }
  };
  visit(root);
  return [...seen].sort() as LayoutSlot[];
}

export { LAYOUT_SLOTS };
