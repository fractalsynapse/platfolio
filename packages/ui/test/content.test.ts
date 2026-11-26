/**
 * The content-layout primitives (11 §2, rule 2, D63; #267 item 5).
 *
 * These are the tests that make the primitive real rather than named. The marketing page used to compose itself
 * — a `68ch` measure, a `container-type` on `main`, an `@container (min-width: 48rem)` that turned a row of three
 * points into three columns — and the values in this file are those decisions, moved to where a gate can read
 * them. So the interesting assertions are not "the CSS exists" but: the threshold is data, the measure is a
 * token and not a number, the sheet reproduces from the table, and a page cannot invent a fourth class that
 * nothing styles.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  CONTENT_CLASSES, CONTENT_SLOTS, CONTENT_TABLE, contentDeclarations, contentWideDeclarations, isContentClass,
  renderContentCss,
} from '../src/layout/content.ts';
import { CONTENT_CLASSES as BARREL_CLASSES, CONTENT_SLOTS as BARREL_SLOTS, MEASURE, measureVar } from '../src/index.ts';
import { stripCssComments } from '../../../scripts/ui-source-scan.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_REL = 'packages/ui/src/layout/content.css';
const SOURCE_REL = 'packages/ui/src/layout/content.ts';

/** Recomputed here, exactly as `gen-ui-css.ts` does it, so a header edited to look current fails (D63). */
const digestOfSource = (): string =>
  `sha256/${createHash('sha256').update(fs.readFileSync(path.join(ROOT, SOURCE_REL))).digest('hex').slice(0, 16)}`;

const SHEET_DIGEST = 'sha256/committed-file-is-compared-elsewhere';

test('there are exactly the two content primitives the table declares, and the barrel exports the same list', () => {
  assert.deepEqual([...CONTENT_SLOTS], ['prose', 'columns']);
  assert.deepEqual(CONTENT_CLASSES, CONTENT_SLOTS.map((slot) => CONTENT_TABLE[slot].className));
  assert.deepEqual([...BARREL_SLOTS], [...CONTENT_SLOTS], 'the package entry hides a primitive the module declares');
  assert.deepEqual([...BARREL_CLASSES], [...CONTENT_CLASSES], 'the package entry exports different class names');
});

test('every content primitive declares its container, with no default to fall back on', () => {
  for (const slot of CONTENT_SLOTS) {
    const p = CONTENT_TABLE[slot];
    assert.equal(p.containerType, 'inline-size', `${slot} declares ${JSON.stringify(p.containerType)}`);
  }
});

test('the committed content.css reproduces from the table, byte for byte', () => {
  const committed = fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8');
  const regenerated = renderContentCss(digestOfSource());
  if (committed !== regenerated) {
    const a = committed.split('\n');
    const b = regenerated.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    assert.fail(`${OUT_REL} does not reproduce from ${SOURCE_REL}. First difference at line ${String(i + 1)}:\n`
      + `  committed: ${JSON.stringify(a[i])}\n  generated: ${JSON.stringify(b[i])}\n`
      + 'Edit the table and run `pnpm run ui:css`; a hand edit here is a second description of the layout.');
  }
  assert.match(committed, /GENERATED FILE -- DO NOT EDIT/);
});

/**
 * The measure is a token. This is the assertion that makes D63 true for content layout rather than for colour
 * alone: the sheet must reference `var(--ui-measure-content)`, and the token module must actually emit that
 * name with the value the marketing page has been using.
 */
test('the line measure is one token, referenced and not restated', () => {
  assert.deepEqual(MEASURE, { content: '68ch' }, 'the measure changed; the only page that uses it should be re-reviewed');
  assert.equal(measureVar('content'), '--ui-measure-content');

  const css = renderContentCss(SHEET_DIGEST);
  assert.match(css, /max-inline-size: var\(--ui-measure-content\);/, 'prose does not reference the measure token');
  assert.equal(contentWideDeclarations(CONTENT_TABLE.columns) === null, false, 'columns lost its wide composition');

  // The other half: the emitted token sheet really carries the value, or the reference resolves to nothing and
  // a page silently loses its line length. This is the same cross-sheet check `components.test.ts` runs on
  // --ui-target-primary.
  const tokens = fs.readFileSync(path.join(ROOT, 'packages/ui/src/tokens.css'), 'utf8');
  assert.match(tokens, /--ui-measure-content: 68ch;/, 'tokens.css does not define the measure that content.css references');

  // And no length in the sheet is a number someone typed.
  const body = stripCssComments(css);
  assert.equal(body.match(/max-inline-size:\s*[^;]*\d+(?:\.\d+)?(?:ch|rem|px)/g), null, 'a literal measure in the generated sheet');
});

