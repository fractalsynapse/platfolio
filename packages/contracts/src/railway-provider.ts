import {
  InfraPlanSchema, planIssues,
  type ApplyResult, type CapabilityInfo, type DeleteResult, type InfraPlan, type InfraProvider,
  type Issue, type ServicePlan, type StateSnapshot,
} from './infra.ts';
import {
  HttpRailwayTransport, type RailwayCredential, type RailwayCredentialSource, type RailwayTransport,
} from './railway-transport.ts';

/**
 * Railway provider, contract 1.0.0.
 *
 * Written against measured behaviour rather than documentation summaries
 * (docs/research/railway-token-and-sealing-2026-11-08.md): a workspace grant creates projects,
 * environments and project tokens; the minted environment-scoped token does service work and authenticates
 * only in `Project-Access-Token`; a sourceless service consumes no deploy; `serviceInstanceDeploy` reaches
 * SUCCESS.
 *
 * Two gaps are reported instead of hidden. Resource ceilings are not expressible through this API, and
 * databases/buckets are not implemented here — so an apply that asks for either comes back with visible
 * failures rather than a green that means something else.
 *
 * Nothing in this file persists or returns a secret value. Literal configuration is written; secrets are
 * verified by **name presence** through `Environment.config`, measured to redact values, and are never read
 * through `variables()`.
 */

/** Written into the project description so an apply can recognise its own last plan. */
const MARKER = 'platfolio:plan=';

/**
 * The complete `DeploymentStatus` enum, introspected live (BUILDING, CRASHED, DEPLOYING, FAILED,
 * INITIALIZING, NEEDS_APPROVAL, QUEUED, REMOVED, REMOVING, SKIPPED, SLEEPING, SUCCESS, WAITING). An
 * earlier map guessed at values and omitted NEEDS_APPROVAL -- the exact state a workspace approval gate
 * produces, and the one docs/design/06 says must surface to the tenant rather than look like a slow
 * deploy. Unknown values now map to 'pending' *and* are reported, so a provider change cannot silently
 * flatten a new state into "still starting".
 */
const STATUS_MAP: Record<string, ServiceStateStatus> = {
  SUCCESS: 'live',
  FAILED: 'failed',
  CRASHED: 'crashed',
  DEPLOYING: 'deploying',
  BUILDING: 'building',
  INITIALIZING: 'deploying',
  QUEUED: 'pending',
  WAITING: 'pending',
  PENDING: 'pending',
  NEEDS_APPROVAL: 'awaiting-approval',
  SLEEPING: 'sleeping',
  REMOVED: 'removed',
  REMOVING: 'removed',
  SKIPPED: 'removed',
};

/** Statuses the controller may keep polling on; anything else is terminal for a wait. */
const IN_FLIGHT: ReadonlySet<ServiceStateStatus> = new Set(['pending', 'building', 'deploying']);

type ServiceStateStatus = StateSnapshot['services'][number]['status'];

export interface RailwayProviderOptions {
  credentials: RailwayCredentialSource;
  transport?: RailwayTransport;
  workspaceId: string;
  /**
   * Deploys this provider instance may trigger. The execution plane treats the tenant's daily ceiling as
   * external and hard, so the guard lives here instead of in the caller's memory.
   */
  deployBudget?: number;
  /** Wall-clock budget for waiting on a deployment to settle. */
  deployTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface ServiceNode { id: string; name: string }
interface EnvironmentNode { id: string; name: string }
interface ProjectNode { id: string; name: string; description?: string }
interface InstanceInfo { instanceId: string; rawStatus?: string | undefined; status: ServiceStateStatus; image: string; numReplicas: number; domainHosts: string[]; customDomainStatus: Record<string, string>; serviceDomainSync: Record<string, string> }

export class RailwayInfraProvider implements InfraProvider {
  readonly contract = '1.0.0';

  private readonly credentials: RailwayCredentialSource;
  private readonly transport: RailwayTransport;
  private readonly workspaceId: string;
  private readonly deployBudget: number;
  private readonly deployTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Deploys consumed so far; the caller reports this against the tenant's daily ceiling. */
  deploymentsUsed = 0;

  constructor(options: RailwayProviderOptions) {
    this.credentials = options.credentials;
    this.transport = options.transport ?? new HttpRailwayTransport();
    this.workspaceId = options.workspaceId;
    this.deployBudget = options.deployBudget ?? 4;
    this.deployTimeoutMs = options.deployTimeoutMs ?? 180_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  }

