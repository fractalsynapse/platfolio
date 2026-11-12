import { OPERATIONS, ProviderUnsupported, satisfiesRange, type ApplyResult, type CapabilityInfo, type DeleteResult, type InfraPlan, type InfraProvider, type Issue, type StateSnapshot } from './infra.ts';

/**
 * The conformance suite: what makes "swappable provider" a claim that can be tested instead of
 * asserted. Any implementation — the in-memory double, the Railway provider, or a future one — runs
 * through the same cases, and a provider that has not passed cannot be selected by the control plane
 * (docs/design/10 § "Interface contracts drive versioning").
 *
 * A case result is one of pass / fail / not-implemented. "not-implemented" is reported separately from
 * failure on purpose: an incomplete provider must be visibly incomplete, never silently green.
 */

export type CaseStatus = 'pass' | 'fail' | 'not-implemented';

export interface CaseResult {
  name: string;
  status: CaseStatus;
  detail: string;
}

export interface ConformanceReport {
  /** 'full' uses the reference sample plan; 'reduced' means the provider cannot satisfy it yet. */
  scope: 'full' | 'reduced';
  provider: string;
  contract: string;
  requiredRange: string;
  results: CaseResult[];
  passed: number;
  failed: number;
  unimplemented: number;
  ok: boolean;
}

/** A plan built for testing: two environments, one service, one database, one domain. */
export function samplePlan(overrides: Partial<InfraPlan> = {}): InfraPlan {
  const service = (name: string, replicas: number) => ({
    name,
    image: `ghcr.io/acme/${name}:1.4.0`,
    digest: `sha256:${'a'.repeat(64)}`,
    port: 3000,
    healthPath: '/healthz',
    replicas,
    limits: { cpu: 1, memoryMB: 512 },
    env: [{ name: 'NODE_ENV', literal: 'production' }],
    secrets: [{ name: 'STRIPE_WEBHOOK_SECRET', source: 'preserve' as const }],
  });
  return {
    instanceId: 'inst-01',
    teamId: 'team-01',
    provider: 'sample',
    contract: '1.0.0',
    planHash: 'a'.repeat(16),
    manifestRef: { template: 'example-web-app', version: '1.4.0' },
    environments: [
      { name: 'production', services: [service('api', 2)], domains: [{ host: 'api.example.com', service: 'api', port: 3000, verificationName: 'domain-verify' }], databases: [{ name: 'app-db', kind: 'postgres' }], buckets: [{ name: 'clones', region: 'iad' }] },
      { name: 'staging', cloneFrom: 'production', services: [service('api', 1)], domains: [], databases: [{ name: 'app-db', kind: 'postgres' }], buckets: [] },
    ],
    ...overrides,
  };
}

async function guarded(run: () => Promise<CaseResult>): Promise<CaseResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderUnsupported) return { name: '', status: 'not-implemented', detail: error.message };
    return { name: '', status: 'fail', detail: (error as Error).message };
  }
}

/**
 * @param make fresh provider instance per case, so state cannot leak between cases
 * @param requiredRange contract range the control plane requires, e.g. "^1.0.0"
 */
/**
 * A provider that cannot yet satisfy the reference sample plan may be run against a reduced fixture, but
 * the report then carries `scope: 'reduced'` so nobody can quote it as conformance. The default stays the
 * strict, full-capability gate.
 */
export interface ConformanceOptions {
  plan?: () => InfraPlan;
}

