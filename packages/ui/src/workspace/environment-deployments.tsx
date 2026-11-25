import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ActivityFeed } from './activity-feed.tsx';

type Deployment = SuccessOf<'getInstanceEnvironment'>['deployments'][number];
const resultText: Record<Deployment['result'], string> = {
  ok: 'Completed', partial: 'Partially completed', failed: 'Failed', noop: 'No changes',
};

export function EnvironmentDeployments({ deployments }: { readonly deployments: readonly Deployment[] }) {
  return <ActivityFeed title="Deployment history" empty="No deployment reports for this environment."
    entries={deployments.map(({ id, result, reportedAt, commit, problem }) => {
      const detail = [commit && `Commit ${commit.slice(0, 12)}`, problem && `Reported issue ${problem}`].filter(Boolean).join(' · ');
      return { id, title: resultText[result], at: reportedAt, ...(detail ? { detail } : {}) };
    })} />;
}
