# platfolio's own web shell (D65), as an image: the Astro build, then `astro preview` serving the artifact.
#
# Single stage, like apps/control-plane/Dockerfile, for the reason that file records: an earlier two-stage build
# copied installed workspace links and then re-copied sources over them, and every problem it caused appeared at
# container start rather than at `docker build`. A build is not a test.
#
# No secret is read at build time and none is baked in (D4). What IS baked in is the endpoint configuration the
# build environment supplied -- `PLATFOLIO_SITE_ORIGIN`, `PLATFOLIO_URL`, `PLATFOLIO_IDENTITY_ISSUER`,
# `PLATFOLIO_WEB_CLIENT_ID` -- because a static artifact cannot do otherwise, and the names are declared in
# `environment.yaml` rather than remembered here. A deployment that must re-point one artifact at run time gets
# `dist/config.js` rewritten at start by `apps/site/src/tools/render-runtime-config.ts` (see the ENTRYPOINT below and the header of
# apps/site/src/lib/site-config.ts); that is the mechanism, not a hostname in this file (D47).
FROM node:22-bookworm-slim

WORKDIR /app
ENV PNPM_HOME=/app/.pnpm-home NODE_ENV=production
RUN corepack enable
# node-linker=hoisted, spelled the way apps/control-plane spells it: pnpm's default symlink farm does not survive
# being copied across layers, and a container that only works because a store path happened to be readable is not
# a container.
RUN echo 'node-linker=hoisted' > /app/.npmrc

# Manifests first, sources second: the dependency layer is what a rebuild reuses.
#
# The install IS filtered to this app, and that is a fact about the dependency graph rather than a preference.
# The first version of this line read `--filter @platfolio/site...` while `apps/site/package.json` declared no
# edge on `@platfolio/ui` -- and the build inside the image failed with:
#
#   [vite]: Rollup failed to resolve import "@platfolio/page-schema/page" from "/app/packages/ui/src/contract.ts"
#
# because the filtered graph stopped at this app and installed nothing for the UI package, while the Astro alias
# still dragged `packages/ui/src/**.ts` into the bundle, where its *own* imports had nothing to resolve against.
# On the host it looked fine, because this checkout is installed whole: the kind of success that does not travel.
# The image therefore installed the whole workspace, and said so here, until #267 item 1 declared the edge --
# `"@platfolio/ui": "workspace:*"` in package.json, `version: link:../../packages/ui` in pnpm-lock.yaml, and the
# alias plus the `paths` block deleted. Measured with that in place, on this file:
#
#   Scope: 6 of 8 workspace projects      (was: all 8)
#   astro build: 3 page(s) built in 2.23s, exit 0
#   docker run: GET / -> 200, `grep -c '<script' dist/index.html` -> 0, islands on / -> 0, 5 chunks in
#     dist/_astro, `createShellContext` in exactly 1 of them
#
# So the filter is now correct *because* the graph is complete, which is the whole point of the change. The COPY
# lines below still copy every workspace member's manifest: pnpm resolves the workspace definition from
# `pnpm-workspace.yaml` before it filters, and an importer whose manifest is absent is a lockfile mismatch, not a
# smaller image.
COPY package.json pnpm-workspace.yaml tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/kernel/package.json packages/kernel/
COPY packages/manifest/package.json packages/manifest/
COPY packages/page-schema/package.json packages/page-schema/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/ui/package.json packages/ui/
COPY apps/site/package.json apps/site/
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --filter @platfolio/site...

# The generated contract types are build inputs: `ENDPOINTS` is what the island routes with (#258), and it is
# committed, so the copy is a source copy rather than a code-generation step.
COPY packages/contracts ./packages/contracts
COPY packages/api-contract ./packages/api-contract
COPY packages/page-schema ./packages/page-schema
COPY packages/manifest ./packages/manifest
COPY packages/ui ./packages/ui
COPY apps/site ./apps/site

# D47, and the reason this is a build ARG rather than a literal: an unset origin means the site has no address,
# and the app refuses to build instead of inventing one. `astro.config.mjs` reads the same name from the
# environment; nothing here prints a host that platfolio owns.
ARG PLATFOLIO_SITE_ORIGIN
ARG PLATFOLIO_URL
ARG PLATFOLIO_IDENTITY_ISSUER
ARG PLATFOLIO_WEB_CLIENT_ID
ENV PLATFOLIO_SITE_ORIGIN=$PLATFOLIO_SITE_ORIGIN PLATFOLIO_URL=$PLATFOLIO_URL PLATFOLIO_IDENTITY_ISSUER=$PLATFOLIO_IDENTITY_ISSUER PLATFOLIO_WEB_CLIENT_ID=$PLATFOLIO_WEB_CLIENT_ID
RUN pnpm --filter @platfolio/site run build

RUN chown -R node:node /app
EXPOSE 4321
USER node
WORKDIR /app/apps/site
# Two things happen at start, in this order, and the second only if the first succeeds.
#
# 1. **Render the endpoint overlay.** `node /app/apps/site/src/tools/render-runtime-config.ts`, run as TypeScript
#    the same way `apps/control-plane/Dockerfile` runs its own `CMD ["node", "…/src/index.ts"]` on this base image --
#    there is no compile step here to produce a `.js` for it. It writes `dist/config.js`, the file
#    `apps/site/public/config.js` is a comment-only placeholder for. If a required name is unset, or is not an
#    absolute http(s) URL with a host, or is plain http on a machine this deploy does not own, the renderer exits 1
#    and the container does **not** serve: a UI that quietly kept its build-time origin is a UI whose operator
#    believes they re-pointed it, and the failure would surface later as a browser talking to the wrong plane.
# 2. **Serve the artifact.** `astro preview` reads `dist/`, which is what the build produced.
#
# Measured on 2026-11-17, on this file: `docker build` exits 0 (the legacy builder; BuildKit's activity file could
# not be written in this sandbox), and the container was run and answered -- `/` 200 with **zero** `<script>`
# elements and zero island markers, `/dashboard` 200 with exactly one `<astro-island>` whose serialized props are
# the five endpoint fields and nothing credential-shaped, `/callback` 200, `/config.js` 200 carrying the overlay
# rendered from that container's environment. The refusal was also observed for real: with `PLATFOLIO_URL` pointed
# at a plain-http non-loopback host, the container printed the named problem and never served.
#
# Two limits this file cannot retire on its own. `astro preview` is Astro's *development* preview server, not the
# static server a deployment wants in front of a public origin -- choosing that (a hardened static server, an edge,
# or `output: 'server'` with a Node adapter, which is the runtime-config answer D65 priced) belongs with the
# composition entry, and is deliberately not decided here. And no browser executed a single byte of what was
# served: hydration, one React root, focus order and the 320 px containers remain unobserved, which is what 11
# §9.7/§9.8 exist to cover.
ENTRYPOINT ["sh", "-c", "node /app/apps/site/src/tools/render-runtime-config.ts > /app/apps/site/dist/config.js && exec pnpm --filter @platfolio/site run preview --host 0.0.0.0 --port 4321"]
