import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { ActivityFeed } from './activity-feed.tsx';

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
  if (state.status === 'pending') return <p role="status">Loading app status…</p>;
  if (state.status === 'failed') return state.error.status === 404 ? <p>App checks begin once a hosted deployment has been verified.</p>
    : <p role="status">Couldn’t read app status.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button>
    </p>;
  const { checkedAt, updates } = state.data;
  return <>
    <section aria-label="Availability">
      <h2>Staging</h2>
      <p><strong>{labels[state.data.state]}</strong></p>
      {checkedAt && <p>Last app check <time dateTime={checkedAt}>{new Date(checkedAt).toLocaleString()}</time></p>}
      <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
    </section>
    <ActivityFeed title="Status updates" empty="No outages or planned stops have been recorded."
      entries={updates.map(({ id, at, state }) => ({ id, at, title: updateLabels[state] }))} />
  </>;
}
