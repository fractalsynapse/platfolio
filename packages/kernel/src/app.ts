import { Context } from 'cordis';
import type { z } from 'zod';
import { CustodyService, CustodyConfigSchema } from './custody.ts';
import { IdentityService } from './identity.ts';
import { requireServices } from './startup.ts';
import { ServerService, ServerConfigSchema } from './server.ts';
import { EmailService, EmailConfigSchema } from './email.ts';
import { StoreService, StoreConfigSchema } from './store.ts';
import { ExtensionService, type ExtensionDescriptor } from './extension.ts';
import { InfraService, ProviderConfigSchema } from './infra-provider.ts';
import type { IdentityConfig, Jwk, VariablePort, RedactionSinks } from '@platfolio/contracts';

export interface KernelOptions {
  /** Email transport selection (D46). Absent means no email capability is installed at all. */
  email?: import('./email.ts').EmailConfigInput;
  provider?: 'fake' | 'railway';
  contract?: string;
  custody?: 'managed' | 'strict';
  /** Required when provider is 'railway'. */
  railway?: import('./infra-provider.ts').RailwayWiring;
  delivery?: 'relay-sealed' | 'relay-plain' | 'tenant-side' | 'runner-side';
  ports?: { variable?: VariablePort; sinks?: RedactionSinks };
  /**
   * Identity trust parameters. Omit for a runtime with no HTTP identity: `ctx.identity` then refuses every
   * token, which is right for a CLI or a worker and would be a silent disaster as a server default.
   */
  identity?: IdentityConfig;
  /** Key material for tests and the conformance double. Production supplies a JWKS endpoint instead. */
  identityKeys?: Jwk[];
  server?: { host?: string; port?: number };
  /**
   * Persistence driver and location. The store is a capability like every other: chosen by configuration, and
   * two implementations satisfy one conformance suite.
   */
  store?: Partial<z.infer<typeof StoreConfigSchema>>;
  /**
   * Application capabilities: routes plus optional boot hooks, installed as plugins. This is how the app
   * composes behaviour without importing the framework (D15).
   */
  extensions?: readonly ExtensionDescriptor[];
  /**
   * Services that must be live before boot reports success. Cordis detects neither a missing dependency nor a
   * cycle, so this list is the only thing between a mis-wired composition and a process that looks healthy
   * while serving nothing.
   */
  requiredServices?: readonly string[];
}

/**
 * Boot the control-plane runtime. Implementations are chosen by configuration, not by an import at the call
 * site -- the property E9 measured and this package makes usable.
 */
export async function createKernel(options: KernelOptions = {}): Promise<Context> {
  const ctx = new Context();
  try {
    return await install(ctx, options);
  } catch (error) {
    // Teardown on a failed boot. Without this, an assertion that throws after the server is listening leaves a
    // bound port and a running controller interval, and the process cannot exit -- which looks exactly like the
    // hang the assertion was meant to prevent. Discovered by a test suite that simply never finished.
    await disposeQuietly(ctx);
    throw error;
  }
}

async function install(ctx: Context, options: KernelOptions): Promise<Context> {
  const config = ProviderConfigSchema.parse({
    provider: options.provider ?? 'fake',
    contract: options.contract ?? '^1.0.0',
    features: [],
  });
  const custody = CustodyConfigSchema.parse({ mode: options.custody ?? 'strict', delivery: options.delivery ?? 'relay-sealed' });
  await ctx.plugin(InfraService, config);
  if (config.provider === 'railway') {
    if (!options.railway) throw new Error('provider "railway" requires options.railway { workspaceId, credentials }');
    ctx.infra.attachRailway(options.railway);
  }
  await ctx.plugin(CustodyService, custody);
  // Ports are attached by the composition root. This line was lost once already while the function was being
  // restructured into install(), and the kernel test caught it by counting provider writes -- a reminder that a
  // rewrite of a working function is not free, and that the assertion which fails is the one worth keeping.
  ctx.custody.attachPorts({ ...(options.ports?.variable ? { variable: options.ports.variable } : {}), ...(options.ports?.sinks ? { sinks: options.ports.sinks } : {}) });

  if (options.identity) {
    const identityConfig = { ...options.identity };
    await ctx.plugin(IdentityService, identityConfig);
    // Attached before the assertion below, so "configured but unattached" is never a state that can pass boot.
    if (options.identityKeys) ctx.identity.attachKeys(options.identityKeys);
  }

  if (options.store?.driver === 'postgres' || options.store?.connectionString) {
    const storeConfig = StoreConfigSchema.parse({ driver: 'postgres', ...options.store });
    await ctx.plugin(StoreService, storeConfig);
    // Migration is explicit and separate from construction: replicas boot concurrently.
    if (storeConfig.migrate) await ctx.store.migrate();
  } else if (options.store) {
    await ctx.plugin(StoreService, StoreConfigSchema.parse(options.store));
  }

  if (options.email) {
    // Installed before the server so a capability can reach email at boot, and only when configured -- an
    // unconfigured control plane does not silently gain a sender it never asked for.
    await ctx.plugin(EmailService, EmailConfigSchema.parse(options.email));
  }

  if (options.server) {
    await ctx.plugin(ServerService, ServerConfigSchema.parse({ ...options.server }));
  }
  if (options.extensions?.length) {
    // One fiber registers every capability's routes and runs its boot hooks, after the transport exists so
    // routes have somewhere to go and before traffic arrives so an empty table is caught here, not in prod.
    await ctx.plugin(ExtensionService, { extensions: options.extensions });
  }

  await requireServices(ctx, options.requiredServices ?? []);

  if (options.server && options.extensions?.length && ctx.server.routeCount === 0) {
    // Only asserted when extensions were supplied: a bare server (a health probe, a test) legitimately has no
    // routes and must not be refused. When a composition *did* declare capabilities and none registered a
    // route, an empty table turns every request into a tidy 404 while the process reports itself healthy.
    throw new Error('startup: the server is listening but no capability registered a route -- check that the extension list is non-empty and that each extension declared the capabilities it uses');
  }
  return ctx;
}

async function disposeQuietly(ctx: Context): Promise<void> {
  // Bounded and silent: teardown of a half-built runtime may itself fail, and that failure must not replace
  // the startup error someone needs to read.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  await Promise.race([ctx.fiber.dispose().then(() => undefined), timeout]).catch(() => undefined);
}

export async function disposeKernel(ctx: Context): Promise<void> {
  await ctx.fiber.dispose();
}