  describe(): CapabilityInfo {
    return {
      provider: 'railway',
      contract: this.contract,
      operations: ['describe', 'validatePlan', 'applyPlan', 'readState', 'deleteInstance'],
      // What is actually supported. Ceilings and databases/buckets are absent from this list on purpose.
      features: ['service-domains', 'custom-domains', 'literal-configuration', 'preserve-secret-references', 'per-environment-tokens', 'deploy-waiting', 'environment-cloning'],
    };
  }

  validatePlan(plan: InfraPlan): Issue[] {
    const issues: Issue[] = planIssues(plan);
    const parsed = InfraPlanSchema.safeParse(plan);
    if (!parsed.success) return issues;

    if (plan.provider !== 'railway' && plan.provider !== 'sample') {
      issues.push({ path: ['provider'], code: 'unknown-provider', message: `railway provider asked to plan for "${plan.provider}"` });
    }
    for (const env of parsed.data.environments) {
      for (const service of env.services) {
        // Measured 2026-11-08: a tagless digest reference (`repo@sha256:…`) is accepted by the API and
        // then never deploys -- the deployment sat in DEPLOYING for 20+ minutes while `repo:tag@sha256:…`
        // reached SUCCESS in ~20 seconds. Digest pinning is a platfolio invariant, so the tag has to
        // travel with it rather than being discovered as a stuck deploy at 3am.
        const lastSlash = service.image.lastIndexOf('/');
        if (!service.image.slice(lastSlash + 1).includes(':')) {
          issues.push({ path: ['environments', env.name, 'services', service.name, 'image'], code: 'image-tag-missing', message: `Railway needs "repo:tag@digest"; "${service.image}" has no tag and will hang` });
        }
      }
      if (env.name.length > 64) issues.push({ path: ['environments', env.name], code: 'provider-name-limit', message: 'environment names are limited to 64 characters' });
      if (env.cloneFrom && env.cloneFrom === env.name) issues.push({ path: ['environments', env.name, 'cloneFrom'], code: 'self-clone', message: 'an environment cannot clone itself' });
      for (const d of env.domains) {
        const labels = d.host.split('.');
        if (labels.length < 2) issues.push({ path: ['environments', env.name, 'domains', d.host], code: 'host-form', message: 'host must include a domain suffix' });
        if (d.host.startsWith('*')) issues.push({ path: ['environments', env.name, 'domains', d.host], code: 'wildcard-explicit', message: 'wildcards are declared at the manifest level, not as plan domains' });
      }
      for (const b of env.buckets) {
        if (b.region && !/^[a-z]{2,4}(-[a-z])?$/.test(b.region)) issues.push({ path: ['environments', env.name, 'buckets', b.name, 'region'], code: 'region-form', message: `unrecognized region "${b.region}"` });
      }
    }
    return issues;
  }

