FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
WORKDIR /app
COPY src ./src
USER node
CMD ["node", "--experimental-default-type=module", "src/index.ts"]
