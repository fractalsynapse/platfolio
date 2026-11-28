import { railwayTemplateDigest, type RailwayTemplateConfig } from '../../../packages/contracts/src/railway-template.ts';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { railwayInstallationProvider, type RailwayInstallationConfig } from '../../../packages/contracts/src/railway-installation.ts';
import { installationAuthorizationCallback } from './installation-launch.ts';
import type { InstallationProvider } from '../../../packages/contracts/src/installation-provider.ts';
import { EndpointKeySource, IdentityConfigSchema, redactCredentialShaped, type HubSignInTrust } from '@platfolio/contracts';
import { ROUTE_MANIFEST } from './routes.ts';
import { buildCapabilities } from './capabilities.ts';
import { describeAllowedOriginsConfig, parseAllowedOrigins, type CorsBootConfig } from './cors.ts';
import type { StarterLaunch } from './starter-launch.ts';
import { customerLaunch, customerLaunchConfig, privateHostingPlugin, type CustomerLaunchConfig } from './customer-launch.ts';
import { isReleaseTag } from './release-tag.ts';
import { keycloakNotificationDirectory } from './notification-directory.ts';
import { artifactConfigFromEnv, type ArtifactConfig } from './marketplace-artifacts.ts';
import { hubProofHeader, hubSignInConfig } from './hub-sign-in.ts';

export { ROUTE_MANIFEST };
export { ALLOWED_ORIGINS_ENV, describeAllowedOriginsConfig, parseAllowedOrigins, type CorsBootConfig } from './cors.ts';

export interface BootConfig {
  issuer: string;
  audience: string;
  marketplaceEnabled?: boolean;
  artifacts?: ArtifactConfig;
  marketplacePublisherTeam?: string;
  installation?: { configuration: RailwayInstallationConfig; returnTo: string };
  installationProvider?: { provider: InstallationProvider; returnTo: string };
  starterLaunch?: StarterLaunch;
  infrastructure?: readonly import('@platfolio/kernel').HostingPlugin[];
  customerLaunch?: CustomerLaunchConfig;
  hubIdentity?: HubSignInTrust;
  privateSetupKey?: string;
  hubBootstrapKey?: string;
  jwksUri?: string;
  host: string;
  port: number;
  build: { version: string | null; commit: string; buildTime: string };
  /**
   * Browser origins allowed to call this API cross-origin (see `cors.ts` for the contract). Absent or empty
   * means cross-origin use is **not enabled**: the safe default, and the reason a UI on another host needs its
   * origin named in the composition rather than inferred at runtime.
   */
  cors?: CorsBootConfig;
  /** Absent unless PLATFOLIO_EMAIL_DRIVER names one. There is no default: an unconfigured control plane has
   *  no sender at all, rather than one that mails people under an identity no operator chose. */
  email?: import('@platfolio/kernel').EmailConfigInput;
  notificationDirectory?: { client: string; secret: string };
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
  // Cross-origin policy (see `cors.ts`). Parsed here, so a malformed list is a configuration error the operator
  // sees before anything is listening, rather than a policy that quietly means something else. An unset
  // variable yields the empty list, which the transport reads as "cross-origin is not enabled".
  // Read as a literal `env.NAME` rather than through `ALLOWED_ORIGINS_ENV`: the environment registry discovers
  // variables by scanning configuration for that shape, and a name that only ever appears as a constant is a
  // name the registry cannot see. The constant and this spelling are kept identical by the test that uses both.
  const allowedOrigins = parseAllowedOrigins(env.PLATFOLIO_ALLOWED_ORIGINS);
  const launcher = customerLaunchConfig(env, allowedOrigins);
  const templateCode = env.PLATFOLIO_RAILWAY_INSTALL_TEMPLATE;
  const templateDigest = env.PLATFOLIO_RAILWAY_INSTALL_CONFIG_SHA;
  const revision = env.PLATFOLIO_RAILWAY_INSTALL_REVISION;
  const installerJson = env.PLATFOLIO_RAILWAY_INSTALL_CONFIG_JSON;
  const artifacts = artifactConfigFromEnv(env);
  if (artifacts && env.PLATFOLIO_MARKETPLACE_ENABLED !== 'true') throw new Error('Artifact registry delivery requires a marketplace hub');
  const clientId = env.PLATFOLIO_HUB_RAILWAY_OAUTH_CLIENT;
  const callbackValue = env.PLATFOLIO_HUB_RAILWAY_OAUTH_CALLBACK;
  const returnTo = allowedOrigins[0];
  let installation: BootConfig['installation'];
  if (templateDigest || clientId || callbackValue || installerJson) {
    const callback = callbackValue && new URL(callbackValue);
    if (env.PLATFOLIO_MARKETPLACE_ENABLED !== 'true' || !returnTo || !clientId || !callback ||
        callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash ||
        callback.pathname !== installationAuthorizationCallback || !templateCode || !/^[a-zA-Z0-9_-]{6,64}$/.test(templateCode) ||
        !templateDigest || !/^[0-9a-f]{64}$/.test(templateDigest) || !revision || !/^[0-9a-f]{40}$/.test(revision)) {
      throw new Error('The hub launcher requires a verified template, exact OAuth callback and browser origin');
    }
    let installer: RailwayTemplateConfig | undefined;
    if (installerJson) {
      try {
        const artifact = JSON.parse(installerJson) as { sourceCommit?: string; serializedConfig?: RailwayTemplateConfig };
        if (artifact.sourceCommit !== revision || !artifact.serializedConfig?.services ||
            railwayTemplateDigest(artifact.serializedConfig) !== templateDigest) throw new Error('Installer pin mismatch');
        installer = artifact.serializedConfig;
      } catch {
        throw new Error('The installer artifact must match the configured release and digest');
      }
    }
    installation = { configuration: { clientId, callback: callback.href, templateCode, templateDigest, revision,
      ...(installer ? { installer } : {}) }, returnTo };
  }

