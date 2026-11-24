import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SITE = path.join(ROOT, 'apps/site');
const DIST = path.join(SITE, 'dist');

/**
 * Loopback values for a build that no browser will ever visit.
 *
 * They are test inputs, not endpoints: the site's own configuration refuses to carry defaults (D47), so a build
 * has to be told where things are, and the honest answer for a test is a machine-local address that cannot be
 * mistaken for a deployment. Nothing here reaches a tracked file — `dist/` and `.astro/` are both ignored, and
 * `check-project.ts`'s endpoint rule reads tracked files only.
 */
const BUILD_ENV = {
  PLATFOLIO_SITE_ORIGIN: 'http://localhost:4321',
  PLATFOLIO_URL: 'http://localhost:8080',
  PLATFOLIO_IDENTITY_ISSUER: 'http://localhost:8081/realms/platfolio',
};

const astro = (args: readonly string[]): void => {
  execFileSync(path.join(SITE, 'node_modules/.bin/astro'), [...args], {
    cwd: SITE,
    encoding: 'utf8',
    env: { ...process.env, ...BUILD_ENV },
    stdio: 'pipe',
  });
};

const readPage = (route: string): string => {
  const file = route === '/' ? path.join(DIST, 'index.html') : path.join(DIST, route.replace(/^\//, ''), 'index.html');
  assert.ok(fs.existsSync(file), `${route} was not emitted to ${path.relative(ROOT, file)} -- the build did not produce the page this test is about`);
  return fs.readFileSync(file, 'utf8');
};

/**
 * What the built artifact says about itself (D65; 11 §9's "the half that can be measured without a browser").
 *
 * This file exists because a static-output setting and a config comment prove nothing. Two claims are worth
 * gates, and both are read out of `dist/` after a real build:
 *
 *  1. **The landing page ships no client JavaScript.** Not "no hydration markers": zero `<script>` elements of
 *     any kind, zero `type="module"`, zero `modulepreload`, and the CSS inlined or linked instead. That is the
 *     entire reason D65 chose Astro for the marketing route, and it is the one claim in this change that would
 *     survive someone deleting the island and still be worth keeping.
 *  2. **The dashboard hydrates exactly one island.** Exactly one `<astro-island` element per page that hydrates
 *     and none on the page that must not, measured in the HTML the deployer will serve.
 *
 * What this is *not*: it is not a runtime observation. No browser executed the hydration, so it cannot show that
 * React mounted one root, that the SDK context was constructed once in that process, or that the age label
 * updates. The nearest thing to a runtime proof in this repository is
 * `packages/ui/test/shell-context-singleton.test.ts`, which runs the module that decides those constructions in
 * Node and shows a second, differently-configured context is refused. The rest stays NOT RUN, and the report says
 * so instead of dressing the static read up as a browser test.
 */

let built = false;
before(() => {
  const astroCli = path.join(SITE, 'node_modules/.bin/astro');
  if (!fs.existsSync(astroCli)) {
    throw new Error('apps/site has no astro binary: run `pnpm install` before the build gates. This test refuses to report a pass it did not measure.');
  }
  fs.rmSync(DIST, { recursive: true, force: true });
  astro(['build']);
  built = true;
});

after(() => {
  // Leave the tree as it was found: `dist/` is ignored, but a stale artifact is how a later read of "the build
  // output" ends up describing a previous configuration.
  if (built) fs.rmSync(DIST, { recursive: true, force: true });
});

test('the landing page emits no client JavaScript at all', () => {
  const html = readPage('/');
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/<script[\s>]/i.test(html), 'a landing page that ships a script tag is not the claim Astro was chosen for');
  assert.ok(!html.includes('astro-island'), 'the marketing route must not hydrate anything');
  assert.ok(!html.includes('type="module"'));
  assert.ok(!html.includes('modulepreload'));
  assert.ok(html.includes('<style>') || /<link rel="stylesheet"/.test(html), 'the page must still be styled -- tokens travel in CSS, not JS');
  assert.ok(html.includes('platfolio'), 'and it must still say who it is');
});

test('the dashboard hydrates exactly one island, and the callback exactly one', () => {
  for (const route of ['/dashboard', '/callback']) {
    const html = readPage(route);
    const islands = html.match(/<astro-island[\s>]/g) ?? [];
    assert.equal(islands.length, 1, `${route} carries ${String(islands.length)} island elements; D65 allows one, because a second hydration means two registries and two token stores`);
    const config = html.indexOf('<script src="/config.js">');
    assert.ok(config >= 0 && config < html.indexOf('</head>') && config < html.indexOf('<astro-island '),
      `${route} must load its runtime configuration before it hydrates the island`);
  }
  const landing = (readPage('/').match(/<astro-island[\s>]/g) ?? []).length;
  assert.equal(landing, 0, 'the landing page must not hydrate');
});

test('the shipped bundle has one shell-side network call, one freshness word, and one shell construction', () => {
  // Measured over every emitted chunk, because a source-level grep cannot show what the bundler produced. Read
  // the first count for exactly what it is, since minification is what decided it:
  //
  //  - one literal `fetch(` survives in the artifact, and the chunk it survives in is the shell's own: it is
  //    `formPostRequest` in `apps/site/src/lib/browser-capabilities.ts`, the issuer token POST. The SDK transport
  //    also reaches the network -- through `this.config.fetchImpl ?? fetch` (poll.ts:183) -- but the bundler
  //    renames that call site, so it is *not* counted here. This number therefore says "the shell added exactly
  //    one un-renamed fetch", which is a statement about app code (rule 1's shell half), not proof that one
  //    connection exists in the whole bundle. Writing it as the stronger claim would be the kind of overreach the
  //    rules doc refuses: a check that does not cover the claim cannot be quoted for it.
  //
  //  Falsified both ways, and the two results are worth keeping together: a **reachable** second `fetch(` -- an
  //  effect in the island that calls `fetch('/ping-me-')` -- makes this assertion fail, and restoring the source
  //  byte-for-byte makes it pass again. A **dead** one (`export const secondDoor = () => fetch(...)`, nothing
  //  importing it) does not, because the bundler removes it and the artifact then genuinely contains one call.
  //  That is not a hole in this test: it is the difference between what a browser downloads and what a file says.
  //  The dead case is the *source* rule's job -- `ui:check` §D65 and `apps/site/test/island-singleton.test.ts`
  //  both refuse a `fetch(` outside `lib/browser-capabilities.ts` whether or not anything would have shipped it.
  //  - exactly one `polled`: `transportWord` is the single spelling of the honesty label (D64), so two would mean
  //    somebody wrote the word out again.
  //  - exactly one `createShellContext`: the bundler keeps that name (measured), so the count is a real statement
  //    about construction sites, not a minification artifact.
  const chunks = fs.readdirSync(path.join(DIST, '_astro')).filter((f) => f.endsWith('.js'));
  assert.ok(chunks.length > 0, 'no JS chunks were emitted, so the island did not build');
  const counts = chunks.map((f) => {
    const code = fs.readFileSync(path.join(DIST, '_astro', f), 'utf8');
    return {
      file: f,
      fetch: (code.match(/\bfetch\(/g) ?? []).length,
      polled: (code.match(/polled/g) ?? []).length,
      shell: (code.match(/createShellContext/g) ?? []).length,
      route: (code.match(/"\/api\/v1\/instances"/g) ?? []).length,
    };
  });
  const total = (key: 'fetch' | 'polled' | 'shell' | 'route'): number => counts.reduce((n, c) => n + c[key], 0);

  assert.equal(total('fetch'), 1, `the artifact carries ${String(total('fetch'))} literal \`fetch(\` calls; exactly one is allowed, and it is the shell's issuer token request`);
  assert.equal(total('polled'), 1, `the freshness word appears ${String(total('polled'))} times; D64 says polling is named in one place (transportWord)`);
  assert.equal(total('shell'), 1, `createShellContext appears ${String(total('shell'))} times; more than one construction site is D65's second hydration`);
  assert.ok(total('route') >= 1, 'the generated route table is absent from the artifact, which means the screen is not routed by ENDPOINTS (#258)');

  // The chunk that fetches must be the transport, not a page: the island chunks themselves stay clean.
  for (const chunk of counts.filter((c) => /island/.test(c.file))) {
    assert.equal(chunk.fetch, 0, `${chunk.file}: an island chunk that opens its own connection bypasses the SDK`);
  }
});

test('no emitted page names a deployment endpoint that is not the loopback the test supplied', () => {
  const pages = ['index.html', 'dashboard/index.html', 'callback/index.html'];
  const generated = /https?:\/\/[a-z0-9-]+-[a-z0-9-]+-[0-9a-f]{6,}\.up\.railway\.app|[a-z0-9]{8}\.up\.railway\.app/;
  for (const page of pages) {
    const text = fs.readFileSync(path.join(DIST, page), 'utf8');
    assert.ok(!generated.test(text), `${page} carries a generated provider hostname -- that is a running environment's identity, not source (D47)`);
    assert.ok(!/https:\/\/(api|auth)\.platfolio\.dev/.test(text), `${page} baked a production origin into a test build`);
  }
});
