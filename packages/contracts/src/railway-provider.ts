import {
  InfraPlanSchema, OPERATIONS, planIssues,
  CONTRACT_VERSION,
  type ApplyResult, type CapabilityInfo, type DeleteResult, type InfraPlan, type InfraProvider,
  type Issue, type SecretPresence, type SecretWriteResult, type ServicePlan, type StateSnapshot,
} from './infra.ts';
import {
  HttpRailwayTransport, type RailwayCredential, type RailwayCredentialSource, type RailwayTransport,
} from './railway-transport.ts';
import { redactCredentialShaped } from './managed-action.ts';

/**
 * Railway provider. Its contract version is DERIVED (D59); `InfraPlan.contract` carries it, and it is
 * never restated in prose -- an earlier version of this line said `contract 1.0.0` and outlived the literal.
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
 * The one naming rule (D57, amended): a Railway service is named for the compose definition's service key
 * and the environment it belongs to.
 *
 * `physicalServiceName(logical, environment) => `${logical}-${environment.toLowerCase()}``, always, for every
 * environment, with no exceptions. The compose document's service key IS the base name; nothing else is
 * consulted, and nothing is observed -- not the project's current service list, not which environment a
 * service already runs in, not the free-text project description.
 *
 * The rule it replaces read the provider first and named a service bare when the project did not hold it yet
 * or when it already ran in this environment. That existed only to preserve the bare production names
 * (`api`, `identity`, `main`) platfolio's own services were created with before per-environment provisioning,
 * and the maintainer ruled that the preservation was not worth an observational rule: names are now
 * deterministic, so `--dry-run` says what will exist without asking the provider, a plan resolves the same in
 * any project, and the services that do not match the convention are renamed into it instead of being
 * preserved around. See {@link renameLegacyRow} for that path.
 */
export function physicalServiceName(logical: string, environment: string): string {
  return `${logical}-${environment.toLowerCase()}`;
}

/**
 * The physical names one environment's plan declares, keyed by logical name.
 *
 * Now a pure projection of the plan -- it used to be one read of `project.services` plus one of
 * `environment.serviceInstances` per environment, because the rule asked what the project already held.
 * Nothing here observes, which is also why no collision check is needed: two differing logical names cannot
 * resolve to the same physical name, and a plan that declares the same logical name twice is refused by
 * `planIssues` (`duplicate-service`, `duplicate-database`) rather than discovered here.
 */
