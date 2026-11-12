FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
RUN echo 'node-linker=hoisted' > /app/.npmrc
COPY package.json pnpm-workspace.yaml tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/kernel/package.json packages/kernel/
COPY packages/manifest/package.json packages/manifest/
COPY packages/page-schema/package.json packages/page-schema/
COPY packages/api-contract/package.json packages/api-contract/
COPY apps/control-plane/package.json apps/control-plane/
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --filter @platfolio/control-plane... 2>&1 | tail -20
RUN echo "--- root node_modules:" && ls node_modules | wc -l && ls node_modules | head -12
RUN echo "--- nested:" && find . -maxdepth 3 -name node_modules -type d | head -6
