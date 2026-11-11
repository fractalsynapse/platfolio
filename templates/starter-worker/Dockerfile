FROM node:22-alpine
WORKDIR /app
RUN mkdir -p /var/lib/starter-worker && chown node:node /var/lib/starter-worker
COPY src ./src
ENV NODE_ENV=production STATE_DIR=/var/lib/starter-worker
VOLUME ["/var/lib/starter-worker"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "src/worker.mjs"]
