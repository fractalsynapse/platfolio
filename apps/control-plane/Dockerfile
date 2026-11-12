# platfolio's control-plane image -- the one API (apps/status-api, which this replaced, was deleted in the
# same change that moved this build over: two services where one was intended meant two request paths, one of
# them validated against the OpenAPI document and one not).
#
# Single stage on purpose: an earlier two-stage build copied installed workspace links and then re-copied
# sources over them, and ran as `node` against root-owned files -- both failures were invisible to
# `docker build` and only showed up when the container started. A build is not a test; the container has to serve.
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
COPY packages/api-contract/package.json packages/api-contract/
COPY apps/control-plane/package.json apps/control-plane/
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter @platfolio/control-plane...
# The OpenAPI document and the migrations are runtime files, not build-time extras, and missing either one was
# only visible by running the container: every spec-validated response 500s with ENOENT on `api/`, and a
# deployment that sets PLATFOLIO_DB_MIGRATE=true cannot migrate without `db/`. A Dockerfile that copies the
# source and forgets the data the source reads at runtime is the same class of bug as a build that passes and
# a container that does not serve.
COPY api ./api
COPY db ./db
COPY packages/contracts ./packages/contracts
COPY packages/kernel ./packages/kernel
COPY packages/api-contract ./packages/api-contract
COPY packages/manifest ./packages/manifest
COPY apps/control-plane ./apps/control-plane
# Build identity is injected by CI and reported by /version, never inferred from the filesystem.
# Defaults that satisfy the published schema. The inherited values here were `unknown`, copied from the
# status-api Dockerfile, and the OpenAPI spec for /version requires a hex commit and a date-time build time --
# so a container run without build args answered 500 with `response-violates-spec`. CI always passes them; this
# is about the image a person runs by hand, and about a contract that must hold either way. A build identity
# that is absent is reported as epoch-and-zeros, which is unmistakably synthetic; one that is a lie is not.
ARG PLATFOLIO_COMMIT=0000000000000000000000000000000000000000
ARG PLATFOLIO_VERSION=0.0.0-dev
ARG PLATFOLIO_BUILD_TIME=1970-01-01T00:00:00.000Z
ENV PLATFOLIO_COMMIT=$PLATFOLIO_COMMIT PLATFOLIO_VERSION=$PLATFOLIO_VERSION PLATFOLIO_BUILD_TIME=$PLATFOLIO_BUILD_TIME
# Everything the runtime reads must be owned by the unprivileged user, or the drop to `USER node` turns a
# missing read permission into a MODULE_NOT_FOUND that looks like a packaging bug.
RUN chown -R node:node /app
EXPOSE 8080
USER node
# node can reach its own health endpoint, so the image needs no curl/wget to be checkable.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/control-plane/src/index.ts"]
