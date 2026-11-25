import { Context, Service } from 'cordis';
import { z } from 'zod';
import { CONTRACT_VERSION, HostingProviderIdSchema, ProviderUnsupported, hostingProviders, type DeleteOptions, type InfraPlan, type InfraProvider, type HostingTarget } from '@platfolio/contracts';

export const ProviderConfigSchema = z.object({
  provider: HostingProviderIdSchema,
  contract: z.string().min(1).default(`^${CONTRACT_VERSION}`),
  features: z.array(z.string()).default([]),
}).strict();

export interface RailwayWiring {
  workspaceId: string;
  credentials: import('@platfolio/contracts').RailwayCredentialSource;
  transport?: import('@platfolio/contracts').RailwayTransport;
}

export type HostingPlugin = InfraProvider & { bindInstance?(instance: HostingTarget): InfraProvider | undefined };

type Config = z.infer<typeof ProviderConfigSchema> & { providers: readonly HostingPlugin[]; developmentAlias: boolean };

export class InfraService extends Service<Config> {
  static inject = [] as const;
  static provide = 'infra' as const;

  private readonly registered: ReturnType<typeof hostingProviders>;
  private readonly config: Config;

  constructor(ctx: Context, config: Config) {
    super(ctx, 'infra');
    this.config = config;
    this.registered = hostingProviders(config.providers, config.contract);
  }

  /** Resolve a provider after the caller has authenticated and loaded the instance binding. */
  forProvider(id: string): InfraProvider | undefined {
    return this.registered.get(id) ?? (this.config.developmentAlias && id === 'railway' ? this.registered.get('fake') : undefined);
  }

  forInstance(instance: HostingTarget): InfraProvider | undefined {
    const plugin = this.forProvider(instance.provider) as HostingPlugin | undefined;
    return plugin?.bindInstance ? plugin.bindInstance(instance) : plugin;
  }

  get impl(): InfraProvider { return this.registered.require(this.config.provider); }
  describe() { return this.impl.describe(); }
  validatePlan(plan: InfraPlan) { return this.impl.validatePlan(plan); }
  applyPlan(plan: InfraPlan) { return this.impl.applyPlan(plan); }
  readState(instanceId: string) { return this.impl.readState(instanceId); }
  deleteInstance(instanceId: string, options?: DeleteOptions) {
    return options ? this.impl.deleteInstance(instanceId, options) : this.impl.deleteInstance(instanceId);
  }
  putSecretValue(input: Parameters<NonNullable<InfraProvider['putSecretValue']>>[0]) {
    if (!this.impl.putSecretValue || !this.canDeliverSecrets) throw new ProviderUnsupported('putSecretValue');
    return this.impl.putSecretValue(input);
  }
  secretPresence(input: Parameters<NonNullable<InfraProvider['secretPresence']>>[0]) {
    if (!this.impl.secretPresence || !this.impl.describe().operations.includes('secretPresence')) throw new ProviderUnsupported('secretPresence');
    return this.impl.secretPresence(input);
  }
  get canDeliverSecrets(): boolean { return this.impl.describe().operations.includes('putSecretValue'); }
  redeploy(input: Parameters<NonNullable<InfraProvider['redeploy']>>[0]) {
    if (!this.impl.redeploy || !this.canRedeploy) throw new ProviderUnsupported('redeploy');
    return this.impl.redeploy(input);
  }
  get canRedeploy(): boolean { return this.impl.describe().operations.includes('redeploy'); }
}

declare module 'cordis' {
  interface Context { infra: InfraService }
}
