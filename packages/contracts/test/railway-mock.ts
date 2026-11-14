import type { ApplyResult, InfraPlan, StateSnapshot } from '../src/index.ts';
import { RAILWAY_ENDPOINT, type RailwayCredential, type RailwayCredentialSource, type RailwayTransport } from '../src/railway-transport.ts';

/**
 * A Railway mock that keeps the *annoying* behaviour the real API was measured with, because a permissive
 * fake would validate nothing:
 *
 * - `serviceCreate` / `variableUpsert` / `serviceInstanceDeploy` / instance reads require an
 *   **environment-scoped** credential; a workspace credential gets `Not Authorized` (measured).
 * - `serviceCreate` and `templateDeployV2` REFUSE a service name the project already holds
 *   (`A service named "api" already exists in this project`, measured against the live API): service names are
 *   unique per project, not per environment, and no mutation places an existing service into a further
 *   environment. That is the fact the provider's per-environment naming rule is built on (D57), and a double
 *   that let the call through would let a provider share one service -- one database -- across environments.
 * - `serviceDelete` / `projectDelete` / token minting require the **workspace** credential.
 * - `variables()` — the one query that returns secret values — throws here, so any provider that tries to
 *   read values through it fails loudly in CI instead of leaking quietly in production.
 * - Deployment status moves DEPLOYING → SUCCESS over polls, and deploys are counted so budget guards can
 *   be tested against a real ceiling.
 */
export interface MockOptions {
  /** When false, no variable exists for the plan's preserve-references, so they must be reported. */
  secretsPresent?: boolean;
  /** Polls before a deployment settles; lets the timeout path be tested. */
  settleAfter?: number;
  /** Status a deployment settles at. */
  outcome?: 'SUCCESS' | 'FAILED' | 'CRASHED';
  /** Buckets that exist when the project is deleted, to prove orphan reporting is honest. */
  buckets?: string[];
  /** Reads before a template-deployed service becomes visible -- models asynchronous provisioning (#77). */
  templateRevealAfter?: number;
  /** A template deploy accepted but whose service never surfaces -- the stuck-provisioning case. */
  templateNeverReveals?: boolean;
  /** Report a successful deployment with nothing running behind it: the exit-0 case measured on our own
   *  stack on 2026-11-12, where Railway called a stopped Keycloak "completed". */
  completedOnly?: boolean;
  /** Refuse serviceDelete for template-created services, modelling #80's survivor. */
  refuseTemplateServiceDelete?: boolean;
  /**
   * Make `serviceUpdate` answer with the OLD name and change nothing. Not invented: it is the measured shape of
   * this API's silent no-op (`serviceInstanceUpdate` on an environment with no instance returns `true` and places
   * nothing, E25), and a rename is only safe if the provider checks the name back rather than trusting the call.
   */
  renameDoesNothing?: boolean;
  /** Model a partial delete: projectDelete answers true but the project remains readable (#111). */
  keepProjectAfterDelete?: boolean;
  /** Fail the first N serviceDelete calls for template services, to test the retry. */
  templateDeleteFailures?: number;
}

interface MockService { id: string; projectId: string; name: string }
/**
 * The variables a Railway Postgres template actually creates, read from `environment.config` on the live
 * service provisioned for platfolio's own deployment (2026-11-12). Values are redacted by the API -- names are
 * all that is available, and all that a name-existence check needs.
 *
 * The double carries them because #198 added that check: a mock with an empty variable set would either refuse
 * every wiring or verify nothing, and the point is that a typo surfaces as `reference-output-missing` rather
 * than as a service that cannot find its database.
 */
export const TEMPLATE_DATABASE_VARIABLES = [
  'DATABASE_URL', 'DATABASE_PUBLIC_URL', 'PGDATA', 'PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGUSER',
  'POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_USER', 'RAILWAY_DEPLOYMENT_DRAINING_SECONDS',
  'RUNTIME_LOCK_WAIT_SECONDS', 'SSL_CA_CERT_DAYS', 'SSL_CERT_DAYS', 'SSL_REQUIRE',
] as const;

interface MockInstance { instanceId: string; limits?: { cpu: number; memoryMB: number }; settledDomains?: boolean | undefined; verifiedDomains?: boolean | undefined; status: string | null; image: string; numReplicas: number; domains: string[]; polls: number; variables: Set<string> }

