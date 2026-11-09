# platfolio's own control-plane image (M1 step 6). Single stage on purpose: an earlier two-stage build
# copied installed workspace links and then re-copied sources over them, and ran as `node` against
# root-owned files -- both failures were invisible to `docker build` and only showed up when the
# container started. A build is not a test; the container has to serve.
#
# No secret is read at build time and none is baked in: a platfolio container that could hold a tenant
# credential would defeat the custody model.
FROM node:22-bookworm-slim
WORKDIR /app
ENV PNPM_HOME=/app/.pnpm-home NODE_ENV=production PORT=8080 HOST=0.0.0.0
RUN corepack enable
# node-linker=hoisted: pnpm's default symlink farm is hostile to image layers (links pointing at store
# paths survive a COPY only by accident). Real directories, same lockfile.
RUN echo 'node-linker=hoisted' > /app/.npmrc
COPY package.json pnpm-workspace.yaml tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/kernel/package.json packages/kernel/
COPY packages/manifest/package.json packages/manifest/
COPY packages/page-schema/package.json packages/page-schema/
COPY apps/status-api/package.json apps/status-api/
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter @platfolio/status-api...
COPY packages/contracts ./packages/contracts
COPY apps/status-api ./apps/status-api
# Build identity is injected by CI and reported by /version, never inferred from the filesystem.
ARG PLATFOLIO_COMMIT=unknown
ARG PLATFOLIO_VERSION=0.0.0-dev
ARG PLATFOLIO_BUILD_TIME=unknown
ENV PLATFOLIO_COMMIT=$PLATFOLIO_COMMIT PLATFOLIO_VERSION=$PLATFOLIO_VERSION PLATFOLIO_BUILD_TIME=$PLATFOLIO_BUILD_TIME
# Everything the runtime reads must be owned by the unprivileged user, or the drop to `USER node` turns a
# missing read permission into a MODULE_NOT_FOUND that looks like a packaging bug.
RUN chown -R node:node /app
EXPOSE 8080
USER node
# node can reach its own health endpoint, so the image needs no curl/wget to be checkable.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/status-api/src/index.ts"]
