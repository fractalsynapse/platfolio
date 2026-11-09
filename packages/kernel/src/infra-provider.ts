import { Context, Service } from 'cordis';
import { z } from 'zod';
import {
  CONTRACT_NAME, FakeInfraProvider, RailwayInfraProvider, satisfiesRange,
  type InfraPlan, type InfraProvider,
} from '@platfolio/contracts';

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

/** Everything the Railway provider needs that is not configuration data. */
export interface RailwayWiring {
  workspaceId: string;
  credentials: import('@platfolio/contracts').RailwayCredentialSource;
  transport?: import('@platfolio/contracts').RailwayTransport;
}

/** Refuses loudly on first use: an unattached Railway selection is a misconfiguration. */
const unwired = (): never => {
  throw new Error('railway provider has no workspace or credential source attached — call ctx.infra.attachRailway() at the composition root');
};

const unwiredProvider = (): InfraProvider => ({
  describe: () => ({ provider: 'railway', contract: '1.0.0', operations: [], features: [] }),
  validatePlan: (plan: InfraPlan) => { void plan; return unwired(); },
  applyPlan: () => unwired(),
  readState: () => unwired(),
  deleteInstance: () => unwired(),
});

export class InfraService extends Service<z.infer<typeof ProviderConfigSchema>> {
  static inject = [] as const;
  static provide = 'infra' as const;

  private selected: InfraProvider;
  private readonly wantedRailway: boolean;

  constructor(ctx: Context, config: z.infer<typeof ProviderConfigSchema>) {
    super(ctx, 'infra');
    const parsed = ProviderConfigSchema.parse(config ?? { provider: 'fake' });
    this.wantedRailway = parsed.provider === 'railway';
    this.selected = this.wantedRailway ? unwiredProvider() : new FakeInfraProvider();
    this.guard(parsed.contract);
  }

  /** Attach the real Railway provider once the composition root has credentials and a workspace. */
  attachRailway(wiring: RailwayWiring): void {
    if (!this.wantedRailway) throw new Error('attachRailway() called while the selected provider is not "railway"');
    this.selected = new RailwayInfraProvider({ workspaceId: wiring.workspaceId, credentials: wiring.credentials, ...(wiring.transport ? { transport: wiring.transport } : {}) });
    this.guard(ProviderConfigSchema.parse({ provider: 'railway' }).contract);
  }

  private guard(range: string): void {
    const info = this.selected.describe();
    if (!info.operations.length && this.wantedRailway) return; // unwired: refusal happens on first call
    if (!satisfiesRange(info.contract, range)) {
      throw new Error(`${CONTRACT_NAME}: provider "${info.provider}" at ${info.contract} does not satisfy required range "${range}"`);
    }
  }

  get impl(): InfraProvider { return this.selected; }

  describe() { return this.selected.describe(); }
  validatePlan(plan: InfraPlan) { return this.selected.validatePlan(plan); }
  applyPlan(plan: InfraPlan) { return this.selected.applyPlan(plan); }
  readState(instanceId: string) { return this.selected.readState(instanceId); }
  deleteInstance(instanceId: string) { return this.selected.deleteInstance(instanceId); }
}

declare module 'cordis' {
  interface Context {
    infra: InstanceType<typeof InfraService>;
  }
}
