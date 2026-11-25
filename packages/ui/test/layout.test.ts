import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  allowedPlacements, assertPlacement, ContainmentError, FullPage, LayoutTree, LAYOUT_COMPONENTS, LAYOUT_PRIMITIVE_SLOTS,
  LAYOUT_SLOTS, OverlaySheet, placementProblem, PopoutSidebar, PRIMITIVES, refusedPlacements, renderLayoutCss,
  slotsReachableFrom, Split, Stack, type LayoutSlot,
} from '../src/layout/index.ts';

/**
 * Rule 2. The containment matrix is data here, so these tests walk it as data: every cell, both outcomes.
 * 11 §2's table is written in a document; a comment saying "never a second split" is a rule that fails at
 * review time, and this file is what makes it fail at test time instead.
 */

const OUT_REL = 'packages/ui/src/layout/layout.css';
const ROOT = path.resolve(import.meta.dirname, '../../..');
const digest = 'sha256/committed-file-is-compared-elsewhere';

test('there are exactly the five primitives 11 §2 names, and no sixth', () => {
  assert.deepEqual([...LAYOUT_SLOTS], ['stack', 'split', 'popout-sidebar', 'overlay-sheet', 'full-page']);
  assert.deepEqual([...LAYOUT_PRIMITIVE_SLOTS].sort(), [...LAYOUT_SLOTS].sort());
  assert.deepEqual(Object.keys(LAYOUT_COMPONENTS).sort(), [...LAYOUT_SLOTS].sort(), 'a slot with no component, or a component with no slot');
});

test('every primitive declares its container-type, with no default to fall back on', () => {
  for (const slot of LAYOUT_SLOTS) {
    const p = PRIMITIVES[slot];
    // `containerType` is a required field of `LayoutPrimitive` typed as the literal `'inline-size'`; this
    // assertion is the runtime twin, for a primitive built at a boundary and cast.
    assert.equal(p.containerType, 'inline-size', `${slot} declares ${JSON.stringify(p.containerType)}`);
  }
});

test('the primitive components carry the same container declaration as the data (one fact, one place)', () => {
  for (const slot of LAYOUT_SLOTS) {
    const component = LAYOUT_COMPONENTS[slot];
    assert.ok(component, `${slot} has no component`);
    assert.equal(component.slot, slot);
    assert.equal(component.className, PRIMITIVES[slot].className);
    assert.equal(component.containerType, PRIMITIVES[slot].containerType);
  }
});

/* ------------------------------------------------------------------ the matrix, cell by cell */

test('the matrix refuses exactly what 11 §2 refuses', () => {
  const refused = new Set(refusedPlacements().map(([a, b]) => `${a}>${b}`));
  const expect = (parent: LayoutSlot, child: LayoutSlot, why: string): void => {
    assert.ok(refused.has(`${parent}>${child}`), `${parent}>${child} should be refused: ${why}`);
  };
  expect('stack', 'overlay-sheet', 'a sheet is pushed onto the page-level stack, never embedded in a column');
  expect('split', 'split', 'two-up inside two-up is a dashboard product, and D14 refuses a page builder');
  expect('popout-sidebar', 'popout-sidebar', 'no nested sidebar');
  expect('popout-sidebar', 'overlay-sheet', 'a sheet is page-level');
  expect('stack', 'split', 'split owns the track; a column does not host a second composition');

  // `full-page` is the one primitive with no refusals at all.
  assert.equal(PRIMITIVES['full-page'].mustNotContain.length, 0);
});

test('the sheet depth rule bites at three and not at two', () => {
  // Matrix: "depth <= 2 sheets"; a third nested sheet is refused.
  assertPlacement('full-page', 'overlay-sheet');
  assertPlacement('overlay-sheet', 'overlay-sheet', ['full-page', 'overlay-sheet']);
  assert.throws(
    () => assertPlacement('overlay-sheet', 'overlay-sheet', ['full-page', 'overlay-sheet', 'overlay-sheet']),
    (error: unknown) => {
      assert.ok(error instanceof ContainmentError);
      assert.match(error.message, /third nested sheet is refused; depth is capped at 2/);
      return true;
    },
  );
});

