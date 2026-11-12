import { createKernel, disposeKernel } from '@platfolio/kernel';
import { EndpointKeySource, IdentityConfigSchema } from '@platfolio/contracts';
import { ROUTE_MANIFEST } from './routes.ts';
import { buildCapabilities } from './capabilities.ts';

export { ROUTE_MANIFEST };

export interface BootConfig {
  issuer: string;
  audience: string;
  jwksUri?: string;
  host: string;
  port: number;
  build: { version: string; commit: string; buildTime: string };
}

/** Fail closed on missing identity config: a control plane that starts without knowing its issuer is an open door with a logo on it. */
export function configFromEnv(env: NodeJS.ProcessEnv): BootConfig {
  const missing = ['PLATFOLIO_IDENTITY_ISSUER', 'PLATFOLIO_IDENTITY_AUDIENCE'].filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`control-plane cannot start: ${missing.join(', ')} is not set (Slice 1 has no default issuer)`);
  return {
    issuer: env.PLATFOLIO_IDENTITY_ISSUER as string,
    audience: env.PLATFOLIO_IDENTITY_AUDIENCE as string,
    ...(env.PLATFOLIO_IDENTITY_JWKS_URI ? { jwksUri: env.PLATFOLIO_IDENTITY_JWKS_URI } : {}),
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    build: {
      version: env.PLATFOLIO_VERSION ?? '0.0.0-dev',
      commit: env.PLATFOLIO_COMMIT ?? '0'.repeat(40),
      buildTime: env.PLATFOLIO_BUILD_TIME ?? new Date(0).toISOString(),
    },
  };
}

export async function boot(config: BootConfig, fetchImpl: typeof fetch = fetch) {
  // Checked before anything starts: refusing after the listener is open would leave a half-booted control plane
  // holding a port, which is worse than not starting.
  if (!config.jwksUri) throw new Error('control-plane cannot start: PLATFOLIO_IDENTITY_JWKS_URI is not set -- identity would refuse every token, and starting in order to refuse everything is not the same as being able to serve');
  const identity = IdentityConfigSchema.parse({
    issuer: config.issuer,
    audience: config.audience,
    ...(config.jwksUri ? { jwksUri: config.jwksUri } : {}),
    allowedAlgorithms: ['RS256'],
  });
  const storeUrl = process.env.PLATFOLIO_DB_URL;
  // A control plane with no database is a development mode, not a broken one -- but it has to say so. The
  // previous shape omitted the `store` config entirely when PLATFOLIO_DB_URL was unset, so the Store service
  // was never installed and boot died with `required capability "store" is not present`: true, and useless,
  // because the cause was a missing line of configuration rather than a missing plugin. The container that
  // CI builds has no database, and this is what made that visible.
  const storeConfig = storeUrl
    ? { driver: 'postgres' as const, connectionString: storeUrl, ...(process.env.PLATFOLIO_DB_MIGRATE === 'true' ? { migrate: true } : {}) }
    : { driver: 'memory' as const };
  if (!storeUrl) {
    process.emitWarning('PLATFOLIO_DB_URL is not set: running on the in-memory store. Nothing survives a restart -- this is development, not a deployment.');
  }
  const ctx = await createKernel({
    provider: 'fake',
    custody: 'strict',
    identity,
    store: storeConfig,
    server: { host: config.host, port: config.port },
    extensions: buildCapabilities({ build: config.build }),
    requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  ctx.identity.attachKeySource(new EndpointKeySource(identity, fetchImpl, config.jwksUri));
  return {
    ctx,
    address: ctx.server.address,
    stop: async () => {
      await disposeKernel(ctx);
    },
  };
}

// Cordis has no shutdown seam at this tag (verified: `Loader.exit()` is an empty stub in the reference tree),
// so the process owns that decision. SIGTERM must close the listener and settle in-flight work, or a rolling
// deploy just kills requests mid-flight.
if (import.meta.url === `file://${process.argv[1]}`) {
  let stopping = false;
  boot(configFromEnv(process.env))
    .then((app) => {
      const shutdown = (signal: string) => {
        if (stopping) return;
        stopping = true;
        process.stdout.write(`control-plane: ${signal} received, closing listener\n`);
        app.stop().then(() => process.exit(0), (error: unknown) => {
          process.stderr.write(`control-plane: shutdown failed: ${(error as Error).message}\n`);
          process.exit(1);
        });
      };
      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('unhandledRejection', (reason) => {
        process.stderr.write(`control-plane: unhandled rejection: ${String(reason).slice(0, 300)}\n`);
      });
      process.stdout.write(`control-plane listening on ${app.address.host}:${String(app.address.port)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`control-plane: cannot start: ${(error as Error).message}\n`);
      process.exit(1);
    });
}
