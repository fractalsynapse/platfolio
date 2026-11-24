import * as React from 'react';
import type { InstanceResponse, SuccessOf, TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { ActivityFeed, type ActivityEntry } from './activity-feed.tsx';
import { workspacePaths } from './routes.ts';

type Audit = SuccessOf<'listTeamActivity'>[number];

const titleByAction: Readonly<Record<string, string>> = {
  'attestation.record': 'Deployment reported',
  'dispatch.trigger': 'Deployment requested',
  'availability.down': 'App outage confirmed',
  'availability.up': 'App is responding again',
  'hosting.verified': 'Deployment verified',
  'hosting.paused': 'App stopped and storage kept',
  'hosting.removed': 'App removed and storage scheduled for deletion',
  'instance.create': 'App added',
  'instance.destroy': 'App removal requested',
  'instance.redeploy': 'Redeployment requested',
  'plan.register': 'Deployment plan saved',
  'secret.deliver': 'Secret updated',
  'team.create': 'Team created',
};
const deploymentActions = new Set(['attestation.record', 'hosting.verified']);
const reportedResults: Readonly<Record<string, string>> = { ok: 'Completed', partial: 'Partially completed', failed: 'Failed', noop: 'No changes' };

function entryFor(event: Audit, team: string, apps: readonly InstanceResponse[]): ActivityEntry {
  const app = apps.find(({ id }) => id === event.target || `instance/${id}` === event.target);
  const environment = app?.environments.find((item) => item.environment === event.detail.environment)?.environment;
  const url = app && (event.action.startsWith('availability.') ? workspacePaths.instanceStatus(team, app.name)
    : environment && deploymentActions.has(event.action)
    ? workspacePaths.environment(team, app.name, environment, 'deployments')
    : workspacePaths.instance(team, app.name));
  const result = typeof event.detail.result === 'string' ? reportedResults[event.detail.result] : undefined;
  const detail = [app?.name, environment, result].filter(Boolean).join(' · ');
  return {
    id: event.id, at: event.at, title: titleByAction[event.action] ?? 'Hosting change recorded',
    ...(url ? { href: url } : {}), ...(detail ? { detail } : {}),
  };
}

export function TeamActivity({ team, apps, summary }: {
  readonly team: TeamWithRole;
  readonly apps: readonly InstanceResponse[];
  readonly summary?: boolean;
}) {
  const params = React.useMemo(() => ({ teamId: team.teamId }), [team.teamId]);
  const activity = useOperation('listTeamActivity', { params, key: `team-activity-${team.teamId}` });
  const clock = useClock();
  if (activity.state.status === 'pending') return <p role="status">Loading activity…</p>;
  if (activity.state.status === 'failed') return <p role="status">Couldn’t load activity.{' '}
    <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={activity.reload}>Try again</button>
  </p>;
  const events = activity.state.data;
  return <>
    <p className="ui-workspace-meta">{ageLabel(activity.state.freshness, clock().toISOString()).text}</p>
    {summary ? <>
      <ActivityFeed title="Recent deployments" empty="No deployments have been verified or reported yet."
        entries={events.filter(({ action }) => deploymentActions.has(action)).slice(0, 5).map((event) => entryFor(event, team.name, apps))} />
      <ActivityFeed title="Recent activity" empty="No team activity has been recorded yet."
        entries={events.filter(({ action }) => !deploymentActions.has(action)).slice(0, 5).map((event) => entryFor(event, team.name, apps))} />
    </> : <ActivityFeed title="Hosting timeline" empty="No team activity has been recorded yet."
      entries={events.map((event) => entryFor(event, team.name, apps))} />}
  </>;
}
