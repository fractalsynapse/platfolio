import type { ApplyResult, InfraPlan, StateSnapshot } from '../src/index.ts';
import { RAILWAY_ENDPOINT, type RailwayCredential, type RailwayCredentialSource, type RailwayTransport } from '../src/railway-transport.ts';

/**
 * A Railway mock that keeps the *annoying* behaviour the real API was measured with, because a permissive
 * fake would validate nothing:
 *
 * - `serviceCreate` / `variableUpsert` / `serviceInstanceDeploy` / instance reads require an
 *   **environment-scoped** credential; a workspace credential gets `Not Authorized` (measured).
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
  /** Refuse serviceDelete for template-created services, modelling #80's survivor. */
  refuseTemplateServiceDelete?: boolean;
}

interface MockService { id: string; projectId: string; name: string }
interface MockInstance { instanceId: string; limits?: { cpu: number; memoryMB: number }; settledDomains?: boolean | undefined; verifiedDomains?: boolean | undefined; status: string | null; image: string; numReplicas: number; domains: string[]; polls: number; variables: Set<string> }

export class RailwayMock implements RailwayTransport, RailwayCredentialSource {
  readonly endpoint = RAILWAY_ENDPOINT;
  readonly projects = new Map<string, { id: string; name: string; description: string; workspaceId: string }>();
  readonly environments = new Map<string, { id: string; projectId: string; name: string }>();
  readonly services = new Map<string, MockService>();
  readonly instances = new Map<string, MockInstance>();
  readonly tokens = new Map<string, { id: string; projectId: string; environmentId: string; name: string }>;
  readonly buckets = new Map<string, string>();
  readonly certRetries: string[] = [];
  /** Hosts the availability check refuses, so a test can prove the create is never attempted. */
  readonly takenDomains = new Set<string>();
  readonly domainCreates: string[] = [];
  /** Template deploys recorded so tests can assert the composed name and the grant used. */
  volumes: { id: string; projectId: string; name: string; serviceId: string; mountPath: string }[] = [];
  /** How many template-created services are still hidden (diagnostics for tests). */
  hiddenServiceCount(): number { return this.hiddenServices.size; }
  /** Services hidden until read N times, so single-shot lookups fail as they do live (#77). */
  private readonly hiddenServices = new Map<string, number>();
  readonly templateServiceIds = new Set<string>();
  readonly templateDeploys: { templateId: string; serviceName: string; credentialKind: string }[] = [];

  deploys = 0;
  readonly operations: string[] = [];
  readonly writtenVariables: { name: string; value: string }[] = [];
  readonly denied: string[] = [];
  private sequence = 0;

  private readonly workspaceToken = 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA';
  private readonly projectToken = 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB';
  private readonly options: Required<Pick<MockOptions, 'secretsPresent' | 'settleAfter' | 'outcome'>> & MockOptions;

