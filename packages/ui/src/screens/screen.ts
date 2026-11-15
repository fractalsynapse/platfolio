import * as React from 'react';
import { componentById } from '../registry.ts';
import { LayoutTree, LAYOUT_COMPONENTS, placementProblem, PRIMITIVES, type LayoutSlot } from '../layout/index.ts';
import type { LayoutNode } from '../layout/index.ts';
import type { AnyComponentContract } from '../contract.ts';
import type { OperationId } from '@platfolio/api-contract/generated/types';

/**
 * A screen as data (11 §1, §9.5, §9.6), and the reason the composition lives in one place rather than in a
 * component's JSX.
 *
 * The claim this structure is built to keep true is 11 §2 acceptance (d): *the set of API operations reachable
 * from a screen's components at 360 px equals the set reachable at 1920 px, derived mechanically from the
 * components' declared `reads`*. That sentence is only checkable if the composition is data a gate can walk. If
 * the layout lived in a component's JSX, the parity gate would have to parse JSX or trust a comment, and either
 * way "not run" would be the honest report. So:
 *
 * - `ScreenDocument` says which slots exist, in which nesting, and which registered component sits in each.
 * - `renderScreen()` is the only reader that turns it into elements, resolving every id through the build-time
 *   registry -- so an id that is not registered throws at validation instead of rendering an empty div (11 §9.5),
 *   and the gate and the render cannot disagree about what a screen contains, because they read the same object.
 * - `capabilityParityProblems()` is the gate's half, and it asks the question through `floorSlots` on the
 *   primitives, which is 11 §2's degradation stated as data rather than as prose in a table.
 *
 * Nothing here evaluates anything. A document holds ids, slots and props objects: no expressions, no module
 * specifiers, no functions from a server. That is rule 6, and 10's Tier 2 boundary behind it -- an in-process
 * extension shares the heap of the user's session.
 */

export interface ScreenNode {
  readonly slot: LayoutSlot;
  /** Registered component ids rendered directly in this node. */
  readonly components?: readonly string[];
  readonly children?: readonly ScreenNode[];
}

export interface ScreenDocument {
  readonly id: string;
  /** Said to a person, and the handle a stored page document would carry. */
  readonly title: string;
  readonly root: ScreenNode;
}

/** Every `(slot, component)` pair in the document, in reading order, with the chain above it. */
export function screenPlacements(screen: ScreenDocument): { slot: LayoutSlot; component: string; ancestors: readonly LayoutSlot[] }[] {
  const found: { slot: LayoutSlot; component: string; ancestors: readonly LayoutSlot[] }[] = [];
  const walk = (node: ScreenNode, ancestors: readonly LayoutSlot[]): void => {
    for (const id of node.components ?? []) found.push({ slot: node.slot, component: id, ancestors });
    for (const child of node.children ?? []) walk(child, [...ancestors, node.slot]);
  };
  walk(screen.root, []);
  return found;
}

/** The document as the layout-only tree `LayoutTree.problems` already knows how to judge. */
export function screenLayoutTree(node: ScreenNode): LayoutNode {
  return { slot: node.slot, children: (node.children ?? []).map(screenLayoutTree) };
}

/**
 * The operations a screen can reach at one width.
 *
 * `floor` means the container is at the single-column width, and the rule is 11 §2's, read off the primitive
 * table: content in a `split` lands in a stack or a pushed sheet, content in a `popout-sidebar` lands in a sheet.
 * A component whose contract does not declare any of its placement's floor homes has nowhere to be rendered at
 * 360 px, so the operations it `reads` are unreachable there -- and that difference, not a screenshot, is what
 * this function returns.
 */
export function reachableOperations(screen: ScreenDocument, width: 'floor' | 'wide'): OperationId[] {
  const operations = new Set<OperationId>();
  for (const placement of screenPlacements(screen)) {
    const contract = findContract(placement.component);
    // An id the registry does not hold is skipped *here* and reported by name in `capabilityParityProblems`,
    // which is where a reviewer needs to see it. This function used to call `componentById` directly and throw,
    // so the gate whose job is to print "this screen names a component that is not registered" died of that error
    // instead of printing it: the refusal was real, and the report was not.
    if (contract === undefined) continue;
    if (width === 'wide' || hasFloorHome(placement.slot, placement.component)) {
      for (const operation of contract.reads ?? []) operations.add(operation);
    }
  }
  return [...operations].sort() as OperationId[];
}

/** The registry lookup that does not throw, for the paths whose job is to report rather than to fail. */
function findContract(componentId: string): AnyComponentContract | undefined {
  try {
    return componentById(componentId);
  } catch {
    return undefined;
  }
}

function hasFloorHome(slot: LayoutSlot, componentId: string): boolean {
  const homes = PRIMITIVES[slot].floorSlots;
  const contract = findContract(componentId);
  // `false`, not a throw: a component that cannot be resolved has no floor home by every definition, and the
  // unregistered id is reported by the caller that collects problems.
  if (contract === undefined) return false;
  const declared = contract.slots as readonly string[];
  return homes.some((home) => declared.includes(home));
}

