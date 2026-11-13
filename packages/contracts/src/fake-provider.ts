import { OPERATIONS, planIssues, type CapabilityInfo, type ApplyResult, type DeleteResult, type InfraPlan, type InfraProvider, type SecretPresence, type SecretWriteResult, type Issue, type StateSnapshot } from './infra.ts';
import { samplePlan } from './conformance.ts';

export interface FakeOptions {
  /** Fail the apply of a named service, to exercise resume behavior. */
  failService?: string;
  /** Contract version this implementation claims. */
  contract?: string;
  /** Drop an operation from the advertised set, e.g. to model a partial provider. */
  without?: readonly string[];
  name?: string;
}

/**
 * The in-memory test double for `infra.provider`. It exists to make the contract testable and
 * satisfiable by more than one implementation (the rule of two in docs/design/10), not to emulate a
 * real provider's semantics beyond the invariants the contract depends on: idempotency by planHash,
 * read-back verification, and honest orphan reporting.
 */
export class FakeInfraProvider implements InfraProvider {
  private readonly secretNames = new Set<string>();
  private readonly instances = new Map<string, { plan: InfraPlan; services: StateSnapshot['services']; domains: StateSnapshot['domains']; applied: string[] }>();
  private readonly opts: Required<Pick<FakeOptions, 'contract' | 'name'>> & FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.opts = { contract: '1.0.0', name: 'fake', ...options };
  }

  describe(): CapabilityInfo {
    return {
      provider: this.opts.name,
      contract: this.opts.contract,
      operations: OPERATIONS.filter((op) => !this.opts.without?.includes(op)) as CapabilityInfo['operations'],
      features: ['volumes', 'preview-environments'],
    };
  }

  validatePlan(plan: InfraPlan): Issue[] {
    // Provider-specific rules would be appended here; the cross-field rules are shared so no two
    // providers disagree about what a valid plan is.
    return planIssues(plan);
  }

  async applyPlan(plan: InfraPlan): Promise<ApplyResult> {
    const issues = this.validatePlan(plan);
    if (issues.length) {
      return { instanceId: plan.instanceId, planHash: plan.planHash, verified: false, services: [], domains: [], noop: false, failures: issues.map((i) => ({ step: 'validate', code: i.code, message: i.message })) };
    }
    const existing = this.instances.get(plan.instanceId);
    if (existing && existing.applied.includes(plan.planHash)) {
      return { instanceId: plan.instanceId, planHash: plan.planHash, verified: true, services: existing.services, domains: existing.domains, noop: true, failures: [] };
    }
    const services: StateSnapshot['services'] = [];
    const domains: StateSnapshot['domains'] = [];
    const failures: ApplyResult['failures'] = [];
    for (const env of plan.environments) {
      for (const s of env.services) {
        if (this.opts.failService && s.name === this.opts.failService) {
          failures.push({ step: `apply:${env.name}/${s.name}`, code: 'injected-failure', message: 'fake configured to fail this service' });
          continue;
        }
        const externalId = `${env.name}/${s.name}@${plan.planHash.slice(0, 8)}`;
        if (!services.some((x) => x.externalId === externalId)) services.push({ name: s.name, environment: env.name, externalId, status: 'live', image: `${s.image}@${s.digest}`, numReplicas: s.replicas });
      }
      for (const d of env.domains) {
        if (!domains.some((x) => x.host === d.host)) domains.push({ host: d.host, dnsStatus: 'verified', certificateStatus: 'issued', targetService: d.service });
      }
    }
    const merged = [...(existing?.services ?? []), ...services];
    const mergedDomains = [...(existing?.domains ?? []), ...domains];
    this.instances.set(plan.instanceId, { plan, services: merged, domains: mergedDomains, applied: [...(existing?.applied ?? []), plan.planHash] });
    // Read-back: confirm the model reflects what we intended to create, exactly as the real
    // provider path must confirm via `latestDeployment`/`domains` rather than trusting a 2xx.
    const state = this.readStateSync(plan.instanceId);
    const want = plan.environments.reduce((n, e) => n + e.services.length, 0);
    const verified = failures.length === 0 && state.services.length >= want && state.services.every((s) => s.status === 'live');
    return { instanceId: plan.instanceId, planHash: plan.planHash, verified, services: state.services, domains: state.domains, noop: false, failures };
  }

  private readStateSync(instanceId: string): StateSnapshot {
    const found = this.instances.get(instanceId);
    if (!found) throw new Error(`unknown instance ${instanceId}`);
    const services = [...found.services];
    const seen = new Set<string>();
    const deduped = services.filter((s) => {
      const k = `${s.environment}/${s.name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return {
      instanceId,
      projectExternalId: `proj-${instanceId}`,
      capturedAt: new Date().toISOString(),
      services: deduped,
      domains: found.domains.filter((d, i, all) => all.findIndex((x) => x.host === d.host) === i),
      ceilings: [],
    };
  }

  async readState(instanceId: string): Promise<StateSnapshot> {
    if (!this.instances.has(instanceId)) throw new Error(`unknown instance ${instanceId}`);
    return this.readStateSync(instanceId);
  }

  /**
   * Presence recorded, value discarded immediately (D53). The double CANNOT store a secret, which is the point:
   * a test implementation that kept values would let the contract be satisfied by an implementation that
   * violates it.
   */
  async putSecretValue(input: { instanceId: string; environment: string; service: string; name: string; value: string }): Promise<SecretWriteResult> {
    if (!this.instances.has(input.instanceId)) return { ok: false, code: 'not-found', reason: `unknown instance ${input.instanceId}` };
    if (input.value.length === 0) return { ok: false, code: 'invalid-value', reason: 'a secret value must be a non-empty string' };
    this.secretNames.add(`${input.instanceId}/${input.environment}/${input.service}/${input.name}`);
    return { ok: true, verified: true };
  }

  async secretPresence(input: { instanceId: string; environment: string; service: string; names: string[] }): Promise<Record<string, SecretPresence>> {
    const out: Record<string, SecretPresence> = {};
    for (const name of input.names) {
      if (!this.instances.has(input.instanceId)) { out[name] = 'unverifiable'; continue; }
      out[name] = this.secretNames.has(`${input.instanceId}/${input.environment}/${input.service}/${name}`) ? 'set' : 'missing';
    }
    return out;
  }

  async deleteInstance(instanceId: string): Promise<DeleteResult> {
    const found = this.instances.get(instanceId);
    if (!found) return { instanceId, removed: [], orphans: [] };
    const removed = [...found.services.map((s) => s.externalId), ...found.domains.map((d) => d.host)];
    // A deliberately injected orphan, so the orphan-reporting path is exercised, not theoretical.
    const orphans = this.opts.failService ? [`${this.opts.failService}(volume)`] : [];
    if (orphans.length === 0) this.instances.delete(instanceId);
    return { instanceId, removed, orphans };
  }
}

export { samplePlan };