  const notificationClient = env.PLATFOLIO_NOTIFICATION_DIRECTORY_CLIENT;
  const notificationSecret = env.PLATFOLIO_NOTIFICATION_DIRECTORY_SECRET;
  if ((notificationClient || notificationSecret) && !(notificationClient && notificationSecret)) {
    throw new Error('The notification directory requires both its service client ID and secret');
  }
  const releaseTag = env.PLATFOLIO_RELEASE_TAG || null;
  if (releaseTag !== null && !isReleaseTag(releaseTag)) {
    throw new Error('control-plane cannot start: PLATFOLIO_RELEASE_TAG must be a bare SemVer tag');
  }
  const hubIdentity = hubSignInConfig(env.PLATFOLIO_HUB_IDENTITY_ISSUER, env.PLATFOLIO_HUB_IDENTITY_CLIENT);
  return {
    ...(hubIdentity ? { hubIdentity } : {}),
    ...(env.PLATFOLIO_PRIVATE_SETUP_KEY ? { privateSetupKey: env.PLATFOLIO_PRIVATE_SETUP_KEY } : {}),
    ...(env.PLATFOLIO_HUB_BOOTSTRAP_KEY ? { hubBootstrapKey: env.PLATFOLIO_HUB_BOOTSTRAP_KEY } : {}),
    issuer: env.PLATFOLIO_IDENTITY_ISSUER as string,
    audience: env.PLATFOLIO_IDENTITY_AUDIENCE as string,
    marketplaceEnabled: env.PLATFOLIO_MARKETPLACE_ENABLED === 'true',
    ...(artifacts ? { artifacts } : {}),
    ...(env.PLATFOLIO_MARKETPLACE_PUBLISHER_TEAM ? { marketplacePublisherTeam: env.PLATFOLIO_MARKETPLACE_PUBLISHER_TEAM } : {}),
    ...(launcher ? { customerLaunch: launcher } : {}),
    ...(installation ? { installation } : {}),
    ...(notificationClient && notificationSecret ? { notificationDirectory: { client: notificationClient, secret: notificationSecret } } : {}),
    ...(env.PLATFOLIO_IDENTITY_JWKS_URI ? { jwksUri: env.PLATFOLIO_IDENTITY_JWKS_URI } : {}),
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    // The cross-origin decision, forwarded always. `cors` absent from a BootConfig assembled by hand means the
    // same thing as an empty list -- cross-origin is not enabled -- so there is no second spelling of "no list"
    // for a caller to get wrong, and nothing here re-reads process.env.
    cors: { allowedOrigins },
    build: {
      version: releaseTag,
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
  const e = error as { name?: string; message?: string; stack?: string; cause?: unknown; errors?: unknown };
  // A thrown non-Error (a string, a domain object) used to render as `Error: (no message)`, which is how a real
  // reason disappears: the boot path lost whatever was thrown the moment it was not an Error instance.
  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'bigint') {
    return `thrown value (${typeof error}): ${redactCredentialShaped(String(error)).slice(0, 240)}`;
  }
  const name = typeof e?.name === 'string' && e.name.length > 0 ? e.name : 'Error';
  const message = typeof e?.message === 'string' && e.message.length > 0 ? e.message : '(no message)';
  const parts = [`${name}: ${redactCredentialShaped(message)}`];
  // AggregateError is what a connection pool throws when several attempts fail, and `pg-pool` uses it -- so the
  // one error type that carried staging's actual boot failure was the one whose contents were invisible: its
  // `message` is empty and the reasons live in `.errors`. Listing them, redacted and capped, is the difference
  // between "cannot start: AggregateError" and "cannot start: AggregateError -- [ECONNREFUSED, ...]".
  const aggregate = e?.errors as Array<{ name?: string; message?: string }> | undefined;
  if (Array.isArray(aggregate) && aggregate.length > 0) {
    const inner = aggregate.slice(0, 4).map((x) => `${x?.name ?? 'Error'}: ${redactCredentialShaped(String(x?.message ?? '(no message)'))}`);
    parts.push(`aggregated ${String(aggregate.length)} error(s): ${inner.join('; ')}${aggregate.length > 4 ? ` (+${String(aggregate.length - 4)} more)` : ''}`);
  }
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
  const ownerSubject = config.customerLaunch?.ownerSubject;
  const installationTeamId = config.customerLaunch?.teamId;
  if (config.privateSetupKey && (!ownerSubject || !installationTeamId || config.marketplaceEnabled || !/^[A-Za-z0-9_-]{32,128}$/.test(config.privateSetupKey))) {
    throw new Error('Private email setup requires a private owner workspace and its Keycloak setup grant');
  }
  const hubIdentity = config.hubIdentity && hubSignInConfig(config.hubIdentity.issuer, config.hubIdentity.clientId);
  if (hubIdentity && (!installationTeamId || config.marketplaceEnabled || !storeUrl || hubIdentity.issuer === config.issuer)) {
    throw new Error('Hub identity requires a private workspace with a database and a distinct issuer');
  }
  if (ownerSubject && (!storeUrl || config.marketplaceEnabled || !installationTeamId)) {
    throw new Error('First owner setup requires a private installation and persistent storage');
  }
  const installation = config.installationProvider ?? (config.installation && {
    provider: railwayInstallationProvider(config.installation.configuration, fetchImpl), returnTo: config.installation.returnTo,
  });
  const launch = config.customerLaunch && customerLaunch(config.customerLaunch, fetchImpl);
  let running: KernelContext | undefined;
  const infrastructure = config.infrastructure ?? (launch ? [privateHostingPlugin(launch, async (instance) => {
    if (!running) throw new Error('The private installation is starting');
    const saved = await running.store.getMarketplaceInstall(instance.teamId, instance.name);
    const release = saved?.receipt.release;
    if (saved?.instance.id !== instance.id || !release?.bundle) return;
    const { platformId, version, descriptorDigest, images } = release;
    return { selection: { platformId, version, descriptorDigest }, images };
  })] : []);
  const ctx = await createKernel({
    ...(infrastructure.length === 0 && config.infrastructure === undefined && !storeUrl
      ? { provider: 'fake' }
      : { provider: 'railway', infrastructure }),
    custody: 'strict',
    identity,
    store: storeConfig,
    ...(config.email === undefined ? {} : { email: config.email }),
    // The driver choice `configFromEnv` computes must actually reach the kernel. It did not: `email` was
    // forwarded and `scm` was not, so a correctly configured git or github-app driver never existed at runtime
    // and the operations answered 503. Found by running them against a live control plane, not by reading the
    // code -- which is the argument for running things.
    ...(config.scm === undefined ? {} : { scm: config.scm }),
    // The cross-origin decision is forwarded the same way `email` and `scm` are -- and for the same reason the
    // scm forwarding bug happened: a choice computed by configuration that never reaches the runtime is a choice
    // that exists only in the operator's head. An empty list is passed through rather than dropped, so "no list"
    // has one spelling all the way down to the transport.
    server: { host: config.host, port: config.port, cors: { allowedOrigins: [...config.cors?.allowedOrigins ?? []],
      ...(hubIdentity ? { allowedHeaders: ['authorization', 'content-type', hubProofHeader] } : {}) } },
    extensions: [
      ...(ownerSubject && installationTeamId ? [{
        id: 'installation-owner',
        requires: ['store'],
        async onBoot(context: KernelContext) {
          const existing = await context.store.getTeam(installationTeamId);
          if (existing.ok) {
            if (existing.value.name !== 'workspace') throw new Error('The installation team ID belongs to another team');
            return;
          }
          const identity = await context.store.resolvePerson({ issuer: config.issuer, subject: ownerSubject });
          if (!identity.ok) throw new Error('Could not prepare the first installation owner');
          const team = await context.store.seedInstallationTeam({ id: installationTeamId, name: 'workspace', personId: identity.value.person.id });
          if (!team.ok) throw new Error('Could not create the first installation workspace');
        },
      }] : []),
      ...buildCapabilities({
        build: config.build,
        marketplaceEnabled: config.marketplaceEnabled ?? false,
        ...(config.artifacts ? { artifacts: config.artifacts } : {}),
        ...(config.marketplacePublisherTeam ? { marketplacePublisherTeam: config.marketplacePublisherTeam } : {}),
        ...(config.marketplaceEnabled && installation ? { installation } : {}),
        ...(config.marketplaceEnabled && config.hubBootstrapKey ? { hubBootstrapKey: config.hubBootstrapKey } : {}),
        accountIssuer: { issuer: config.issuer, request: fetchImpl },
        ...(config.notificationDirectory ? { notificationDirectory: keycloakNotificationDirectory(config.issuer,
          config.notificationDirectory.client, config.notificationDirectory.secret, fetchImpl) } : {}),
        ...(config.cors?.allowedOrigins.length === 1 ? { invitationOrigin: config.cors.allowedOrigins[0]! } : {}),
        ...(config.starterLaunch ? { starterLaunch: config.starterLaunch } : {}),
        ...(launch ? { customerLaunch: launch } : {}),
        ...(hubIdentity ? { hubIdentity } : {}),
        hubIdentityFetch: fetchImpl,
        ...(config.privateSetupKey && ownerSubject && installationTeamId ? { privateSetup: {
          issuer: config.issuer, teamId: installationTeamId, ownerSubject, clientSecret: config.privateSetupKey,
        } } : {}),
      }),
    ],
    requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  running = ctx;
  ctx.identity.attachKeySource(new EndpointKeySource(identity, fetchImpl, config.jwksUri));
  // The transport logs the policy it will enforce; this line names the *source*, because "0 origins" reads
  // differently when you know whether the operator chose that or never set the variable. Stated on every boot:
  // a same-origin-only control plane is the default, and a default nobody can see is a default people trip over.
  ctx.logger.info(describeAllowedOriginsConfig(config.cors?.allowedOrigins ?? []));
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