/**
 * Every reason this screen does not satisfy 11 §2 acceptance (d) and §9.11, gathered rather than short-circuited.
 *
 * Three claims, and the third is the one that catches a real mistake rather than a typo:
 *
 * 1. the composition obeys the containment matrix (`LayoutTree.problems`, the cell-by-cell refusals 11 §2 lists);
 * 2. every placement names a slot the component's own contract declares, so nobody is rendered in a primitive it
 *    never promised to behave inside;
 * 3. the operation set at the floor equals the operation set at wide. A difference means a capability exists only
 *    when the window is wide -- someone forked a component or built the screen desktop-first -- and the mobile
 *    user silently got a smaller product. That is the failure §9.11 exists to make unfashionable.
 */
export function capabilityParityProblems(screen: ScreenDocument): string[] {
  const problems: string[] = [];

  for (const problem of LayoutTree.problems(screenLayoutTree(screen.root))) {
    problems.push(`${screen.id}: ${problem}`);
  }

  const seen = new Set<string>();
  for (const placement of screenPlacements(screen)) {
    const key = `${placement.slot}>${placement.component}`;
    if (seen.has(key)) {
      problems.push(`${screen.id}: ${placement.component} is placed twice in ${placement.slot} -- one component, two positions, and no answer to which one a signal reaches`);
      continue;
    }
    seen.add(key);

    let contract;
    try {
      contract = componentById(placement.component);
    } catch {
      // The throw is the gate's own answer (11 §9.5), and `renderScreen` would have hit it first. Recorded here
      // as a problem rather than allowed to escape, because a reviewer wants every gap in one report.
      problems.push(`${screen.id}: ${key} names a component that is not in the build-time registry`);
      continue;
    }
    if (!(contract.slots as readonly string[]).includes(placement.slot)) {
      problems.push(`${screen.id}: ${key} places ${placement.component} in a slot its contract does not declare (slots: ${contract.slots.join(', ') || 'none'}) -- an unlisted slot is a contract violation, not ugliness (rule 2)`);
    }
    if (!hasFloorHome(placement.slot, placement.component)) {
      problems.push(`${screen.id}: ${key} has no floor home: ${placement.slot} projects its content to ${PRIMITIVES[placement.slot].floorSlots.join(' or ')} at the single-column width, and ${placement.component} declares none of those -- the operations it reads would exist only when the container is wide (11 §2 acceptance (d))`);
    }
  }

  const floor = reachableOperations(screen, 'floor');
  const wide = reachableOperations(screen, 'wide');
  const wideOnly = wide.filter((operation) => !floor.includes(operation));
  if (wideOnly.length > 0) {
    problems.push(`${screen.id}: reachable only when wide: ${wideOnly.join(', ')} -- desktop adds simultaneity, never features (gate §9.11)`);
  }

  return problems;
}

/**
 * The one reader that turns a document into elements.
 *
 * `propsFor` is how a container hands each component the data it needs -- which is 11 §1's first sanctioned door
 * ("props from its container"), and the reason the document itself holds no data: a stored page document that
 * carried an `Instance` would be a cached server response in a document that is supposed to be data about
 * *presentation*. The props object is validated by the component's own schema at the point of resolution, so a
 * screen cannot be rendered with a prop set nothing checked.
 */
export function renderScreen(screen: ScreenDocument, propsFor: (componentId: string, slot: LayoutSlot) => Record<string, unknown>): React.ReactElement {
  const renderNode = (node: ScreenNode): React.ReactElement => {
    const Primitive = LAYOUT_COMPONENTS[node.slot];
    const children = [
      ...(node.components ?? []).map((id) => {
        const contract = componentById(id);
        const props = propsFor(id, node.slot);
        const issues = contract.props['~standard'].validate(props);
        if (!(issues instanceof Promise) && issues.issues) {
          const detail = issues.issues.map((issue) => `${(issue.path ?? []).map(String).join('.')}: ${issue.message}`).join('; ');
          throw new TypeError(`screen "${screen.id}" props for ${id} in ${node.slot} fail its own props schema: ${detail}`);
        }
        return React.createElement(contract.render, { ...props, key: `${node.slot}:${id}` });
      }),
      ...(node.children ?? []).map(renderNode),
    ];
    return React.createElement(Primitive, { class: `ui-screen-${node.slot}` }, ...children);
  };

  if (screen.root.slot !== 'full-page') {
    throw new TypeError(`screen "${screen.id}" is rooted at ${screen.root.slot}: only full-page is a document (11 §2)`);
  }
  return renderNode(screen.root);
}

/** The primitives a screen uses, so a gate can say "this screen does not compose the five" instead of guessing. */
export function screenSlots(screen: ScreenDocument): LayoutSlot[] {
  const found = new Set<LayoutSlot>();
  const walk = (node: ScreenNode): void => {
    found.add(node.slot);
    for (const child of node.children ?? []) walk(child);
  };
  walk(screen.root);
  return [...found].sort() as LayoutSlot[];
}

export { placementProblem };