  async applyPlan(plan: InfraPlan): Promise<ApplyResult> {
    const parsed = InfraPlanSchema.safeParse(plan);
    if (!parsed.success) {
      throw new Error(`railway applyPlan: plan failed schema validation (${parsed.error.issues.length} issues)`);
    }
    const invalid = this.validatePlan(plan);
    if (invalid.length) {
      const first = invalid[0]!;
      throw new Error(`railway applyPlan: plan is invalid — ${first.path}: ${first.message}`);
    }

    const failures: ApplyResult['failures'] = [];
    const notes: NonNullable<ApplyResult['notes']> = [];
    const serviceIds = new Map<string, string>();
    const services: StateSnapshot['services'] = [];
    const domains: ApplyResult['domains'] = [];

    const name = this.projectName(plan);
    const existing = await this.findProject(name);
    const projectId = existing ? existing.id : await this.createProject(name);
    const workspaceCredential = await this.credentials.workspace();

    // Record intent BEFORE mutating anything. An earlier version wrote this marker at the end of a
    // successful apply, so an apply that failed halfway left no marker and its own retry re-deployed
    // every service -- visible in E26 as a stack of DEPLOYING/FAILED deployments for one service.
    // Idempotency has to be established before the destructive step, not after it.
    await this.writeMarker(projectId, plan.planHash, workspaceCredential);

    // Already applied and unchanged: a re-delivered dispatch must not redeploy the world.
    if (this.markerOf(existing?.description) === plan.planHash) {
      const state = await this.snapshot(projectId);
      return {
        instanceId: plan.instanceId,
        planHash: plan.planHash,
        verified: state.services.length > 0 && state.services.every((s) => s.status === 'live'),
        services: state.services,
        domains: state.domains,
        failures,
        noop: true,
      };
    }

    for (const environment of parsed.data.environments) {
      const environmentId = await this.ensureEnvironment(projectId, environment.name, environment.cloneFrom, workspaceCredential);
      const token = await this.credentials.forEnvironment(projectId, environment.name);

      for (const service of environment.services) {
        const serviceId = await this.ensureService(projectId, environmentId, service, token, workspaceCredential, notes);
        // Domain and instance placement take the *service* id; readState reports the *instance* id,
        // because the instance is the per-environment thing that exists. Passing one where the other
        // belongs silently drops the domain, which is what an earlier revision of this line did.
        serviceIds.set(`${environment.name}/${service.name}`, serviceId);

        for (const entry of service.env) {
          if (entry.literal === undefined) continue;
          await this.upsertVariable(projectId, environmentId, serviceId, entry.name, entry.literal, token);
        }
        await this.ensureSecrets(projectId, environmentId, serviceId, service, failures);

        // Measured on 2026-11-08: ceilings ARE reachable through `serviceInstanceLimitsUpdate`, even
        // though the IaC graph has no field for them. An earlier revision of this provider reported them
        // as deferred, which was a documentation limit (the renderer cannot emit them) mistaken for a
        // provider limit. A failure to apply is reported, never swallowed.
        if (service.limits) {
          try {
            await this.transport.graphql({
              operation: 'serviceInstanceLimitsUpdate',
              credential: token,
              query: 'mutation ($input: ServiceInstanceLimitsUpdateInput!) { serviceInstanceLimitsUpdate(input: $input) }',
              // Introspected 2026-11-08: the input is { environmentId, serviceId, memoryGB, vCPUs }. An
              // earlier draft guessed memoryMegabytes/cpuCount, which would have failed on the first live
              // call; a plan states MB and cores, so the conversion happens here.
              variables: { input: { environmentId, serviceId, memoryGB: service.limits.memoryMB / 1024, vCPUs: service.limits.cpu } },
            });
          } catch (error) {
            failures.push({ step: `services.${service.name}.limits`, code: 'ceilings-not-applied', message: `${(error as Error).message.slice(0, 120)} — the plan asks for cpu ${service.limits.cpu} / ${service.limits.memoryMB}MB and this is not enforced` });
          }
        }

        const deployed = await this.deploy(serviceId, environmentId, token, failures);
        const outcome = deployed ? await this.awaitDeployment(projectId, environmentId, serviceId, token, failures, notes) : { status: 'pending' as const, instanceId: serviceId };
        services.push({
          name: service.name,
          environment: environment.name,
          externalId: outcome.instanceId,
          status: outcome.status,
          image: `${service.image}@${service.digest}`,
          numReplicas: service.replicas,
        });
      }

      for (const domain of environment.domains) {
        const targetServiceId = serviceIds.get(`${environment.name}/${domain.service}`);
        const target = services.find((s) => s.name === domain.service && s.environment === environment.name);
        if (!target || !targetServiceId) {
          failures.push({ step: `domains.${domain.host}`, code: 'unknown-service', message: `domain targets "${domain.service}", which this plan does not define in "${environment.name}"` });
          continue;
        }
        // Measured: serviceDomainCreate is NOT idempotent -- re-applying created a second hostname for the
        // same service, so the plan looked satisfied while the tenant had two URLs. Check first.
        const already = await this.instanceStatus(projectId, environmentId, targetServiceId, token);
        const existingHost = already?.domainHosts.some((h) => h === domain.host || (domain.host.endsWith('.up.railway.app') && h.endsWith('.up.railway.app')));
        const placed = existingHost
          ? { host: already?.domainHosts.find((h) => h.endsWith('.up.railway.app')) ?? domain.host, dnsStatus: 'verified' as const }
          : await this.createDomain(projectId, environmentId, targetServiceId, domain, token, failures);
        // A Railway-generated hostname is assigned by the provider, so the plan's requested host is not
        // necessarily what exists. Report the actual one; readState reports the same set, and the two
        // must agree or "verified" means nothing.
        domains.push({ host: placed.host, dnsStatus: placed.dnsStatus, certificateStatus: placed.dnsStatus === 'verified' ? 'issued' : 'pending', targetService: domain.service });
      }

      for (const database of environment.databases) {
        failures.push({ step: `databases.${database.name}`, code: 'unsupported-resource', message: `${database.kind} provisioning is not implemented by this provider; the instance is not complete without it` });
      }
      for (const bucket of environment.buckets) {
        failures.push({ step: `buckets.${bucket.name}`, code: 'unsupported-resource', message: 'bucket provisioning is not implemented by this provider' });
      }
    }

    return {
      instanceId: plan.instanceId,
      planHash: plan.planHash,
      verified: failures.length === 0 && services.length > 0 && services.every((s) => s.status === 'live'),
      services,
      domains,
      failures,
      ...(notes.length ? { notes } : {}),
      noop: false,
    };
  }