function physicalNames(environment: string, logicalNames: readonly string[]): Map<string, string> {
  return new Map(logicalNames.map((name) => [name, physicalServiceName(name, environment)]));
}

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
      // Derived from the shared OPERATIONS constant: a hand-copied list here is how a driver ends up claiming
      // (or denying) a verb it does or does not implement, out of step with the contract.
      // Copied, not passed through: the advertised set is mutable in the contract type while
      // OPERATIONS is a readonly tuple, and a driver must not be able to mutate the shared list.
      operations: [...OPERATIONS],
      // What is actually supported. Ceilings and databases/buckets are absent from this list on purpose.
      // `per-environment-provisioning` replaced `environment-cloning`: every environment is created from its own
      // declaration, because a duplicated environment inherits the source's database configuration (D57).
      features: ['service-domains', 'custom-domains', 'literal-configuration', 'preserve-secret-references', 'per-environment-tokens', 'deploy-waiting', 'per-environment-provisioning'],
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
    //
    // But the marker above records INTENT, deliberately written before anything mutates (E26: a marker written
    // only at the end meant every retry re-deployed everything). So a matching marker is not proof the work
    // FINISHED -- an apply interrupted between the marker and the last environment leaves the promise without
    // the state. Measured on our own infrastructure: the retry answered `noop: true, verified: true` while the
    // staging environment did not exist, because `verified` asked "is every service in the project live", and a
    // service that was never placed anywhere is simply absent from the list it checks.
    //
    // A marker therefore earns a coverage check rather than a certificate: every environment the plan declares
    // must exist, every service in it must be placed, every domain in it must be bound. Anything missing resumes
    // the apply, and the resume is reported instead of being silent.
    if (this.markerOf(existing?.description) === plan.planHash) {
      const coverage = await this.coverageOf(projectId, parsed.data.environments, workspaceCredential);
      const state = await this.snapshot(projectId);
      if (coverage.covered) {
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
      notes.push({
        step: 'idempotency',
        code: 'marker-without-state',
        // Named, not counted: an operator reading this has to know WHICH declared thing the provider is missing,
        // or the resume looks like flapping.
        message: `this plan's marker is present but ${String(coverage.missing.length)} declared thing(s) are absent in the provider (${coverage.missing.slice(0, 6).join('; ')}); resuming the apply rather than reporting success`,
      });
    }

    for (const environment of parsed.data.environments) {
      const environmentId = await this.ensureEnvironment(projectId, environment.name, workspaceCredential);
      const token = await this.credentials.forEnvironment(projectId, environment.name);

      const placed = await this.environmentInstances(projectId, environmentId, token);
      const projectServices = await this.listServices(projectId, workspaceCredential);
      // The names are a projection of the plan, not of the project: what this environment will hold is
      // answerable before anything is read. The read that remains (`projectServices`) exists for the
      // legacy-shape path below and for the create/update decision, never to decide a name.
      const physical = physicalNames(
        environment.name,
        [...environment.services.map((s) => s.name), ...environment.databases.map((d) => d.name)],
      );

      for (const service of environment.services) {
        const name = physical.get(service.name) ?? service.name;
        let known = projectServices.find((s) => s.name === name);
        if (!known) {
          const legacy = await this.renameLegacyRow(projectId, environmentId, environment.name, service.name, name, projectServices, placed, workspaceCredential, notes, failures);
          if (legacy.blocked) continue;
          // The rename returned the SAME row id under its new name; `placed` is keyed by id, so the placement
          // read still answers for it and nothing has to be re-read here.
          known = legacy.row ? { id: legacy.row.id, name } : undefined;
        }
        let placedHere = known !== undefined && placed.has(known.id);
        if (known && !placedHere) {
          // `serviceCreate` refuses a name the project already holds (measured), and there is no
          // `serviceInstanceCreate` in the captured schema, so a row that exists under the name this
          // environment needs but runs nowhere cannot be given an instance: deleting it is the only way to
          // free the name for the create that will place one. That is the D55 resume case -- the residue of an
          // interrupted apply. A row that DOES run somewhere else is somebody's compute and is reported, never
          // deleted to make room.
          if (await this.reclaimUnplacedService(projectId, environmentId, known, workspaceCredential)) {
            notes.push({
              step: `services.${name}@${environment.name}`,
              code: 'service-row-reclaimed',
              message: `"${name}" existed in the project with no instance in any environment; the row was deleted so "${environment.name}" could be provisioned its own service (D57). Measured: serviceDelete leaves volumes intact, so any disk it had survives detached rather than destroyed`,
            });
            known = undefined;
            placedHere = false;
          } else {
            failures.push({
              step: `services.${service.name}@${environment.name}`,
              code: 'instance-missing-in-environment',
              message: `"${service.name}" resolves to "${known.name}" in "${environment.name}", which exists in this project but has no instance here; Railway creates an instance only as part of serviceCreate, and serviceCreate refuses a name the project already holds, so the row has to be deleted by an operator or renamed to whatever the other environment is actually using (D57)`,
            });
            continue;
          }
        }
        const serviceId = await this.ensureService(projectId, environmentId, service, name, known, placedHere, token, notes);
        // Domain and instance placement take the *service* id; readState reports the *instance* id,
        // because the instance is the per-environment thing that exists. Passing one where the other
        // belongs silently drops the domain, which is what an earlier revision of this line did.
        //
        // The key stays the plan's logical name: every consumer below (domains, volumes, references) was
        // written against the declaration, and the VALUE is the id of whichever physical service this
        // environment resolved to (D57). Names are how the two environments stay apart; ids are how the plan
        // keeps addressing one thing.
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
          // The PHYSICAL name (D57), because this list is compared against `readState`, and readState can only
          // report what the provider calls the service. Reporting the plan's logical name here would give one
          // service two identities depending on which method produced the row.
          name: physical.get(service.name) ?? service.name,
          environment: environment.name,
          externalId: outcome.instanceId,
          status: outcome.status,
          image: `${service.image}@${service.digest}`,
          numReplicas: service.replicas,
        });
      }

      for (const domain of environment.domains) {
        const targetServiceId = serviceIds.get(`${environment.name}/${domain.service}`);
        const domainServiceName = physical.get(domain.service) ?? domain.service;
        const target = services.find((s) => s.name === domainServiceName && s.environment === environment.name);
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
          targetService: domainServiceName,
        });
      }

      for (const database of environment.databases) {
        await this.provisionDatabase(projectId, environmentId, environment.name, database, environment, physical, token, serviceIds, failures, notes, projectServices, placed, workspaceCredential);
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

  /**
   * Tear an instance down. `retainMounts` names the mount paths whose volumes stay behind, attached to
   * nothing -- the state half of the hibernate pattern, where compute is destroyed and the disk is kept for a
   * future service to mount.
   *
   * Mounts, not names, because a name is not a shared identity: Railway names volumes itself as
   * `<service>-volume` while the plan's `name` is a tenant-facing label, so an option keyed on either one
   * would silently match nothing the other was called. The mount is what the plan declares and what the
   * provider reads back, so it is the only thing both sides can agree on.
   *
   * The caller supplies it because retention is a plan decision and deleteInstance receives only an instance
   * id; storing retention state inside the provider would be a second source of truth for a fact the plan owns.
   */
  async deleteInstance(instanceId: string, options: { retainMounts?: string[] } = {}): Promise<DeleteResult> {
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

    // Placement first, then the inventory. Since each environment holds its OWN services (D57), the project's
    // service list and an environment's contents no longer coincide, and a teardown built from their cross
    // product would attempt -- and then CLAIM -- deletes for pairs that never existed: `service:production/api-staging`
    // is not a thing that was removed, it is a thing that was never there.
    //
    // Where the instance read itself fails, every service is assumed present here: the sweep then behaves like
    // the old one, because silently skipping a service on the strength of a read that broke is the failure #111
    // was filed about.
    const placedHere = new Map<string, Set<string> | null>();
    for (const environment of environments) {
      const token = await this.credentials.forEnvironment(project.id, environment.name).catch(() => credential);
      try {
        placedHere.set(environment.id, new Set((await this.environmentInstances(project.id, environment.id, token)).keys()));
      } catch {
        placedHere.set(environment.id, null);
      }
    }

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
      ...environments.flatMap((e) => services.filter((s) => placedHere.get(e.id) === null || placedHere.get(e.id)!.has(s.id)).map((s) => `service:${e.name}/${s.name}`)),
    ]);

      // Volumes are released BEFORE the services they are attached to. Measured: a template-created database
      // whose volume still existed was refused by serviceDelete ("Problem processing request"), while an
      // identical volume-less one deleted cleanly -- so #107 was ordering, not a capability limit, and the
      // previous order (services first, volumes after) guaranteed the refusal at every attempt.
      // Instance rows carry the mounts; a volume with no live instance has no mount to match and is treated
      // as already-orphaned, which is the state a retained volume reaches once its service is gone.
      const instancesByVolume = new Map<string, string>();
      for (const environment of environments) {
        for (const row of await this.volumeInstances(project.id, environment.id, credential)) instancesByVolume.set(row.volumeId, row.mountPath);
      }
      const retain = new Set(options.retainMounts ?? []);
      const retained: string[] = [];
      for (const volume of volumesAtStart) {
        const mount = instancesByVolume.get(volume.id);
        if (mount && retain.has(mount)) { retained.push(`${volume.name} (mounted at ${mount})`); continue; }
        // `volumeDelete` answers true and *schedules* removal: measured, the volume keeps `isPendingDeletion`
        // with a `deletedAt` about two days out and stays listed meanwhile. So "removed" here means "we asked",
        // which is why a retained volume is reported as retained rather than conflated with either outcome.
        if (retain.has(volume.name)) { retained.push(volume.name); continue; }
        await this.transport.graphql({ operation: 'volumeDelete', credential, query: 'mutation ($volumeId: String!) { volumeDelete(volumeId: $volumeId) }', variables: { volumeId: volume.id } })
          .then(() => { removed.push(`volume:${volume.name}`); })
          .catch(() => { /* unresolved: classified after the project goes */ });
      }

    for (const environment of environments) {
      const placed = placedHere.get(environment.id);
      for (const service of services) {
        // Nothing runs here, so there is nothing for this environment to delete -- and saying we deleted it
        // would be the same overstatement #111 exists to prevent, only about a pair that never existed.
        if (placed && !placed.has(service.id)) continue;
        try {
          await this.deleteServiceWithRetry(project.id, environment, service, credential);
          removed.push(`service:${environment.name}/${service.name}`);
        } catch (error) {
          // The empty catch was a bug in the family we keep chasing: the intent was "absent in this
          // environment is not an orphan", but a real refusal -- exactly what happened to the
          // template-created database in #80 -- disappeared, leaving a survivor reported with no reason.
          // Placement decides whether to speak, but the placement read above can itself have failed -- a
          // refused delete still deserves a reason either way, so the unknown case reports.
          if (placed && !placed.has(service.id)) continue;   // genuinely absent here: not an orphan, nothing to report
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
    // A retained volume is not an orphan and was not released with the project; it is a decision. Reported
    // that way so the platform's own accounting cannot quietly turn "we kept it" into "it is gone".
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
    return { instanceId, removed, orphans, ...(retained.length ? { retained } : {}), ...(releasedWithProject.length ? { releasedWithProject } : {}), ...(deleteFailures.length ? { failures: deleteFailures } : {}) };
  }

  // --- internals -------------------------------------------------------------------------------

  /**
   * Railway identifies projects by name within a workspace, and a platfolio instance id is not a Railway
   * id, so the mapping is derived. It is a function of the instance id **alone** — including the platform
   * would make `readState(instanceId)` unanswerable, because readState is not given a plan. An earlier
   * version of this method embedded `manifestRef.template`, and the conformance suite caught it: apply
   * succeeded, then readState could not find the project it had just created.
   */
  private projectName(plan: { instanceId: string }): string {
    return `platfolio-${plan.instanceId}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  }

  /**
   * Deliver one secret value (D53). Written with `skipDeploys: true`, because a credential arriving is not a
   * decision to redeploy -- that coupling has woken services for no reason before. `verified` is a name
   * presence check, never a value read: the provider redacts values on read, so the strongest claim available
   * is "the variable now exists", which is also the only claim worth making.
   */
  async putSecretValue(input: { instanceId: string; environment: string; service: string; name: string; value: string; source?: 'service' | 'shared-variable' }): Promise<SecretWriteResult> {
    if (typeof input.value !== 'string' || input.value.length === 0) {
      return { ok: false, code: 'invalid-value', reason: 'a secret value must be a non-empty string; an empty value is a deletion the tenant did not ask for' };
    }
    const project = await this.findProject(this.projectName({ instanceId: input.instanceId }));
    if (!project) return { ok: false, code: 'not-found', reason: `no provider project for instance "${input.instanceId}" -- it has never been applied` };
    const workspace = await this.credentials.workspace();
    const env = (await this.environments(project.id, workspace)).find((e) => e.name === input.environment);
    if (!env) return { ok: false, code: 'not-found', reason: `environment "${input.environment}" does not exist in this instance -- create it by applying a plan that enables it` };
    const svc = await this.serviceInEnvironment(project.id, env, input.service, workspace);
    if (!svc) {
      // The reason names the name the RULE produces, not just the name the caller used: on a project that has
      // not been migrated yet a legacy row does exist under the bare name, and an operator told only "no
      // service api" will look at the project, see one, and conclude the provider is lying.
      const expected = physicalServiceName(input.service, input.environment);
      return { ok: false, code: 'not-found', reason: `no service "${expected}" in the environment "${input.environment}" of project ${project.name}; services are named {name}-{environment} by the platform description, and each environment gets its own (D57). If this project still holds "${input.service}" under its pre-rule name, apply the plan -- that renames the row, and delivery resolves afterwards` };
    }
    const token = await this.credentials.forEnvironment(project.id, env.name);
    const shared = input.source === 'shared-variable';
    try {
      if (shared) {
        // Two calls, one meaning, both read off the captured provider schema rather than assumed.
        // `variableUpsert` WITHOUT a serviceId writes the value at environment scope -- that is what Railway
        // calls a shared variable. `sharedVariableConfigure`, whose input carries only the enable/disable service
        // lists and NO value field, is what attaches it to the service that has to read it. Calling only the
        // first would write a credential the service cannot see and then verify the wrong thing.
        await this.upsertSharedVariable(project.id, env.id, input.name, input.value, token);
        await this.attachSharedVariable(project.id, env.id, input.name, svc.id, token);
      } else {
        await this.upsertVariable(project.id, env.id, svc.id, input.name, input.value, token);
      }
    } catch (error) {
      // The provider's words, redacted: a rejected write is worth reading, and a credential must never be in it.
      return { ok: false, code: 'provider-refused', reason: redactCredentialShaped(String((error as Error).message)).slice(0, 240) };
    }
    // Presence is read for the DECLARING service, not for the environment, so a shared variable that was written
    // but never attached reports verified:false -- the failure the second call exists to prevent.
    const present = (await this.configVariableNames(project.id, env.id, svc.id).catch(() => [] as string[])).includes(input.name);
    return { ok: true, verified: present };
  }

  async secretPresence(input: { instanceId: string; environment: string; service: string; names: string[] }): Promise<Record<string, SecretPresence>> {
    const out: Record<string, SecretPresence> = {};
    const project = await this.findProject(this.projectName({ instanceId: input.instanceId }));
    if (!project) {
      for (const n of input.names) out[n] = 'unverifiable';
      return out;
    }
    const workspace = await this.credentials.workspace();
    const env = (await this.environments(project.id, workspace)).find((e) => e.name === input.environment);
    const svc = env ? await this.serviceInEnvironment(project.id, env, input.service, workspace) : undefined;
    if (!env || !svc) {
      for (const n of input.names) out[n] = 'unverifiable';
      return out;
    }
    const names = await this.configVariableNames(project.id, env.id, svc.id).catch(() => undefined);
    if (names === undefined) {
      for (const n of input.names) out[n] = 'unverifiable';
      return out;
    }
    const set = new Set(names);
    for (const n of input.names) out[n] = set.has(n) ? 'set' : 'missing';
    return out;
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

  /**
   * Create one environment, empty. It arrives with NO services: every resource in it is provisioned from this
   * plan by the caller, which is the point of D57 -- an environment that inherits another environment's services
   * inherits their database configuration too, and staging then reads production's DSN.
   *
   * `isPrivate` is not sent: introspection says `EnvironmentCreateInput` has no such field, which is how E25
   * found it (a single-environment run never creates a second environment, so the bug was invisible to the
   * passing suite). `skipInitialDeploys` stays on: the tenant's daily deploy ceiling is shared and finite, and
   * nothing here is a decision to deploy.
   */
  private async ensureEnvironment(projectId: string, environment: string, credential: RailwayCredential): Promise<string> {
    const found = await this.environments(projectId, credential);
    const existing = found.find((e) => e.name === environment);
    if (existing) return existing.id;
    const data = await this.transport.graphql<{ environmentCreate: { id: string } }>({
      operation: 'environmentCreate',
      credential,
      query: 'mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id } }',
      // No `sourceEnvironmentId` is ever sent, and this is not a formatting choice: measured on the live API,
      // creating an environment from a source gave the new environment the source's service ids, and its api
      // failed with `connect ETIMEDOUT` against a database it does not own. The field stays in the input
      // allowlist of the test double precisely so that nobody reintroduces it here unnoticed.
      variables: { input: { projectId, name: environment, skipInitialDeploys: true } },
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
   * Delete a service ROW that runs nothing anywhere, so the environment asking for that name can provision its
   * own service. Returns whether the row is gone.
   *
   * This exists because the naming rule (D57) and the coverage resume (D55) meet: an interrupted apply can leave
   * `api-staging` as a project row with no instance, and every later apply resolves staging's `api` to that same
   * name and is then refused by `serviceCreate` (measured: a duplicate name is rejected). Without reclaiming,
   * "resume the apply" would be a promise this state cannot keep.
   *
   * THIS IS THE ONLY DELETE LEFT INSIDE A SUCCESSFUL APPLY, and it is deliberately narrow. It reaches a row that
   * already carries the name platfolio's OWN rule produces -- ours by name, not by inference -- and that runs in
   * no environment at all. Renaming cannot fix that shape: the captured schema has no `serviceInstanceCreate`, so
   * `serviceCreate` is the only placer and it refuses the name this row holds. A bare legacy row that runs nowhere
   * is therefore NOT routed here -- see {@link renameLegacyRow}, which leaves it and reports it -- because that
   * row's name is not one the rule produced, and whether its disk survives is a human decision. Deleting anything
   * that RUNS is unreachable from an apply at all: that is the operator's destroy path (D36/D43).
   *
   * The guard is the whole method: an instance in ANY other environment means the row is somebody's running
   * service -- a legacy shared one from the cloning era -- and deleting it would take that environment's compute
   * (and, for a database, its only connection) with it. Those are reported instead.
   *
   * A surviving VOLUME is not what this checks. Measured: `serviceDelete` leaves volumes intact, so reclaiming a
   * database row that had one orphans the disk -- which is why the caller says so in a note rather than calling
   * the recreate a restoration.
   */
  private async reclaimUnplacedService(projectId: string, environmentId: string, row: ServiceNode, workspaceCredential: RailwayCredential): Promise<boolean> {
    const environments = await this.environments(projectId, workspaceCredential);
    for (const other of environments) {
      if (other.id === environmentId) continue;
      const token = await this.credentials.forEnvironment(projectId, other.name).catch(() => workspaceCredential);
      if (await this.instanceStatus(projectId, other.id, row.id, token).catch(() => null)) return false;
    }
    try {
      await this.transport.graphql({
        operation: 'serviceDelete',
        credential: workspaceCredential,
        query: 'mutation ($environmentId: String!, $id: String!) { serviceDelete(environmentId: $environmentId, id: $id) }',
        variables: { environmentId, id: row.id },
      });
    } catch {
      // Refused, timed out, already gone: the caller's report of the collision is more useful than this error,
      // and nothing here is destructive enough to warrant failing the whole apply over.
      return false;
    }
    return true;
  }

  /**
   * The service that a plan's logical name refers to IN ONE environment (D57).
   *
   * Callers outside `applyPlan` -- secret delivery and its read-back -- are addressed by the name the tenant
   * declared, and the deterministic rule says which project service that is in this environment. Resolving it
   * here rather than project-wide is what stops `PUT …/secrets/{name}` from writing a credential onto
   * production's service while reporting it against staging's.
   *
   * The name is computed, never observed. A legacy row that has not been renamed yet therefore reads back as
   * absent -- deliberately, because writing a credential onto a service this plan does not name is how a
   * secret ends up on the wrong service while the report says it landed on the right one. Run the apply first;
   * it renames the row, and delivery then resolves.
   */
  private async serviceInEnvironment(
    projectId: string,
    environment: { id: string; name: string },
    logical: string,
    workspaceCredential: RailwayCredential,
  ): Promise<ServiceNode | undefined> {
    const [projectServices, token] = await Promise.all([
      this.listServices(projectId, workspaceCredential),
      this.credentials.forEnvironment(projectId, environment.name),
    ]);
    const placed = await this.environmentInstances(projectId, environment.id, token);
    const name = physicalServiceName(logical, environment.name);
    const row = projectServices.find((s) => s.name === name);
    // Placed-here is part of the answer: a project row with this name that runs nowhere is not this
    // environment's service, and delivering a credential to it would report success against a service that
    // cannot receive a deploy.
    return row && placed.has(row.id) ? row : undefined;
  }

  /**
   * Move a legacy project row onto the name the deterministic rule gives it, so the migration is a rename
   * rather than a delete-and-recreate.
   *
   * Why rename at all: `Mutation.serviceUpdate(id, input: ServiceUpdateInput!)` exists and `ServiceUpdateInput`
   * carries `name` (captured in `railway-graphql-schema.json`; `Service.name` is service-level, and neither
   * `ServiceInstanceUpdateInput` nor `ServiceInstance` carries a name, which is how we know renaming is a
   * service operation rather than a per-environment one). A Railway service is the thing that owns the volume,
   * the environment instances, the attached domains and the private network, so renaming preserves every one
   * of them. Deleting a service destroys its environments and its database volume -- unrecoverable -- and
   * under this rule that is never required to fix a name.
   *
   * WHICH rows may be renamed -- the ownership rule, without a marker:
   *   a row is a candidate only when its current name is exactly a logical name THIS plan declares, so the
   *   rename target is exactly what `physicalServiceName()` produces for it. A hand-made service in a shared
   *   project is not named by the plan and is therefore untouchable by construction. The provider's plan
   *   marker (`MARKER = 'platfolio:plan='` written to the PROJECT description, read by `markerOf` and written
   *   by `writeMarker`) identifies a project and its last plan hash -- it says nothing about an individual
   *   service row, and the maintainer has ruled description-parsing out as an ownership mechanism, so it is
   *   not used here.
   *
   * Residual limitation, stated rather than implied closed: ownership is INFERRED from the one-project-per-
   * instance layout (`projectName()` is a function of the instance id) plus the plan's declared names. A
   * hand-made service inside a tenant's own platfolio project that happens to share a logical name is the one
   * case this provider can mistake for its own legacy row. The blast radius is a rename, reversible by
   * renaming it back -- which is why the inference is acceptable here and would not have been under
   * delete-and-recreate. Filed as #243.
   *
   * Two guards survive from the observational era because they still protect something real:
   *  - the row must have an instance IN THIS ENVIRONMENT. A row that runs elsewhere is that environment's
   *    service; renaming it would take the name out from under the plan that is using it there.
   *  - the row must not ALSO be running in another environment. That is the shape the cloning era left behind
   *    -- one service instance shared across environments. Renaming it for this environment would leave the
   *    other environment's plan to find its own name free and provision a SECOND service, silently splitting
   *    one dataset in two. Neither outcome is a rename this provider should choose, so it refuses and names
   *    both rows.
   */
  private async renameLegacyRow(
    projectId: string,
    environmentId: string,
    environmentName: string,
    logical: string,
    target: string,
    projectServices: ServiceNode[],
    placedHere: ReadonlyMap<string, unknown>,
    workspaceCredential: RailwayCredential,
    notes: NonNullable<ApplyResult['notes']>,
    failures: ApplyResult['failures'],
    kind: 'service' | 'database' = 'service',
  ): Promise<{ row?: ServiceNode; blocked: boolean }> {
    if (logical === target) return { blocked: false };
    const candidate = projectServices.find((s) => s.name === logical);
    if (!candidate) return { blocked: false };

    // One read of the OTHER environments answers both remaining questions: does this row run somewhere else
    // (and therefore belong to that environment), and is it running here AND there at once (the shared shape
    // the cloning era left behind)?
    const elsewhere: string[] = [];
    for (const other of await this.environments(projectId, workspaceCredential)) {
      if (other.id === environmentId) continue;
      const otherToken = await this.credentials.forEnvironment(projectId, other.name).catch(() => workspaceCredential);
      if (await this.instanceStatus(projectId, other.id, candidate.id, otherToken).catch(() => null)) elsewhere.push(other.name);
    }

    if (!placedHere.has(candidate.id)) {
      // Nothing runs here for this row, and under the deterministic rule that does NOT block provisioning:
      // the target name is free, so this environment provisions its own row and the legacy one is left
      // exactly where it is. Two shapes, reported differently because the operator's decision differs:
      //   - it runs in ANOTHER environment: that environment's apply renames it, and deleting it here would
      //     have destroyed that environment's compute (and, for a database, its only connection);
      //   - it runs nowhere: the residue of an interrupted apply or a deleted environment. Not renaming is
      //     deliberate -- renaming it onto the target would put the name in place without an instance, and
      //     the captured schema has NO `serviceInstanceCreate` (verified against the captured introspection:
      //     the instance mutations are Update/Deploy/DeployV2/Redeploy/Limits/Limits and none of them places
      //     one), so the row would then block the `serviceCreate` that is the only way to place one.
      //     Provisioning around it leaves the row for a human to delete or adopt -- for a database that row
      //     may still own the volume, and orphaning it visibly beats destroying it.
      notes.push({
        step: `services.${target}@${environmentName}`,
        code: elsewhere.length > 0 ? 'legacy-row-belongs-to-another-environment' : 'legacy-row-left-unplaced',
        message: elsewhere.length > 0
          ? `"${logical}" (service ${candidate.id}) runs in ${elsewhere.map((n) => `"${n}"`).join(' and ')}, not in "${environmentName}", so it was left exactly as it is: that is ${elsewhere.length === 1 ? 'that environment' : 'those environments'}' running service, and renaming or deleting it here would take it away from them. "${environmentName}" is being provisioned its own "${target}". Nothing was renamed and nothing was deleted (D57)`
          : `LEFTOVER SERVICE NOT TOUCHED: "${logical}" (service ${candidate.id}) has NO instance in ANY environment of this project -- it is the residue of an interrupted apply or of an environment that was deleted underneath it. platfolio deliberately did NOT delete it and did NOT rename it, and this apply will not either. Renaming it onto "${target}" would install the name with nothing behind it and permanently block the serviceCreate that is the only way to place an instance (the captured provider schema has no serviceInstanceCreate), so the environment could never converge without a human. Deleting it is destructive and is therefore the operator's call through the destroy path (D36/D43), never a side effect of a successful apply. This row may still own a volume, which costs money while it exists: if it is a database, its disk and the data on it survive until an operator deletes the service. Target: service ${candidate.id}, name "${logical}", in project ${projectId}`,
      });
      return { blocked: false };
    }

    if (elsewhere.length > 0) {
      failures.push({
        step: `services.${logical}@${environmentName}`,
        code: 'legacy-service-ambiguous',
        message: `"${logical}" runs in ${[environmentName, ...elsewhere].map((n) => `"${n}"`).join(' and ')} at once, so it is not this environment's service to rename: renaming it for "${environmentName}" would leave ${elsewhere.map((n) => `"${n}"`).join(' and ')} free to provision a second service over the same data. Split it by hand first -- rename this row to the name ONE environment uses, then re-apply (D57). Nothing was renamed and nothing was deleted. Service id ${candidate.id}`,
      });
      return { blocked: true };
    }

    let readBack: { id: string; name: string } | undefined;
    try {
      readBack = (await this.transport.graphql<{ serviceUpdate: { id: string; name: string } }>({
        operation: 'serviceUpdate',
        credential: workspaceCredential,
        // `serviceUpdate` returns `Service!`, an OBJECT, so it carries a sub-selection: the same validation
        // rule that broke the marker write (E25/E26) applies to every mutation the API answers with an object.
        // The sub-selection is also the read-back: the name is asked for, not assumed from the call succeeding.
        query: 'mutation ($id: String!, $input: ServiceUpdateInput!) { serviceUpdate(id: $id, input: $input) { id name } }',
        variables: { id: candidate.id, input: { name: target } },
      })).serviceUpdate;
    } catch (error) {
      failures.push({
        step: `services.${logical}@${environmentName}`,
        code: 'legacy-service-rename-failed',
        message: `renaming "${logical}" to "${target}" was refused: ${redactCredentialShaped((error as Error).message).slice(0, 200)}. Nothing was deleted (D57)`,
      });
      return { blocked: true };
    }

    if (readBack?.name !== target) {
      // A 2xx is not a rename. Measured repeatedly in this provider's family: mutations answer true while
      // changing nothing (E25's `serviceInstanceUpdate` on an unplaced instance), so the moved name is confirmed
      // from what the provider sent back, and an unconfirmed rename is reported rather than provisioned on top of.
      failures.push({
        step: `services.${target}@${environmentName}`,
        code: 'legacy-service-rename-unverified',
        message: `serviceUpdate for ${candidate.id} returned ${readBack?.name === undefined ? 'no name' : `name "${readBack.name}"`} instead of "${target}", so the rename was not confirmed and nothing further was provisioned against that row (D57)`,
      });
      return { blocked: true };
    }

    // One note per rename. A database's caller says more -- the volume and the data on it are the whole reason
    // this migration is a rename -- so the generic sentence stays with services instead of describing the same
    // row twice in two voices.
    if (kind === 'service') {
      notes.push({
        step: `services.${target}@${environmentName}`,
        code: 'legacy-service-renamed',
        message: `"${logical}" (service ${candidate.id}) was renamed to "${target}" with serviceUpdate, so its environment instances, its domains and its private network all followed the service: nothing was deleted and no data was destroyed (D57)`,
      });
    }
    return { row: candidate, blocked: false };
  }

  /**
   * Create-or-update ONE instance, in ONE environment, under the physical name this environment resolved to
   * (D57) — which is why the name is a parameter and not read off the plan: the plan's `api` is the project's
   * `api` in production and `api-staging` in staging, and both are the same declaration. A Railway service is
   * project-level while what runs is the per-environment **instance**, so this is where the two meet.
   *
   * An existing service placed HERE is updated (its instance is the per-environment thing). Anything else is
   * created with `serviceCreate`, the only mutation that places a service in an environment — `serviceInstanceUpdate`
   * against an environment with no instance there returns true and changes nothing (measured in E25), so an
   * update is never a way to place one.
   */
  private async ensureService(
    projectId: string,
    environmentId: string,
    service: ServicePlan,
    physicalName: string,
    known: ServiceNode | undefined,
    placedHere: boolean,
    token: RailwayCredential,
    notes: NonNullable<ApplyResult['notes']>,
  ): Promise<string> {
    if (!known || !placedHere) return this.createService(projectId, environmentId, service, physicalName, token);
    try {
      await this.updateService(known.id, environmentId, service, token);
      return known.id;
    } catch (error) {
      const message = (error as Error).message;
      if (!/NOT_FOUND|no instance/i.test(message)) throw error;
      // E25 measured that the unplaced case does NOT raise — it answers true — so the placement check in
      // applyPlan is the guard, not this catch. This is for the narrower race: the instance existed when the
      // environment was read and does not exist now. Creating is safe here because the name this function was
      // handed is the one the rule resolved for this environment.
      notes.push({
        step: `services.${physicalName}@${environmentId}`,
        code: 'instance-created-by-fallback',
        message: 'serviceInstanceUpdate reported no instance for this environment although the placement read said otherwise; the service was created in it instead',
      });
      return this.createService(projectId, environmentId, service, physicalName, token);
    }
  }

  private async createService(projectId: string, environmentId: string, service: ServicePlan, physicalName: string, credential: RailwayCredential): Promise<string> {
    const data = await this.transport.graphql<{ serviceCreate: { id: string } }>({
      operation: 'serviceCreate',
      credential,
      query: 'mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }',
      variables: {
        input: {
          projectId,
          environmentId,
          name: physicalName,
          // Measured: a workspace grant is refused here. The environment-scoped token is required. Measured
          // differently, and just as load-bearing: a name the project already holds is refused outright, which
          // is why this call gets the resolved name and never the plan's (D57).
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
   * Write one variable at ENVIRONMENT scope. Railway's `VariableUpsertInput` makes every field optional, and
   * omitting `serviceId` is exactly what distinguishes a shared variable from a service variable: the value
   * belongs to the environment, and services opt in to reading it.
   */
  private async upsertSharedVariable(projectId: string, environmentId: string, name: string, value: string, credential: RailwayCredential): Promise<void> {
    await this.transport.graphql({
      operation: 'variableUpsert',
      credential,
      query: 'mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
      // No serviceId: environment scope. skipDeploys for the same reason as the service-scoped write -- a
      // credential arriving is not a decision to redeploy.
      variables: { input: { projectId, environmentId, name, value, skipDeploys: true } },
    });
  }

  /**
   * Attach an environment-scoped variable to the service that declares it. This is the ONLY thing
   * `sharedVariableConfigure` does -- the captured input shape is `projectId` / `environmentId` / `name` /
   * `enabledServiceIds` / `disabledServiceIds`, with no value field anywhere -- so treating it as a write would
   * be wrong in both directions, and skipping it would leave a delivered credential invisible to the service
   * while still existing in the environment.
   */
  private async attachSharedVariable(projectId: string, environmentId: string, name: string, serviceId: string, credential: RailwayCredential): Promise<void> {
    await this.transport.graphql({
      operation: 'sharedVariableConfigure',
      credential,
      // Returns Variable!, so a sub-selection is required -- the same class of validation-time rejection that
      // bit the marker write (E26) and is why the query is spelled out rather than sent bare.
      query: 'mutation ($input: SharedVariableConfigureInput!) { sharedVariableConfigure(input: $input) { id } }',
      // Both lists are NON_NULL in the captured schema -- `[String!]!` each -- so attaching means sending an
      // empty `disabledServiceIds` alongside the enabled one. Omitting it is not a harmless abbreviation: the
      // live API rejected the whole mutation with `Variable "$input" got invalid value`, and my own double
      // agreed with the omission because its allowlist checked field NAMES and never requiredness.
      variables: { input: { projectId, environmentId, name, enabledServiceIds: [serviceId], disabledServiceIds: [] } },
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
        throw new Error(`secret "${secret.name}" declares platfolio-held custody, which the contract forbids (D4: platfolio-held custody was removed before 1.0.0 shipped) (docs/design/03)`);
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
      query: 'query ($projectId: String!, $environmentId: String!) { environment(projectId: $projectId, id: $environmentId) { serviceInstances { edges { node { id serviceId numReplicas source { image } latestDeployment { status } activeDeployments { status } domains { customDomains { id domain syncStatus status { verified certificateStatus verificationDnsHost verificationToken dnsRecords { fqdn hostlabel zone recordType requiredValue currentValue status purpose } } } serviceDomains { id domain syncStatus } } } } } } }',
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
        // `SUCCESS` is a deployment outcome, not a process state. Measured on our own deployment
        // (2026-11-12): Keycloak exited, and Railway still listed an older SUCCESS deployment as active while
        // the UI called the service "completed". Mapping SUCCESS straight to `live` means a service that has
        // stopped -- including one that exited 0 -- is reported as running, and then `verified` counts it as
        // healthy, and then the controller tells a tenant their platform is up. Nothing running is `stopped`,
        // whatever the last deployment's outcome was.
        status: (() => {
          const mapped = STATUS_MAP[deployment?.status ?? ''] ?? 'pending';
          const active = node.activeDeployments as Array<{ status?: string }> | undefined;
          // Absence of the field is not evidence of absence of the process: a query that does not select
          // `activeDeployments` must not turn every healthy service into `stopped`. That is the mistake this
          // change made first -- applyPlan's other query lacked the field, so a serving control plane was
          // reported stopped while it answered 200 on /healthz. The downgrade needs positive evidence.
          const running = active === undefined ? true : active.some((a) => a.status === 'SUCCESS');
          return mapped === 'live' && !running ? 'stopped' : mapped;
        })(),
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
        out.push({ name: service.name, environment: environment.name, externalId: info.instanceId, status: info.status, ...(info.rawStatus === undefined ? {} : { rawStatus: info.rawStatus }), image: info.image, numReplicas: info.numReplicas });
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
   * config is fetched, renamed to the name THIS environment resolved to, and sent back. Provisioning is
   * asynchronous (operationId/workflowId), so success is observed by reading the deployment back, not by the
   * mutation returning. A database that does not reach SUCCESS fails the apply: a service reported healthy
   * without its database is the worst outcome this contract can produce.
   *
   * The name matters more than it looks: this is the service whose DSN ends up inside every referencing
   * service, and a database shared between two environments is two environments writing one dataset.
   */
  private async provisionDatabase(projectId: string, environmentId: string, envName: string, database: { name: string; kind: string }, environment: { name: string; services: ServicePlan[]; databases: { name: string; kind: string }[] }, physical: Map<string, string>, token: RailwayCredential, serviceIds: Map<string, string>, failures: ApplyResult['failures'], notes: NonNullable<ApplyResult['notes']>, projectServices: ServiceNode[], placed: Map<string, InstanceInfo>, workspaceCredential: RailwayCredential): Promise<void> {
    const step = `databases.${database.name}@${envName}`;
    // The name Railway will show on this database, and the name every reference expression has to spell (D57).
    const databaseName = physical.get(database.name) ?? database.name;
    const templateCode = this.databaseTemplates[database.kind];
    if (!templateCode) {
      failures.push({ step, code: 'unknown-database-kind', message: `${database.kind} has no template code configured on this provider` });
      return;
    }

    // The lookup is by the name the deterministic rule produces, so a legacy database row -- `main`, from the
    // era before the suffix -- is NOT found here and is handled next, before any create. Order matters: a
    // rename changes the name the reference expressions have to spell, so it happens first and `wireReferences`
    // at the end of this method writes the new spelling.
    const workspaceForLookup = await this.credentials.workspace();
    let existing = (await this.listServices(projectId, workspaceForLookup)).find((s) => s.name === databaseName);
    let renamedFrom: string | undefined;
    if (!existing) {
      const legacy = await this.renameLegacyRow(projectId, environmentId, envName, database.name, databaseName, projectServices, placed, workspaceCredential, notes, failures, 'database');
      if (legacy.blocked) return;
      if (legacy.row) {
        renamedFrom = legacy.row.name;
        // Renaming a database is exactly the case that justifies renaming instead of replacing: the volume and
        // the data on it belong to the service, so they follow it. Say so, because the operator otherwise has
        // no way to tell this from the delete path the rule replaced.
        notes.push({
          step,
          code: 'legacy-database-renamed',
          message: `the ${database.kind} "${legacy.row.name}" (service ${legacy.row.id}) was renamed to "${databaseName}" instead of being deleted: its volume and all the data on it were NOT destroyed, its environment instances survived, and nothing about this operation touches a record. The reference expressions for this database are rewritten to the new spelling in this same apply (D57)`,
        });
        existing = { id: legacy.row.id, name: databaseName };
      }
    }
    if (existing) {
      const placedRow = await this.instanceStatus(projectId, environmentId, existing.id, token);
      if (placedRow) {
        serviceIds.set(`${envName}/${database.name}`, existing.id);
        if (placedRow.status !== 'live') {
          // A service that is placed but has never been deployed has `rawStatus: null` -- measured on the
          // duplicated staging environment this replaced, where the instance arrived with no deployment at all and
          // sat at PENDING while the provider waited for one that would never start. Per-environment provisioning
          // creates the database in its own environment and deploys it there, so this branch is now the re-apply
          // case (an interrupted apply, a deploy refused by the ceiling); the read still tells the two apart, so
          // the provider starts what the environment has never run. Budget and idempotency still apply.
          const started = placedRow.rawStatus == null ? await this.deploy(existing.id, environmentId, token, failures) : true;
          if (started) {
            const outcome = await this.awaitDeployment(projectId, environmentId, existing.id, token, failures, notes);
            if (outcome.status !== 'live') {
              failures.push({ step, code: 'database-not-deployed', message: `${database.kind} reached ${outcome.status} instead of live` });
            }
          }
        }
        await this.wireReferences(projectId, environmentId, database, databaseName, envName, environment, serviceIds, token, failures, notes, step, renamedFrom);
        return;
      }

      // Nothing runs here. Same fork as an ordinary service: a row that runs NOTHING anywhere is the residue of
      // an interrupted apply and is reclaimed so this environment can finally be provisioned, and a row that runs
      // in another environment is that environment's database -- deleting it would be the destructive reading of
      // "resume", so it is reported instead.
      if (await this.reclaimUnplacedService(projectId, environmentId, existing, workspaceForLookup)) {
        notes.push({
          step,
          code: 'database-row-reclaimed',
          message: `the ${database.kind} row "${databaseName}" had no instance in any environment, so it was deleted and this environment is being provisioned its own. Measured: serviceDelete leaves volumes intact -- any disk that database had is NOT attached to the new one, and its data is unreachable until someone re-attaches it (D57)`,
        });
      } else {
        failures.push({
          step,
          code: 'database-instance-missing-in-environment',
          message: `the ${database.kind} service "${databaseName}" exists in this project but has no instance in "${envName}", and it is running in another environment -- deleting it would destroy THAT environment's database, which is not this plan's to do. Delete the service that is not deployed in "${envName}", or give this environment a different name (D57)`,
        });
        return;
      }
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
      // The composed name is the PHYSICAL one, and this is the line that decides whether the environment gets
      // its own database: naming it after the plan alone would put production's service name here, the lookup
      // above would find production's already-created service, and staging would spend its life writing to a
      // dataset it does not own (D57, measured as `connect ETIMEDOUT` on the duplicated environment).
      const composedConfig = { ...config, services: { [key]: { ...services[key]!, name: databaseName } } };

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
        const candidates = listed.filter((s) => s.name === databaseName || (s.name ?? '').toLowerCase().includes(database.kind));
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
      await this.wireReferences(projectId, environmentId, database, databaseName, envName, environment, serviceIds, token, failures, notes, step);
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
   *
   * `databaseName` is the physical service name this environment resolved to, and the expression has to spell
   * THAT, not the plan's logical name: `${{app-db.DATABASE_URL}}` written into staging points at production's
   * database by name, which is the same leak the duplicated environment had, arrived at by a different route
   * (D57).
   */
  private async wireReferences(projectId: string, environmentId: string, database: { name: string; kind: string }, databaseName: string, envName: string, environment: { name: string; services: ServicePlan[] }, serviceIds: Map<string, string>, credential: RailwayCredential, failures: ApplyResult['failures'], notes: NonNullable<ApplyResult['notes']>, stepLabel: string, renamedFrom?: string): Promise<void> {
    const rewritten: { service: string; variable: string; expression: string }[] = [];
    for (const service of environment.services) {
      for (const reference of service.references ?? []) {
        if (reference.database !== database.name) continue;
        const target = serviceIds.get(`${envName}/${service.name}`);
        if (!target) continue;
        const output = reference.output ?? 'DATABASE_URL';
        // #198: the reference mechanism was never the limitation -- `output` already selects which variable on
        // the database service to point at, so a JDBC-style DSN is writable as components today. What was
        // missing is *trust*: nothing checked that the name exists, so a typo would write a reference that
        // resolves to nothing and the service would fail at boot with a message about an unresolvable host.
        // Existence is checked against the provider's own config read, which returns names with values
        // redacted -- the same measured property that keeps secrets out of our memory (see ensureSecrets).
        const sourceId = serviceIds.get(`${envName}/${database.name}`);
        const available = sourceId ? await this.configVariableNames(projectId, environmentId, sourceId) : [];
        if (sourceId && available.length > 0 && !available.includes(output)) {
          failures.push({
            step: `references.${service.name}.${reference.variable}`,
            code: 'reference-output-missing',
            message: `database "${database.name}" (service "${databaseName}") exposes no variable named "${output}"; available: ${[...new Set(available)].sort().slice(0, 12).join(', ')} (names only -- values are redacted by the provider)`,
          });
          continue;
        }
        if (!sourceId || available.length === 0) {
          notes.push({
            step: `references.${service.name}.${reference.variable}`,
            code: 'reference-output-unverified',
            message: `the database service's variable list could not be read, so "${output}" was written without checking it exists`,
          });
        }
        const expression = '$' + `{{${databaseName}.${output}}}`;
        await this.upsertVariable(projectId, environmentId, target, reference.variable, expression, credential);
        rewritten.push({ service: service.name, variable: reference.variable, expression });
      }
    }

    // A reference expression is only as good as the state of its target AT THE MOMENT IT IS WRITTEN.
    // Measured, and this is the load-bearing fact for a rename: Railway expands `${{Service.VAR}}` server-side
    // at store time, not at deploy time (docs/research/railway-token-and-sealing-2026-11-08.md:566-571 -- the
    // read-back returned a fully resolved connection string including the password; restated at
    // railway-provider's own wireReferences comment). Two consequences, both of which the rename path has to
    // survive:
    //
    //  1. Renaming a database does NOT retro-fix the values already expanded into every service that reads it.
    //     The rewrite below is not cosmetic -- re-writing the expression is the only thing that re-expands the
    //     value. So the order in this method is fixed: rename first (in `provisionDatabase`, before this call),
    //     rewrite second. A test asserts that ordering literally, because reasoning about it is how the last
    //     three bugs in this area were shipped.
    //  2. It also explains #242's staging symptom, which was misdiagnosed as a boot-order race. Writing
    //     `${{main-staging.DATABASE_URL}}` while `main-staging` was still provisioning expanded to NOTHING at
    //     write time and stored the empty result. The variable was written and empty, which is why the name was
    //     present, why `verified` was true, and why a redeploy fixed it. Presence of a name is not evidence that
    //     its value resolved -- D55 again, in a place nobody was looking.
    //
    // The running containers therefore still hold the OLD expanded value until they are deployed again, and
    // this apply does not redeploy them: `applyPlan` deploys each service once, before the database loop that
    // rewrites these expressions, and forcing a second deploy per referencing service would spend the tenant's
    // finite daily deploy ceiling a second time for a mutation this method cannot verify. So the remaining
    // step is named here, per service, and never left silent.
    if (renamedFrom !== undefined && rewritten.length > 0) {
      const spelled = rewritten.map((r) => `${r.service}.${r.variable} <- ${r.expression}`).join('; ');
      const targets = rewritten.map((r) => r.service).join(', ');
      notes.push({
        step: stepLabel,
        code: 'legacy-reference-redeploy-required',
        message: `"${databaseName}" was renamed from "${renamedFrom}", so ${String(rewritten.length)} reference expression(s) were rewritten to the new spelling: ${spelled}. Railway expands a reference at WRITE TIME, so the rewrite is stored but the RUNNING containers still hold the value expanded from the old name. Redeploy each referencing service in "${envName}" before trusting any request that touches this database: ${targets}. Per service: npx tsx scripts/platform-deploy.ts --redeploy=<service> --environment=${envName} --apply. A database request that still works right now is reading the OLD expanded value -- it is not proof the rename is complete (D57, #242)`,
      });
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
    // Reuse before create, matched on the MOUNT, not the declared name. Measured on the live API: Railway
    // names volumes itself, as `<service>-volume` -- `state-cache` never appears anywhere -- so a plan's
    // `name` is a label for the tenant and not an identity. Matching on it looked correct, passed review, and
    // could never fire: the provider would have created a second disk beside the survivor in exactly the
    // hibernate case this exists to support.
    const instances = await this.volumeInstances(projectId, environmentId, credential);
    const survivor = instances.find((i) => i.mountPath === volume.mountPath);
    if (survivor) {
      if (survivor.serviceId === serviceId) return;
      try {
        await this.transport.graphql({
          operation: 'volumeInstanceUpdate',
          credential,
          query: 'mutation ($environmentId: String!, $volumeId: String!, $input: VolumeInstanceUpdateInput!) { volumeInstanceUpdate(environmentId: $environmentId, volumeId: $volumeId, input: $input) }',
          variables: { environmentId, volumeId: survivor.volumeId, input: { serviceId, mountPath: volume.mountPath } },
        });
        notes.push({ step, code: 'volume-reused', message: `volume at ${volume.mountPath} already existed (${survivor.volumeName}); re-attached to "${volume.service}" instead of creating a second disk -- the state from its previous service is intact` });
      } catch (error) {
        failures.push({ step, code: 'volume-reattach-failed', message: `existing volume at ${volume.mountPath} could not be attached to "${volume.service}": ${(error as Error).message.slice(0, 160)}` });
      }
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
    private async deleteServiceWithRetry(_projectId: string, environment: EnvironmentNode, service: ServiceNode, credential: RailwayCredential): Promise<void> {
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

  /**
   * The per-environment attachments. `Volume` carries no service and no mount path -- that lives on
   * `VolumeInstance`, per environment -- which is both why a volume can outlive its service and why the mount
   * is the only stable identity a plan can match on. An unreadable answer is empty rather than an error: a
   * volume is created in that case, and the duplicate it might have caused is reported by the read-back below.
   */
  private async volumeInstances(_projectId: string, environmentId: string, credential: RailwayCredential): Promise<{ volumeId: string; volumeName: string; serviceId: string; mountPath: string }[]> {
    const data = await this.transport.graphql<{ environment: { volumeInstances?: { edges: { node: { serviceId?: string | null; mountPath?: string | null; volumeId?: string | null; volume?: { name?: string | null } | null } }[] } | null } | null }>({
      operation: 'environment.volumeInstances',
      credential,
      query: 'query ($environmentId: String!) { environment(id: $environmentId) { volumeInstances(first: 50) { edges { node { serviceId mountPath volumeId volume { name } } } } } }',
      variables: { environmentId },
    }).catch(() => null);
    return (data?.environment?.volumeInstances?.edges ?? [])
      .map((e) => e.node)
      .filter((n): n is { serviceId: string; mountPath: string; volumeId: string; volume?: { name?: string | null } | null } => Boolean(n.serviceId && n.mountPath && n.volumeId))
      .map((n) => ({ volumeId: n.volumeId, volumeName: n.volume?.name ?? n.volumeId, serviceId: n.serviceId, mountPath: n.mountPath }));
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

  /**
   * Does the provider's actual state contain everything the plan declares?
   *
   * Deliberately three nested questions rather than one "are the services healthy" sweep, because the failure
   * this exists to catch is absence, not illness: a missing environment, a service that exists in the project
   * but was never placed in this environment, and a service placed with no domain bound are all invisible to a
   * liveness check over the services that happen to be there.
   */
  private async coverageOf(
    projectId: string,
    environments: { name: string; services: { name: string }[]; databases?: { name: string }[]; domains?: { host: string; service: string }[] }[],
    workspaceCredential: RailwayCredential,
  ): Promise<{ covered: boolean; missing: string[] }> {
    const missing: string[] = [];
    const listed = await this.environments(projectId, workspaceCredential);
    const projectServices = await this.listServices(projectId, workspaceCredential);
    for (const environment of environments) {
      const env = listed.find((e) => e.name === environment.name);
      if (!env) { missing.push(`environment "${environment.name}"`); continue; }
      const token = await this.credentials.forEnvironment(projectId, env.name);
      const placed = await this.environmentInstances(projectId, env.id, token);
      // Coverage asks the question with the SAME rule the apply uses, and the rule is now a computation: what
      // this environment must hold is `{name}-{environment}`, full stop. Answering it by bare name was the D55
      // mistake generalised -- a service that exists somewhere in the project is not a service that exists in
      // THIS environment -- and under per-environment provisioning the two differ for every environment, so a
      // name-only check would certify a plan whose staging was never built.
      const physical = physicalNames(
        environment.name,
        [...environment.services.map((s) => s.name), ...(environment.databases ?? []).map((d) => d.name)],
      );
      for (const kind of ['service', 'database'] as const) {
        const declared = kind === 'service' ? environment.services : environment.databases ?? [];
        for (const resource of declared) {
          const name = physical.get(resource.name) ?? resource.name;
          const known = projectServices.find((s) => s.name === name);
          if (!known) missing.push(`${kind} "${name}" (project level) for "${environment.name}"`);
          else if (!placed.has(known.id)) missing.push(`${kind} "${name}" is not placed in "${environment.name}"`);
        }
      }
      for (const domain of environment.domains ?? []) {
        // Two kinds of host, and they are not checked the same way. A custom domain is OUR assertion: the exact
        // hostname must be bound in this environment. A `*.up.railway.app` host is provider-ASSIGNED -- Railway
        // names generated domains itself, so demanding the literal would report a correctly applied plan as
        // unfinished forever, which is precisely the false positive that makes a check get ignored. What the plan
        // actually asserts for a generated host is that the service has traffic in this environment.
        const assigned = /\.up\.railway\.app$/.test(domain.host);
        if (assigned) {
          const target = projectServices.find((s) => s.name === (physical.get(domain.service) ?? domain.service));
          const info = target ? placed.get(target.id) : undefined;
          if (!info || (info.domainHosts ?? []).length === 0) missing.push(`no domain bound to "${domain.service}" in "${environment.name}" (plan asserted the generated host "${domain.host}")`);
          continue;
        }
        const bound = [...placed.values()].some((info) => (info.domainHosts ?? []).includes(domain.host));
        if (!bound) missing.push(`domain "${domain.host}" in "${environment.name}"`);
      }
    }
    return { covered: missing.length === 0, missing };
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
