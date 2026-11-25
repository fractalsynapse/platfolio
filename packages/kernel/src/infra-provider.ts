import { Context, Service } from 'cordis';
import { z } from 'zod';
import { CONTRACT_NAME, CONTRACT_VERSION, satisfiesRange, type InfraPlan, type InfraProvider } from '@platfolio/contracts';

/**
 * The `infra.provider` capability, exposed as a stable `ctx.infra` service. This file is the seam
 * between platfolio's contracts and the vendored framework: nothing outside `packages/kernel` may
 * import `cordis` (docs/design/10, D15).
 */
export const ProviderConfigSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]*$/),
  // D59: the default required range is derived from the contract this build compiled against, so a
  // version bump cannot leave a stale "^1.0.0" guard that refuses the provider it ships with.
  contract: z.string().min(1).default(`^${CONTRACT_VERSION}`),
  features: z.array(z.string()).default([]),
}).strict();

/** Everything the Railway provider needs that is not configuration data. */
export interface RailwayWiring {
  workspaceId: string;
  credentials: import('@platfolio/contracts').RailwayCredentialSource;
  transport?: import('@platfolio/contracts').RailwayTransport;
}

type InfraServiceConfig = z.infer<typeof ProviderConfigSchema> & { implementation: InfraProvider };

export class InfraService extends Service<InfraServiceConfig> {
  static inject = [] as const;
  static provide = 'infra' as const;

  private readonly selected: InfraProvider;

  constructor(ctx: Context, { implementation, ...config }: InfraServiceConfig) {
    super(ctx, 'infra');
    const { provider, contract, features } = ProviderConfigSchema.parse(config);
    const info = implementation.describe();
    if (info.provider !== provider) {
      throw new Error(`${CONTRACT_NAME}: registered provider "${provider}" identifies as "${info.provider}"`);
    }
    if (!satisfiesRange(info.contract, contract)) {
      throw new Error(`${CONTRACT_NAME}: provider "${info.provider}" at ${info.contract} does not satisfy required range "${contract}"`);
    }
    const missing = features.filter((feature) => !info.features.includes(feature));
    if (missing.length) throw new Error(`${CONTRACT_NAME}: provider "${provider}" is missing required features: ${missing.join(', ')}`);
    this.selected = implementation;
  }

  get impl(): InfraProvider { return this.selected; }

  describe() { return this.selected.describe(); }
  validatePlan(plan: InfraPlan) { return this.selected.validatePlan(plan); }
  applyPlan(plan: InfraPlan) { return this.selected.applyPlan(plan); }
  readState(instanceId: string) { return this.selected.readState(instanceId); }
  deleteInstance(instanceId: string) { return this.selected.deleteInstance(instanceId); }
    // Forwarded, and the absence is reported: whether a driver implements these is answerable from
    // describe().operations, so a handler that assumes the fake provider can do what Railway can is a bug
    // in the handler. The error names the provider rather than the verb, because that is what an operator
    // can act on.
    // `refresh` is passed through rather than restated: a facade that omitted the field would silently deliver
    // with suppression while the caller asked for a restart, which is the plausible-outcome failure exactly one
    // layer below the place it would be noticed.
    putSecretValue(input: { instanceId: string; environment: string; service: string; name: string; value: string; source?: 'service' | 'shared-variable'; refresh?: 'suppress' | 'auto' }) {
      const fn = this.selected.putSecretValue;
      if (typeof fn !== 'function') {
        throw new Error(`provider "${this.selected.describe().provider}" cannot deliver secrets: it does not implement putSecretValue`);
      }
      return fn.call(this.selected, input);
    }
    secretPresence(input: { instanceId: string; environment: string; service: string; names: string[] }) {
      const fn = this.selected.secretPresence;
      if (typeof fn !== 'function') {
        throw new Error(`provider "${this.selected.describe().provider}" cannot read secret presence: it does not implement secretPresence`);
      }
      return fn.call(this.selected, input);
    }
    /** Lets a handler answer 501 with a reason instead of attempting a call it knows will throw. */
    get canDeliverSecrets(): boolean { return typeof this.selected.putSecretValue === 'function'; }
    /**
     * The restart verb. Forwarded with the same discipline as delivery: whether a driver can do it is
     * answerable from `describe().operations`, so a handler asks rather than assumes, and a provider that
     * cannot is a 501 with the provider's name in it rather than a TypeError from inside a facade.
     */
    redeploy(input: { instanceId: string; environment: string; service?: string }) {
      const fn = this.selected.redeploy;
      if (typeof fn !== 'function') {
        throw new Error(`provider "${this.selected.describe().provider}" cannot redeploy a service: it does not implement redeploy`);
      }
      return fn.call(this.selected, input);
    }
    /**
     * Whether the selected driver can restart a service.
     *
     * Read from `describe().operations`, NOT from `typeof this.selected.redeploy === 'function'`. The
     * difference is the whole point of advertising an operation set: a driver may expose a method that refuses
     * at call time, and a double configured `without: ['redeploy']` keeps its method on the prototype while
     * declaring the verb absent. Checking the property would then answer "yes", call a method designed to throw,
     * and surface a 500 for what is really a 501 -- the same "plausible outcome instead of a refusal" failure
     * this platform keeps meeting. `canDeliverSecrets` below has that flaw for the same reason and is left as
     * found rather than silently widened: nothing in tree currently delivers through a driver that advertises
     * the verb away, so changing it would be an untested edit. It should follow this one when a test exists.
     */
    get canRedeploy(): boolean { return this.selected.describe().operations.includes('redeploy'); }
}

declare module 'cordis' {
  interface Context {
    infra: InstanceType<typeof InfraService>;
  }
}