  async readState(instanceId: string): Promise<StateSnapshot> {
    // Resolve in the order the mapping guarantees: our derived name, then a stored Railway id, then a bare
    // name for projects a tenant created by hand. applyPlan creates by derived name, so the first lookup is
    // the one that makes read-back work -- and read-back is the whole point of the controller loop.
    const project = await this.findProject(this.projectName({ instanceId }))
      ?? await this.findProjectById(instanceId)
      ?? await this.findProject(instanceId);
    if (!project) throw new Error(`railway readState: no project for instance "${instanceId}"`);
    const state = await this.snapshot(project.id);
    return {
      instanceId,
      projectExternalId: project.id,
      capturedAt: new Date().toISOString(),
      services: state.services,
      domains: state.domains,
      // Deliberately empty: ceilings are not readable here, and an invented number is worse than none.
      ceilings: [],
    };
  }

  async deleteInstance(instanceId: string): Promise<DeleteResult> {
    // Resolve in the order the mapping guarantees: our derived name, then a stored Railway id, then a bare
    // name for projects a tenant created by hand. applyPlan creates by derived name, so the first lookup is
    // the one that makes read-back work -- and read-back is the whole point of the controller loop.
    const project = await this.findProject(this.projectName({ instanceId }))
      ?? await this.findProjectById(instanceId)
      ?? await this.findProject(instanceId);
    if (!project) throw new Error(`railway deleteInstance: no project for instance "${instanceId}"`);
    const credential = await this.credentials.workspace();
    const removed: string[] = [];
    const orphans: string[] = [];

    const environments = await this.environments(project.id, credential);
    const services = await this.listServices(project.id, credential);
    for (const environment of environments) {
      for (const service of services) {
        try {
          await this.transport.graphql({
            operation: 'serviceDelete',
            credential,
            query: 'mutation ($environmentId: String!, $id: String!) { serviceDelete(environmentId: $environmentId, id: $id) }',
            variables: { environmentId: environment.id, id: service.id },
          });
          removed.push(`service:${environment.name}/${service.name}`);
        } catch {
          // Absent in this environment is not an orphan.
        }
      }
    }

    // Anything still there is reported, never counted as gone.
    for (const leftover of await this.listServices(project.id, credential)) orphans.push(`service:${leftover.name}`);
    for (const bucket of await this.buckets(project.id, credential)) orphans.push(`bucket:${bucket}`);

    await this.transport.graphql({
      operation: 'projectDelete',
      credential,
      query: 'mutation ($id: String!) { projectDelete(id: $id) }',
      variables: { id: project.id },
    });
    removed.push(`project:${project.name}`);
    return { instanceId, removed, orphans };
  }

  // --- internals -------------------------------------------------------------------------------

