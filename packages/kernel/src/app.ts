import { Context } from 'cordis';
import { CustodyService, CustodyConfigSchema } from './custody.ts';
import { IdentityService } from './identity.ts';
import { requireServices } from './startup.ts';
import { ServerService, ServerConfigSchema } from './server.ts';
import { InfraService, ProviderConfigSchema } from './infra-provider.ts';
import type { IdentityConfig, Jwk, VariablePort, RedactionSinks } from '@platfolio/contracts';

export interface KernelOptions {
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
   * Services that must be live before boot reports success. Cordis detects neither a missing dependency nor a
   * cycle -- the dependent fiber stays PENDING forever and logs nothing -- so this list is the only thing
   * standing between a mis-wired composition and a process that looks healthy while serving nothing.
   */
  requiredServices?: readonly string[];
}

/**
 * Boot the control-plane runtime. The provider implementation is chosen by configuration, not by an
 * import at the call site — the property E9 measured and this package makes usable.
 */
export async function createKernel(options: KernelOptions = {}): Promise<Context> {
  const config = ProviderConfigSchema.parse({
    provider: options.provider ?? 'fake',
    contract: options.contract ?? '^1.0.0',
    features: [],
  });
  const custody = CustodyConfigSchema.parse({ mode: options.custody ?? 'strict', delivery: options.delivery ?? 'relay-sealed' });
  const ctx = new Context();
  await ctx.plugin(InfraService, config);
  if (config.provider === 'railway') {
    if (!options.railway) throw new Error('provider "railway" requires options.railway { workspaceId, credentials }');
    ctx.infra.attachRailway(options.railway);
  }
  await ctx.plugin(CustodyService, custody);
  if (options.identity) {
    const identityConfig = { ...options.identity };
    await ctx.plugin(IdentityService, identityConfig);
    // Attached before the assertion below, so "configured but unattached" is never a state that can pass boot.
    if (options.identityKeys) ctx.identity.attachKeys(options.identityKeys);
  }
  if (options.server) {
    await ctx.plugin(ServerService, ServerConfigSchema.parse({ ...options.server }));
  }
  await requireServices(ctx, options.requiredServices ?? []);
  ctx.custody.attachPorts({ ...(options.ports?.variable ? { variable: options.ports.variable } : {}), ...(options.ports?.sinks ? { sinks: options.ports.sinks } : {}) });
  return ctx;
}

export async function disposeKernel(ctx: Context): Promise<void> {
  await ctx.fiber.dispose();
}
