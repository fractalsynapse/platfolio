import { InfraPlanSchema, planIssues, ProviderUnsupported, type ApplyResult, type CapabilityInfo, type DeleteResult, type InfraPlan, type InfraProvider, type Issue, type StateSnapshot } from './infra.ts';


/**
 * Railway provider, contract 1.0.0 — **deliberately incomplete**, and honest about it.
 *
 * Implemented here: `describe` and `validatePlan`, which need no network and no credential. Everything
 * that would talk to Railway throws `ProviderUnsupported`, so the conformance suite reports
 * `not-implemented` rather than letting a stub pass as a provider. The real implementations land with
 * the execution plane (docs/design/04) and go through the tenant's runner, which is where the provider
 * token lives — this class must never hold one.
 */
export class RailwayInfraProvider implements InfraProvider {
  readonly contract = '1.0.0';

  describe(): CapabilityInfo {
    return {
      provider: 'railway',
      contract: this.contract,
      operations: ['describe', 'validatePlan'],
      features: ['volumes', 'buckets', 'custom-domains', 'environment-cloning'],
    };
  }

  validatePlan(plan: InfraPlan): Issue[] {
    const issues: Issue[] = planIssues(plan);
    const parsed = InfraPlanSchema.safeParse(plan);
    if (!parsed.success) return issues;
    // Railway-specific rules that the shared checks cannot express.
    for (const env of parsed.data.environments) {
      if (env.name.length > 64) issues.push({ path: ['environments', env.name], code: 'provider-name-limit', message: 'environment names are limited to 64 characters' });
      for (const d of env.domains) {
        const labels = d.host.split('.');
        if (labels.length < 2) issues.push({ path: ['environments', env.name, 'domains', d.host], code: 'host-form', message: 'host must include a domain suffix' });
        if (d.host.startsWith('*')) issues.push({ path: ['environments', env.name, 'domains', d.host], code: 'wildcard-explicit', message: 'wildcards are declared at the manifest level, not as domains' });
      }
      for (const b of env.buckets) {
        if (b.region && !/^[a-z]{2,4}(-[a-z])?$/.test(b.region)) issues.push({ path: ['environments', env.name, 'buckets', b.name, 'region'], code: 'region-form', message: `unrecognized region "${b.region}"` });
      }
    }
    return issues;
  }

  async applyPlan(_plan: InfraPlan): Promise<ApplyResult> {
    throw new ProviderUnsupported('applyPlan', 'execution runs in the tenant CI via the GitHub workflow (docs/design/04)');
  }

  async readState(_instanceId: string): Promise<StateSnapshot> {
    throw new ProviderUnsupported('readState', 'requires the provider API client, scheduled with M2');
  }

  async deleteInstance(_instanceId: string): Promise<DeleteResult> {
    throw new ProviderUnsupported('deleteInstance', 'requires the provider API client, scheduled with M2');
  }
}
