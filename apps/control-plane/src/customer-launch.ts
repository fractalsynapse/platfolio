import { ApplyResultSchema, CONTRACT_VERSION, KEEP_DATA_FEATURE, PINNED_RELEASE_REDEPLOY_FEATURE, CustomerHostingCommandSchema, DeleteResultSchema, RAILWAY_AUTHORIZATION_CALLBACK,
  PrivateLaunchTemplateSchema, RedeployResultSchema, StateSnapshotSchema, planIssues, type CustomerHostingCommand, type HostingTarget } from '@platfolio/contracts';
import type { HostingPlugin } from '@platfolio/kernel';
import { IdentityClientPlacementSchema, IdentityClientRequestSchema, type IdentityClientRequest } from '../../../packages/contracts/src/shared-identity-execution.ts';

export const privateOperationTimeoutMs = 720_000;

export interface CustomerLaunchConfig {
  teamId: string;
  workerUrl: string;
  workerKey: string;
  siteOrigin: string;
  ownerSubject?: string;
}

export function customerLaunchConfig(env: NodeJS.ProcessEnv, origins: readonly string[]): CustomerLaunchConfig | undefined {
  const workerUrl = env.PLATFOLIO_LAUNCH_WORKER_URL;
  const workerKey = env.PLATFOLIO_LAUNCH_WORKER_KEY;
  const teamId = env.PLATFOLIO_LAUNCH_TEAM;
  const ownerSubject = env.PLATFOLIO_INSTALL_OWNER_SUBJECT;
  if (!workerUrl && !workerKey && !teamId && !ownerSubject) return;
  if (ownerSubject && (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ownerSubject) || teamId !== 'team-' + ownerSubject)) {
    throw new Error('The installation team must match the bootstrapped owner subject');
  }
  if (!workerUrl || !workerKey || workerKey.length < 32 || !teamId || origins.length !== 1 || env.PLATFOLIO_MARKETPLACE_ENABLED === 'true') {
    throw new Error('The launcher requires a customer worker, team and exactly one site origin');
  }
  const worker = new URL(workerUrl);
  if (!['http:', 'https:'].includes(worker.protocol) ||
      !/^[a-z0-9-]+\.railway\.internal$|^127\.0\.0\.1$/.test(worker.hostname) ||
      worker.username || worker.password || worker.pathname !== '/' || worker.search || worker.hash) {
    throw new Error('The customer worker must be on the installation private network');
  }
  return { workerUrl: worker.origin, workerKey, teamId, siteOrigin: origins[0]!, ...(ownerSubject ? { ownerSubject } : {}) };
}

export function customerLaunch(config: CustomerLaunchConfig, request: typeof fetch) {
  return {
    teamId: config.teamId,
    callbackPath: RAILWAY_AUTHORIZATION_CALLBACK,
    returnTo: new URL('/dashboard/launch', config.siteOrigin).href,
    async identity(input: IdentityClientRequest) {
      const command = IdentityClientRequestSchema.parse(input);
      if (command.target.teamId !== config.teamId) return { status: 404 };
      try {
        const response = await request(config.workerUrl + '/identity', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(command.action === 'status' ? 120_000 : privateOperationTimeoutMs),
          headers: { authorization: 'Bearer ' + config.workerKey, 'content-type': 'application/json' },
          body: JSON.stringify(command),
        });
        return response.ok
          ? { status: response.status, placement: IdentityClientPlacementSchema.parse(await response.json()) }
          : { status: response.status };
      } catch { return { status: 503 }; }
    },
    async call(action: CustomerHostingCommand['action'], body?: object) {
      const command = CustomerHostingCommandSchema.safeParse({ action, ...(body === undefined ? {} : { body }) });
      if (!command.success) return { ok: false as const, status: 400 };
      try {
        const response = await request(config.workerUrl + '/launch', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(action === 'hosting-apply' ? privateOperationTimeoutMs
            : ['initialize', 'unlock', 'callback', 'hosting-remove', 'marketplace-verify-install'].includes(action) ? 120_000 : 15000),
          headers: { authorization: 'Bearer ' + config.workerKey, 'content-type': 'application/json' },
          body: JSON.stringify(command.data),
        });
        return response.ok ? { ok: true as const, body: await response.json() as unknown } : { ok: false as const, status: response.status };
      } catch { return { ok: false as const, status: undefined }; }
    },
  };
}