export class RailwayMock implements RailwayTransport, RailwayCredentialSource {
  readonly endpoint = RAILWAY_ENDPOINT;
  readonly projects = new Map<string, { id: string; name: string; description: string; workspaceId: string }>();
  readonly environments = new Map<string, { id: string; projectId: string; name: string }>();
  readonly services = new Map<string, MockService>();
  readonly instances = new Map<string, MockInstance>();
  /**
   * Environment-scoped variables, keyed `${environmentId}:${name}` -- what Railway calls a shared variable.
   * Kept separate from service variables on purpose: the provider must write the value HERE and then attach it,
   * and a double that merged the two would let a one-call implementation pass every assertion while leaving a
   * credential the declaring service cannot read.
   */
  readonly sharedVariables = new Map<string, string>();
  /** Which services see each environment-scoped variable: `${environmentId}:${name}` -> serviceIds. */
  readonly sharedAttachments = new Map<string, Set<string>>();
  readonly tokens = new Map<string, { id: string; projectId: string; environmentId: string; name: string }>;
  readonly buckets = new Map<string, string>();
  readonly certRetries: string[] = [];
  /** Hosts the availability check refuses, so a test can prove the create is never attempted. */
  readonly takenDomains = new Set<string>();
  readonly domainCreates: string[] = [];
  /** Template deploys recorded so tests can assert the composed name and the grant used. */
  volumes: { id: string; projectId: string; name: string; serviceId: string; environmentId: string; mountPath: string }[] = [];
  /** How many template-created services are still hidden (diagnostics for tests). */
  hiddenServiceCount(): number { return this.hiddenServices.size; }
  /** Services hidden until read N times, so single-shot lookups fail as they do live (#77). */
  private readonly hiddenServices = new Map<string, number>();
  readonly templateServiceIds = new Set<string>();
  private templateDeleteAttempts = new Map<string, number>();
  readonly templateDeploys: { templateId: string; serviceName: string; credentialKind: string }[] = [];
  /**
   * Every successful `serviceUpdate` that changed a name, in order. The legacy-shape path is a rename rather
   * than a recreate, so what a test has to see is WHICH row moved from WHICH name to WHICH name: the final
   * name set alone cannot distinguish "the row holding production's data was renamed" from "that row was
   * deleted and a fresh one created under the same name", and those are opposite claims about data.
   *
   * `at` is the position in `operations` when the rename landed. Reference expressions are expanded by the
   * provider AT WRITE TIME (measured: docs/research/railway-token-and-sealing-2026-11-08.md), so "the rename
   * happened before the reference was written" is the property that decides whether the rewritten value points
   * at the service that now exists. Ordering is the whole claim, so it is recorded rather than inferred from
   * two separately ordered arrays.
   */
  readonly renames: { id: string; from: string; to: string; at: number }[] = [];
  /**
   * Every `environmentCreate` input, in order. A test asserts against this that platfolio never creates an
   * environment from a source (D57) -- the double still implements the source, because the real API does, and
   * recording the call is how "we stopped doing that" stays checked instead of merely unfashionable.
   */
  readonly environmentCreates: { name: string; sourceEnvironmentId?: string }[] = [];

  deploys = 0;
  readonly operations: string[] = [];
  /**
   * Every variable write, with WHERE it landed. A reference expression like `${{app-db.DATABASE_URL}}` is only
   * proof of isolation when you know which service in which environment received it, and a flat name/value log
   * could not say (D57). Values are the ones the test itself wrote -- this double holds no real credentials.
   */
  /**
   * `at` is the position in `operations` when the write landed. A rename only fixes a reference expression if
   * the rewrite happens AFTER it -- Railway expands the expression at write time -- so ordering between a
   * `serviceUpdate` and a `variableUpsert` is an assertion a test has to be able to make, not a property it
   * has to infer from two separately ordered arrays.
   */
  readonly writtenVariables: { name: string; value: string; environmentId: string; serviceId?: string; at: number }[] = [];
  readonly denied: string[] = [];
  private sequence = 0;

  private readonly workspaceToken = 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA';
  private readonly projectToken = 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB';
  private readonly options: Required<Pick<MockOptions, 'secretsPresent' | 'settleAfter' | 'outcome' | 'completedOnly'>> & MockOptions;

  constructor(options: MockOptions = {}) {
    // Every option has to be listed here: the normalization below silently drops unknown keys, which is how
    // templateNeverReveals looked "ignored" -- the guard was correct and never received the flag. A double
    // that drops its own configuration is the same failure class as a stub that passes vacuously.
    this.options = {
      completedOnly: options.completedOnly ?? false,
      templateRevealAfter: options.templateRevealAfter ?? 2,
      templateNeverReveals: options.templateNeverReveals ?? false,
      refuseTemplateServiceDelete: options.refuseTemplateServiceDelete ?? false,
      renameDoesNothing: options.renameDoesNothing ?? false,
      // Not a whitelist entry: the constructor rebuilds options, and a flag left out here is silently
      // undefined -- the exact bug that once made a test vacuous. Any new option must be threaded through.
      keepProjectAfterDelete: options.keepProjectAfterDelete ?? false,
      templateDeleteFailures: options.templateDeleteFailures ?? 0,
      secretsPresent: options.secretsPresent ?? true,
      settleAfter: options.settleAfter ?? 1,
      outcome: options.outcome ?? 'SUCCESS',
      ...(options.buckets ? { buckets: options.buckets } : {}),
    };
  }

  // --- credential source ---------------------------------------------------------------------

  async workspace(): Promise<RailwayCredential> {
    return { kind: 'workspace', token: this.workspaceToken };
  }

  async forEnvironment(projectId: string, environment: string): Promise<RailwayCredential> {
    // Mint lazily, exactly like the broker-backed implementation would.
    const environmentId = this.findEnvironmentId(projectId, environment);
    const name = `platfolio-managed-${environment}`;
    if (!environmentId) throw new Error(`no environment "${environment}" in project "${projectId}"`);
    const existing = [...this.tokens.values()].find((t) => t.projectId === projectId && t.environmentId === environmentId && t.name === name);
    if (!existing) {
      this.tokens.set(`tok-${this.sequence}`, { id: `tok-${this.sequence}`, projectId, environmentId, name });
      this.sequence += 1;
    }
    return { kind: 'project', token: this.projectToken };
  }

  // --- transport -----------------------------------------------------------------------------