  constructor(options: MockOptions = {}) {
    // Every option has to be listed here: the normalization below silently drops unknown keys, which is how
    // templateNeverReveals looked "ignored" -- the guard was correct and never received the flag. A double
    // that drops its own configuration is the same failure class as a stub that passes vacuously.
    this.options = {
      templateRevealAfter: options.templateRevealAfter ?? 2,
      templateNeverReveals: options.templateNeverReveals ?? false,
      refuseTemplateServiceDelete: options.refuseTemplateServiceDelete ?? false,
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
    const needsProject = ['serviceCreate', 'serviceInstanceUpdate', 'serviceInstanceLimitsUpdate', 'variableUpsert', 'serviceInstanceDeploy', 'environment.serviceInstances', 'environment.config', 'serviceDomainCreate', 'customDomainCreate', 'customDomainIssueCertificate'];
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
      serviceInstanceUpdate: ['numReplicas', 'healthcheckPath', 'healthcheckTimeout', 'source', 'startCommand', 'buildCommand', 'preDeployCommand', 'region', 'restartPolicyType', 'sleepApplication', 'watchPatterns', 'cronSchedule', 'dockerfilePath', 'buildpacks', 'nixpacksPlan'],
      variableUpsert: ['projectId', 'environmentId', 'serviceId', 'name', 'value', 'skipDeploys'],
      serviceDomainCreate: ['environmentId', 'serviceId', 'targetPort'],
      customDomainCreate: ['projectId', 'environmentId', 'serviceId', 'domain', 'targetPort'],
      serviceInstanceLimitsUpdate: ['environmentId', 'serviceId', 'memoryGB', 'vCPUs'],
    };
    const inputKey = ['projectCreate', 'projectUpdate', 'environmentCreate', 'projectTokenCreate', 'serviceCreate', 'serviceInstanceUpdate', 'variableUpsert', 'serviceDomainCreate', 'customDomainCreate', 'serviceInstanceLimitsUpdate'].includes(operation) ? 'input' : null;
    if (inputKey) {
      const allowed = inputFields[operation];
      const payload = (v[inputKey] ?? {}) as Record<string, unknown>;
      const unknown = allowed ? Object.keys(payload).filter((k) => !allowed.includes(k)) : [];
      if (unknown.length) throw new Error(`railway ${operation}: Field ${JSON.stringify(unknown[0])} is not defined by ${operation} input (the real API rejects this)`);
    }

    // Guard the class of bug E26 exposed: mutations returning an OBJECT are rejected by the real API
    // unless they select a subfield. The mock used to accept the query and never notice.
    const objectReturning = ['projectCreate', 'environmentCreate', 'serviceCreate', 'projectUpdate', 'serviceDomainCreate', 'customDomainCreate'];
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
        this.projects.delete(v.id as string);
        return { projectDelete: true } as T;
      }
      case 'project.environments': {
        const projectId = v.projectId as string;
        const nodes = [...this.environments.values()].filter((e) => e.projectId === projectId).map((node) => ({ node }));
        return { project: { environments: { edges: nodes } } } as T;
      }
      case 'environmentCreate': {
        const input = v.input as { projectId: string; name: string; sourceEnvironmentId?: string };
        const id = `env-${this.sequence++}`;
        this.environments.set(id, { id, projectId: input.projectId, name: input.name });
        if (input.sourceEnvironmentId) {
          // A clone carries configuration; the provider documents that sealed values are not copied.
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
        const projectId = v.projectId as string;
        return { project: { volumes: { edges: this.volumes.filter((x) => x.projectId === projectId).map((node) => ({ node })) } } } as T;
      }
      case 'volumeCreate': {
        const input = v.input as { projectId: string; environmentId: string; serviceId: string; mountPath: string };
        if (!this.services.has(input.serviceId)) throw new Error('railway volumeCreate: unknown service [NOT_FOUND]');
        const id = `vol-${String(this.sequence).padStart(4, '0')}`;
        this.sequence += 1;
        this.volumes.push({ id, projectId: input.projectId, name: `volume-${id}`, serviceId: input.serviceId, mountPath: input.mountPath });
        return { volumeCreate: { id, name: `volume-${id}` } } as T;
      }
      case 'volumeDelete': {
        const volumeId = v.volumeId as string;
        const before = this.volumes.length;
        this.volumes = this.volumes.filter((x) => x.id !== volumeId);
        if (this.volumes.length === before) throw new Error('railway volumeDelete: no such volume [NOT_FOUND]');
        return { volumeDelete: true } as T;
      }
      case 'project.services': {
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
        const existing = [...this.services.values()].find((s) => s.projectId === input.projectId && s.name === input.name);
        const id = existing?.id ?? `svc-${this.sequence++}`;
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
          variables: new Set(Object.keys(spec.variables ?? {})),
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
        const input = v.input as { environmentId: string; serviceId: string; name: string; value: string };
        const instance = this.instances.get(`${input.environmentId}:${input.serviceId}`);
        if (!instance) throw new Error('railway variableUpsert: no instance [NOT_FOUND]');
        instance.variables.add(input.name);
        this.writtenVariables.push({ name: input.name, value: input.value });
        return { variableUpsert: true } as T;
      }
      case 'environment.config': {
        const environmentId = v.environmentId as string;
        const services: Record<string, { variables: Record<string, { value: null }> }> = {};
        for (const [key, instance] of this.instances) {
          if (!key.startsWith(`${environmentId}:`)) continue;
          services[key.split(':')[1]!] = { variables: Object.fromEntries([...instance.variables].map((name) => [name, { value: null }])) };
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
                        requiredValue: '1ggsepht.up.railway.app',
                        ...(verified ? { currentValue: '1ggsepht.up.railway.app' } : {}),
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
        if (this.options.refuseTemplateServiceDelete && this.templateServiceIds.has(v.id as string)) {
          throw new Error('railway serviceDelete: Bad Access for template-created service [FORBIDDEN]');
        }
        const key = `${v.environmentId}:${v.id}`;
        this.instances.delete(key);
        const service = this.services.get(v.id as string);
        const siblings = [...this.instances.keys()].filter((k) => k.endsWith(`:${v.id}`));
        if (service && siblings.length === 0) this.services.delete(v.id as string);
        return { serviceDelete: true } as T;
      }
      case 'project.buckets': {
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
