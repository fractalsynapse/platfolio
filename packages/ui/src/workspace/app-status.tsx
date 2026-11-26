import { OperationState } from './operation-state.tsx';
import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { ActivityFeed } from './activity-feed.tsx';
import { ActivityHistory } from './activity-history.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

type Status = SuccessOf<'getHostedAppStatus'>;
const labels: Record<Status['state'], string> = {
  checking: 'Waiting for checks',
  up: 'Available',
  down: 'Unavailable',
  paused: 'Stopped. Storage kept.',
  removed: 'Removed',
};
const updateLabels: Record<Status['updates'][number]['state'], string> = {
  up: 'App is responding again',
  down: 'App outage confirmed',
  paused: 'App stopped and storage kept',
  removed: 'App removed and storage scheduled for deletion',
};

export function AppStatus({ instanceId }: { readonly instanceId: string }) {
  const params = React.useMemo(() => ({ instanceId }), [instanceId]);
  const { state, reload } = useOperation('getHostedAppStatus', { params, key: `app-status-${instanceId}` });
  const clock = useClock();
  if (state.status !== 'loaded') {
    if (state.status === 'failed' && state.error.status === 404) return <p>App checks begin once a hosted deployment has been verified.</p>;
    return <OperationState status={state.status} pending="Loading app status…" failed="Couldn’t read app status." retry={reload} />;
  }
  const { checkedAt, updates } = state.data;
  const now = clock();
  return <>
    <WorkspacePanel title="Service checks">
      <p><strong>Staging</strong>{' '}<span className="ui-setup-status" data-tone={state.data.state === 'up' ? 'success' : 'attention'}>{labels[state.data.state]}</span></p>
      {checkedAt && <p>Last app check <time dateTime={checkedAt}>{new Date(checkedAt).toLocaleString()}</time></p>}
      <p className="ui-workspace-meta">{ageLabel(state.freshness, now.toISOString()).text}</p>
    </WorkspacePanel>
    <ActivityFeed title="Status updates" empty="No outages or planned stops have been recorded."
      history={<ActivityHistory timestamps={updates.map(({ at }) => at)} now={now} noun="status updates" tone="attention" />}
      entries={updates.map(({ id, at, state }) => ({ id, at, title: updateLabels[state], label: state === 'down' ? 'Outage' : 'Status update' }))} />
  </>;
}
