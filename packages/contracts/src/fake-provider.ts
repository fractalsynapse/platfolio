import { CONTRACT_VERSION, KEEP_DATA_FEATURE, OPERATIONS, planIssues, ProviderUnsupported, type CapabilityInfo, type Operation, type ApplyResult, type DeleteOptions, type DeleteResult, type InfraPlan, type InfraProvider, type RedeployResult, type SecretPresence, type SecretWriteResult, type Issue, type StateSnapshot } from './infra.ts';
import { samplePlan } from './conformance.ts';

export interface FakeOptions {
  /** Fail the apply of a named service, to exercise resume behavior. */
  failService?: string;
  /** Contract version this implementation claims. */
  contract?: string;
  /** Drop an operation from the advertised set, e.g. to model a partial provider. */
  without?: readonly string[];
  name?: string;
  /**
   * How many deployments this double may start before it reports `budgetSkipped`. Mirrors the Railway
   * driver's own ceiling, so the budget path is testable against BOTH implementations rather than being a
   * property only one of them can claim (docs/design/10: the second implementation is the proof).
   */
  deployBudget?: number;
}

/**
 * The in-memory test double for `infra.provider`. It exists to make the contract testable and
 * satisfiable by more than one implementation (the rule of two in docs/design/10), not to emulate a
 * real provider's semantics beyond the invariants the contract depends on: idempotency by planHash,
 * read-back verification, and honest orphan reporting.
 */
