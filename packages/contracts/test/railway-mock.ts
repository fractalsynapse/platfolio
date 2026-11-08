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
}

interface MockService { id: string; projectId: string; name: string }
interface MockInstance { instanceId: string; limits?: { cpu: number; memoryMB: number }; status: string | null; image: string; numReplicas: number; domains: string[]; polls: number; variables: Set<string> }

export class RailwayMock implements RailwayTransport, RailwayCredentialSource {
  readonly endpoint = RAILWAY_ENDPOINT;
  readonly projects = new Map<string, { id: string; name: string; description: string; workspaceId: string }>();
  readonly environments = new Map<string, { id: string; projectId: string; name: string }>();
  readonly services = new Map<string, MockService>();
  readonly instances = new Map<string, MockInstance>();
  readonly tokens = new Map<string, { id: string; projectId: string; environmentId: string; name: string }>();

  deploys = 0;
  readonly operations: string[] = [];
  readonly writtenVariables: { name: string; value: string }[] = [];
  readonly denied: string[] = [];
  private sequence = 0;

  private readonly workspaceToken = 'mock-workspace-token-AAAAAAAAAAAAAAAAAAAA';
  private readonly projectToken = 'mock-project-token-BBBBBBBBBBBBBBBBBBBBBBBB';
  private readonly options: Required<Pick<MockOptions, 'secretsPresent' | 'settleAfter' | 'outcome'>> & MockOptions;

  constructor(options: MockOptions = {}) {
    this.options = {
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
    const needsProject = ['serviceCreate', 'serviceInstanceUpdate', 'serviceInstanceLimitsUpdate', 'variableUpsert', 'serviceInstanceDeploy', 'serviceInstances', 'environment.config', 'serviceDomainCreate', 'customDomainCreate'];
    const needsWorkspace = ['projects', 'project', 'projectCreate', 'projectUpdate', 'projectDelete', 'project.environments', 'environmentCreate', 'project.services', 'projectTokenCreate', 'projectTokens', 'projectTokenDelete', 'serviceDelete', 'project.buckets'];
    if (needsProject.includes(operation) && credential.kind !== 'project') {
      this.denied.push(operation);
      throw new Error(`railway ${operation}: Not Authorized [INTERNAL_SERVER_ERROR]`);
    }
    if (needsWorkspace.includes(operation) && credential.kind !== 'workspace') {
      this.denied.push(operation);
      throw new Error(`railway ${operation}: Not Authorized [INTERNAL_SERVER_ERROR]`);
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
            this.instances.set(cloneKey, { ...instance, variables: new Set(instance.variables), status: null, polls: 0 });
          }
        }
        return { environmentCreate: { id } } as T;
      }
      case 'project.services': {
        const projectId = v.projectId as string;
        const nodes = [...this.services.values()].filter((s) => s.projectId === projectId).map((node) => ({ node: { id: node.id, name: node.name } }));
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
        if (!instance) throw new Error('railway serviceInstanceUpdate: no instance [NOT_FOUND]');
        if (input.numReplicas !== undefined) instance.numReplicas = input.numReplicas;
        if (input.source?.image) instance.image = input.source.image;
        return { serviceInstanceUpdate: true } as T;
      }
      case 'serviceInstanceLimitsUpdate': {
        const key = `${v.environmentId}:${v.serviceId}`;
        const instance = this.instances.get(key);
        if (!instance) throw new Error('railway serviceInstanceLimitsUpdate: no instance [NOT_FOUND]');
        const input = v.input as { memoryMegabytes?: number; cpuCount?: number };
        instance.limits = { cpu: input.cpuCount ?? 0, memoryMB: input.memoryMegabytes ?? 0 };
        return { serviceInstanceLimitsUpdate: true } as T;
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
      case 'serviceInstances': {
        const key = `${v.environmentId}:${v.serviceId}`;
        const instance = this.instances.get(key);
        if (!instance) return { serviceInstances: { edges: [] } } as T;
        instance.polls += 1;
        if (instance.status === 'DEPLOYING' && instance.polls > this.options.settleAfter) instance.status = this.options.outcome;
        if (instance.status === null) instance.status = 'PENDING';
        const node = {
          id: instance.instanceId,
          serviceId: v.serviceId as string,
          numReplicas: instance.numReplicas,
          source: { image: instance.image },
          latestDeployment: { status: instance.status },
          domains: { edges: instance.domains.map((domain) => ({ node: { domain } })) },
        };
        return { serviceInstances: { edges: [{ node }] } } as T;
      }
      case 'serviceDomainCreate': {
        const input = v.input as { environmentId: string; serviceId: string };
        const instance = this.instances.get(`${input.environmentId}:${input.serviceId}`);
        instance?.domains.push(`service-${input.serviceId}.up.railway.app`);
        return { serviceDomainCreate: { id: `dom-${this.sequence++}`, domain: `service-${input.serviceId}.up.railway.app` } } as T;
      }
      case 'customDomainCreate': {
        const input = v.input as { environmentId: string; serviceId: string; domain: string };
        const instance = this.instances.get(`${input.environmentId}:${input.serviceId}`);
        instance?.domains.push(input.domain);
        return { customDomainCreate: { id: `dom-${this.sequence++}`, domain: input.domain } } as T;
      }
      case 'serviceDelete': {
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
