import process from 'node:process';
import { createServer, type BuildInfo } from './service.ts';

const info: BuildInfo = {
  version: process.env.PLATFOLIO_VERSION ?? '0.0.0-dev',
  commit: process.env.PLATFOLIO_COMMIT ?? 'unknown',
  buildTime: process.env.PLATFOLIO_BUILD_TIME ?? 'unknown',
};

const port = Number(process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`PORT is not a valid port: ${process.env.PORT ?? ''}`);
  process.exit(1);
}

const server = createServer(info);
server.listen(port, '0.0.0.0', () => {
  console.log(`status-api listening on ${port} (version ${info.version}, commit ${info.commit})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // A forced exit bounded in time, so a hung keep-alive connection cannot strand the pod.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
