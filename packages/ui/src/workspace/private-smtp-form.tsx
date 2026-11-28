import * as React from 'react';
import { useCommand } from '../sdk/use-operation.ts';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';

export function PrivateSmtpForm({ teamId, confirmed }: { readonly teamId: string; readonly confirmed: () => void }) {
  const id = React.useId();
  const save = useCommand('configurePrivateSmtp');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = (key: string) => String(fields.get(key) ?? '');
    const user = value('user');
    const body = { host: value('host').trim(), port: Number(value('port')), user, password: value('password'), from: value('from').trim() || user };
    setBusy(true);
    setError('');
    try {
      const result = await save({ params: { teamId }, body });
      if (!result.ok) { setError('Could not verify the SMTP relay. Check the settings and try again.'); return; }
      form.reset();
      confirmed();
    } catch { setError('Could not verify the SMTP relay. Try again.'); }
    finally { setBusy(false); }
  }
  return <form className="ui-workspace-form" onSubmit={(event) => void submit(event)}>
    <WorkspaceField id={id + '-host'} label="SMTP host"><input id={id + '-host'} name="host" required autoComplete="off" /></WorkspaceField>
    <WorkspaceField id={id + '-port'} label="SMTP port"><input id={id + '-port'} name="port" type="number" defaultValue={587} min={1} max={65535} required /></WorkspaceField>
    <WorkspaceField id={id + '-user'} label="SMTP user"><input id={id + '-user'} name="user" required autoComplete="off" /></WorkspaceField>
    <WorkspaceField id={id + '-password'} label="SMTP password"><input id={id + '-password'} name="password" type="password" required autoComplete="new-password" /></WorkspaceField>
    <WorkspaceField id={id + '-from'} label="Sender email (if different from SMTP user)"><input id={id + '-from'} name="from" type="email" autoComplete="off" /></WorkspaceField>
    {error && <p role="alert">{error}</p>}
    <WorkspaceAction variant="primary" type="submit" disabled={busy}>{busy ? 'Verifying relay…' : 'Verify and save relay'}</WorkspaceAction>
  </form>;
}
