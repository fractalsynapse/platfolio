import * as React from 'react';
import type { NotificationRule, TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { ActivityFeed } from './activity-feed.tsx';
import { NotificationRuleForm, notificationEvents } from './notification-rule-form.tsx';
import { workspacePaths } from './routes.ts';

const params = {};
const eventLabel = (event: NotificationRule['event']) => notificationEvents.find((item) => item.value === event)?.label ?? event;

export function NotificationsWorkspace({ teams }: { readonly teams: readonly TeamWithRole[] }) {
  const feed = useOperation('listMyNotifications', { params, key: 'my-notifications' });
  const instances = useOperation('listInstances', { params });
  const update = useCommand('updateNotificationRule');
  const remove = useCommand('deleteNotificationRule');
  const [editing, setEditing] = React.useState<NotificationRule | 'new'>();
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
  return <>
    <div className="ui-workspace-heading"><h1>Notifications</h1>
      {!editing && teams.length > 0 && <button type="button" className="ui-workspace-primary ui-hit-primary" onClick={() => setEditing('new')}>New rule</button>}
    </div>
    <p>Choose which app events appear here.</p>
    {editing && <NotificationRuleForm key={editing === 'new' ? 'new' : editing.id} teams={teams} apps={apps}
      initial={editing === 'new' ? undefined : editing} onSaved={() => { setEditing(undefined); feed.reload(); }}
      onCancel={() => setEditing(undefined)} />}
    {problem && <p role="alert">{problem}</p>}
    {feed.state.status === 'pending' && <p role="status">Loading notifications…</p>}
    {feed.state.status === 'failed' && <p role="status">Couldn’t load notifications.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={feed.reload}>Try again</button>
    </p>}
    {instances.state.status === 'failed' && <p role="status">Couldn’t load apps.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={instances.reload}>Try again</button>
    </p>}
    {feed.state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(feed.state.freshness, clock().toISOString()).text}</p>
      <section aria-label="Notification rules">
        <h2>Your rules</h2>
        {feed.state.data.rules.length ? <ul className="ui-workspace-list">
          {feed.state.data.rules.map((rule) => {
            const app = apps.find((item) => item.id === rule.instanceId);
            const team = teams.find((item) => item.teamId === app?.teamId);
            return <li key={rule.id} className="ui-workspace-row">
              <div><strong>{eventLabel(rule.event)}</strong>
                <p className="ui-workspace-meta">{[team?.name, app?.name, rule.environment ?? 'Any environment', rule.enabled ? 'Active' : 'Paused'].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="ui-workspace-links">
                <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={!app || busy || !!editing} onClick={() => setEditing(rule)}>Edit</button>
                <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={busy || !!editing} onClick={() => void change(rule, 'toggle')}>{rule.enabled ? 'Pause' : 'Resume'}</button>
                <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={busy || !!editing} onClick={() => void change(rule, 'remove')}>Remove</button>
              </div>
            </li>;
          })}
        </ul> : <p>No rules yet.</p>}
      </section>
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
    </>}
  </>;
}
