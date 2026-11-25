// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

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
 * ## Hosted configuration
 *
 * platfolio's own UI is meant to be a service *inside* the platfolio project, beside `api` and `identity` (D62).
 * `compose.yaml` supplies the production build arguments and environment-specific runtime endpoints. The
 * release candidate carries the site digest, and Railway serves the site on the domains the plan names (D54, D68).
 *
 * ## There is no `vite.resolve.alias` in this file, and that is the decision (#267 item 1)
 *
 * Until 2026-11-17 this config carried two alias entries and `apps/site/tsconfig.json` carried a matching `paths`
 * block, both standing in for a workspace edge that `package.json` did not declare. The maintainer settled the
 * open question the way the Dockerfile had already predicted: **declare the edge.** So:
 *
 *  - `apps/site/package.json` now depends on `"@platfolio/ui": "workspace:*"`, `pnpm-lock.yaml` records
 *    `version: link:../../packages/ui`, and `pnpm install --frozen-lockfile` passes against that lockfile.
 *  - The specifier `@platfolio/ui` resolves through the package's own `exports` map — `"."` for the barrel,
 *    `"./tokens.css"` for the generated token sheet — which is what a *dependency* is for. The alias is gone, and
 *    with it the one mechanism in this shell that the dependency graph could not see.
 *  - Why that mattered was measured, not argued: the filtered install the Dockerfile wanted to use
 *    (`pnpm install --frozen-lockfile --filter @platfolio/site...`) failed at `astro build` with
 *    `Rollup failed to resolve import "@platfolio/page-schema/page"` from `packages/ui/src/contract.ts`, because
 *    with no edge the graph stopped at this app while the alias still dragged `packages/ui/src/**` into the
 *    bundle — its own imports installed by nothing. With the edge declared, the same filtered install is the
 *    subject of item 1's proof, and the Dockerfile comment that said "either the edge is declared or the image
 *    installs the workspace" no longer has to choose.
 *
 * What remains true and is *not* fixed by this file: `@platfolio/ui` has no build step, so its published surface
 * is raw `.ts`/`.tsx` and Astro's React integration is the thing that transforms it. That is a property of the
 * package (D63), not of the resolution mechanism, and `apps/site/test/island-singleton.test.ts` plus
 * `build-output.test.ts` are what say it still works.
 */
export default defineConfig({
  output: 'static',
  // D47: a deploy's address, not a source constant. Unset means the site has no absolute origin, and
  // `apps/site/src/lib/site-config.ts` reports that as a configuration failure instead of inventing one.
  site: process.env['PLATFOLIO_SITE_ORIGIN'],
  // Keep the issuer request apart from page code so the built artifact can enforce the shell's network boundary.
  vite: { build: { rollupOptions: { output: { manualChunks(id) {
    return id.endsWith('/src/lib/browser-capabilities.ts') ? 'browser-capabilities' : undefined;
  } } } } },
  integrations: [react()],
});
