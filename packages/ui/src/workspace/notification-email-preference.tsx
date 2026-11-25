import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { WorkspacePanel } from './workspace-panel.tsx';

const params = {};

export function NotificationEmailPreference() {
  const preference = useOperation('getMyNotificationEmail', { params, key: 'notification-email' });
  const update = useCommand('updateMyNotificationEmail');
  const clock = useClock();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');

  async function change(enabled: boolean) {
    setPending(true);
    setError('');
    try {
      const result = await update({ params, body: { enabled } });
      if (!result.ok) setError(result.error.status === 400
        ? 'Verify your primary email to receive notification emails.'
        : 'Couldn’t save your email preference. Try again.');
      preference.reload();
    } finally { setPending(false); }
  }

  if (preference.state.status === 'pending') return <p role="status">Checking your email preference…</p>;
  if (preference.state.status === 'failed') return <p role="status">Couldn’t check your email preference.{' '}
    <WorkspaceAction type="button" onClick={preference.reload}>Try again</WorkspaceAction>
  </p>;
  if (preference.state.status !== 'loaded') return null;
  const { available, enabled } = preference.state.data;
  return <WorkspacePanel title="Email alerts">
    <p>{available ? 'Send matching alerts to your verified primary email address.' : 'Email delivery is unavailable in this installation.'}</p>
    <p className="ui-workspace-meta">{ageLabel(preference.state.freshness, clock().toISOString()).text}</p>
    {(available || enabled) && <WorkspaceAction type="button" disabled={pending}
      onClick={() => void change(!enabled)}>{pending ? 'Saving…' : enabled ? 'Turn off email alerts' : 'Turn on email alerts'}</WorkspaceAction>}
    {error && <p role="alert">{error}</p>}
  </WorkspacePanel>;
}
