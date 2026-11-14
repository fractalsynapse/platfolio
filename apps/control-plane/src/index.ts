import { createKernel, disposeKernel } from '@platfolio/kernel';
import { EndpointKeySource, IdentityConfigSchema, redactCredentialShaped } from '@platfolio/contracts';
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
  /** Absent unless PLATFOLIO_EMAIL_DRIVER names one. There is no default: an unconfigured control plane has
   *  no sender at all, rather than one that mails people under an identity no operator chose. */
  email?: import('@platfolio/kernel').EmailConfigInput;
  /**
   * Source control (D22, git driver per D50). Absent means the kernel's `none` driver: the repository
   * operations answer 503 `source-control-not-configured` rather than inventing a plan.
   */
  scm?: import('@platfolio/kernel').ScmConfigInput;
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
      // Email is configured or absent -- never defaulted on. A control plane that quietly gains a sender can
      // mail people under an identity no operator chose, and only the driver knows whether anything was
      // delivered. D4 applies to its credential: a name and a presence check, the value never leaves here.
      ...(env.PLATFOLIO_EMAIL_DRIVER === undefined ? {} : {
        email: {
          driver: env.PLATFOLIO_EMAIL_DRIVER as 'smtp' | 'mailpit' | 'memory',
          from: env.PLATFOLIO_EMAIL_FROM ?? 'platfolio@localhost',
          ...(env.PLATFOLIO_SMTP_HOST === undefined ? {} : { host: env.PLATFOLIO_SMTP_HOST }),
          ...(env.PLATFOLIO_SMTP_PORT === undefined ? {} : { port: Number(env.PLATFOLIO_SMTP_PORT) }),
          ...(env.PLATFOLIO_SMTP_SECURE === undefined ? {} : { secure: env.PLATFOLIO_SMTP_SECURE === 'true' }),
          ...(env.PLATFOLIO_SMTP_STARTTLS === undefined ? {} : { startTls: env.PLATFOLIO_SMTP_STARTTLS as 'require' | 'allow' | 'off' }),
          ...(env.PLATFOLIO_SMTP_USER === undefined ? {} : { user: env.PLATFOLIO_SMTP_USER }),
          ...(env.PLATFOLIO_SMTP_PASSWORD === undefined ? {} : { password: env.PLATFOLIO_SMTP_PASSWORD }),
          ...(env.PLATFOLIO_MAILPIT_URL === undefined ? {} : { baseUrl: env.PLATFOLIO_MAILPIT_URL }),
        },
      }),
      // Source control (D22, git driver added by D50's maintainer point). `ctx.scm` is always installed; with
      // nothing configured it is the `none` driver and the two repository operations answer 503 rather than
      // pretending to have read a tenant's platform. Same rule as email: a capability that may be absent is a
      // value, never a hole in the route table -- and a hole there is how "not configured" becomes a 404 on a
      // real endpoint.
      //
      // PLATFOLIO_SCM_DRIVER states the choice; when it is unset, app credentials mean `github-app` and
      // anything else means none. The inference exists only because github-app was the sole driver until git
      // arrived. An explicit `git` is never overridden by the presence of app credentials: GitHub is a wrapper
      // over git, so the portable transport is the one an operator should be able to ask for directly.
      ...(env.PLATFOLIO_SCM_DRIVER === 'git'
        ? {
            scm: {
              driver: 'git' as const,
              ...(env.PLATFOLIO_GIT_HOST === undefined ? {} : { host: env.PLATFOLIO_GIT_HOST }),
              ...(env.PLATFOLIO_GIT_TRANSPORT === undefined ? {} : { transport: env.PLATFOLIO_GIT_TRANSPORT as 'https' | 'ssh' }),
              // A blank is treated as absent: `PLATFOLIO_GIT_TOKEN=${PLATFOLIO_GIT_TOKEN:-}` in a Compose file
              // yields an empty string, and forwarding that into a `min(8)` schema would fail startup with a
              // zod error instead of the driver's own, useful "no token was supplied" message.
              ...(env.PLATFOLIO_GIT_TOKEN?.trim() ? { gitToken: env.PLATFOLIO_GIT_TOKEN!.trim() } : {}),
            },
          }
        : env.PLATFOLIO_SCM_DRIVER === 'none'
          ? { scm: { driver: 'none' as const } }
          : env.PLATFOLIO_GITHUB_APP_ID === undefined || env.PLATFOLIO_GITHUB_INSTALLATION_ID === undefined
            ? {}
            : {
                scm: {
                  driver: 'github-app' as const,
                  appId: Number(env.PLATFOLIO_GITHUB_APP_ID),
                  installationId: Number(env.PLATFOLIO_GITHUB_INSTALLATION_ID),
                  ...(env.PLATFOLIO_GITHUB_PRIVATE_KEY === undefined ? {} : { privateKeyPem: env.PLATFOLIO_GITHUB_PRIVATE_KEY }),
                },
              }),
  };
}

