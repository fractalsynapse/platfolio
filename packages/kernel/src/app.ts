import { Context } from 'cordis';
import { InfraService, ProviderConfigSchema } from './infra-provider.ts';

export interface KernelOptions {
  provider?: 'fake' | 'railway';
  contract?: string;
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
  const ctx = new Context();
  await ctx.plugin(InfraService, config);
  return ctx;
}

export async function disposeKernel(ctx: Context): Promise<void> {
  await ctx.fiber.dispose();
}
