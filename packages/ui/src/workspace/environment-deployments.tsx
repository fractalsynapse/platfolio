import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ActivityFeed } from './activity-feed.tsx';

type Deployment = SuccessOf<'getInstanceEnvironment'>['deployments'][number];
const resultText: Record<Deployment['result'], string> = {
  ok: 'Completed', partial: 'Partially completed', failed: 'Failed', noop: 'No changes',
};

export function EnvironmentDeployments({ deployments, observation, stale }: {
  readonly deployments: readonly Deployment[];
  readonly observation?: string | undefined;
  readonly stale?: boolean | undefined;
}): React.ReactElement {
  return <ActivityFeed title="Deployment history" presentation="rows" empty="No deployment reports for this environment."
    observation={observation} stale={stale}
    entries={deployments.map(({ id, result, reportedAt, commit, problem }) => {
      const detail = [commit && `Commit ${commit}`, problem && `Reported issue ${problem}`].filter(Boolean).join(' · ');
      const outcome = { label: resultText[result], tone: result === 'ok' ? 'success' : result === 'noop' ? undefined : 'attention' } as const;
      return { id, title: commit ? `Build ${commit.slice(0, 7)}` : 'Deployment report', at: reportedAt,
        outcome: outcome.tone ? { label: outcome.label, tone: outcome.tone } : { label: outcome.label }, ...(detail ? { detail } : {}) };
    })} />;
}