/**
 * Say something useful about a boot failure.
 *
 * The first version printed only `error.message`. On staging's first boot that produced a log line reading
 * `control-plane: cannot start: ` -- an empty message, no name, no stack, no cause -- which is a fail-closed
 * path that fails closed *and* blind: the container refused correctly and told nobody why. A machine that
 * refuses must also explain, or the operator has to guess between "configuration is missing" and "a dependency
 * threw on the way in".
 *
 * Redaction is not optional here. Stack frames quote the very strings that failed, so a DSN with a password
 * would otherwise land in the provider's log stream -- which is platfolio reading a tenant's secret, by
 * accident, in the one component that promises not to (D4).
 */
export function describeBootFailure(error: unknown): string {
  const e = error as { name?: string; message?: string; stack?: string; cause?: unknown };
  // A thrown non-Error (a string, a domain object) used to render as `Error: (no message)`, which is how a real
  // reason disappears: the boot path lost whatever was thrown the moment it was not an Error instance.
  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'bigint') {
    return `thrown value (${typeof error}): ${redactCredentialShaped(String(error)).slice(0, 240)}`;
  }
  const name = typeof e?.name === 'string' && e.name.length > 0 ? e.name : 'Error';
  const message = typeof e?.message === 'string' && e.message.length > 0 ? e.message : '(no message)';
  const parts = [`${name}: ${redactCredentialShaped(message)}`];
  // The cause chain, because a wrapped failure is where the real reason lives -- one level deep is enough to
  // turn "database error" into "schema platfolio does not exist", and deeper chains are noise at boot.
  const cause = e?.cause as { name?: string; message?: string } | undefined;
  if (cause && (typeof cause.message === 'string' || typeof cause.name === 'string')) {
    parts.push(`caused by ${cause.name ?? 'Error'}: ${redactCredentialShaped(String(cause.message ?? '(no message)'))}`);
  }
  const frames = typeof e?.stack === 'string'
    ? e.stack.split('\n').slice(1).filter((l) => l.trim().startsWith('at ')).slice(0, 3).map((l) => l.trim())
    : [];
  if (frames.length > 0) parts.push(redactCredentialShaped(frames.join(' | ')));
  return parts.join(' -- ');
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
    ...(config.email === undefined ? {} : { email: config.email }),
    // The driver choice `configFromEnv` computes must actually reach the kernel. It did not: `email` was
    // forwarded and `scm` was not, so a correctly configured git or github-app driver never existed at runtime
    // and the operations answered 503. Found by running them against a live control plane, not by reading the
    // code -- which is the argument for running things.
    ...(config.scm === undefined ? {} : { scm: config.scm }),
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
          process.stderr.write(`control-plane: shutdown failed: ${describeBootFailure(error)}\n`);
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
      process.stderr.write(`control-plane: cannot start: ${describeBootFailure(error)}\n`);
      process.exit(1);
    });
}

