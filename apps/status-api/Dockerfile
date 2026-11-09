# platfolio's own control-plane image (M1 step 6). Two stages: install with the workspace lockfile, then run
# a slim image carrying only what the server needs. No secrets are read at build time and none are baked in:
# a platfolio container that could hold a tenant credential would defeat the custody model.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PNPM_HOME=/app/.pnpm-home
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/kernel/package.json packages/kernel/
COPY packages/manifest/package.json packages/manifest/
COPY packages/page-schema/package.json packages/page-schema/
COPY apps/status-api/package.json apps/status-api/
COPY pnpm-lock.yaml ./
# node-linker=hoisted is load-bearing: pnpm's default symlink farm does not survive the copy between
# build stages, and the container failed at startup with "Cannot find package 'tsx'" -- a dangling link,
# not a missing install. Real directories in the image; the lockfile still decides versions.
RUN echo 'node-linker=hoisted' > /app/.npmrc && pnpm install --frozen-lockfile --prod --filter @platfolio/status-api...

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
RUN corepack enable
# The whole dependency tree is copied, not a hand-picked set of node_modules directories: pnpm lays a
# workspace out as a symlink farm, and reconstructing it by cherry-picking produced an image whose
# runtime could not resolve its own packages (verified by running the container, not by building it).
COPY --from=deps /app ./
COPY packages/contracts ./packages/contracts
COPY apps/status-api ./apps/status-api
# Build identity is injected by CI, never inferred: /version must be able to name the commit and contract.
ARG PLATFOLIO_COMMIT=unknown
ARG PLATFOLIO_VERSION=0.0.0-dev
ARG PLATFOLIO_BUILD_TIME=unknown
ENV PLATFOLIO_COMMIT=$PLATFOLIO_COMMIT PLATFOLIO_VERSION=$PLATFOLIO_VERSION PLATFOLIO_BUILD_TIME=$PLATFOLIO_BUILD_TIME
EXPOSE 8080
# node can reach the health endpoint itself, so the image needs no curl/wget to be checkable.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "--import", "tsx", "apps/status-api/src/index.ts"]
