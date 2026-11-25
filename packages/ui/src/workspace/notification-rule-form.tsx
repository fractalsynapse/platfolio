import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { InstanceResponse, NotificationRule, TeamWithRole } from '@platfolio/api-contract/generated/types';
import { useCommand } from '../sdk/use-operation.ts';
import { WorkspaceChoice } from './workspace-choice.tsx';

export const notificationEvents = [
  { value: 'deployment-failed', label: 'Deployment failed' },
  { value: 'app-outage', label: 'App outage' },
  { value: 'secret-updated', label: 'Environment secret updated' },
] as const;

export function NotificationRuleForm({ teams, apps, initial, onSaved, onCancel }: {
  teams: readonly TeamWithRole[];
  apps: readonly InstanceResponse[];
  initial?: NotificationRule | undefined;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const initialApp = apps.find(({ id }) => id === initial?.instanceId);
  const [teamId, setTeam] = React.useState(initialApp?.teamId ?? teams[0]?.teamId ?? '');
  const [instanceId, setInstance] = React.useState(initialApp?.id ?? '');
  const [environment, setEnvironment] = React.useState(initial?.environment ?? '');
  const [event, setEvent] = React.useState<NotificationRule['event']>(initial?.event ?? 'deployment-failed');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const add = useCommand('createNotificationRule');
  const edit = useCommand('updateNotificationRule');
  const options = apps.filter((app) => app.teamId === teamId);
  const chosen = options.find((app) => app.id === instanceId) ?? options[0];

  async function submit(eventObject: React.FormEvent<HTMLFormElement>) {
    eventObject.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setProblem('');
    try {
      const body = { event, ...(environment ? { environment } : {}), enabled: initial?.enabled ?? true };
      const result = initial ? await edit({ params: { instanceId: chosen.id, ruleId: initial.id }, body })
        : await add({ params: { instanceId: chosen.id }, body });
      if (result.ok) onSaved();
      else setProblem(result.error.status === 409 ? 'You already follow that event on this app and environment.'
        : 'Couldn’t save this rule. Check the app and try again.');
    } finally { setBusy(false); }
  }

  return <form className="ui-workspace-form" aria-label={initial ? 'Edit notification rule' : 'New notification rule'} onSubmit={(eventObject) => void submit(eventObject)}>
    {initial ? <p>{chosen?.name ?? 'App unavailable'}</p> : <>
      <WorkspaceChoice label="Team" value={teamId} options={teams.map((team) => ({ value: team.teamId, label: team.name }))}
        onChange={(value) => { setTeam(value); setInstance(''); setEnvironment(''); }} />
      {options.length > 0 ? <WorkspaceChoice label="App" value={chosen?.id ?? ''} options={options.map((app) => ({ value: app.id, label: app.name }))}
        onChange={(value) => { setInstance(value); setEnvironment(''); }} /> : <p>No apps in this team.</p>}
    </>}
    <WorkspaceChoice label="Environment" value={environment} options={[
      { value: '', label: 'Any environment' },
      ...(chosen?.environments.map((item) => ({ value: item.environment, label: item.environment })) ?? []),
    ]} onChange={setEnvironment} />
    <WorkspaceChoice label="Event" value={event} options={notificationEvents} onChange={setEvent} />
    {problem && <p role="alert">{problem}</p>}
    <div className="ui-workspace-links">
      <WorkspaceAction type="submit" variant="primary" disabled={busy || !chosen}>Save rule</WorkspaceAction>
      <WorkspaceAction type="button" onClick={onCancel} disabled={busy}>Cancel</WorkspaceAction>
    </div>
  </form>;
}
