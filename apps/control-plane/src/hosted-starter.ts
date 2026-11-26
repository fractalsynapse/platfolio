import { HostedStarterSchema, type NewHostedStarter, type Store } from '@platfolio/contracts';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { MARKETPLACE_RELEASES } from '@platfolio/manifest';

type Report = SuccessOf<'getStarterLaunch'>;

export function hostedStarterObservation(teamId: string, data: unknown): NewHostedStarter | undefined {
  if (!data || typeof data !== 'object') return;
  const report = data as Partial<Report>;
  const release = MARKETPLACE_RELEASES.find(({ template, revision, installable }) =>
    installable && template === report.template && revision === report.revision);
  if (!release || !Array.isArray(report.events)) return;
  const last = report.events.at(-1);
  const common = {
    teamId, name: release.template, template: release.template,
    templateRef: { repo: release.repo, commitSha: release.revision },
  };
  if (last?.state !== 'READY') return;
  if (last.step === 'Removal complete' && (report.state === 'kept' || report.state === 'wiped')) {
    const removal = report.events.at(-2);
    if (removal?.step !== (report.state === 'kept' ? 'Remove and keep data' : 'Remove and wipe data') ||
        removal.state !== 'WORKING') return;
    const parsed = HostedStarterSchema.pick({ projectId: true, observedAt: true }).safeParse({
      projectId: removal.resourceId, observedAt: last.at,
    });
    if (parsed.success) return { ...common, ...parsed.data, state: report.state === 'kept' ? 'paused' : 'removed' };
    return;
  }
  if (report.state !== 'ready' || last.step !== 'Open your app' || typeof report.origin !== 'string' ||
      !/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(report.origin)) return;
  const parsed = HostedStarterSchema.omit({ instanceId: true }).safeParse({
    projectId: report.projectId, deploymentId: report.deploymentId, state: 'live', origin: report.origin, observedAt: last.at,
  });
  if (!parsed.success) return;
  return { ...common, ...parsed.data, state: 'live' };
}

export async function hostedStarterLink(store: Pick<Store, 'listInstances' | 'getHostedStarter'>, teamId: string, report: unknown) {
  const observation = hostedStarterObservation(teamId, report);
  if (observation?.state === 'removed') return { removedProjectId: observation.projectId };
  if (observation?.state !== 'live') return {};
  const instance = (await store.listInstances(teamId)).find(({ name }) => name === observation.name);
  if (!instance) return { registration: 'pending' as const };
  const hosting = await store.getHostedStarter(instance.id);
  if (!hosting.ok || hosting.value.projectId !== observation.projectId) return { registration: 'conflict' as const };
  if (hosting.value.state !== 'live' || hosting.value.deploymentId !== observation.deploymentId) return { registration: 'pending' as const };
  return { registration: 'recorded' as const, instanceName: instance.name };
}