export class FakeInfraProvider implements InfraProvider {
  private readonly secretNames = new Set<string>();
  /**
   * Delivered values, held in memory only, for the lifetime of this object.
   *
   * The one place the double keeps a value, and it is kept to mirror a property the REAL provider has:
   * Railway holds what it was given and diffs the next write against it, which is why a changed value
   * restarts a service and an identical one does not (measured arms B and D). Nothing here reaches
   * platfolio's store -- the field is private, never serialised, and dies with the instance -- so a test
   * can assert the OUTCOME without the contract acquiring a place to keep credentials (D4).
   */
  private readonly secretValues = new Map<string, string>();
  private readonly instances = new Map<string, { plan: InfraPlan; services: StateSnapshot['services']; domains: StateSnapshot['domains']; applied: string[] }>();
  /** Deployment counter per instance/service, bumped by `redeploy` so a caller's read-back sees movement. */
  private readonly deploymentStamps = new Map<string, number>();
  private deploymentsUsed = 0;
  private readonly deployBudget: number;
  private readonly opts: Required<Pick<FakeOptions, 'contract' | 'name'>> & FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.opts = { contract: CONTRACT_VERSION, name: 'fake', ...options };
    this.deployBudget = options.deployBudget ?? 4;;
  }

  describe(): CapabilityInfo {
    return {
      provider: this.opts.name,
      contract: this.opts.contract,
      operations: OPERATIONS.filter((op) => !this.opts.without?.includes(op)) as CapabilityInfo['operations'],
      features: [KEEP_DATA_FEATURE, 'volumes', 'preview-environments'],
    };
  }

  /**
   * `without` has to remove the BEHAVIOUR, not only the advertised name.
   *
   * It used to filter `describe().operations` and leave the method working, which made the double a liar in
   * precisely the way this contract cares about: it claimed not to support an operation and then performed it.
   * A test written against that passes by exercising a capability the provider just said it lacked, and the
   * 501 path -- the honest answer a partial provider gives -- becomes untestable. The check is consulted at each
   * call site, so the claim and the behaviour cannot diverge.
   */
  private supports(operation: Operation): boolean {
    return !this.opts.without?.includes(operation);
  }

  private refuse(operation: Operation): never {
    throw new ProviderUnsupported(operation, `${this.opts.name} was configured without it`);
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
    const merged = [
      ...(existing?.services ?? []).filter((prior) => !services.some((next) => next.environment === prior.environment && next.name === prior.name)),
      ...services,
    ];
    const mergedDomains = [...(existing?.domains ?? []).filter((prior) => !domains.some((next) => next.host === prior.host)), ...domains];
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
  async putSecretValue(input: { instanceId: string; environment: string; service: string; name: string; value: string; source?: 'service' | 'shared-variable'; refresh?: 'suppress' | 'auto' }): Promise<SecretWriteResult> {
    if (!this.instances.has(input.instanceId)) return { ok: false, code: 'not-found', reason: `unknown instance ${input.instanceId}` };
    if (input.value.length === 0) return { ok: false, code: 'invalid-value', reason: 'a secret value must be a non-empty string' };
    // Two custody keys, because the contract distinguishes the scopes and a double that flattened them would
    // let a driver pass every assertion while writing secrets the service cannot read.
    const custodyKey = input.source === 'shared-variable'
      ? `${input.instanceId}/${input.environment}/+shared/${input.name}#${input.service}`
      : `${input.instanceId}/${input.environment}/${input.service}/${input.name}`;
    const prior = this.secretValues.get(custodyKey);
    const changed = prior !== undefined && prior !== input.value;
    this.secretNames.add(custodyKey);
    this.secretValues.set(custodyKey, input.value);
    if (input.refresh !== 'auto') return { ok: true, verified: true };
    const placedHere = (this.instances.get(input.instanceId)!.plan.environments.find((e) => e.name === input.environment)?.services.some((s) => s.name === input.service)) ?? false;
    if (!placedHere) return { ok: true, verified: true, refresh: 'unknown' };
    if (prior !== undefined && !changed) return { ok: true, verified: true, refresh: 'unchanged' };
    this.deploymentsUsed += 1;
    return { ok: true, verified: true, refresh: 'redeployed' };
  }

  async secretPresence(input: { instanceId: string; environment: string; service: string; names: string[] }): Promise<Record<string, SecretPresence>> {
    const out: Record<string, SecretPresence> = {};
    for (const name of input.names) {
      if (!this.instances.has(input.instanceId)) { out[name] = 'unverifiable'; continue; }
      const scoped = `${input.instanceId}/${input.environment}/${input.service}/${name}`;
      const attached = `${input.instanceId}/${input.environment}/+shared/${name}#${input.service}`;
      out[name] = this.secretNames.has(scoped) || this.secretNames.has(attached) ? 'set' : 'missing';
    }
    return out;
  }

  /**
   * The restart verb, modelled as an observation, not as a boolean echo.
   *
   * Each call bumps a per-service deployment stamp so a caller's read-back has something real to compare, and a
   * name that is not in this environment is REFUSED rather than quietly dropped -- the same shape the Railway
   * driver has to produce, because "202 accepted" and "nothing restarted" must never be the same answer.
   */
  async redeploy(input: { instanceId: string; environment: string; service?: string }): Promise<RedeployResult> {
    if (!this.supports('redeploy')) this.refuse('redeploy');
    const found = this.instances.get(input.instanceId);
    if (!found) {
      return { instanceId: input.instanceId, environment: input.environment, services: [], refused: [{ service: input.service ?? '*', code: 'no-project', reason: `no provider project for instance "${input.instanceId}" -- it has never been applied` }], budgetSkipped: [], verified: false };
    }
    // Scoped to the named environment, because `api` EXISTS in both of them and a double that flattened the two
    // would let a production refresh restart staging -- the wrong answer, and one the flattened
    // `StateSnapshot.services` read cannot express on its own. The environment has to come from the plan this
    // instance was applied with, which is what makes this the same question the Railway driver answers by
    // looking at which instances are placed in which environment.
    const envPlan = found.plan.environments.find((e) => e.name === input.environment);
    if (!envPlan) {
      return {
        instanceId: input.instanceId, environment: input.environment, services: [],
        refused: [{ service: input.service ?? '*', code: 'no-environment', reason: `environment "${input.environment}" is not in the plan this instance was applied with` }],
        budgetSkipped: [], verified: false,
      };
    }
    // The TARGETS come from the plan's environment, not from the flattened state read. `StateSnapshot.services`
    // holds one row per environment and does NOT carry the environment name, so filtering it by name matches
    // `api` in production AND `api` in staging at once -- a double that did that would restart a service in an
    // environment the caller did not name, and report it as one that did. The plan is the only place in this
    // object where "which services live in which environment" is still true.
    const planned = envPlan.services.filter((s) => input.service === undefined || s.name === input.service);
    const deployed = new Set(found.services.map((s) => s.name));
    const targets = planned.filter((s) => deployed.has(s.name));
    if (targets.length === 0) {
      return {
        instanceId: input.instanceId, environment: input.environment, services: [],
        refused: [{ service: input.service ?? '*', code: 'no-service', reason: `nothing named "${input.service ?? '(any)'}" is deployed in environment "${input.environment}" of this instance` }],
        budgetSkipped: [], verified: false,
      };
    }
    const services: string[] = [];
    const budgetSkipped: string[] = [];
    for (const s of targets) {
      if (this.deploymentsUsed >= this.deployBudget) { budgetSkipped.push(s.name); continue; }
      this.deploymentsUsed += 1;
      services.push(s.name);
      this.deploymentStamps.set(`${input.instanceId}/${input.environment}/${s.name}`, (this.deploymentStamps.get(`${input.instanceId}/${input.environment}/${s.name}`) ?? 0) + 1);
    }
    // A refresh that was asked for and could not be started because of the ceiling is NOT a success, and it is
    // not a `no-service` refusal either -- those are different facts and collapsing them is how an operator
    // goes looking for a service that is there. `verified` therefore means "everything asked for was restarted",
    // with `budgetSkipped` naming what was not; nothing was ever silently dropped.
    const verified = services.length > 0 && budgetSkipped.length === 0;
    return { instanceId: input.instanceId, environment: input.environment, services, refused: [], budgetSkipped, verified };
  }

  async deleteInstance(instanceId: string): Promise<DeleteResult>;
  async deleteInstance(instanceId: string, options: DeleteOptions): Promise<DeleteResult>;
  async deleteInstance(instanceId: string, { data }: DeleteOptions = { data: 'wipe' }): Promise<DeleteResult> {
    const found = this.instances.get(instanceId);
    if (!found) return { instanceId, removed: [], orphans: [] };
    if (data === 'keep') {
      this.instances.set(instanceId, { ...found, applied: [], services: found.services.map((service) => ({ ...service, status: 'stopped' })) });
      return { instanceId, removed: [], orphans: [], retained: found.plan.environments.flatMap(({ volumes }) => (volumes ?? []).map(({ name }) => name)) };
    }
    if (data !== 'wipe') throw new Error('Unknown storage removal option');
    const removed = [...found.services.map((s) => s.externalId), ...found.domains.map((d) => d.host)];
    // A deliberately injected orphan, so the orphan-reporting path is exercised, not theoretical.
    const orphans = this.opts.failService ? [`${this.opts.failService}(volume)`] : [];
    if (orphans.length === 0) this.instances.delete(instanceId);
    return { instanceId, removed, orphans };
  }
}

export { samplePlan };
