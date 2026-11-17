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
# `dist/config.js` rewritten at start by `scripts/site-env-print.ts` (see the ENTRYPOINT below and the header of
# apps/site/src/lib/site-config.ts); that is the mechanism, not a hostname in this file (D47).
FROM node:22-bookworm-slim

WORKDIR /app
ENV PNPM_HOME=/app/.pnpm-home NODE_ENV=production
RUN corepack enable
# node-linker=hoisted, spelled the way apps/control-plane spells it: pnpm's default symlink farm does not survive
# being copied across layers, and a container that only works because a store path happened to be readable is not
# a container.
RUN echo 'node-linker=hoisted' > /app/.npmrc

# Manifests first, sources second: the dependency layer is what a rebuild reuses, and it only resolves if every
# workspace member this app touches is declared before the install runs.
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
# The overlay is re-rendered from the environment the container actually has, so one artifact can be started
# against staging or production without a rebuild. A container started without the names fails here, naming them,
# which is the point: a UI that quietly kept the build-time origin is a UI an operator believes they re-pointed.
# `--override` is not a flag this script has; the redirect is the whole of it.
ENTRYPOINT ["sh", "-c", "node --import tsx /app/scripts/site-env-print.ts > /app/apps/site/dist/config.js 2>/dev/null || node --import tsx /app/scripts/site-env-print.ts; exec astro preview --host 0.0.0.0 --port 4321"]
CMD ["astro", "preview", "--host", "0.0.0.0", "--port", "4321"]
