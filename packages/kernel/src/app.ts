import { Context } from 'cordis';
import { CustodyService, CustodyConfigSchema } from './custody.ts';
import { InfraService, ProviderConfigSchema } from './infra-provider.ts';
import type { VariablePort, RedactionSinks } from '@platfolio/contracts';

export interface KernelOptions {
  provider?: 'fake' | 'railway';
  contract?: string;
  custody?: 'managed' | 'strict';
  /** Required when provider is 'railway'. */
  railway?: import('./infra-provider.ts').RailwayWiring;
  delivery?: 'relay-sealed' | 'relay-plain' | 'tenant-side' | 'runner-side';
  ports?: { variable?: VariablePort; sinks?: RedactionSinks };
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
  ctx.custody.attachPorts({ ...(options.ports?.variable ? { variable: options.ports.variable } : {}), ...(options.ports?.sinks ? { sinks: options.ports.sinks } : {}) });
  return ctx;
}

export async function disposeKernel(ctx: Context): Promise<void> {
  await ctx.fiber.dispose();
}
