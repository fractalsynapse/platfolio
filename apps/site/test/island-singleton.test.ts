import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { stripComments } from '../../../scripts/ui-source-scan.ts';

const SRC = path.resolve(import.meta.dirname, '../src');

/**
 * The source-level half of D65's risk, and the honest limits of it.
 *
 * D65 names the danger in its own words: *"the island constructs the SDK context and the signal registry exactly
 * once, because a second hydration means two registries and two token stores."* Two contexts means two
 * `PollTransport` instances (two freshness clocks, so one panel says "4s ago" beside another saying "90s ago"
 * about the same operation), two `SignalBus` objects (a context switch emitted into one and listened for on the
 * other, which fails silently), and two token bags (two refresh schedules for one session, which is how a refresh
 * becomes a 401 nobody can explain).
 *
 * Three things are proved here, over text, and one is proved somewhere else:
 *
 *  1. **One island element per page**, by the only count that matters — the `client:*` directive a page hands to
 *     Astro. More than one means two hydrations on one document, and it is visible in source before it is visible
 *     in a browser.
 *  2. **One construction point.** Every `createShellContext` call sits in `src/islands/`, and no page or layout
 *     builds an `SdkContextValue`, a `SignalBus` or a `PollTransport` itself. That is what "the shell creates one
 *     and passes it down" means as a grep.
 *  3. **No second data path.** The island never hands the transport a route table of its own (#258 generated
 *     `ENDPOINTS` is the one spelling), and the app has no `@platfolio/page-schema`-style back door into the API.
 *
 * What is NOT proved by this file, stated because the temptation is to read it as proof: that a browser hydrates
 * exactly one React root, that the singleton is respected at run time, or that the props the page bakes are the
 * props the island reads. Those need either a browser or the module itself — so the runtime claim is tested where
 * it can be tested, in `packages/ui/test/shell-context-singleton.test.ts`, and the artifact claim in
 * `apps/site/test/build-output.test.ts`. `docs/design/11` calls gate §9.7's browser half NOT RUN for the same
 * reason, and this file does not upgrade that verdict by inference.
 */

const sources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|tsx|astro)$/.test(entry.name)) out.push(abs);
  }
  return out;
};

const ROOT = path.resolve(import.meta.dirname, '../../..');
const rel = (abs: string): string => path.relative(ROOT, abs).split(path.sep).join('/');
const text = (abs: string): string => fs.readFileSync(abs, 'utf8');
const pages = (): string[] => sources(path.join(SRC, 'pages'));

test('the walk found the pages it claims to audit', () => {
  const found = pages().map(rel);
  for (const expected of ['apps/site/src/pages/index.astro', 'apps/site/src/pages/dashboard.astro', 'apps/site/src/pages/callback.astro']) {
    assert.ok(found.includes(expected), `${expected} is missing, so the assertions below would pass on an empty list -- the vacuous green this package exists to refuse`);
  }
});

test('no page mounts more than one island', () => {
  const directives: string[] = [];
  for (const page of pages()) {
    const clean = stripComments(text(page));
    const found = clean.match(/client:(load|visible|idle|media|only)/g) ?? [];
    if (found.length > 1) directives.push(`${rel(page)}: ${String(found.length)} client:* directives`);
  }
  assert.deepEqual(directives, [], 'one island per page is D65\'s sentence; a second hydration is two registries and two token stores');
});

test('the dashboard mounts exactly one, and the landing page mounts none', () => {
  const dashboard = stripComments(text(path.join(SRC, 'pages/dashboard.astro')));
  assert.equal((dashboard.match(/client:only|client:load|client:visible|client:idle|client:media/g) ?? []).length, 1, 'the dashboard is the island route; if it hydrates nothing the claim below is decoration');
  const landing = stripComments(text(path.join(SRC, 'pages/index.astro')));
  assert.equal((landing.match(/client:(load|visible|idle|media|only)/g) ?? []).length, 0, '/ must ship no client JavaScript');
});

test('only island modules construct a shell context', () => {
  const offenders: string[] = [];
  for (const file of sources(SRC)) {
    const clean = stripComments(text(file));
    if (!/createShellContext\(/.test(clean)) continue;
    if (!rel(file).startsWith('apps/site/src/islands/')) offenders.push(rel(file));
  }
  assert.deepEqual(offenders, [], 'createShellContext is the one door; a page that builds its own context is the second hydration D65 refuses');
});

test('the app never builds the pieces the shell context owns', () => {
  const forbidden: readonly (readonly [RegExp, string])[] = [
    [/\bSdkProvider\b/, 'SdkProvider (the SDK context is created once, in createShellContext)'],
    [/\bSignalsProvider\b/, 'SignalsProvider (same reason)'],
    [/\bnew PollTransport\(/, 'a transport built by hand (the shell owns the one instance)'],
    [/\bcreateSignalBus\(/, 'a second signal registry'],
    [/\bcreateBrowserAuthSource\(/, 'a second token bag'],
  ];
  const hits: string[] = [];
  for (const file of sources(SRC)) {
    const clean = stripComments(text(file));
    for (const [pattern, why] of forbidden) if (pattern.test(clean)) hits.push(`${rel(file)}: ${why}`);
  }
  assert.deepEqual(hits, [], 'one page, one context, built by one function');
});

test('the island hands the transport no route table of its own (#258)', () => {
  const hits: string[] = [];
  for (const file of sources(SRC)) {
    const clean = stripComments(text(file));
    if (/\bendpoints\s*:/.test(clean)) hits.push(`${rel(file)}: an \`endpoints:\` field -- the route table is generated from the spec, and a shell that supplies one is a second source of truth`);
    if (/from '@platfolio\/api-contract/.test(clean)) hits.push(`${rel(file)}: imports the generated contract directly -- components and shells reach it through the SDK`);
  }
  assert.deepEqual(hits, [], 'the SDK routes from ENDPOINTS; nothing in apps/site may restate the paths');
});

test('no source in the app spells out a control-plane path', () => {
  // Rule 1's other half: `/api/v1/...` belongs to the spec and the generated table, not to a page.
  const hits: string[] = [];
  for (const file of sources(SRC)) {
    const clean = stripComments(text(file));
    for (const match of clean.matchAll(/["'`]\/api\/v1[/"'`]/g)) {
      hits.push(`${rel(file)}:${String(clean.slice(0, match.index ?? 0).split('\n').length)}: a literal spec path "${match[0]}"`);
    }
  }
  assert.deepEqual(hits, [], 'a hand-written path is a second description of the API, and the drift is invisible until a request 404s');
});
