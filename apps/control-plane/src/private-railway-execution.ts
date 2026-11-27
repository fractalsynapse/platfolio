import { CONTRACT_VERSION, KEEP_DATA_FEATURE, HttpRailwayTransport, RailwayInfraProvider,
  planIssues, type DeleteOptions, type HostingTarget, type InfraProvider, type RailwayProviderOptions } from '@platfolio/contracts';
import type { HostingPlugin } from '@platfolio/kernel';
import type { IdentityClientRequest } from '../../../packages/contracts/src/shared-identity-execution.ts';

type WorkspaceGrant = { token: string; workspaceId: string; projectId?: string };

export function privateRailwayExecution(team: string, readGrant: () => Promise<WorkspaceGrant>,
  readArtifact?: (artifact: NonNullable<HostingTarget['artifact']>) => Promise<NonNullable<RailwayProviderOptions['registryCredentials']>>): HostingPlugin & {
    configureIdentity(target: NonNullable<IdentityClientRequest['railway']>, environment: string, callback: string, variables?: Readonly<Record<string, string>> | 'check'): Promise<void>;
  } {
  const operations = new Set<string>();
  const transport = new HttpRailwayTransport();
  const describe: InfraProvider['describe'] = () => ({
    provider: 'railway', contract: CONTRACT_VERSION,
    operations: ['describe', 'validatePlan', 'applyPlan', 'readState', 'deleteInstance', 'redeploy'],
    features: [KEEP_DATA_FEATURE, 'volumes'],
  });
  const refuse = async (): Promise<never> => { throw new Error('The hosting plugin requires an authorized instance'); };

  async function provider(target: HostingTarget, authorizeArtifacts = false): Promise<RailwayInfraProvider> {
    const registryCredentials = authorizeArtifacts && target.artifact ? await readArtifact?.(target.artifact).catch(() => {
      console.warn('Private hosting release authorization failed.');
      throw new Error('The marketplace could not authorize this release.');
    }) : undefined;
    if (authorizeArtifacts && target.artifact && !registryCredentials) throw new Error('Connect the artifact registry before applying this release.');
    const grant = await readGrant().catch(() => {
      if (authorizeArtifacts) console.warn('Private hosting workspace authorization failed.');
      throw new Error('The connected workspace grant is unavailable.');
    });
    if (grant.projectId) {
      if (authorizeArtifacts) console.warn('Private hosting requires a workspace grant.');
      throw new Error('Connect a workspace grant to manage this instance');
    }
    const credential = { kind: 'workspace' as const, token: grant.token };
    return new RailwayInfraProvider({
      transport, workspaceId: grant.workspaceId,
      credentials: { workspace: async () => credential, forEnvironment: async () => credential },
      project: { instanceId: target.id, name: target.name },
      ...(registryCredentials ? { registryCredentials } : {}),
      deployTimeoutMs: 600_000,
    });
  }

  async function perform<T>(target: HostingTarget, operation: (driver: RailwayInfraProvider) => Promise<T>, authorizeArtifacts = false): Promise<T> {
    if (operations.has(target.id)) throw new Error('A hosting operation is already in progress');
    operations.add(target.id);
    try { return await operation(await provider(target, authorizeArtifacts)); }
    finally { operations.delete(target.id); }
  }

  return {
    describe, validatePlan: planIssues, applyPlan: refuse, readState: refuse, deleteInstance: refuse, redeploy: refuse,
    async configureIdentity(target, environment, callback, variables) {
      if (target.teamId !== team || !target.artifact.images.includes(target.image)) throw new Error('Invalid hosting scope');
      await perform(target, (driver) => driver.configureIdentityClient({ instanceId: target.id, environment,
        image: target.image, planHash: target.planHash, callback,
        ...(variables === 'check' ? { checkOnly: true } : variables ? { variables } : {}) }), variables !== 'check');
    },
    bindInstance(target) {
      if (target.provider !== 'railway' || target.teamId !== team) return undefined;
      return {
        describe, validatePlan: planIssues,
        applyPlan(plan) {
          if (plan.instanceId !== target.id || plan.teamId !== target.teamId || plan.provider !== target.provider) {
            return Promise.reject(new Error('Plan did not match the authorized instance'));
          }
          if (target.artifact) {
            const planned = new Set(plan.environments.flatMap(({ services }) => services.map(({ image, digest }) => `${image}@${digest}`)));
            if (planned.size !== target.artifact.images.length || target.artifact.images.some((image) => !planned.has(image))) {
              return Promise.reject(new Error('The plan images do not match this acquisition'));
            }
          }
          return perform(target, (driver) => driver.applyPlan(plan).catch(() => {
            console.warn('Private hosting Railway apply failed.');
            throw new Error('Railway could not apply the plan.');
          }), true);
        },
        async readState(id) { return (await provider(target)).readState(id); },
        deleteInstance(id: string, options: DeleteOptions = { data: 'wipe' }) { return perform(target, (driver) => driver.deleteInstance(id, options)); },
        redeploy(input) { return perform(target, (driver) => driver.redeploy(input), true); },
      };
    },
  };
}
