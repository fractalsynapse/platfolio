import { Context, Service } from 'cordis';
import { CONTRACT_NAME, satisfiesRange } from '@platfolio/contracts';
import { z } from 'zod';
import { FakeInfraProvider, RailwayInfraProvider } from '@platfolio/contracts';

/**
 * The `infra.provider` capability, exposed as a stable `ctx.infra` service. This file is the seam
 * between platfolio's contracts and the vendored framework: nothing outside `packages/kernel` may
 * import `cordis` (docs/design/10, D15).
 */
export const ProviderConfigSchema = z.object({
  provider: z.enum(['fake', 'railway']),
  contract: z.string().min(1).default('^1.0.0'),
  features: z.array(z.string()).default([]),
}).strict();

export class InfraService extends Service<z.infer<typeof ProviderConfigSchema>> {
  static inject = [] as const;
  static provide = 'infra' as const;

  readonly impl: import('@platfolio/contracts').InfraProvider;

  constructor(ctx: Context, config: z.infer<typeof ProviderConfigSchema>) {
    super(ctx, 'infra');
    const parsed = ProviderConfigSchema.parse(config ?? { provider: 'fake' });
    this.impl = parsed.provider === 'railway' ? new RailwayInfraProvider() : new FakeInfraProvider();
    const info = this.impl.describe();
    // Refuse to boot on an unsatisfiable contract instead of failing later, mid-provision.
    if (!satisfiesRange(info.contract, parsed.contract)) {
      throw new Error(`${CONTRACT_NAME}: provider "${info.provider}" at ${info.contract} does not satisfy required range "${parsed.contract}"`);
    }
  }

  describe() {
    return this.impl.describe();
  }

  validatePlan(plan: import('@platfolio/contracts').InfraPlan) {
    return this.impl.validatePlan(plan);
  }

  applyPlan(plan: import('@platfolio/contracts').InfraPlan) {
    return this.impl.applyPlan(plan);
  }

  readState(instanceId: string) {
    return this.impl.readState(instanceId);
  }

  deleteInstance(instanceId: string) {
    return this.impl.deleteInstance(instanceId);
  }
}

declare module 'cordis' {
  interface Context {
    infra: InstanceType<typeof InfraService>;
  }
}