/** RPC adapter for the customer execution worker. The installation owns the provider grant. */
export function privateHostingPlugin(launch: ReturnType<typeof customerLaunch>,
  loadArtifacts?: (instance: HostingTarget) => Promise<HostingTarget['artifact']>): HostingPlugin {
  const info = () => ({
    provider: 'railway', contract: CONTRACT_VERSION,
    operations: ['describe', 'validatePlan', 'applyPlan', 'readState', 'deleteInstance', 'redeploy'] as const,
    features: [KEEP_DATA_FEATURE, 'volumes', PINNED_RELEASE_REDEPLOY_FEATURE],
  });
  const refuse = async (): Promise<never> => { throw new Error('Hosting operations require a bound instance'); };
  async function call(action: CustomerHostingCommand['action'], body: object) {
    const outcome = await launch.call(action, body);
    if (!outcome.ok) {
      if (action === 'hosting-apply') console.warn('Private hosting apply worker response:', outcome.status ?? 'unreachable');
      throw new Error('The private hosting worker could not complete the operation');
    }
    return outcome.body;
  }
  return {
    describe: () => ({ ...info(), operations: [...info().operations] }),
    validatePlan: planIssues,
    applyPlan: refuse, readState: refuse, deleteInstance: refuse, redeploy: refuse,
    bindInstance(instance) {
      if (instance.teamId !== launch.teamId || instance.provider !== 'railway') return undefined;
      const target: HostingTarget = { id: instance.id, teamId: instance.teamId, name: instance.name, provider: instance.provider };
      async function releaseTarget() {
        const artifact = await loadArtifacts?.(target);
        return artifact ? { ...target, artifact } : target;
      }
      return {
        describe: () => ({ ...info(), operations: [...info().operations] }),
        validatePlan: planIssues,
        applyPlan: async (plan) => ApplyResultSchema.parse(await call('hosting-apply', { target: await releaseTarget(), plan })),
        readState: async (id) => {
          if (target.id !== id) throw new Error('Hosting instance did not match the bound target');
          return StateSnapshotSchema.parse(await call('hosting-observe', target));
        },
        deleteInstance: async (id, options = { data: 'wipe' }) => {
          if (target.id !== id) throw new Error('Hosting instance did not match the bound target');
          return DeleteResultSchema.parse(await call('hosting-remove', { target, options }));
        },
        redeploy: async ({ instanceId, expectedDeployment, ...input }) => {
          if (target.id !== instanceId) throw new Error('Hosting instance did not match the bound target');
          if (expectedDeployment) {
            if (input.environment !== 'staging' || input.service) throw new Error('The pinned release has one staging target');
            const template = PrivateLaunchTemplateSchema.safeParse(target.name);
            const outcome = template.success
              ? await launch.call('template-redeploy', { template: template.data, ...expectedDeployment })
              : target.name === 'starter-web' ? await launch.call('redeploy', expectedDeployment) : undefined;
            if (!outcome || !outcome.ok && outcome.status !== 409) throw new Error('The private worker could not request redeployment');
            return { instanceId, environment: input.environment, services: [], budgetSkipped: [], verified: false,
              refused: outcome.ok ? [] : [{ service: target.name, code: 'operation-conflict', reason: 'Finish the current setup or refresh the app before trying again.' }] };
          }
          return RedeployResultSchema.parse(await call('hosting-redeploy', { target: await releaseTarget(), ...input }));
        },
      };
    },
  };
}