  /**
   * Railway identifies projects by name within a workspace, and a platfolio instance id is not a Railway
   * id, so the mapping is derived. It is a function of the instance id **alone** — including the platform
   * would make `readState(instanceId)` unanswerable, because readState is not given a plan. An earlier
   * version of this method embedded `manifestRef.platform`, and the conformance suite caught it: apply
   * succeeded, then readState could not find the project it had just created.
   */
  private projectName(plan: { instanceId: string }): string {
    return `platfolio-${plan.instanceId}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  }

  private async findProject(name: string): Promise<ProjectNode | null> {
    const credential = await this.credentials.workspace();
    const data = await this.transport.graphql<{ projects: { edges: { node: { id: string; name: string; description: string | null } }[] } }>({
      operation: 'projects',
      credential,
      query: 'query ($workspaceId: String!) { projects(workspaceId: $workspaceId) { edges { node { id name description } } } }',
      variables: { workspaceId: this.workspaceId },
    });
    return this.toProject(data.projects.edges.map((e) => e.node).find((n) => n.name === name));
  }

  private async findProjectById(id: string): Promise<ProjectNode | null> {
    const credential = await this.credentials.workspace();
    try {
      const data = await this.transport.graphql<{ project: { id: string; name: string; description: string | null } | null }>({
        operation: 'project',
        credential,
        query: 'query ($id: String!) { project(id: $id) { id name description } }',
        variables: { id },
      });
      return this.toProject(data.project ?? null);
    } catch {
      return null;
    }
  }

  private toProject(node: { id: string; name: string; description: string | null } | null | undefined): ProjectNode | null {
    if (!node) return null;
    return { id: node.id, name: node.name, ...(node.description ? { description: node.description } : {}) };
  }

  private async createProject(name: string): Promise<string> {
    const credential = await this.credentials.workspace();
    const data = await this.transport.graphql<{ projectCreate: { id: string } }>({
      operation: 'projectCreate',
      credential,
      query: 'mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }',
      variables: { input: { name, workspaceId: this.workspaceId, isPublic: false, description: `${MARKER}none` } },
    });
    return data.projectCreate.id;
  }

  private async environments(projectId: string, credential: RailwayCredential): Promise<EnvironmentNode[]> {
    const data = await this.transport.graphql<{ project: { environments: { edges: { node: { id: string; name: string } }[] } } }>({
      operation: 'project.environments',
      credential,
      query: 'query ($projectId: String!) { project(id: $projectId) { environments { edges { node { id name } } } } }',
      variables: { projectId },
    });
    return data.project.environments.edges.map((e) => e.node);
  }

  private async ensureEnvironment(projectId: string, environment: string, cloneFrom: string | undefined, credential: RailwayCredential): Promise<string> {
    const found = await this.environments(projectId, credential);
    const existing = found.find((e) => e.name === environment);
    if (existing) return existing.id;
    const source = cloneFrom ? found.find((e) => e.name === cloneFrom) : undefined;
    const data = await this.transport.graphql<{ environmentCreate: { id: string } }>({
      operation: 'environmentCreate',
      credential,
      query: 'mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id } }',
      // Cloning carries configuration; the provider documents that sealed values are NOT copied, which is
      // why the secrets checklist is expected to report red on a freshly cloned staging.
      variables: { input: { projectId, name: environment, isPrivate: false, ...(source ? { sourceEnvironmentId: source.id } : {}) } },
    });
    return data.environmentCreate.id;
  }

  private async listServices(projectId: string, credential?: RailwayCredential): Promise<ServiceNode[]> {
    const cred = credential ?? await this.credentials.workspace();
    const data = await this.transport.graphql<{ project: { services: { edges: { node: { id: string; name: string } }[] } } }>({
      operation: 'project.services',
      credential: cred,
      query: 'query ($projectId: String!) { project(id: $projectId) { services { edges { node { id name } } } } }',
      variables: { projectId },
    });
    return data.project.services.edges.map((e) => e.node);
  }

  /**
   * Place a service in one environment. A Railway service is project-level while what runs is the
   * per-environment **instance**, so an existing service still needs its instance created or updated for
   * each environment in the plan.
   *
   * The order here is deliberate and is what E25 must confirm against a live project: update first (the
   * plausible upsert), and if the provider says there is no instance, create the service in that
   * environment. Which branch the real API takes is not something I will assert from a mock, so both are
   * exercised and the fallback is reported rather than hidden.
   */
  private async ensureService(
    projectId: string,
    environmentId: string,
    service: ServicePlan,
    token: RailwayCredential,
    workspaceCredential: RailwayCredential,
    notes: NonNullable<ApplyResult['notes']>,
  ): Promise<string> {
    const known = (await this.listServices(projectId, workspaceCredential)).find((s) => s.name === service.name);
    if (!known) return this.createService(projectId, environmentId, service, token);
    try {
      await this.updateService(known.id, environmentId, service, token);
      return known.id;
    } catch (error) {
      const message = (error as Error).message;
      if (!/NOT_FOUND|no instance/i.test(message)) throw error;
      notes.push({
        step: `services.${service.name}@${environmentId}`,
        code: 'instance-created-by-fallback',
        message: 'serviceInstanceUpdate reported no instance for this environment; the service was created in it instead (E25 must confirm which shape the real API uses)',
      });
      return this.createService(projectId, environmentId, service, token);
    }
  }

  private async createService(projectId: string, environmentId: string, service: ServicePlan, credential: RailwayCredential): Promise<string> {
    const data = await this.transport.graphql<{ serviceCreate: { id: string } }>({
      operation: 'serviceCreate',
      credential,
      query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
      variables: {
        input: {
          projectId,
          environmentId,
          name: service.name,
          // Measured: a workspace grant is refused here. The environment-scoped token is required.
          source: { image: `${service.image}@${service.digest}` },
        },
      },
    });
    return data.serviceCreate.id;
  }

  private async updateService(serviceId: string, environmentId: string, service: ServicePlan, credential: RailwayCredential): Promise<void> {
    const input: Record<string, unknown> = {
      numReplicas: service.replicas,
      healthcheckPath: service.healthPath,
      source: { image: `${service.image}@${service.digest}` },
    };
    if (service.command) input.startCommand = service.command;
    if (service.preDeployCommand) input.preDeployCommand = service.preDeployCommand;
    await this.transport.graphql({
      operation: 'serviceInstanceUpdate',
      credential,
      query: 'mutation ($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) }',
      variables: { environmentId, serviceId, input },
    });
  }

  private async upsertVariable(projectId: string, environmentId: string, serviceId: string, name: string, value: string, credential: RailwayCredential): Promise<void> {
    await this.transport.graphql({
      operation: 'variableUpsert',
      credential,
      query: 'mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
      // skipDeploys: a configuration write must not trigger a redeploy we did not decide on.
      variables: { input: { projectId, environmentId, serviceId, name, value, skipDeploys: true } },
    });
  }

  /**
   * Secrets are verified by name presence from `Environment.config`, measured to redact values
   * (`{ value: null }` even for a variable written moments earlier). Reading through `variables()` would
   * put the value in our memory for no reason, and that is the difference between a claim we can keep and
   * one we cannot.
   */
  private async ensureSecrets(projectId: string, environmentId: string, serviceId: string, service: ServicePlan, failures: ApplyResult['failures']): Promise<void> {
    if (service.secrets.length === 0) return;
    const present = new Set(await this.configVariableNames(projectId, environmentId, serviceId));
    for (const secret of service.secrets) {
      if ((secret as { source: string }).source === 'platfolio-held') {
        throw new Error(`secret "${secret.name}" declares platfolio-held custody, which contract 1.0.0 forbids (docs/design/03)`);
      }
      if (!present.has(secret.name)) {
        failures.push({
          step: `services.${service.name}.secrets.${secret.name}`,
          code: 'secret-unavailable',
          message: `no variable named "${secret.name}" exists in this environment (source "${secret.source}"); the deploy is not healthy until the tenant supplies it`,
        });
      }
    }
  }

  private async configVariableNames(projectId: string, environmentId: string, serviceId: string): Promise<string[]> {
    const token = await this.credentials.forEnvironment(projectId, await this.environmentName(projectId, environmentId));
    const data = await this.transport.graphql<{ environment: { config: { services?: Record<string, { variables?: Record<string, unknown> }> } | null } | null }>({
      operation: 'environment.config',
      credential: token,
      query: 'query ($projectId: String!, $environmentId: String!) { environment(projectId: $projectId, id: $environmentId) { config } }',
      variables: { projectId, environmentId },
    });
    return Object.keys(data.environment?.config?.services?.[serviceId]?.variables ?? {});
  }

  private async environmentName(projectId: string, environmentId: string): Promise<string> {
    const credential = await this.credentials.workspace();
    return this.environments(projectId, credential).then((list) => list.find((e) => e.id === environmentId)?.name ?? 'production');
  }

  private async deploy(serviceId: string, environmentId: string, credential: RailwayCredential, failures: ApplyResult['failures']): Promise<boolean> {
    if (this.deploymentsUsed >= this.deployBudget) {
      failures.push({
        step: `service:${serviceId}`,
        code: 'deploy-budget-exhausted',
        message: `this provider instance is limited to ${this.deployBudget} deploys; remaining services were configured but not deployed`,
      });
      return false;
    }
    this.deploymentsUsed += 1;
    await this.transport.graphql({
      operation: 'serviceInstanceDeploy',
      credential,
      query: 'mutation ($environmentId: String!, $serviceId: String!) { serviceInstanceDeploy(environmentId: $environmentId, serviceId: $serviceId, latestCommit: true) }',
      variables: { environmentId, serviceId },
    });
    return true;
  }

  private async awaitDeployment(projectId: string, environmentId: string, serviceId: string, credential: RailwayCredential, failures: ApplyResult['failures'], notes: NonNullable<ApplyResult['notes']>): Promise<{ status: ServiceStateStatus; instanceId: string }> {
    const deadline = Date.now() + this.deployTimeoutMs;
    let last: ServiceStateStatus = 'pending';
    let instanceId = serviceId;
    while (Date.now() < deadline) {
      const seen = await this.instanceStatus(projectId, environmentId, serviceId, credential);
      last = seen ? seen.status : 'pending';
      instanceId = seen?.instanceId ?? instanceId;
      if (!IN_FLIGHT.has(last)) {
        // awaiting-approval is terminal too: it needs a human in the provider UI, and reporting it as
        // "still deploying" would hide exactly the condition the tenant has to act on.
        if (last !== 'live') failures.push({ step: `service:${serviceId}`, code: last === 'awaiting-approval' ? 'deployment-awaiting-approval' : 'deployment-unhealthy', message: `deployment settled as ${last}` });
        return { status: last, instanceId };
      }
      if (seen?.rawStatus && !(seen.rawStatus in STATUS_MAP)) {
        notes.push({ step: `service:${serviceId}`, code: 'unknown-deployment-status', message: `provider reported "${seen.rawStatus}", which this build does not map; treated as in flight` });
      }
      await this.sleep(this.pollIntervalMs);
    }
    failures.push({ step: `service:${serviceId}`, code: 'deployment-timeout', message: `still ${last} after ${this.deployTimeoutMs}ms` });
    return { status: last, instanceId };
  }

  /**
   * Instance state per environment. There is **no root `serviceInstances` query** -- an earlier draft of
   * this method invented one, which is the kind of thing a mock will happily answer and a real API will
   * reject. Instances hang off `Environment`, so one query per environment serves every service in it,
   * keyed by service id.
   */
  private async environmentInstances(projectId: string, environmentId: string, credential: RailwayCredential): Promise<Map<string, InstanceInfo>> {
    const data = await this.transport.graphql<{ environment: { serviceInstances: { edges: { node: Record<string, unknown> }[] } | null } | null }>({
      operation: 'environment.serviceInstances',
      credential,
      // `CustomDomain.status` is an OBJECT (verified + certificateStatus enum), not a scalar -- a mock
      // that accepted a string here hid it for a whole test cycle. Measured 2026-11-08.
      query: 'query ($projectId: String!, $environmentId: String!) { environment(projectId: $projectId, id: $environmentId) { serviceInstances { edges { node { id serviceId numReplicas source { image } latestDeployment { status } domains { customDomains { domain status { verified certificateStatus } } serviceDomains { domain syncStatus } } } } } } }',
      variables: { projectId, environmentId },
    });
    const out = new Map<string, InstanceInfo>();
    for (const edge of data.environment?.serviceInstances?.edges ?? []) {
      const node = edge.node;
      const serviceId = typeof node.serviceId === 'string' ? node.serviceId : '';
      if (!serviceId) continue;
      const deployment = node.latestDeployment as { status?: string } | null;
      const source = node.source as { image?: string } | null;
      const domains = node.domains as {
        customDomains?: { domain: string; status?: { verified?: boolean; certificateStatus?: string } | null }[];
        serviceDomains?: { domain: string; syncStatus?: string | null }[];
      } | null;
      out.set(serviceId, {
        instanceId: typeof node.id === 'string' ? node.id : serviceId,
        rawStatus: typeof deployment?.status === 'string' ? deployment.status : undefined,
        status: STATUS_MAP[deployment?.status ?? ''] ?? 'pending',
        image: source?.image ?? 'unknown',
        numReplicas: typeof node.numReplicas === 'number' ? node.numReplicas : 0,
        domainHosts: [...(domains?.serviceDomains ?? []).map((d) => d.domain), ...(domains?.customDomains ?? []).map((d) => d.domain)],
        customDomainStatus: Object.fromEntries((domains?.customDomains ?? []).map((d) => [d.domain, d.status?.verified ? 'VERIFIED' : (d.status?.certificateStatus ?? '') === 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED' ? 'FAILED' : 'PENDING'])),
        serviceDomainSync: Object.fromEntries((domains?.serviceDomains ?? []).map((d) => [d.domain, d.syncStatus ?? 'CREATING'])),
      });
    }
    return out;
  }

  private async instanceStatus(projectId: string, environmentId: string, serviceId: string, credential: RailwayCredential): Promise<InstanceInfo | null> {
    return (await this.environmentInstances(projectId, environmentId, credential)).get(serviceId) ?? null;
  }

  private async createDomain(projectId: string, environmentId: string, serviceId: string, domain: { host: string; port: number }, credential: RailwayCredential, failures: ApplyResult['failures']): Promise<{ host: string; dnsStatus: 'pending' | 'verified' | 'failed' }> {
    const isRailwayDomain = domain.host.endsWith('.up.railway.app');
    try {
      let actual = domain.host;
      if (isRailwayDomain) {
        const created = await this.transport.graphql<{ serviceDomainCreate: { domain?: string } }>({
          operation: 'serviceDomainCreate',
          credential,
          query: 'mutation ($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id domain } }',
          variables: { input: { environmentId, serviceId, targetPort: domain.port } },
        });
        actual = created.serviceDomainCreate.domain ?? domain.host;
      } else {
        await this.transport.graphql({
          operation: 'customDomainCreate',
          credential,
          query: 'mutation ($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id domain } }',
          variables: { input: { projectId, environmentId, serviceId, domain: domain.host, targetPort: domain.port } },
        });
      }
      // Custom domains need a TXT record the tenant owns before they resolve: pending, not failed.
      return { host: actual, dnsStatus: isRailwayDomain ? 'verified' : 'pending' };
    } catch (error) {
      failures.push({ step: `domains.${domain.host}`, code: 'domain-create-failed', message: (error as Error).message.slice(0, 200) });
      return { host: domain.host, dnsStatus: 'failed' };
    }
  }

  private async snapshot(projectId: string): Promise<{ services: StateSnapshot['services']; domains: StateSnapshot['domains'] }> {
    const credential = await this.credentials.workspace();
    const environments = await this.environments(projectId, credential);
    const services = await this.listServices(projectId, credential);
    const out: StateSnapshot['services'] = [];
    const domains: StateSnapshot['domains'] = [];
    for (const environment of environments) {
      const token = await this.credentials.forEnvironment(projectId, environment.name).catch(() => credential);
      const instances = await this.environmentInstances(projectId, environment.id, token);
      for (const service of services) {
        const info = instances.get(service.id);
        if (!info) continue;
        // Railway services are project-level; the instance is the thing that exists per environment, so
        // it is the identity readState reports -- using the service id here duplicated one identity across
        // two environments and the conformance suite called it a duplicate.
        out.push({ name: service.name, environment: environment.name, externalId: info.instanceId, status: info.status, image: info.image, numReplicas: info.numReplicas });
        for (const host of info.domainHosts) {
          const custom = info.customDomainStatus[host];
          const isRailwayHost = host.endsWith('.up.railway.app');
          // Railway's own hostnames are issued by definition once the domain exists; a custom domain
          // reports the provider's real verification and certificate state, which may legitimately be
          // pending on DNS the tenant still owns.
          const verified = isRailwayHost || custom === 'VERIFIED';
          domains.push({
            host: host as StateSnapshot['domains'][number]['host'],
            dnsStatus: verified ? 'verified' : custom === 'FAILED' ? 'failed' : 'pending',
            certificateStatus: verified ? 'issued' : custom === 'FAILED' ? 'failed' : 'pending',
            targetService: service.name,
          });
        }
      }
    }
    return { services: out, domains };
  }

  private async buckets(projectId: string, credential: RailwayCredential): Promise<string[]> {
    try {
      const data = await this.transport.graphql<{ project: { buckets: { edges: { node: { id: string } }[] } | null } | null }>({
        operation: 'project.buckets',
        credential,
        query: 'query ($projectId: String!) { project(id: $projectId) { buckets { edges { node { id } } } } }',
        variables: { projectId },
      });
      return (data.project?.buckets?.edges ?? []).map((e) => e.node.id);
    } catch {
      return [];
    }
  }

  private markerOf(description: string | undefined | null): string | null {
    if (!description) return null;
    const index = description.indexOf(MARKER);
    if (index < 0) return null;
    return description.slice(index + MARKER.length).split(/[\s,]/)[0] ?? null;
  }

  private async writeMarker(projectId: string, planHash: string, credential: RailwayCredential): Promise<void> {
    await this.transport.graphql({
      operation: 'projectUpdate',
      credential,
      // `projectUpdate` returns Project!, so it requires a sub-selection. Without one the API rejects
      // the whole call at validation time -- which is what E26 hit, and because this write happens at the
      // END of applyPlan, it meant the marker was never stored and every retry re-deployed everything.
      query: 'mutation ($id: String!, $input: ProjectUpdateInput!) { projectUpdate(id: $id, input: $input) { id } }',
      variables: { id: projectId, input: { description: `${MARKER}${planHash}` } },
    });
  }
}
