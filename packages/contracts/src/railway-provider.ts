import {
  InfraPlanSchema, planIssues,
  CONTRACT_VERSION,
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
/** Registry hosts that routinely hold private images; docker.io library images almost never do. */
const PRIVATE_CAPABLE_REGISTRIES = ['ghcr.io', 'quay.io', 'mcr.microsoft.com', 'public.ecr.aws'];

/**
 * Where a tenant should look when their own image fails to deploy. Narrow on purpose: platfolio cannot
 * verify pullability (no registry credential, by design) and must not read provider build logs, so this
 * never asserts a cause -- it names the one action only the tenant can take.
 */
export function registryPullHint(image: string): string | undefined {
  const host = image.split('/')[0] ?? '';
  if (!host.includes('.') && !host.includes('localhost')) return undefined;   // docker.io shorthand form
  if (!PRIVATE_CAPABLE_REGISTRIES.some((known) => host === known || host.endsWith(`.${known}`))) return undefined;
  return `"${image}" is pulled from ${host}, which routinely holds private repositories. If the deployment failed to start, the likely cause is that this Railway project cannot pull the image: attach a read-only registry credential for ${host} in the project's settings. platfolio cannot do this for you and does not hold such a credential -- it is yours to grant, and is never stored here.`;
}

const IN_FLIGHT: ReadonlySet<ServiceStateStatus> = new Set(['pending', 'building', 'deploying']);

type ServiceStateStatus = StateSnapshot['services'][number]['status'];

export interface RailwayProviderOptions {
  credentials: RailwayCredentialSource;
  transport?: RailwayTransport;
  workspaceId: string;
  /** Engine kind -> Railway Template code; public catalog entries are read by code (#75). */
  databaseTemplates?: Record<string, string>;
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
interface InstanceInfo {
  instanceId: string;
  rawStatus?: string | undefined;
  status: ServiceStateStatus;
  image: string;
  numReplicas: number;
  domainHosts: string[];
  /** Per-host state read from the provider: no hostname guessing anywhere in this file. */
  domainStates: Record<string, { dnsStatus: 'pending' | 'verified' | 'failed'; certificateStatus: 'pending' | 'issued' | 'failed' }>;
  /** Provider ids per host, so a failed certificate can be retried by id. */
  domainIds: Record<string, string>;
/** The records the provider asked for, read back rather than derived (D25). */
domainRecords: Record<string, NonNullable<StateSnapshot['domains'][number]['records']>>;
}

export class RailwayInfraProvider implements InfraProvider {
  // Annotated with the literal type on purpose: `readonly contract = CONTRACT_VERSION` infers
  // `string`, which widens a public field consumers narrow on -- a tightening for them even though it reads
  // as an improvement here. The baseline drift gate caught it as a removal.
  readonly contract: typeof CONTRACT_VERSION = CONTRACT_VERSION;

  private readonly credentials: RailwayCredentialSource;
  private readonly transport: RailwayTransport;
  private readonly workspaceId: string;
  private readonly deployBudget: number;
  private readonly deployTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Engine kind -> Railway Template CODE. Catalog reads authorize by code: template(id:) answers
  /** "Not Authorized" for public entries even on the workspace grant (#75). */
  private readonly databaseTemplates: Record<string, string>;

  /** Deploys consumed so far; the caller reports this against the tenant's daily ceiling. */
  deploymentsUsed = 0;

  constructor(options: RailwayProviderOptions) {
    this.credentials = options.credentials;
    this.transport = options.transport ?? new HttpRailwayTransport();
    this.workspaceId = options.workspaceId;
    this.databaseTemplates = { postgres: 'postgresql', ...options.databaseTemplates };
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
    const resources: string[] = [];
    const services: StateSnapshot['services'] = [];
    const domains: ApplyResult['domains'] = [];

    const name = this.projectName(plan);
    const existing = await this.findProject(name);
    const projectId = existing ? existing.id : await this.createProject(name);
    this.lastProjectId = projectId;
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

      const placed = await this.environmentInstances(projectId, environmentId, token);
      for (const service of environment.services) {
        const known = (await this.listServices(projectId, workspaceCredential)).find((s) => s.name === service.name);
        if (known && !placed.has(known.id)) {
          // E25: `serviceInstanceUpdate` on an environment with no instance returns true and changes
          // nothing. Silently continuing would report a service as configured in an environment where
          // it does not exist, so it is refused here and reported. Placement happens by duplicating an
          // environment, which is a snapshot: a service added to the source afterwards is not present.
          failures.push({
            step: `services.${service.name}@${environment.name}`,
            code: 'instance-missing-in-environment',
            message: `"${service.name}" has no instance in "${environment.name}"; Railway places services into a new environment only when that environment is duplicated, so this environment must be recreated from a source that already contains the service`,
          });
          continue;
        }
        const serviceId = await this.ensureService(projectId, environmentId, service, token, workspaceCredential, notes);
        // Domain and instance placement take the *service* id; readState reports the *instance* id,
        // because the instance is the per-environment thing that exists. Passing one where the other
        // belongs silently drops the domain, which is what an earlier revision of this line did.
        serviceIds.set(`${environment.name}/${service.name}`, serviceId);

        for (const entry of service.env) {
          if (entry.literal === undefined) continue;
          await this.upsertVariable(projectId, environmentId, serviceId, entry.name, entry.literal, token);
        }
        await this.ensureSecrets(projectId, environmentId, serviceId, service, environment.name, failures);

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
        // A deployment that does not come up is often a pull authorization problem, and the tenant -- not
        // platfolio -- is the only party who can fix it. We cannot pull-test their image (we hold no registry
        // credential by design) and must not read Railway build logs (they contain resolved environment
        // values), so this is a hint attached to a real failure, never a claimed diagnosis.
        if (outcome.status !== 'live') {
          const hint = registryPullHint(service.image);
          if (hint) {
            notes.push({ step: `services.${service.name}`, code: 'image-pull-authorization-hint', message: hint });
          }
        }
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
        const reused = already?.domainHosts.find((h) => h === domain.host)
          ?? (domain.host.endsWith('.up.railway.app') ? already?.domainHosts.find((h) => h.endsWith('.up.railway.app')) : undefined);
        const placed = reused
          ? { host: reused, dnsStatus: already?.domainStates[reused]?.dnsStatus ?? ('pending' as const) }
          : await this.createDomain(projectId, environmentId, targetServiceId, domain, token, failures);
        // Read the provider's state rather than assuming issuance follows creation: a custom domain waits
        // on DNS the tenant owns, and a Railway one waits on the deployment settling.
        const settled = await this.instanceStatus(projectId, environmentId, targetServiceId, token);
        const state = settled?.domainStates[placed.host];
        domains.push({
          host: placed.host,
          dnsStatus: state?.dnsStatus ?? placed.dnsStatus,
          certificateStatus: state?.certificateStatus ?? 'pending',
          ...(settled?.domainRecords[placed.host] ? { records: settled.domainRecords[placed.host] } : {}),
          targetService: domain.service,
        });
      }

      for (const database of environment.databases) {
        await this.provisionDatabase(projectId, environmentId, environment.name, database, environment, token, serviceIds, failures, notes);
      }

      for (const volume of environment.volumes ?? []) {
        await this.provisionVolume(projectId, environmentId, volume, environment.name, serviceIds, workspaceCredential, failures, notes);
      }

      for (const bucket of environment.buckets) {
        // E28: bucketCreate works, but only with the workspace grant -- an environment-scoped project
        // token is answered with "Bad Access", which is why this call cannot go through `token`.
        try {
          const created = await this.transport.graphql<{ bucketCreate: { id: string; name: string } }>({
            operation: 'bucketCreate',
            credential: workspaceCredential,
            query: 'mutation ($input: BucketCreateInput!) { bucketCreate(input: $input) { id name } }',
            variables: { input: { projectId, environmentId, name: bucket.name } },
          });
          resources.push(`bucket:${created.bucketCreate.name}`);
          if (bucket.region) {
            notes.push({ step: `buckets.${bucket.name}`, code: 'bucket-region-ignored', message: `the API takes no region on creation; "${bucket.region}" is not enforced` });
          }
        } catch (error) {
          failures.push({ step: `buckets.${bucket.name}`, code: 'bucket-create-failed', message: (error as Error).message.slice(0, 160) });
        }
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
    const releasedWithProject: string[] = [];
    const deleteFailures: NonNullable<DeleteResult['failures']> = [];

    const environments = await this.environments(project.id, credential);
    const services = await this.listServices(project.id, credential);

    // #111: take the inventory BEFORE anything is removed. The old sweep ran after projectDelete, so with
    // the project unreadable "nothing was left" and "nothing can be seen" produced the same answer, and a
    // clean-looking orphan list quietly overstated what we had done. Every resource that existed at the
    // start is now classified into one of three states: removed by us, taken along with the project, or
    // still reachable afterwards -- the only case that earns the name orphan.
    const volumesAtStart = await this.listVolumes(project.id, credential);
    const bucketsAtStart = await this.buckets(project.id, credential);
    const expected = new Set<string>([
      ...volumesAtStart.map((v) => `volume:${v.name}`),
      ...bucketsAtStart.map((b) => `bucket:${b}`),
      ...environments.flatMap((e) => services.map((s) => `service:${e.name}/${s.name}`)),
    ]);

      // Volumes are released BEFORE the services they are attached to. Measured: a template-created database
      // whose volume still existed was refused by serviceDelete ("Problem processing request"), while an
      // identical volume-less one deleted cleanly -- so #107 was ordering, not a capability limit, and the
      // previous order (services first, volumes after) guaranteed the refusal at every attempt.
      for (const volume of volumesAtStart) {
        await this.transport.graphql({ operation: 'volumeDelete', credential, query: 'mutation ($volumeId: String!) { volumeDelete(volumeId: $volumeId) }', variables: { volumeId: volume.id } })
          .then(() => { removed.push(`volume:${volume.name}`); })
          .catch(() => { /* unresolved: classified after the project goes */ });
      }

    for (const environment of environments) {
      for (const service of services) {
        try {
          await this.deleteServiceWithRetry(project.id, environment, service, credential);
          removed.push(`service:${environment.name}/${service.name}`);
        } catch (error) {
          // The empty catch was a bug in the family we keep chasing: the intent was "absent in this
          // environment is not an orphan", but a real refusal -- exactly what happened to the
          // template-created database in #80 -- disappeared, leaving a survivor reported with no reason.
          // Placement decides whether the delete has anything to say about it.
          // Placement decides whether to speak, but the placement read itself needs an environment token and
          // can fail -- a refused delete still deserves a reason either way, so this is best-effort.
          let placed: unknown = true;
          try {
            const envToken = await this.credentials.forEnvironment(project.id, environment.name);
            placed = await this.instanceStatus(project.id, environment.id, service.id, envToken);
          } catch {
            placed = true;
          }
          if (!placed) continue;   // genuinely absent here: not an orphan, nothing to report
          deleteFailures.push({ step: `service:${environment.name}/${service.name}`, code: 'service-delete-failed', message: (error as Error).message.slice(0, 200) });
        }
      }
    }

    // Anything still there is reported, never counted as gone.
    // Volumes are project-level and outlive the service they were attached to, so they are removed
    // explicitly and anything left is reported. "Removed everything" has to mean everything we can create.
    // There is no bucketDelete mutation on this API -- the full *Delete set was enumerated while filing
    // #106 -- so a bucket cannot be released individually and projectDelete is the mechanism that takes it.
    // Reporting one as an orphan before the project is gone was accurate but misleading: nothing is left
    // reachable afterwards. Anything that outlives a successful projectDelete is a genuine survivor.

    await this.transport.graphql({
      operation: 'projectDelete',
      credential,
      query: 'mutation ($id: String!) { projectDelete(id: $id) }',
      variables: { id: project.id },
    });
    removed.push(`project:${project.name}`);

    // Classify against the snapshot. Reachability after the delete is the only way to tell "released with
    // the project" from "still out there", so it is probed rather than assumed.
    const reachable = await this.reachableResources(project.id, credential);
    for (const item of expected) {
      if (removed.includes(item)) continue;
      if (reachable === null) releasedWithProject.push(item);
      else if (reachable.has(item)) orphans.push(item);
      else releasedWithProject.push(item);
    }
    if (orphans.length) {
      deleteFailures.push({ step: "orphans", code: "teardown-incomplete", message: `${String(orphans.length)} resource(s) still reachable after projectDelete: ${orphans.join(", ")}` });
    }
    return { instanceId, removed, orphans, ...(releasedWithProject.length ? { releasedWithProject } : {}), ...(deleteFailures.length ? { failures: deleteFailures } : {}) };
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
      // Introspected `EnvironmentCreateInput` has NO isPrivate field -- sending one fails validation,
      // which is exactly how E25 found this: a single-environment run never creates a second
      // environment, so the bug was invisible to the passing suite. skipInitialDeploys keeps a clone
      // from deploying the world without the controller deciding to; the tenant's daily ceiling is
      // shared and finite. Cloning carries configuration, and sealed values are documented NOT to be
      // copied -- which is why the secrets checklist is expected to report red on a fresh staging.
      variables: {
        input: {
          projectId,
          name: environment,
          skipInitialDeploys: true,
          ...(source ? { sourceEnvironmentId: source.id } : {}),
        },
      },
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
  private async ensureSecrets(projectId: string, environmentId: string, serviceId: string, service: ServicePlan, envName: string, failures: ApplyResult['failures']): Promise<void> {
    if (service.secrets.length === 0) return;
    const present = new Set(await this.configVariableNames(projectId, environmentId, serviceId));
    for (const secret of service.secrets) {
      if ((secret as { source: string }).source === 'platfolio-held') {
        throw new Error(`secret "${secret.name}" declares platfolio-held custody, which contract 1.0.0 forbids (docs/design/03)`);
      }
      if (!present.has(secret.name)) {
        failures.push({
          // The environment belongs in the step: with two environments this failure was reported twice under an
          // identical step, which tells a tenant nothing about where to set the value (found by the
          // manifest->plan->provider chain test in #84).
          step: `environments.${envName}.services.${service.name}.secrets.${secret.name}`,
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
      query: 'query ($projectId: String!, $environmentId: String!) { environment(projectId: $projectId, id: $environmentId) { serviceInstances { edges { node { id serviceId numReplicas source { image } latestDeployment { status } domains { customDomains { id domain syncStatus status { verified certificateStatus verificationDnsHost verificationToken dnsRecords { fqdn hostlabel zone recordType requiredValue currentValue status purpose } } } serviceDomains { id domain syncStatus } } } } } } }',
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
        customDomains?: { id?: string; domain: string; syncStatus?: string | null; status?: {
          verified?: boolean; certificateStatus?: string; verificationDnsHost?: string; verificationToken?: string;
          dnsRecords?: { fqdn: string; hostlabel?: string | null; zone: string; recordType?: string | null;
            requiredValue?: string | null; currentValue?: string | null; status?: string | null; purpose?: string | null }[] | null;
        } | null }[];
        serviceDomains?: { id?: string; domain: string; syncStatus?: string | null }[];
      } | null;
      out.set(serviceId, {
        instanceId: typeof node.id === 'string' ? node.id : serviceId,
        rawStatus: typeof deployment?.status === 'string' ? deployment.status : undefined,
        status: STATUS_MAP[deployment?.status ?? ''] ?? 'pending',
        image: source?.image ?? 'unknown',
        numReplicas: typeof node.numReplicas === 'number' ? node.numReplicas : 0,
        ...(() => {
          // Both domain kinds carry real state: service domains a `syncStatus` enum
          // (ACTIVE/CREATING/UPDATING/DELETING/DELETED/UNSPECIFIED) and custom domains a `status` object
          // (verified + certificateStatus enum). An earlier revision inferred issuance from the hostname,
          // which is exactly the kind of comfortable shortcut that reports a certificate as live when it is
          // still issuing.
          const states: InstanceInfo['domainStates'] = {};
          const ids: InstanceInfo['domainIds'] = {};
          const recordsByHost: InstanceInfo['domainRecords'] = {};
          for (const d of domains?.serviceDomains ?? []) {
            const active = d.syncStatus === 'ACTIVE';
            states[d.domain] = { dnsStatus: active ? 'verified' : 'pending', certificateStatus: active ? 'issued' : 'pending' };
            if (d.id) ids[d.domain] = d.id;
          }
          for (const d of domains?.customDomains ?? []) {
          const raw = d.status?.dnsRecords ?? [];
          // Every record below is copied out of the provider's response. Nothing here derives a value: the
          // routing target is Railway's own host and cannot be computed from the service hostname.
          const records: InstanceInfo['domainRecords'][string] = raw.filter((r) => r?.requiredValue).map((r) => ({
            host: r.hostlabel || r.fqdn,
            fqdn: r.fqdn,
            zone: r.zone,
            type: r.recordType?.endsWith('_CNAME') ? 'CNAME' as const
              : r.recordType?.endsWith('_TXT') ? 'TXT' as const
                : r.recordType?.endsWith('_A') ? 'A' as const : 'NS' as const,
            value: r.requiredValue ?? '',
            ...(r.currentValue ? { current: r.currentValue } : {}),
            status: r.status?.endsWith('PROPAGATED') ? 'propagated' as const
              : r.status?.endsWith('REQUIRES_UPDATE') ? 'requires-update' as const : 'unspecified' as const,
            purpose: r.purpose?.endsWith('TRAFFIC_ROUTE') ? 'traffic' as const
              : r.purpose?.endsWith('ACME_DNS01_CHALLENGE') ? 'challenge' as const : 'unspecified' as const,
          }));
          // The ownership TXT is disclosed as a host/token pair rather than inside dnsRecords, so it joins the
          // same list: one renderable set of instructions beats two the UI must merge.
          const vHost = d.status?.verificationDnsHost;
          const vToken = d.status?.verificationToken;
          if (vHost && vToken && !records.some((r) => r.purpose === 'ownership')) {
            const zone = raw[0]?.zone ?? d.domain.split('.').slice(-2).join('.');
            records.push({
              host: vHost,
              fqdn: vHost.includes('.') ? vHost : `${vHost}.${zone}`,
              zone,
              type: 'TXT',
              value: vToken,
              status: d.status?.verified ? 'propagated' as const : 'requires-update' as const,
              purpose: 'ownership' as const,
            });
          }
          if (records.length) recordsByHost[d.domain] = records;
            const cert = d.status?.certificateStatus ?? '';
            const failed = cert === 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED';
            states[d.domain] = {
              dnsStatus: d.status?.verified ? 'verified' : failed ? 'failed' : 'pending',
              certificateStatus: cert === 'CERTIFICATE_STATUS_TYPE_VALID' ? 'issued' : failed ? 'failed' : 'pending',
            };
            if (d.id) ids[d.domain] = d.id;
          }
          return { domainHosts: Object.keys(states), domainStates: states, domainIds: ids, domainRecords: recordsByHost };
        })(),
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
        // Availability is asked before the attach, because it is the only source of a human-readable reason:
        // a refused create returns the bare "Failed to create custom domain, please try again", which cannot
        // be the cause a tenant is shown (D25). An unclaimable host fails with the provider's own text and
        // the create is never attempted.
        const availability = await this.transport.graphql<{ customDomainAvailable: { available: boolean; message: string } }>({
          operation: 'customDomainAvailable',
          credential,
          query: 'query ($domain: String!) { customDomainAvailable(domain: $domain) { available message } }',
          variables: { domain: domain.host },
        });
        if (!availability.customDomainAvailable.available) {
          failures.push({
            step: `domains.${domain.host}`,
            code: 'domain-not-available',
            message: availability.customDomainAvailable.message || `"${domain.host}" is not available`,
          });
          return { host: domain.host, dnsStatus: 'failed' as const };
        }
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
          const state = info.domainStates[host];
          domains.push({
            host: host as StateSnapshot['domains'][number]['host'],
            dnsStatus: state?.dnsStatus ?? 'pending',
            certificateStatus: state?.certificateStatus ?? 'pending',
            ...(info.domainRecords[host] ? { records: info.domainRecords[host] } : {}),
            targetService: service.name,
          });
        }
      }
    }
    return { services: out, domains };
  }

  /**
   * Nudge a certificate re-issue by the provider's own domain id. Outside the `infra.provider` contract
   * on purpose -- `OPERATIONS` is five verbs and the conformance suite holds every provider to it -- so it
   * is a Railway-specific capability the composition root can offer, not something the controller may
   * assume exists. Callers reach it through the concrete provider or a capability of their own.
   */
  async retryCertificate(domainId: string): Promise<void> {
    const projectId = this.lastProjectId;
    if (!projectId) throw new Error('retryCertificate needs a project resolved by a prior readState or applyPlan');
    const credential = await this.credentials.workspace();
    const environments = await this.environments(projectId, credential);
    for (const environment of environments) {
      const token = await this.credentials.forEnvironment(projectId, environment.name).catch(() => credential);
      const instances = await this.environmentInstances(projectId, environment.id, token);
      // domainIds maps host -> provider id, so the id is a VALUE here; testing membership on the keys
      // made every retry look like a domain that was not attached.
      const attached = [...instances.values()].some((info) => Object.values(info.domainIds).includes(domainId));
      if (!attached) continue;
      await this.transport.graphql({
        operation: 'customDomainIssueCertificate',
        credential: token,
        query: 'mutation ($id: String!) { customDomainIssueCertificate(id: $id) }',
        variables: { id: domainId },
      });
      return;
    }
    throw new Error(`retryCertificate: no custom domain with id "${domainId}" is attached to project "${projectId}"`);
  }

  /** Recorded so a retry can find the project without the caller repeating the mapping. */
  private lastProjectId = '';

  /**
   * Provision a managed database through the template path (OD13). Measured 2026-11-09:
   * `templateDeployV2({ templateId, serializedConfig, projectId, environmentId, workspaceId })` created AND
   * deployed a private PostgreSQL to SUCCESS with no dashboard step. Two details make it work where earlier
   * probes failed: the input type is `TemplateDeployV2Input` (a different, similarly named type exists), and
   * `serializedConfig` is supplied by the caller -- read from the Template itself. Wrong shapes get the same
   * opaque "Problem processing request" that change sets emit, so that message means "could not deserialize",
   * never "cannot be done".
   *
   * The input has no services field and the deploy arrives under the template's own service name, so the
   * config is fetched, renamed to the plan's name, and sent back. Provisioning is asynchronous
   * (operationId/workflowId), so success is observed by reading the deployment back, not by the mutation
   * returning. A database that does not reach SUCCESS fails the apply: a service reported healthy without
   * its database is the worst outcome this contract can produce.
   */
  private async provisionDatabase(projectId: string, environmentId: string, envName: string, database: { name: string; kind: string }, environment: { name: string; services: ServicePlan[]; databases: { name: string; kind: string }[] }, token: RailwayCredential, serviceIds: Map<string, string>, failures: ApplyResult['failures'], notes: NonNullable<ApplyResult['notes']>): Promise<void> {
    const step = `databases.${database.name}`;
    const templateCode = this.databaseTemplates[database.kind];
    if (!templateCode) {
      failures.push({ step, code: 'unknown-database-kind', message: `${database.kind} has no template code configured on this provider` });
      return;
    }

    // Service names are project-wide (measured in E25: creating the same name in another environment is
    // rejected), and staging receives services through environment duplication. So an existing database
    // service is never re-provisioned here -- the only question is whether it has an instance in THIS
    // environment, which is the same placement rule already applied to ordinary services.
    const workspaceForLookup = await this.credentials.workspace();
    const existing = (await this.listServices(projectId, workspaceForLookup)).find((s) => s.name === database.name);
    if (existing) {
      serviceIds.set(`${envName}/${database.name}`, existing.id);
      const placed = await this.instanceStatus(projectId, environmentId, existing.id, token);
      if (!placed) {
        failures.push({
          step,
          code: 'database-instance-missing-in-environment',
          message: `${database.kind} exists in this project but has no instance in "${envName}"; recreate the environment duplicate so it is placed`,
        });
        return;
      }
      if (placed.status !== 'live') {
        // A duplicate made by environmentCreate carries the service but NO deployment (measured in E25, and
        // reproduced honestly by the double: the cloned instance sits at PENDING forever). Waiting on a
        // deployment that was never started is the same class of bug as the project-wide lookup above -- the
        // provider has to start it. Budget and idempotency still apply, so a re-apply does not redeploy.
        // rawStatus is the provider's own last deployment record: null means nothing has ever been deployed
        // in this environment, which is exactly the duplicated-staging case.
        const started = placed.rawStatus == null ? await this.deploy(existing.id, environmentId, token, failures) : true;
        if (started) {
          const outcome = await this.awaitDeployment(projectId, environmentId, existing.id, token, failures, notes);
          if (outcome.status !== 'live') {
            failures.push({ step, code: 'database-not-deployed', message: `${database.kind} reached ${outcome.status} instead of live` });
          }
        }
      }
      await this.wireReferences(projectId, environmentId, database, envName, environment, serviceIds, token);
      return;
    }

    try {
      // The catalog read goes on the workspace grant: every live probe that reached a Template did, while an
      // environment-scoped project token is the grant that gets "Bad Access" on project-level operations.
      const workspaceCredential = await this.credentials.workspace();
      const fetched = await this.transport.graphql<{ template: { id?: string | null; serializedConfig?: { services?: Record<string, Record<string, unknown>> } | null } }>({
        operation: 'template',
        credential: workspaceCredential,
        query: 'query ($code: String!) { template(code: $code) { id serializedConfig } }',
        variables: { code: templateCode },
      });
      const templateId = fetched.template.id;
      const config = fetched.template.serializedConfig;
      if (!templateId) {
        failures.push({ step, code: 'template-config-unexpected', message: `template code "${templateCode}" returned no id to deploy` });
        return;
      }
      const services = config?.services ?? {};
      const keys = Object.keys(services);
      if (keys.length !== 1 || !config) {
        failures.push({ step, code: 'template-config-unexpected', message: `template "${templateCode}" exposed ${String(keys.length)} services; this provider composes exactly one` });
        return;
      }
      const key = keys[0]!;
      const composedConfig = { ...config, services: { [key]: { ...services[key]!, name: database.name } } };

      const deployed = await this.transport.graphql<{ templateDeployV2: { operationId?: string | null; workflowId?: string | null } }>({
        operation: 'templateDeployV2',
        credential: workspaceCredential,
        query: 'mutation ($input: TemplateDeployV2Input!) { templateDeployV2(input: $input) { operationId workflowId } }',
        variables: { input: { templateId, serializedConfig: composedConfig, projectId, environmentId, workspaceId: this.workspaceId } },
      });
      // Template provisioning is a deployment in everything but the call we made, so the budget has to see
      // it, or a second environment would be free to deploy past the tenant's ceiling.
      this.deploymentsUsed += 1;
      notes.push({ step, code: 'database-provisioning-started', message: `template deploy accepted (operation ${deployed.templateDeployV2.operationId ?? 'unreported'}); provisioning is asynchronous` });

      // templateDeployV2 is asynchronous (operationId/workflowId) and the service materialises tens of
      // seconds later -- measured. Listing once immediately reported a healthy provisioning as a missing
      // service (issue #77), so we wait for it to appear AND to be placed in this environment.
      const deadline = Date.now() + this.deployTimeoutMs;
      let created: ServiceNode | undefined;
      for (;;) {
        const listed = await this.listServices(projectId, workspaceCredential);
        const candidates = listed.filter((s) => s.name === database.name || (s.name ?? '').toLowerCase().includes(database.kind));
        for (const candidate of candidates) {
          if (await this.instanceStatus(projectId, environmentId, candidate.id, token)) { created = candidate; break; }
        }
        if (created) break;
        if (Date.now() > deadline) break;
        await this.sleep(this.pollIntervalMs);
      }
      if (!created) {
        failures.push({
          step,
          code: 'database-provision-timeout',
          message: `the ${database.kind} template deploy was accepted but surfaced no placed service within ${this.deployTimeoutMs}ms`,
        });
        return;
      }
      serviceIds.set(`${envName}/${database.name}`, created.id);

      const outcome = await this.awaitDeployment(projectId, environmentId, created.id, token, failures, notes);
      if (outcome.status !== 'live') {
        failures.push({ step, code: 'database-not-deployed', message: `${database.kind} reached ${outcome.status} instead of success` });
        return;
      }

      // Wire every service in this environment that references the database, using Railway's own reference
      // expression so the credential is resolved by the provider: platfolio writes an expression and never
      // sees the value it stands for.
      await this.wireReferences(projectId, environmentId, database, envName, environment, serviceIds, token);
    } catch (error) {
      failures.push({ step, code: 'database-provision-failed', message: (error as Error).message.slice(0, 240) });
    }
  }

  /**
   * Write Railway's own reference expression for every service that declares a reference to this database,
   * so platfolio never *chooses* the value and never keeps it: the write is the only time it crosses.
   *
   * Measured, and it corrects an assumption I made in the design docs: Railway resolves `${{Service.VAR}}`
   * **on write**, so `variables()` returns the resolved secret. This is therefore NOT a custody mechanism --
   * it does not make reading safe, and it must not be described to a tenant as "we cannot see your secret".
   * The custody guarantee comes from never reading variable values anywhere in this provider
   * (`configVariableNames` takes keys only) and from the D24 tier choice, not from the expression syntax.
   */
  private async wireReferences(projectId: string, environmentId: string, database: { name: string; kind: string }, envName: string, environment: { name: string; services: ServicePlan[] }, serviceIds: Map<string, string>, credential: RailwayCredential): Promise<void> {
    for (const service of environment.services) {
      for (const reference of service.references ?? []) {
        if (reference.database !== database.name) continue;
        const target = serviceIds.get(`${envName}/${service.name}`);
        if (!target) continue;
        const expression = '$' + `{{${database.name}.${reference.output ?? 'DATABASE_URL'}}}`;
        await this.upsertVariable(projectId, environmentId, target, reference.variable, expression, credential);
      }
    }
  }

  /**
   * Provision a volume. `VolumeCreateInput` is { projectId, environmentId, serviceId, mountPath, region }:
   * a volume is created ATTACHED to a service, so the plan's `volumes[].service` selects the target and
   * there is no name to request and no separate attach call.
   *
   * Verification is deliberately limited to what is observable: `Volume` exposes id/name/project only, and
   * VolumeInstance (which carries mountPath and serviceId) has no list query on this grant -- a single
   * `volumeInstance(id)` lookup needs an id we are never handed. So this confirms the volume exists in the
   * project and notes that mount state is unreadable, rather than inventing a check that always passes.
   */
  private async provisionVolume(projectId: string, environmentId: string, volume: { name: string; service: string; mountPath: string; sizeMB?: number | undefined }, envName: string, serviceIds: Map<string, string>, credential: RailwayCredential, failures: ApplyResult['failures'], notes: NonNullable<ApplyResult['notes']>): Promise<void> {
    const step = `volumes.${volume.name}`;
    const serviceId = serviceIds.get(`${envName}/${volume.service}`);
    if (!serviceId) {
      failures.push({ step, code: 'unknown-service', message: `volume "${volume.name}" targets service "${volume.service}", which is not resolved in "${envName}"` });
      return;
    }
    try {
      await this.transport.graphql({
        operation: 'volumeCreate',
        credential,
        query: 'mutation ($input: VolumeCreateInput!) { volumeCreate(input: $input) { id name } }',
        variables: { input: { projectId, environmentId, serviceId, mountPath: volume.mountPath } },
      });
      const listed = await this.listVolumes(projectId, credential);
      if (!listed.length) {
        failures.push({ step, code: 'volume-not-listed', message: `volume create returned but the project lists no volumes in ${envName}` });
        return;
      }
      notes.push({ step, code: 'volume-mount-unobservable', message: `volume created for "${volume.service}" at ${volume.mountPath}; Railway exposes no volume-instance list on this grant, so the mount itself is not verifiable here` });
    } catch (error) {
      failures.push({ step, code: 'volume-create-failed', message: (error as Error).message.slice(0, 240) });
    }
  }

    /**
     * serviceDelete is slow for template-created services: measured live, deleting the provisioned database
     * exceeded the transport's 25s request deadline and timed out, leaving an orphan, while ordinary services
     * deleted inside the window. One retry with a short pause keeps the surface honest -- if both attempts
     * fail, the reason still lands in DeleteResult.failures rather than in an empty catch.
     */
    private async deleteServiceWithRetry(projectId: string, environment: EnvironmentNode, service: ServiceNode, credential: RailwayCredential): Promise<void> {
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await this.transport.graphql({
            operation: 'serviceDelete',
            credential,
            query: 'mutation ($environmentId: String!, $id: String!) { serviceDelete(environmentId: $environmentId, id: $id) }',
            variables: { environmentId: environment.id, id: service.id },
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt === 0) await this.sleep(2_000);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('serviceDelete failed');
    }

  /**
   * What still answers after the project delete. Null when the project itself is unreadable, which is a
   * different fact from an empty set: unreadable means everything went with it, an empty set means we
   * looked and found nothing, and a non-empty set is the case that deserves an orphan report.
   */
  private async reachableResources(projectId: string, credential: RailwayCredential): Promise<Set<string> | null> {
    try {
      const [services, bucketNames, volumeNodes, environments] = await Promise.all([
        this.listServices(projectId, credential),
        this.buckets(projectId, credential),
        this.listVolumes(projectId, credential),
        this.environments(projectId, credential),
      ]);
      return new Set<string>([
        ...volumeNodes.map((v) => `volume:${v.name}`),
        ...bucketNames.map((b) => `bucket:${b}`),
        ...environments.flatMap((e) => services.map((s) => `service:${e.name}/${s.name}`)),
      ]);
    } catch {
      return null;
    }
  }

  private async listVolumes(projectId: string, credential: RailwayCredential): Promise<{ id: string; name: string }[]> {
    const data = await this.transport.graphql<{ project: { volumes?: { edges: { node: { id: string; name?: string } }[] } | null } | null }>({
      operation: 'project.volumes',
      credential,
      query: 'query ($projectId: String!) { project(id: $projectId) { volumes(first: 50) { edges { node { id name } } } } }',
      variables: { projectId },
    });
    return (data.project?.volumes?.edges ?? []).map((e) => ({ id: e.node.id, name: e.node.name ?? e.node.id }));
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
