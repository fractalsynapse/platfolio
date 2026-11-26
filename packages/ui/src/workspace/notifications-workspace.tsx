import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { NotificationRule, TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { MainContext } from '../layout/main-context.tsx';
import { Stack } from '../layout/index.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { ActivityFeed } from './activity-feed.tsx';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { NotificationRuleForm, notificationEvents } from './notification-rule-form.tsx';
import { workspacePaths } from './routes.ts';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const params = {};
const eventLabel = (event: NotificationRule['event']) => notificationEvents.find((item) => item.value === event)?.label ?? event;

export function NotificationsWorkspace({ teams }: { readonly teams: readonly TeamWithRole[] }) {
  const feed = useOperation('listMyNotifications', { params, key: 'my-notifications' });
  const instances = useOperation('listInstances', { params });
  const update = useCommand('updateNotificationRule');
  const remove = useCommand('deleteNotificationRule');
  const [editing, setEditing] = React.useState<NotificationRule>();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const clock = useClock();

  async function change(rule: NotificationRule, action: 'toggle' | 'remove') {
    setBusy(true);
    setProblem('');
    try {
      const scope = { ruleId: rule.id, instanceId: rule.instanceId };
      const result = action === 'remove' ? await remove({ params: scope })
        : await update({ params: scope, body: { event: rule.event, enabled: !rule.enabled,
          ...(rule.environment ? { environment: rule.environment } : {}) } });
      if (!result.ok) setProblem('Couldn’t update the rule. Check the latest list and try again.');
      feed.reload();
    } finally { setBusy(false); }
  }

  const apps = instances.state.status === 'loaded' ? instances.state.data : [];
  const rules = feed.state.status === 'loaded' ? feed.state.data.rules : [];
  const activeCount = rules.filter(({ enabled }) => enabled).length;
  return <>
    <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Notifications' }]} />
    <WorkspaceHeading title="Notifications"><p>Choose which app events you want to hear about.</p></WorkspaceHeading>
    {problem && <p role="alert">{problem}</p>}
    {feed.state.status === 'pending' && <p role="status">Loading notifications…</p>}
    {feed.state.status === 'failed' && <p role="status">Couldn’t load notifications.{' '}
      <WorkspaceAction type="button" onClick={feed.reload}>Try again</WorkspaceAction>
    </p>}
    {instances.state.status === 'failed' && <p role="status">Couldn’t load apps.{' '}
      <WorkspaceAction type="button" onClick={instances.reload}>Try again</WorkspaceAction>
    </p>}
    <MainContext>
      <WorkspacePanel title="Your rules">
        {feed.state.status === 'loaded' && <p className="ui-workspace-meta">
          {rules.length > 0 && <>{activeCount} active · {rules.length - activeCount} paused · </>}
          {ageLabel(feed.state.freshness, clock().toISOString()).text}
        </p>}
        {rules.length > 0 ? <ul className="ui-workspace-list ui-notification-rules">
          {rules.map((rule) => {
            const app = apps.find((item) => item.id === rule.instanceId);
            const team = teams.find((item) => item.teamId === app?.teamId);
            const event = notificationEvents.find(({ value }) => value === rule.event);
            return <li key={rule.id} className="ui-notification-rule">
              <div className="ui-notification-rule-header">
                <span className="ui-environment-symbol" aria-hidden="true">{event?.mark}</span>
                <div><h3>{eventLabel(rule.event)}</h3>
                  <span className="ui-workspace-meta">{[team?.name, app?.name].filter(Boolean).join(' / ')}</span>
                </div>
                <span className="ui-setup-status" data-tone={rule.enabled ? 'success' : undefined}>{rule.enabled ? 'Active' : 'Paused'}</span>
              </div>
              <dl className="ui-workspace-facts ui-notification-rule-details">
                <div><dt>Environment</dt><dd>{rule.environment ?? 'All environments'}</dd></div>
                <div><dt>Send to</dt><dd>Verified primary email when enabled</dd></div>
              </dl>
              <div className="ui-workspace-links">
                <WorkspaceAction type="button" disabled={!app || busy || !!editing} onClick={() => setEditing(rule)}>Edit</WorkspaceAction>
                <WorkspaceAction type="button" disabled={busy || !!editing} onClick={() => void change(rule, 'toggle')}>{rule.enabled ? 'Pause' : 'Resume'}</WorkspaceAction>
                <WorkspaceAction type="button" disabled={busy || !!editing} onClick={() => void change(rule, 'remove')}>Remove</WorkspaceAction>
              </div>
            </li>;
          })}
        </ul> : feed.state.status === 'loaded' && <div className="ui-workspace-empty">
          <strong>No notification rules yet</strong><p>Start with an app and an event you want to hear about.</p>
        </div>}
      </WorkspacePanel>
      <Stack>
        <WorkspacePanel title={editing ? 'Edit rule' : 'Add a rule'}>
          {teams.length > 0 ? <NotificationRuleForm key={editing?.id ?? 'new'} teams={teams} apps={apps}
            initial={editing} onSaved={() => { setEditing(undefined); feed.reload(); }}
            onCancel={() => setEditing(undefined)} /> : <p>Join a team to see its apps here.</p>}
        </WorkspacePanel>
        <WorkspacePanel title="Email delivery" context>
          <p>Manage how your rules send email to your verified primary address.</p>
          <WorkspaceLink className="ui-workspace-secondary ui-hit-primary" href={workspacePaths.accountNotifications}>Email delivery settings</WorkspaceLink>
        </WorkspacePanel>
      </Stack>
    </MainContext>
    {feed.state.status === 'loaded' &&
      <ActivityFeed title="Recent notifications" empty="No recent events match your active rules."
        entries={feed.state.data.updates.map((item) => {
          const app = apps.find(({ id }) => id === item.instanceId);
          const team = teams.find(({ teamId }) => teamId === app?.teamId);
          const href = team && app ? item.event === 'app-outage'
            ? workspacePaths.instanceStatus(team.name, app.name)
            : workspacePaths.instance(team.name, app.name) : undefined;
          return { id: item.id, at: item.at, title: eventLabel(item.event),
            detail: [app?.name, item.environment].filter(Boolean).join(' · '),
            ...(href ? { href } : {}) };
        })} />
    }
  </>;
}