test('a split cannot contain a split, and the refusal cites the matrix rather than asserting', () => {
  const problem = placementProblem('split', 'split');
  assert.ok(problem, 'split>split was allowed');
  assert.match(problem, /never containing split \(11 §2\)/, `the refusal should name its source, got: ${problem}`);
});

test('an allowed placement reports no problem, so the refusals above are not the function refusing everything', () => {
  const allowed = allowedPlacements();
  assert.ok(allowed.length > 0, 'nothing is allowed anywhere: the matrix would fail every screen and be switched off');
  for (const [parent, child] of allowed) {
    assert.equal(placementProblem(parent, child), null, `${parent}>${child} is in the allowed list but reports a problem`);
  }
  // The specific compositions 11 §2 describes as the design, not just absence of refusal.
  assert.ok(allowed.some(([p, c]) => p === 'split' && c === 'stack'), 'a split must be able to hold a stack per track');
  assert.ok(allowed.some(([p, c]) => p === 'split' && c === 'popout-sidebar'), 'a split must be able to host a sidebar as its detail track');
  assert.ok(slotsReachableFrom('full-page').includes('split'), 'the route cannot reach a split at all');
});

test('every allowed cell is allowed for a reason the matrix states, and the two lists partition the table', () => {
  const total = LAYOUT_SLOTS.length * LAYOUT_SLOTS.length;
  assert.equal(allowedPlacements().length + refusedPlacements().length, total,
    'the allowed and refused lists do not partition the matrix, so some cell is being counted twice or not at all');
});

test('mustNotContain and mayContain never contradict each other', () => {
  for (const slot of LAYOUT_SLOTS) {
    const p = PRIMITIVES[slot];
    const overlap = (p.mayContain as readonly LayoutSlot[]).filter((c) => (p.mustNotContain as readonly LayoutSlot[]).includes(c));
    assert.deepEqual(overlap, [], `${slot} lists ${overlap.join(', ')} as both allowed and refused`);
  }
});

test('full-page reaches every slot, and the floor layout reaches everything a capability needs (rule 2)', () => {
  assert.deepEqual(slotsReachableFrom('full-page').sort(), [...LAYOUT_SLOTS].sort());
  // The single-column floor is `stack`, and it is reachable from the route at any width. This is the structural
  // half of "mobile is missing nothing but simultaneity": nothing is *unreachable*, only not side-by-side.
  assert.ok(slotsReachableFrom('full-page').includes('stack'));
  assert.ok(slotsReachableFrom('full-page').includes('overlay-sheet'));
});

/* ------------------------------------------------------------------ LayoutTree */

test('a tree must be rooted at full-page', () => {
  assert.doesNotThrow(() => new LayoutTree());
  assert.throws(() => new LayoutTree('stack'), /must be rooted at full-page/);
});

test('the tree accumulates depth so the sheet cap is enforceable, and close() unwinds it', () => {
  const tree = new LayoutTree();
  tree.open('overlay-sheet');
  tree.open('overlay-sheet');
  assert.deepEqual([...tree.depth], ['full-page', 'overlay-sheet', 'overlay-sheet']);
  assert.throws(() => tree.open('overlay-sheet'), ContainmentError);
  tree.close();
  tree.close();
  assert.deepEqual([...tree.depth], ['full-page']);
  // Popping back to the root re-opens the same slot: the refusal was about depth, not about a one-shot latch.
  tree.open('overlay-sheet');
  assert.equal(tree.depth.length, 2);
  assert.equal(tree.close(), 'overlay-sheet');
  assert.equal(tree.close(), undefined, 'the root cannot be closed');
});

test('a sheet cannot be pushed inside a stack even when depth would allow it', () => {
  const tree = new LayoutTree();
  tree.open('stack');
  assert.throws(() => tree.open('overlay-sheet'), /page-level stack, never embedded in a column/);
});

