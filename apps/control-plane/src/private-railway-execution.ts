import { CONTRACT_VERSION, KEEP_DATA_FEATURE, HttpRailwayTransport, RailwayInfraProvider,
  planIssues, type DeleteOptions, type HostingTarget, type InfraProvider, type RailwayProviderOptions } from '@platfolio/contracts';
import type { HostingPlugin } from '@platfolio/kernel';

type WorkspaceGrant = { token: string; workspaceId: string; projectId?: string };

export function privateRailwayExecution(team: string, readGrant: () => Promise<WorkspaceGrant>,
  readArtifact?: (artifact: NonNullable<HostingTarget['artifact']>) => Promise<NonNullable<RailwayProviderOptions['registryCredentials']>>): HostingPlugin {
  const operations = new Set<string>();
  const transport = new HttpRailwayTransport();
  const describe: InfraProvider['describe'] = () => ({
    provider: 'railway', contract: CONTRACT_VERSION,
    operations: ['describe', 'validatePlan', 'applyPlan', 'readState', 'deleteInstance', 'redeploy'],
    features: [KEEP_DATA_FEATURE, 'volumes'],
  });
  const refuse = async (): Promise<never> => { throw new Error('The hosting plugin requires an authorized instance'); };

  async function provider(target: HostingTarget, authorizeArtifacts = false): Promise<RailwayInfraProvider> {
    const registryCredentials = authorizeArtifacts && target.artifact ? await readArtifact?.(target.artifact) : undefined;
    if (authorizeArtifacts && target.artifact && !registryCredentials) throw new Error('Connect the artifact registry before applying this release.');
    const grant = await readGrant();
    if (grant.projectId) throw new Error('Connect a workspace grant to manage this instance');
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
          return perform(target, (driver) => driver.applyPlan(plan), true);
        },
        async readState(id) { return (await provider(target)).readState(id); },
        deleteInstance(id: string, options: DeleteOptions = { data: 'wipe' }) { return perform(target, (driver) => driver.deleteInstance(id, options)); },
        redeploy(input) { return perform(target, (driver) => driver.redeploy(input), true); },
      };
    },
  };
}