  async graphql<T>(args: { query: string; variables?: Record<string, unknown>; credential: RailwayCredential; operation: string }): Promise<T> {
    const { operation, credential } = args;
    this.operations.push(`${operation}:${credential.kind}`);
    const v = args.variables ?? {};

    // The measured authorization split. Getting this wrong is how a provider "works" against a fake and
    // fails on the first real call.
    const needsProject = ['serviceCreate', 'serviceInstanceUpdate', 'serviceInstanceLimitsUpdate', 'variableUpsert', 'serviceInstanceDeploy', 'environment.serviceInstances', 'environment.config', 'serviceDomainCreate', 'customDomainCreate', 'customDomainIssueCertificate', 'sharedVariableConfigure'];
    const needsWorkspace = ['projects', 'project', 'projectCreate', 'projectUpdate', 'projectDelete', 'project.environments', 'environmentCreate', 'project.services', 'projectTokenCreate', 'projectTokens', 'projectTokenDelete', 'serviceDelete', 'project.buckets', 'bucketCreate', 'project.bucketsList'];
    if (needsProject.includes(operation) && credential.kind !== 'project') {
      this.denied.push(operation);
      throw new Error(`railway ${operation}: Not Authorized [INTERNAL_SERVER_ERROR]`);
    }
    if (needsWorkspace.includes(operation) && credential.kind !== 'workspace') {
      this.denied.push(operation);
      throw new Error(`railway ${operation}: Not Authorized [INTERNAL_SERVER_ERROR]`);
    }
    /**
     * The real API rejects unknown input fields at validation, which is how E25 caught `isPrivate` in
     * `environmentCreate` -- a field invented confidently enough to pass every test the mock was asked to
     * answer. These allowlists come from live introspection; extend them deliberately, never by deleting.
     */
    const inputFields: Record<string, string[]> = {
      projectCreate: ['name', 'workspaceId', 'isPublic', 'description', 'defaultEnvironmentName', 'prDeploys', 'isMonorepo', 'repo', 'runtime'],
      projectUpdate: ['name', 'description', 'isPublic', 'baseEnvironmentId', 'prDeploys', 'botPrEnvironments', 'focusedPrEnvironments'],
      environmentCreate: ['projectId', 'name', 'sourceEnvironmentId', 'skipInitialDeploys', 'applyChangesInBackground', 'ephemeral', 'stageInitialChanges'],
      projectTokenCreate: ['projectId', 'environmentId', 'name'],
      serviceCreate: ['projectId', 'environmentId', 'name', 'source', 'templateId', 'templateServiceId', 'variables', 'branch', 'icon', 'registryCredentials'],
      // Captured from the introspected schema, not guessed: `Mutation.serviceUpdate(id: String!, input:
      // ServiceUpdateInput!)` returns `Service!`, and `ServiceUpdateInput` has exactly two fields -- `icon` and
      // `name`. That is why a rename is a SERVICE-level operation: `ServiceInstanceUpdateInput` carries no
      // `name` at all, and `ServiceInstance` has `serviceId`/`serviceName` but no name of its own.
      serviceUpdate: ['icon', 'name'],
      serviceInstanceUpdate: ['numReplicas', 'healthcheckPath', 'healthcheckTimeout', 'source', 'startCommand', 'buildCommand', 'preDeployCommand', 'region', 'restartPolicyType', 'sleepApplication', 'watchPatterns', 'cronSchedule', 'dockerfilePath', 'buildpacks', 'nixpacksPlan'],
      variableUpsert: ['projectId', 'environmentId', 'serviceId', 'name', 'value', 'skipDeploys'],
      // Captured from `SharedVariableConfigureInput`: there is NO value field here, only which services the
      // already-written environment-scoped variable is enabled or disabled for. Any provider that treats this
      // call as the write is wrong, and the double refuses it rather than quietly agreeing.
      sharedVariableConfigure: ['projectId', 'environmentId', 'name', 'enabledServiceIds', 'disabledServiceIds'],
      serviceDomainCreate: ['environmentId', 'serviceId', 'targetPort'],
      customDomainCreate: ['projectId', 'environmentId', 'serviceId', 'domain', 'targetPort'],
      serviceInstanceLimitsUpdate: ['environmentId', 'serviceId', 'memoryGB', 'vCPUs'],
    };
    /**
     * Which input fields the API REQUIRES, per operation. Captured from live introspection: every field of
     * `SharedVariableConfigureInput` is NON_NULL, including BOTH `enabledServiceIds` and `disabledServiceIds` --
     * so an attachment call that omits the empty second list is not a shorthand, it is an invalid mutation.
     *
     * This map exists because the allowlist above can only reject names that ARE present. It happily accepted
     * the omission my provider code shipped, and the live API answered `Variable "$input" got invalid value`:
     * a double that agrees with a wrong assumption is worse than no double, because it converts a bug into
     * evidence. Requiredness is the other half of a schema, and I had only modelled half of it.
     */
    const requiredFields: Record<string, string[]> = {
      sharedVariableConfigure: ['projectId', 'environmentId', 'name', 'enabledServiceIds', 'disabledServiceIds'],
      // From the same captured introspection: `EnvironmentCreateInput` requires projectId and name and NOTHING
      // else -- `sourceEnvironmentId` is optional, which is the schema's own answer to the claim that a second
      // environment has to be made from a first one (D57). A provider that stops passing a source must still be
      // able to create the environment.
      environmentCreate: ['projectId', 'name'],
    };

    const inputKey = ['projectCreate', 'projectUpdate', 'environmentCreate', 'projectTokenCreate', 'serviceCreate', 'serviceUpdate', 'serviceInstanceUpdate', 'variableUpsert', 'serviceDomainCreate', 'customDomainCreate', 'serviceInstanceLimitsUpdate', 'sharedVariableConfigure'].includes(operation) ? 'input' : null;
    if (inputKey) {
      const allowed = inputFields[operation];
      const payload = (v[inputKey] ?? {}) as Record<string, unknown>;
      const unknown = allowed ? Object.keys(payload).filter((k) => !allowed.includes(k)) : [];
      if (unknown.length) throw new Error(`railway ${operation}: Field ${JSON.stringify(unknown[0])} is not defined by ${operation} input (the real API rejects this)`);
      // Requiredness, for operations whose captured input is all-NON_NULL. The name allowlist above cannot
      // catch an omission, and an omission is what the live API threw on: my double validated my own
      // misreading rather than the provider, which is how a bug becomes evidence.
      const missing = (requiredFields[operation] ?? []).filter((k) => payload[k] === undefined);
      if (missing.length) {
        throw new Error(`railway ${operation}: Field ${JSON.stringify(missing[0])} of type String! is not defined. Expected a value (the real API rejects an absent NON_NULL input field)`);
      }
    }

    // Guard the class of bug E26 exposed: mutations returning an OBJECT are rejected by the real API
    // unless they select a subfield. The mock used to accept the query and never notice.
    const objectReturning = ['projectCreate', 'environmentCreate', 'serviceCreate', 'projectUpdate', 'serviceUpdate', 'serviceDomainCreate', 'customDomainCreate', 'sharedVariableConfigure'];
    // Match the *field's* own closing paren, not the mutation's variable list -- a first version used
    // `/\)\s*\{/`, which the outer `mutation (...) {` always satisfied, so the guard could not fail.
    const fieldSelection = new RegExp(`${operation}\\s*\\([^)]*\\)\\s*\\{`);
    if (objectReturning.includes(operation) && !fieldSelection.test(args.query)) {
      throw new Error(`railway ${operation}: Field must have a selection of subfields (the real API rejects this at validation)`);
    }

    if (operation === 'variables' || operation === 'variables.unrendered') {
      throw new Error('railway mock: variables() returns secret values and must never be called by a provider');
    }

    switch (operation) {
      case 'projects': {
        const workspaceId = v.workspaceId as string;
        const nodes = [...this.projects.values()].filter((p) => p.workspaceId === workspaceId)
          .map((p) => ({ id: p.id, name: p.name, description: p.description }));
        return { projects: { edges: nodes.map((node) => ({ node })) } } as T;
      }
      case 'project': {
        const found = [...this.projects.values()].find((p) => p.id === (v.id as string));
        return { project: found ? { id: found.id, name: found.name, description: found.description } : null } as T;
      }
      case 'projectCreate': {
        const input = v.input as { name: string; workspaceId: string; description?: string };
        if ([...this.projects.values()].some((p) => p.workspaceId === input.workspaceId && p.name === input.name)) {
          throw new Error('railway projectCreate: name already exists in workspace [BAD_USER_INPUT]');
        }
        const id = `proj-${this.sequence++}`;
        this.projects.set(id, { id, name: input.name, workspaceId: input.workspaceId, description: input.description ?? '' });
        const environmentId = `env-${this.sequence++}`;
        this.environments.set(environmentId, { id: environmentId, projectId: id, name: 'production' });
        return { projectCreate: { id } } as T;
      }
      case 'projectUpdate': {
        const project = this.projects.get(v.id as string);
        const input = v.input as { description?: string };
        if (project && input.description !== undefined) project.description = input.description;
        return { projectUpdate: true } as T;
      }
      case 'projectDelete': {
        // #111's orphan branch needs a partial delete to exist: a projectDelete that returns true while the
        // project stays readable. Without it, everything unremoved lands in releasedWithProject and the
        // provider could claim a clean teardown without the survivor case ever being exercised.
        if (!this.options.keepProjectAfterDelete) this.projects.delete(v.id as string);
        return { projectDelete: true } as T;
      }
      case 'project.environments': {
        if (!this.projects.has(v.projectId as string)) throw new Error(`railway project.environments: Project not found [INTERNAL_SERVER_ERROR]`);
        const projectId = v.projectId as string;
        const nodes = [...this.environments.values()].filter((e) => e.projectId === projectId).map((node) => ({ node }));
        return { project: { environments: { edges: nodes } } } as T;
      }
      case 'environmentCreate': {
        const input = v.input as { projectId: string; name: string; sourceEnvironmentId?: string };
        const id = `env-${this.sequence++}`;
        this.environments.set(id, { id, projectId: input.projectId, name: input.name });
        // Recorded so a test can hold the provider to the rule: platfolio never creates an environment from a
        // source, because the source's services -- including its database -- arrive with it (D57).
        this.environmentCreates.push({ name: input.name, ...(input.sourceEnvironmentId ? { sourceEnvironmentId: input.sourceEnvironmentId } : {}) });
        if (input.sourceEnvironmentId) {
          // Kept because the live API does this, not because platfolio asks for it. Measured on our own project
          // when staging was created from production: the duplicated environment's `api` and `main` carried the
          // SAME service ids as production's, and staging's api then timed out on a DSN that pointed at a
          // database it does not own. So the copy is faithful -- including the part that makes it dangerous:
          // the serviceId travels, only the instance is new.
          for (const [key, instance] of this.instances) {
            if (!key.startsWith(`${input.sourceEnvironmentId}:`)) continue;
            const cloneKey = `${id}:${key.split(':')[1]}`;
            // A duplicated environment gets its OWN instances -- reusing the source's id made readState
            // report two services with one externalId, which is the duplicate the conformance suite is
            // right to reject.
            this.instances.set(cloneKey, { ...instance, instanceId: `inst-${this.sequence++}`, variables: new Set(instance.variables), status: null, polls: 0 });
          }
        }
        return { environmentCreate: { id } } as T;
      }
      case 'project.volumes': {
        if (!this.projects.has(v.projectId as string)) throw new Error(`railway project.volumes: Project not found [INTERNAL_SERVER_ERROR]`);
        const projectId = v.projectId as string;
        return { project: { volumes: { edges: this.volumes.filter((x) => x.projectId === projectId).map((node) => ({ node })) } } } as T;
      }
      case 'volumeCreate': {
        const input = v.input as { projectId: string; environmentId: string; serviceId: string, mountPath: string };
        if (!this.services.has(input.serviceId)) throw new Error('railway volumeCreate: unknown service [NOT_FOUND]');
        if (!this.instances.has(`${input.environmentId}:${input.serviceId}`)) {
          // The captured schema makes `VolumeInstance.environmentId` NON_NULL: a volume instance belongs to one
          // environment's service. Attaching one where the service does not run is not a thing the API does, and
          // a double that allowed it would let a shared disk pass as per-environment storage (D57).
          throw new Error('railway volumeCreate: service has no instance in this environment [NOT_FOUND]');
        }
        const id = `vol-${String(this.sequence).padStart(4, '0')}`;
        this.sequence += 1;
        // Named like the real API, which derives `<service>-volume` and ignores whatever label the plan used.
        // The double used to invent `volume-<id>`, and that difference is what made a match-by-name provider
        // path look fine in CI and be dead code against production. With per-environment services the derived
        // name differs per environment too, which is the honest consequence of the naming rule.
        const owner = this.services.get(input.serviceId);
        const volumeName = `${owner?.name ?? 'orphan'}-volume`;
        this.volumes.push({ id, projectId: input.projectId, name: volumeName, serviceId: input.serviceId, environmentId: input.environmentId, mountPath: input.mountPath });
        return { volumeCreate: { id, name: volumeName } } as T;
      }
      case 'environment.volumeInstances': {
        // Scoped to the ENVIRONMENT, not to the project: `VolumeInstance.environmentId` is NON_NULL, so asking
        // what is mounted here must not answer with what is mounted somewhere else. The double used to filter
        // by project, which made production's surviving disk visible to staging's re-attach path.
        const environmentId = v.environmentId as string;
        return {
          environment: {
            volumeInstances: {
              edges: this.volumes.filter((x) => x.environmentId === environmentId).map((x) => ({
                node: { volumeId: x.id, serviceId: x.serviceId, mountPath: x.mountPath, volume: { name: x.name } },
              })),
            },
          },
        } as T;
      }
      case 'volumeInstanceUpdate': {
        const input = v.input as { serviceId: string; mountPath: string };
        const target = this.volumes.find((x) => x.id === v.volumeId);
        if (!target) throw new Error('railway volumeInstanceUpdate: no such volume [NOT_FOUND]');
        // Read-back must change what the next query reports, or this double cannot tell an applied re-attach
        // from the silent `true` that Railway itself returns for an unplaced instance.
        target.serviceId = input.serviceId;
        target.mountPath = input.mountPath;
        return { volumeInstanceUpdate: true } as T;
      }
      case 'volumeDelete': {
        const volumeId = v.volumeId as string;
        const volumesBefore = this.volumes.length;
        this.volumes = this.volumes.filter((x) => x.id !== volumeId);
        if (this.volumes.length === volumesBefore) throw new Error('railway volumeDelete: no such volume [NOT_FOUND]');
        return { volumeDelete: true } as T;
      }
      case 'project.services': {
        if (!this.projects.has(v.projectId as string)) throw new Error(`railway project.services: Project not found [INTERNAL_SERVER_ERROR]`);
        const projectId = v.projectId as string;
        // Async provisioning modelled honestly (#77): a template-created service is invisible until it has
        // been read a few times, so a provider that lists once, immediately, gets nothing and must wait.
        // Decrement is per read, so a very large counter is effectively "never" -- but the never-reveals
        // flag is absolute, because a counter that a fast poll loop could drain would make the stuck case
        // depend on machine speed, which is not a test anybody can trust.
        for (const [id, remaining] of [...this.hiddenServices]) {
          if (this.options.templateNeverReveals) continue;
          const left = remaining - 1;
          if (left <= 0) this.hiddenServices.delete(id);
          else this.hiddenServices.set(id, left);
        }
        const visible = [...this.services.values()].filter((s) => s.projectId === projectId && !this.hiddenServices.has(s.id));
        const nodes = visible.map((node) => ({ node: { id: node.id, name: node.name } }));
        return { project: { services: { edges: nodes } } } as T;
      }
      case 'serviceCreate': {
        const input = v.input as { projectId: string; environmentId: string; name: string; source: { image: string } };
        // Measured against the live API: a name the project already holds is REFUSED, whatever environment the
        // call names -- `A service named "api" already exists in this project`. The double used to accept the
        // call and hand back the existing service, which is how a provider could "place" a second environment's
        // api by pointing it at production's service and still pass every test. Names are the only thing that
        // keeps two environments' services apart (D57), so the double enforces the one fact that makes the rule
        // necessary.
        const clash = [...this.services.values()].find((s) => s.projectId === input.projectId && s.name === input.name);
        if (clash) throw new Error(`railway serviceCreate: A service named "${input.name}" already exists in this project [UNPROCESSABLE]`);
        const id = `svc-${this.sequence++}`;
        this.services.set(id, { id, projectId: input.projectId, name: input.name });
        this.instances.set(`${input.environmentId}:${id}`, {
          instanceId: `inst-${this.sequence++}`,
          status: null,
          image: input.source.image,
          numReplicas: 1,
          domains: [],
          polls: 0,
          variables: new Set(this.options.secretsPresent ? ['STRIPE_WEBHOOK_SECRET'] : []),
        });
        return { serviceCreate: { id } } as T;
      }
      case 'serviceUpdate': {
        const input = v.input as { name?: string; icon?: string };
        const service = this.services.get(v.id as string);
        if (!service) throw new Error('railway serviceUpdate: service not found [NOT_FOUND]');
        // The measured silent no-op, in this mutation's shape: the call answers, the object comes back, and the
        // name did not move. A provider that trusts the call rather than the answer provisions on top of a row
        // that never changed.
        if (this.options.renameDoesNothing) return { serviceUpdate: { id: service.id, name: service.name } } as T;
        if (input.name !== undefined && input.name !== service.name) {
          // DERIVED, not measured for this mutation: service names are unique per project (measured against
          // `serviceCreate` and `templateDeployV2`), and the uniqueness is a property of the project's service
          // set rather than of the call that changes it, so a rename onto a held name cannot be accepted. The
          // provider refuses before ever asking, so no test depends on this refusal -- it exists so that a
          // future change which DID rely on the API to arbitrate fails here instead of passing on an
          // assumption. Uniqueness on rename has not been observed on the live API and must not be quoted as
          // if it had.
          const clash = [...this.services.values()].find((s) => s.projectId === service.projectId && s.name === input.name);
          if (clash) throw new Error(`railway serviceUpdate: A service named "${input.name}" already exists in this project [UNPROCESSABLE]`);
          this.renames.push({ id: service.id, from: service.name, to: input.name, at: this.operations.length });
          service.name = input.name;
        }
        return { serviceUpdate: { id: service.id, name: service.name } } as T;
      }
      case 'serviceInstanceUpdate': {
        const key = `${v.environmentId}:${v.serviceId}`;
        const instance = this.instances.get(key);
        const input = v.input as { numReplicas?: number; source?: { image?: string }; healthcheckPath?: string };
        // Measured in E25: the real API returns true for an environment that has no instance and
        // creates nothing. A mock that threw NOT_FOUND hid exactly that, so it now reproduces the
        // silent no-op and the provider has to detect it on its own.
        if (!instance) return { serviceInstanceUpdate: true } as T;
        if (input.numReplicas !== undefined) instance.numReplicas = input.numReplicas;
        if (input.source?.image) instance.image = input.source.image;
        return { serviceInstanceUpdate: true } as T;
      }
      case 'serviceInstanceLimitsUpdate': {
        const lim = v.input as { environmentId: string; serviceId: string };
        const key = `${lim.environmentId}:${lim.serviceId}`;
        const instance = this.instances.get(key);
        if (!instance) throw new Error('railway serviceInstanceLimitsUpdate: no instance [NOT_FOUND]');
        const input = v.input as { memoryGB?: number; vCPUs?: number };
        instance.limits = { cpu: input.vCPUs ?? 0, memoryMB: Math.round((input.memoryGB ?? 0) * 1024) };
        return { serviceInstanceLimitsUpdate: true } as T;
      }
      case 'template': {
        // Keyed by CODE, the authorized read for public catalog entries (#75). The double accepted the
        // id only because I chose it, which is how a wrong lookup passed every offline test.
        const code = v.code as string;
        if (code !== 'postgresql') throw new Error('railway template: not found [NOT_FOUND]');
        return {
          template: {
            id: 'c27544e8-a7e7-450d-9314-bdaa25c734aa',
            serializedConfig: {
              services: {
                '36d08c1e-1bcb-4de6-a199-3749dc83dff3': {
                  name: 'Postgres',
                  source: { image: 'ghcr.io/ncontiero/postgres-ssl:18.6', type: 'image' },
                  variables: { POSTGRES_PASSWORD: { isSensitive: true, generateValue: true } },
                },
              },
            },
          },
        } as T;
      }
      case 'templateDeployV2': {
        // Measured: a workspace-grant operation that provisions asynchronously.
        if (credential.kind !== 'workspace') throw new Error('railway templateDeployV2: Bad Access [UNPROCESSABLE]');
        const input = v.input as { templateId: string; serializedConfig: { services: Record<string, { name?: string; source?: { image?: string }; variables?: Record<string, unknown> }> }; projectId: string; environmentId: string };
        const spec = Object.values(input.serializedConfig.services)[0]!;
        const name = spec.name ?? 'Postgres';
        this.templateDeploys.push({ templateId: input.templateId, serviceName: name, credentialKind: credential.kind });
        if (!this.projects.has(input.projectId)) throw new Error('railway templateDeployV2: project not found [NOT_FOUND]');
        // Same project-unique name rule as serviceCreate (measured), because a template deploy creates a service
        // too: a provider that asked for a second `app-db` would get a refusal live and a second database here.
        const clash = [...this.services.values()].find((s) => s.projectId === input.projectId && s.name === name);
        if (clash) throw new Error(`railway templateDeployV2: A service named "${name}" already exists in this project [UNPROCESSABLE]`);
        const serviceId = `svc-${this.sequence++}`;
        this.services.set(serviceId, { id: serviceId, name, projectId: input.projectId });
        // Measured: a template deploy provisions AND deploys on its own -- the instance came up
        // DEPLOYING and reached SUCCESS without any serviceInstanceDeploy call from us.
        this.instances.set(`${input.environmentId}:${serviceId}`, {
          instanceId: `inst-${this.sequence++}`,
          status: 'DEPLOYING',
          image: spec.source?.image ?? '',
          numReplicas: 1,
          domains: [],
          polls: 0,
          // The measured template variables are merged in (#198): reference outputs are checked against
          // what the provider can actually see, and an empty set here would make the check vacuous.
          variables: new Set([...Object.keys(spec.variables ?? {}), ...TEMPLATE_DATABASE_VARIABLES]),
        });
        this.templateServiceIds.add(serviceId);
        this.hiddenServices.set(serviceId, this.options.templateNeverReveals ? Number.MAX_SAFE_INTEGER : (this.options.templateRevealAfter ?? 2));
        return { templateDeployV2: { operationId: `op-${name}`, workflowId: `deployTemplate/${input.projectId}/mock` } } as T;
      }
      case 'customDomainAvailable': {
        const domain = v.domain as string;
        if (this.takenDomains.has(domain)) {
          return { customDomainAvailable: { available: false, message: `"${domain}" is already attached to another project` } } as T;
        }
        return { customDomainAvailable: { available: true, message: 'Available' } } as T;
      }
      case 'customDomainIssueCertificate': {
        const id = v.id as string;
        if (!id.startsWith('cdom-')) throw new Error('railway customDomainIssueCertificate: domain not found [NOT_FOUND]');
        this.certRetries.push(id);
        for (const instance of this.instances.values()) {
          if (instance.domains.some((d) => `cdom-${d}` === id)) { instance.verifiedDomains = true; instance.settledDomains = true; }
        }
        return { customDomainIssueCertificate: true } as T;
      }
      case 'variableUpsert': {
        const input = v.input as { environmentId: string; serviceId?: string; name: string; value: string };
        // Omitting serviceId is exactly how Railway distinguishes a shared variable from a service one.
        if (!input.serviceId) {
          if (!this.environments.has(input.environmentId)) throw new Error('railway variableUpsert: no environment [NOT_FOUND]');
          this.sharedVariables.set(`${input.environmentId}:${input.name}`, input.value);
          this.writtenVariables.push({ name: input.name, value: input.value, environmentId: input.environmentId, at: this.operations.length });
          return { variableUpsert: true } as T;
        }
        const instance = this.instances.get(`${input.environmentId}:${input.serviceId}`);
        if (!instance) throw new Error('railway variableUpsert: no instance [NOT_FOUND]');
        instance.variables.add(input.name);
        this.writtenVariables.push({ name: input.name, value: input.value, environmentId: input.environmentId, serviceId: input.serviceId, at: this.operations.length });
        return { variableUpsert: true } as T;
      }
      case 'sharedVariableConfigure': {
        const input = v.input as { environmentId: string; name: string; enabledServiceIds?: string[]; disabledServiceIds?: string[] };
        const key = `${input.environmentId}:${input.name}`;
        if (!this.sharedVariables.has(key)) {
          // The real API cannot attach a variable that was never written at this scope. Modelling the refusal is
          // what stops a provider calling configure alone and describing that as delivery.
          throw new Error(`railway sharedVariableConfigure: no shared variable "${input.name}" in this environment [NOT_FOUND]`);
        }
        const attached = this.sharedAttachments.get(key) ?? new Set<string>();
        for (const id of input.disabledServiceIds ?? []) attached.delete(id);
        for (const id of input.enabledServiceIds ?? []) attached.add(id);
        this.sharedAttachments.set(key, attached);
        return { sharedVariableConfigure: { id: `sv-${this.sequence++}` } } as T;
      }
      case 'environment.config': {
        const environmentId = v.environmentId as string;
        const services: Record<string, { variables: Record<string, { value: null }> }> = {};
        for (const [key, instance] of this.instances) {
          if (!key.startsWith(`${environmentId}:`)) continue;
          const serviceId = key.split(':')[1]!;
          // What the service actually sees: its own variables PLUS every environment-scoped variable attached to
          // it. Values stay redacted exactly as the real API does, and a shared variable that was written but
          // never attached is deliberately absent -- that is the failure a correct delivery has to avoid.
          const visible = new Set(instance.variables);
          for (const [sharedKey, attached] of this.sharedAttachments) {
            if (!sharedKey.startsWith(`${environmentId}:`)) continue;
            if (attached.has(serviceId)) visible.add(sharedKey.slice(environmentId.length + 1));
          }
          services[serviceId] = { variables: Object.fromEntries([...visible].map((name) => [name, { value: null }])) };
        }
        return { environment: { config: { services } } } as T;
      }
      case 'serviceInstanceDeploy': {
        const key = `${v.environmentId}:${v.serviceId}`;
        const instance = this.instances.get(key);
        if (!instance) throw new Error('railway serviceInstanceDeploy: no instance [NOT_FOUND]');
        this.deploys += 1;
        instance.polls = 0;
        instance.status = 'DEPLOYING';
        return { serviceInstanceDeploy: true } as T;
      }
      case 'environment.serviceInstances': {
        const environmentId = v.environmentId as string;
        const nodes: unknown[] = [];
        for (const [key, instance] of this.instances) {
          if (!key.startsWith(`${environmentId}:`)) continue;
          instance.polls += 1;
          if (instance.status === 'DEPLOYING' && instance.polls > this.options.settleAfter) {
          instance.status = this.options.outcome;
          // Domains go live with the deployment, as they do on Railway -- before that, syncStatus is
          // CREATING and the provider must report pending rather than issued.
          if (this.options.outcome === 'SUCCESS') instance.settledDomains = true;
        }
          // A duplicated instance has NO latestDeployment in the real API (measured in E25), so the double
          // must not invent PENDING: that made "never deployed" look identical to "deploying", and the
          // provider then waited forever instead of starting the deployment a clone actually needs.
          const svc = this.services.get(key.split(':')[1]!);
          nodes.push({
            node: {
              id: instance.instanceId,
              serviceId: key.split(':')[1],
              numReplicas: instance.numReplicas,
              source: { image: instance.image },
              latestDeployment: { status: instance.status },
              // What is actually RUNNING. The real API returns this (measured 2026-11-12 on our own
              // deployment: a service whose process had exited still showed an older SUCCESS deployment as
              // active), and a mock that always invented an active deployment would let the provider keep
              // mapping "finished" to "live" forever. `completedOnly` simulates the exit-0 case.
              activeDeployments: instance.status === 'SUCCESS' && this.options.completedOnly === false
                ? [{ status: 'SUCCESS' }]
                : [],
              // Mirrors the measured API: custom status is an object, service syncStatus an enum.
              domains: {
                // Records mirror Railway's disclosure: a routing host that is NOT the service hostname,
                // an ownership TXT pair outside dnsRecords, and REQUIRES_UPDATE until the domain settles.
                customDomains: instance.domains.filter((d) => !d.endsWith('.up.railway.app')).map((domain) => {
                  // Nothing is published by the mock, so the honest default is "not yet verified":
                  // a fresh attach must look like work the tenant still has to do.
                  const verified = instance.verifiedDomains === true;
                  const label = domain.split('.')[0] ?? domain;
                  const zone = domain.split('.').slice(-2).join('.');
                  return {
                    id: `cdom-${domain}`,
                    domain,
                    syncStatus: instance.settledDomains ? 'ACTIVE' : 'CREATING',
                    status: {
                      verified,
                      certificateStatus: verified ? 'CERTIFICATE_STATUS_TYPE_VALID' : 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
                      verificationDnsHost: `_railway-verify.${label}`,
                      verificationToken: `railway-verify=${'a'.repeat(64)}`,
                      dnsRecords: [{
                        fqdn: domain, hostlabel: label, zone,
                        recordType: 'DNS_RECORD_TYPE_CNAME',
                        requiredValue: 'verify-target.up.railway.app',
                        ...(verified ? { currentValue: 'verify-target.up.railway.app' } : {}),
                        status: verified ? 'DNS_RECORD_STATUS_PROPAGATED' : 'DNS_RECORD_STATUS_REQUIRES_UPDATE',
                        purpose: 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE',
                      }],
                    },
                  };
                }),
                serviceDomains: instance.domains.filter((d) => d.endsWith('.up.railway.app')).map((domain) => ({ id: `sdom-${domain}`, domain, syncStatus: instance.settledDomains ? 'ACTIVE' : 'CREATING' })),
              },
            },
          });
          void svc;
        }
        return { environment: { serviceInstances: { edges: nodes } } } as T;
      }
      case 'serviceDomainCreate': {
        const input = v.input as { environmentId: string; serviceId: string };
        const instance = this.instances.get(`${input.environmentId}:${input.serviceId}`);
        instance?.domains.push(`service-${input.serviceId}.up.railway.app`);
        return { serviceDomainCreate: { id: `dom-${this.sequence++}`, domain: `service-${input.serviceId}.up.railway.app` } } as T;
      }
      case 'customDomainCreate': {
        this.domainCreates.push(String((v.input as { domain?: string }).domain ?? ''));
        const input = v.input as { environmentId: string; serviceId: string; domain: string };
        const instance = this.instances.get(`${input.environmentId}:${input.serviceId}`);
        instance?.domains.push(input.domain);
        return { customDomainCreate: { id: `dom-${this.sequence++}`, domain: input.domain } } as T;
      }
      case 'serviceDelete': {
        // Measured, and narrower than my first version of this rule. A template-created database is refused
        // while its volume exists; an ORDINARY service with an attached volume deletes fine (probed 2026-11-10:
        // `hibernate-a` deleted with its volume intact and the volume survived). The double used to refuse
        // every attached volume, which encoded an over-generalisation from one database case and would have
        // made the provider's blanket volumes-first ordering look like a requirement instead of a caution.
        if (this.templateServiceIds.has(v.id as string) && this.volumes.some((x) => x.serviceId === v.id)) {
          throw new Error('railway serviceDelete: Problem processing request [UNPROCESSABLE]');
        }
        if (this.options.refuseTemplateServiceDelete && this.templateServiceIds.has(v.id as string)) {
          throw new Error('railway serviceDelete: Bad Access for template-created service [FORBIDDEN]');
        }
        // Measured live: deleting a template-created database exceeded the 25s request deadline, so the
        // double can fail the first attempts and let the retry succeed (#80).
        const attempts = (this.templateDeleteAttempts.get(v.id as string) ?? 0) + 1;
        this.templateDeleteAttempts.set(v.id as string, attempts);
        if (attempts <= (this.options.templateDeleteFailures ?? 0)) {
          throw new Error('railway transport: serviceDelete failed to reach the API (TimeoutError) [NETWORK]');
        }
        const key = `${v.environmentId}:${v.id}`;
        this.instances.delete(key);
        const service = this.services.get(v.id as string);
        const siblings = [...this.instances.keys()].filter((k) => k.endsWith(`:${v.id}`));
        if (service && siblings.length === 0) this.services.delete(v.id as string);
        return { serviceDelete: true } as T;
      }
      case 'project.buckets': {
        if (!this.projects.has(v.projectId as string)) throw new Error(`railway project.buckets: Project not found [INTERNAL_SERVER_ERROR]`);
        const ids = (this.options.buckets ?? []).map((id) => ({ node: { id } }));
        return { project: { buckets: ids.length ? { edges: ids } : null } } as T;
      }
      case 'bucketCreate': {
        const input = v.input as { projectId: string; environmentId: string; name: string };
        const id = `bkt-${this.sequence++}`;
        this.buckets.set(id, input.name);
        return { bucketCreate: { id, name: input.name } } as T;
      }
      case 'project.bucketsList': {
        const nodes = [...this.buckets.entries()].map(([id, name]) => ({ node: { id, name } }));
        return { project: { buckets: { edges: nodes } } } as T;
      }
      case 'projectTokenCreate': {
        const input = v.input as { projectId: string; environmentId: string; name: string };
        this.tokens.set(`tok-${this.sequence}`, { id: `tok-${this.sequence}`, projectId: input.projectId, environmentId: input.environmentId, name: input.name });
        this.sequence += 1;
        return { projectTokenCreate: this.projectToken } as T;
      }
      case 'projectTokens': {
        const nodes = [...this.tokens.values()].filter((t) => t.projectId === (v.projectId as string)).map((node) => ({ node }));
        return { projectTokens: { edges: nodes } } as T;
      }
      case 'projectTokenDelete': {
        this.tokens.delete(v.id as string);
        return { projectTokenDelete: true } as T;
      }
      default:
        throw new Error(`railway mock: unhandled operation "${operation}" — extend the mock deliberately, never silently`);
    }
  }

  private findEnvironmentId(projectId: string, environment: string): string | null {
    return [...this.environments.values()].find((e) => e.projectId === projectId && e.name === environment)?.id ?? null;
  }

  /** Convenience for tests that want to assert on the applied shape. */
  instanceFor(plan: InfraPlan, environment: string, service: string): MockInstance | undefined {
    const project = [...this.projects.values()].find((p) => p.name === `platfolio-${plan.instanceId}`);
    const environmentId = project ? this.findEnvironmentId(project.id, environment) : null;
    const svc = [...this.services.values()].find((s) => s.name === service);
    if (!environmentId || !svc) return undefined;
    return this.instances.get(`${environmentId}:${svc.id}`);
  }
}

/** Types re-exported so tests read the same shapes the provider returns. */
export type { ApplyResult, StateSnapshot };