export async function runConformance(make: () => InfraProvider, requiredRange = '^1.0.0', options: ConformanceOptions = {}): Promise<ConformanceReport> {
  const scope: ConformanceReport['scope'] = options.plan ? 'reduced' : 'full';
  if (options.plan) {
    const probe = options.plan();
    // What must be present is a *service* and a *domain* -- not an arbitrary count, which once rejected a
    // legitimate single-environment plan while a bloated one would have passed.
    const services = probe.environments.reduce((n, e) => n + e.services.length, 0);
    const domains = probe.environments.reduce((n, e) => n + e.domains.length, 0);
    const environments = probe.environments.length;
    if (services < 1 || domains < 1 || environments < 1) {
      throw new Error(`a reduced conformance plan must still exercise a service and a domain (got ${services} services, ${domains} domains)`);
    }
  }
  /** Every case resolves its plan through here, so a reduced run is uniform and visible. */
  const planFor = (overrides: Parameters<typeof samplePlan>[0] = {}): InfraPlan => (options.plan ? options.plan() : samplePlan(overrides));

  const results: CaseResult[] = [];
  const add = async (name: string, run: () => Promise<Omit<CaseResult, 'name'>>): Promise<void> => {
    const out = await guarded(async () => ({ name, ...(await run()) }));
    results.push({ ...out, name });
  };

  const first = make();
  const info = first.describe();
  const contractOk = satisfiesRange(info.contract, requiredRange);

  await add('describe: names every operation it claims', async () => {
    const unknown = info.operations.filter((op) => !(OPERATIONS as readonly string[]).includes(op));
    if (unknown.length) return Promise.resolve({ status: 'fail', detail: `unknown operations: ${unknown.join(', ')}` });
    if (info.operations.length === 0) return Promise.resolve({ status: 'fail', detail: 'provider declares no operations' });
    return Promise.resolve({ status: 'pass', detail: `${info.provider}@${info.contract}: ${info.operations.length}/${OPERATIONS.length} operations` });
  });

  await add('contract version satisfies the required range', async () =>
    Promise.resolve(
      contractOk
        ? { status: 'pass', detail: `${info.contract} satisfies ${requiredRange}` }
        : { status: 'fail', detail: `${info.contract} does not satisfy ${requiredRange}` },
    ),
  );

  await add('validatePlan rejects a plan with an unknown resource reference', async () => {
    const plan = planFor();
    plan.environments[0]!.domains = [{ host: 'x.example.com', service: 'ghost', port: 1, verificationName: 'v' }];
    const issues = make().validatePlan(plan);
    return issues.length
      ? Promise.resolve({ status: 'pass', detail: `${issues.length} issue(s): ${issues[0]!.code}` })
      : Promise.resolve({ status: 'fail', detail: 'accepts a domain targeting a non-existent service' });
  });

  await add('validatePlan rejects a mutable tag instead of a digest', async () => {
    const plan = planFor();
    plan.environments[0]!.services[0]!.digest = 'sha256:bad';
    const issues = make().validatePlan(plan);
    return issues.length
      ? Promise.resolve({ status: 'pass', detail: 'digest shape enforced' })
      : Promise.resolve({ status: 'fail', detail: 'accepted a malformed digest' });
  });

  await add('apply then readState shows every environment, service and domain', async () => {
    const provider = make();
    const plan = planFor();
    const applied = await provider.applyPlan(plan);
    if (!applied.verified) {
      const reasons = applied.failures.map((f) => `${f.code}@${f.step}: ${f.message.slice(0, 110)}`);
      return { status: 'fail', detail: `apply did not verify: ${reasons.join(' | ') || 'no failures reported'}` };
    }
    if (applied.failures.length) return { status: 'fail', detail: `apply reported failures: ${applied.failures.map((f) => f.code).join(', ')}` };
    const state = await provider.readState(plan.instanceId);
    const want = plan.environments.reduce((n, e) => n + e.services.length, 0);
    const wantDomains = plan.environments.reduce((n, e) => n + e.domains.length, 0);
    if (state.services.length < want) return { status: 'fail', detail: `expected >=${want} services, got ${state.services.length}` };
    if (state.domains.length < wantDomains) return { status: 'fail', detail: `expected >=${wantDomains} domains, got ${state.domains.length}` };
    if (state.services.some((s) => s.status !== 'live')) return { status: 'fail', detail: 'a service is not live after a verified apply' };
    if (!state.domains.every((d) => d.certificateStatus === 'issued')) return { status: 'fail', detail: 'domain certificate status not reported' };
    return { status: 'pass', detail: `${state.services.length} services, ${state.domains.length} domains, all live with certificate state reported` };
  });

  await add('re-applying the same planHash is a no-op, not a duplicate', async () => {
    const provider = make();
    const plan = planFor();
    await provider.applyPlan(plan);
    const again = await provider.applyPlan(plan);
    if (!again.noop) return { status: 'fail', detail: 'second apply did not report noop' };
    const state = await provider.readState(plan.instanceId);
    const ids = new Set(state.services.map((s) => s.externalId));
    return ids.size === state.services.length
      ? { status: 'pass', detail: `${state.services.length} services, no duplicates` }
      : { status: 'fail', detail: `duplicate services after retry (${state.services.length} services, ${ids.size} ids)` };
  });

  await add('interrupted apply converges on retry with no orphans', async () => {
    const provider = make();
    const plan = planFor();
    const partial = await provider.applyPlan({ ...plan, environments: [plan.environments[0]!] });
    if (partial.failures.length) return { status: 'fail', detail: 'first phase failed unexpectedly' };
    const full = await provider.applyPlan(plan);
    if (!full.verified) return { status: 'fail', detail: 'resumed apply not verified' };
    const state = await provider.readState(plan.instanceId);
    const dupes = state.services.length - new Set(state.services.map((s) => `${s.environment}/${s.name}`)).size;
    return dupes === 0 ? { status: 'pass', detail: `converged to ${state.services.length} services` } : { status: 'fail', detail: `${dupes} duplicate services after resume` };
  });

  await add('secrets are never carried in a plan, by schema', async () => {
    const raw = JSON.stringify(planFor()) as unknown;
    const text = typeof raw === 'string' ? raw : '';
    const looksLikeValue = /"(client[_-]?secret|token|password|api[_-]?key)"\s*:\s*"[^"]{8,}"/i.test(text);
    return looksLikeValue
      ? { status: 'fail', detail: 'plan serialization contains a secret-valued field' }
      : { status: 'pass', detail: 'plan JSON holds secret names and sources only' };
  });

  await add('deleteInstance removes everything and reports orphans honestly', async () => {
    const provider = make();
    const plan = planFor();
    await provider.applyPlan(plan);
    const deleted = await provider.deleteInstance(plan.instanceId);
    if (deleted.orphans.length) return { status: 'fail', detail: `orphans left behind: ${deleted.orphans.join(', ')}` };
    let state: StateSnapshot | undefined;
    try {
      state = await provider.readState(plan.instanceId);
    } catch {
      return { status: 'pass', detail: `${deleted.removed.length} resources removed; state no longer readable` };
    }
    return state.services.length === 0
      ? { status: 'pass', detail: `${deleted.removed.length} resources removed, empty state remains readable` }
      : { status: 'fail', detail: `${state.services.length} services still present after delete` };
  });

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const unimplemented = results.filter((r) => r.status === 'not-implemented').length;
  return {
    scope,
    provider: info.provider,
    contract: info.contract,
    requiredRange,
    results,
    passed,
    failed,
    unimplemented,
    ok: failed === 0 && unimplemented === 0 && contractOk,
  };
}

export type { CapabilityInfo, ApplyResult, DeleteResult, Issue, InfraProvider };