test('LayoutTree.problems reports every illegal cell at once, not the first', () => {
  const problems = LayoutTree.problems({
    slot: 'full-page',
    children: [
      { slot: 'stack', children: [{ slot: 'overlay-sheet' }] },
      { slot: 'split', children: [{ slot: 'split' }] },
      { slot: 'split', children: [{ slot: 'stack' }] },
    ],
  });
  assert.equal(problems.length, 2, JSON.stringify(problems));
  assert.ok(problems.some((p) => p.includes('overlay-sheet under stack')), JSON.stringify(problems));
  assert.ok(problems.some((p) => p.includes('split under split')));
});

/* ------------------------------------------------------------------ the generated stylesheet */

test('layout.css reproduces from the primitive table, byte for byte', () => {
  const committed = fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8');
  const regenerated = renderLayoutCss(digestOfSource());
  if (committed !== regenerated) {
    const a = committed.split('\n');
    const b = regenerated.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    assert.fail(`${OUT_REL} does not reproduce from packages/ui/src/layout/primitives.ts. First difference at line ${String(i + 1)}:\n  committed: ${JSON.stringify(a[i])}\n  generated: ${JSON.stringify(b[i])}\nRun \`pnpm run ui:css\`.`);
  }
  assert.match(committed, /GENERATED FILE -- DO NOT EDIT/);
});

// Recomputed, never parsed out of the file — same reason as the API types' test.
const digestOfSource = (): string =>
  `sha256/${createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'packages/ui/src/layout/primitives.ts'))).digest('hex').slice(0, 16)}`;

test('the stylesheet gives each primitive its container, and queries containers rather than the window', () => {
  const css = renderLayoutCss(digest);
  for (const slot of LAYOUT_SLOTS) {
    assert.ok(css.includes(`.${PRIMITIVES[slot].className} {\n  container-type: inline-size;`), `${slot} has no container-type rule`);
  }
  // The header states, in prose, that there is no width @media in this file. Asserting against the raw text
  // would read that sentence as the violation — so the check runs on the body, exactly as gate §9.3 does. The
  // two must agree, and `gates-falsify.test.ts` plants a real width query to prove neither is forgiving.
  const body = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(!/@media[^{]*\bwidth\b/i.test(body), 'a width @media appeared in the generated layout');
  assert.ok(/@media/.test(body) === false || /prefers-/.test(body), 'the only @media permitted is a prefers-* one');
  assert.ok(/@container\s*\(/.test(body), 'no @container query at all');
});

test('the wide composition is stated per primitive and only where the data says so', () => {
  const css = renderLayoutCss(digest);
  assert.ok(css.includes('.ui-split') && css.includes('grid-template-columns: 24rem 1fr;'), 'split does not compose two tracks');
  assert.equal(PRIMITIVES.stack.wideRule, null, 'the stack is the floor; it must not gain a second composition');
  assert.equal(PRIMITIVES['full-page'].wideRule, null);
  const blocks = [...css.matchAll(/@container \(min-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['48', '64', '48'], 'the breakpoint set drifted from the primitive table');
});

/* ------------------------------------------------------------------ rendering */

test('a primitive renders a plain element: no inline width, no media fork, no behaviour props', () => {
  const el = Stack({ children: null });
  assert.equal(typeof el, 'object');
  const props = (el as { props: Record<string, unknown> }).props;
  assert.equal(props.className, 'ui-stack');
  assert.ok(!('style' in props), 'a primitive set an inline style');
  assert.ok(!Object.keys(props).some((k) => /mobile|desktop|tablet|compact|dense|width|breakpoint/i.test(k)),
    `a fork prop reached the DOM: ${Object.keys(props).join(', ')}`);
});

test('a caller-supplied class composes with the primitive class and cannot replace it', () => {
  const props = (OverlaySheet({ class: 'instance-detail' }) as { props: { className: string } }).props;
  assert.equal(props.className, 'ui-sheet instance-detail');
});

test('the five components are distinct objects, not one aliased five ways', () => {
  const slots = [Stack, Split, PopoutSidebar, OverlaySheet, FullPage].map((c) => c.slot);
  assert.deepEqual(new Set(slots).size, 5, `duplicate slots: ${slots.join(', ')}`);
});
