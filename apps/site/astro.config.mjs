// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

/**
 * The D65 shell: Astro owns routing, content and the pages that need no JavaScript at all; React exists in
 * exactly one place per page that asks for it (UI-OD1, closed to D65 on 2026-11-16).
 *
 * ## `output: 'static'`, and what that costs
 *
 * Every route here is prerendered at build. That is the half of Astro the rules doc wants for a landing page
 * ("shipping no JavaScript is the point"). The price is stated rather than hidden: a static artifact bakes the
 * island's props at build, so changing `PLATFOLIO_URL` means a rebuild — which is why the Dockerfile renders
 * `dist/config.js` at container start and the page loads it through `runtime-config.ts`. A deploy that will
 * rebuild on every endpoint change can ignore that file entirely; a deploy that ships one artifact to several
 * environments cannot.
 *
 * ## No composition entry here, and why that is not an oversight
 *
 * platfolio's own UI is meant to be a service *inside* the platfolio project, beside `api` and `identity` (D62).
 * Saying so in this repository means a `compose.yaml` service, a generated digest in the generated overlay, and
 * DNS — the follow-on step, deliberately not taken here. An unreviewed edit to a generated file is how a tree ends
 * up carrying "a real digest of the deleted service's image", which #217 records actually happening. Until that
 * entry exists, this app builds, type-checks and is gated, and nothing deploys it.
 *
 * ## Why the alias, and not a workspace edge
 *
 * `@platfolio/ui` has no build step: its `main` and its `exports["."]` both point at `./src/index.ts`, so its
 * published surface *is* raw `.ts`/`.tsx`. Naming that same file by path puts it inside this project's module
 * graph, where Astro's React integration is configured to transform JSX. This is a resolution choice, not a claim
 * that the edge cannot work: adding `"@platfolio/ui": "workspace:*"` to package.json and deleting this alias is
 * the alternative, and whether a first-party shell should depend on the UI package the way a service depends on a
 * package is the maintainer's open question. `apps/site/tsconfig.json` says the same thing for `tsc`, and
 * `apps/site/test/shell-config.test.ts` reads both spellings against `package.json` so the bundler and the
 * type-checker cannot disagree about which file the island imports.
 */
const uiEntry = fileURLToPath(new URL('../packages/ui/src/index.ts', import.meta.url));
const uiTokens = fileURLToPath(new URL('../packages/ui/src/tokens.css', import.meta.url));

export default defineConfig({
  output: 'static',
  // D47: a deploy's address, not a source constant. Unset means the site has no absolute origin, and
  // `apps/site/src/lib/site-config.ts` reports that as a configuration failure instead of inventing one.
  site: process.env['PLATFOLIO_SITE_ORIGIN'],
  integrations: [react()],
  vite: {
    resolve: {
      alias: [
        // Order matters: a Vite alias does prefix matching, so the tokens file must be tried before the entry,
        // or `@platfolio/ui/tokens.css` resolves to `<index.ts>/tokens.css` and the stylesheet disappears.
        { find: /^@platfolio\/ui\/tokens\.css$/, replacement: uiTokens },
        { find: /^@platfolio\/ui$/, replacement: uiEntry },
      ],
    },
  },
});
