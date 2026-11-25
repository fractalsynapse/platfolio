import { CONTRACT_VERSION, KEEP_DATA_FEATURE, HttpRailwayTransport, RailwayInfraProvider,
  planIssues, type DeleteOptions, type HostingTarget, type InfraProvider } from '@platfolio/contracts';
import type { HostingPlugin } from '@platfolio/kernel';

type WorkspaceGrant = { token: string; workspaceId: string; projectId?: string };

export function privateRailwayExecution(team: string, readGrant: () => Promise<WorkspaceGrant>): HostingPlugin {
  const operations = new Set<string>();
  const transport = new HttpRailwayTransport();
  const describe: InfraProvider['describe'] = () => ({
    provider: 'railway', contract: CONTRACT_VERSION,
    operations: ['describe', 'validatePlan', 'applyPlan', 'readState', 'deleteInstance', 'redeploy'],
    features: [KEEP_DATA_FEATURE, 'volumes'],
  });
  const refuse = async (): Promise<never> => { throw new Error('The hosting plugin requires an authorized instance'); };

  async function provider(target: HostingTarget): Promise<RailwayInfraProvider> {
    const grant = await readGrant();
    if (grant.projectId) throw new Error('Connect a workspace grant to manage this instance');
    const credential = { kind: 'workspace' as const, token: grant.token };
    return new RailwayInfraProvider({
      transport, workspaceId: grant.workspaceId,
      credentials: { workspace: async () => credential, forEnvironment: async () => credential },
      project: { instanceId: target.id, name: target.name },
      deployTimeoutMs: 600_000,
    });
  }

  async function perform<T>(target: HostingTarget, operation: (driver: RailwayInfraProvider) => Promise<T>): Promise<T> {
    if (operations.has(target.id)) throw new Error('A hosting operation is already in progress');
    operations.add(target.id);
    try { return await operation(await provider(target)); }
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
          return perform(target, (driver) => driver.applyPlan(plan));
        },
        async readState(id) { return (await provider(target)).readState(id); },
        deleteInstance(id: string, options: DeleteOptions = { data: 'wipe' }) { return perform(target, (driver) => driver.deleteInstance(id, options)); },
        redeploy(input) { return perform(target, (driver) => driver.redeploy(input)); },
      };
    },
  };
}