test('the floor is one column and the wide case adds tracks, never capability', () => {
  const prose = contentDeclarations(CONTENT_TABLE.prose);
  assert.ok(prose.includes('display: flex;') && prose.includes('flex-direction: column;'), 'prose is not a column');
  assert.equal(contentWideDeclarations(CONTENT_TABLE.prose), null, 'prose gained a second composition; nothing in 11 §2 asks for one');

  const columns = contentDeclarations(CONTENT_TABLE.columns);
  assert.deepEqual(columns, [
    'container-type: inline-size;',
    'display: flex;',
    'flex-direction: column;',
    'gap: var(--ui-space-5);',
  ], `the columns floor drifted: ${JSON.stringify(columns)}`);
  assert.equal(columns.some((d) => d.includes('grid')), false, 'a grid at the floor is a composition the 360 px case never asked for');
  const wide = contentWideDeclarations(CONTENT_TABLE.columns);
  assert.ok(wide !== null);
  assert.deepEqual(wide, [
    'display: grid;',
    'grid-template-columns: repeat(3, minmax(0, 1fr));',
    'gap: var(--ui-space-6);',
  ], `the columns wide composition drifted: ${JSON.stringify(wide)}`);

  // The threshold is data, and the sheet's query is the only place it is spelled.
  const css = renderContentCss(SHEET_DIGEST);
  const blocks = [...css.matchAll(/@container \(min-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['48', '58'], 'the content breakpoint set drifted from CONTENT_TABLE');
  assert.equal(CONTENT_TABLE.columns.wideFromRem, 48);
  assert.equal(CONTENT_TABLE.columns.contextWideFromRem, 58);
});

test('a class the table does not declare is refused, so a page cannot invent a fourth primitive', () => {
  assert.equal(isContentClass('ui-prose'), true);
  assert.equal(isContentClass('ui-columns'), true);
  assert.equal(isContentClass('ui-measure'), false, 'a measure-only class would be a second name for prose\'s own cap');
  assert.equal(isContentClass('three'), false, 'the hand-rolled class this change removed must not come back');
  assert.equal(isContentClass('ui-split'), false, 'a screen slot is not a content primitive, and the tables are not interchangeable');
});

test('the generated sheet carries no width @media, the rule §9.3 audits from the other side', () => {
  const body = stripCssComments(renderContentCss(SHEET_DIGEST));
  assert.equal(/@media[^{]*\b(width|min-width|max-width)\b/i.test(body), false, 'a width @media in the content sheet');
  assert.match(body, /@container\s*\(/, 'no @container query, so the primitive declares a container nobody asks about');
});

/**
 * The half that is about `apps/site`, stated here because the primitive is only real if the app uses it: the
 * marketing page names the classes, and the app stylesheet owns no breakpoint. Gate §D65 refuses a width query
 * in app CSS and `test/gates-falsify.test.ts` plants one to prove that bites; this is the quieter check that
 * the *replacement* actually landed, because a gate can only refuse what it looks for.
 */
test('apps/site imports the sheet and names the primitives instead of composing itself', () => {
  const sheet = fs.readFileSync(path.join(ROOT, 'apps/site/src/styles/site.css'), 'utf8');
  assert.ok(sheet.includes("@import '@platfolio/ui/content.css';"), 'site.css does not import the content sheet');
  // Comments are read on purpose... for the assertions about what is *gone*: the file's own header records the
  // `68ch` and the `@container` it used to hold, and a check that fired on that sentence would be the false
  // positive 11 §9 names as the reason gates get switched off. So the body is the code, and the prose is prose.
  const sheetBody = stripCssComments(sheet);
  assert.equal(sheetBody.match(/@container|@media/g), null, 'a width query is back in app CSS');
  assert.equal(/max-width:\s*68ch/.test(sheetBody), false, 'the measure is restated in the app instead of referenced');
  assert.equal(/container-type\s*:/.test(sheetBody), false, 'the app declares its own container again');

  const landing = fs.readFileSync(path.join(ROOT, 'apps/site/src/pages/index.astro'), 'utf8');
  assert.match(landing, /class="ui-prose ui-public-intro"/, 'the signup introduction does not name the prose primitive');
  assert.match(landing, /class="ui-columns" data-columns="2"/, 'the welcome panel does not use the two-column primitive');
});
