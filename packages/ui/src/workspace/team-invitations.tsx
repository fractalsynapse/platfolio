import { OperationState } from './operation-state.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { WorkspaceChoice } from './workspace-choice.tsx';
import { WorkspaceDialog } from './workspace-dialog.tsx';
import { ResourceText } from './resource-text.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const roles = [{ value: 'member', label: 'Member' }, { value: 'owner', label: 'Owner' }] as const;

export function TeamInvitations({ teamId }: { readonly teamId: string }): React.ReactElement {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const { state, reload } = useOperation('listInvitations', { params, key: `team-invitations-${teamId}` });
  const create = useCommand('createInvitation');
  const revoke = useCommand('revokeInvitation');
  const clock = useClock();
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<'owner' | 'member'>('member');
  const [history, setHistory] = React.useState(false);
  const [inviting, setInviting] = React.useState(false);
  const [revoking, setRevoking] = React.useState<{ id: string; email: string }>();
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; failed: boolean }>();
  const now = clock();
  const active = (entry: { state: string; expiresAt: string }) => entry.state === 'pending' && Date.parse(entry.expiresAt) > now.getTime();

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await create({ params, body: { email: email.trim(), role } });
      if (result.ok) {
        setEmail('');
        setInviting(false);
        setHistory(false);
        setFeedback({ text: result.value.delivery.sent ? 'Invitation sent.'
          : 'Invitation saved. Email delivery failed. Ask the invitee to sign in with that verified address.', failed: !result.value.delivery.sent });
        reload();
      } else {
        setFeedback({ text: result.error.status === 409 ? 'This address already has an active invitation.'
          : 'Couldn’t create the invitation. Check the email address and try again.', failed: true });
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(invitationId: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await revoke({ params: { teamId, invitationId } });
      setFeedback(result.ok ? { text: 'Invitation withdrawn.', failed: false }
        : { text: 'Couldn’t withdraw the invitation. Check its current status and try again.', failed: true });
      if (result.ok) setRevoking(undefined);
      reload();
    } finally {
      setBusy(false);
    }
  }

  const displayed = state.status === 'loaded' ? state.data.filter((entry) => active(entry) !== history) : [];
  const observation = state.status === 'loaded' ? ageLabel(state.freshness, now.toISOString()) : undefined;
  return <>
    <div className="ui-workspace-page-actions">
      <div className="ui-workspace-segments" role="group" aria-label="Invitation views">
        <WorkspaceAction variant="plain" aria-pressed={!history} onClick={() => setHistory(false)}>Active</WorkspaceAction>
        <WorkspaceAction variant="plain" aria-pressed={history} onClick={() => setHistory(true)}>History</WorkspaceAction>
      </div>
      {!history && <div><WorkspaceAction variant="primary" onClick={() => {
        setEmail(''); setRole('member'); setFeedback(undefined); setInviting(true);
      }}>Invite member</WorkspaceAction></div>}
    </div>
    <WorkspacePanel title={history ? 'Invitation history' : 'Active invitations'} observation={observation?.text} stale={observation?.mayBeStale}>
      {feedback && !inviting && !revoking && <p role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</p>}
      <OperationState status={state.status} pending="Checking team invitations…" failed="Couldn’t load team invitations." retry={reload} />
      {state.status === 'loaded' && <>
        {displayed.length === 0 ? <p className="ui-workspace-empty">{history ? 'No past invitations.' : 'No active invitations.'}</p> : <ul className="ui-workspace-list">
          {displayed.map((entry) => <li className="ui-workspace-row" key={entry.id}>
            <ResourceText title={<>{entry.email}{' '}
              <span className="ui-setup-status" data-tone={history ? undefined : 'attention'}>
                {history ? entry.state === 'pending' ? 'Expired' : entry.state : 'Pending'}
              </span></>} detail={<>
              {entry.role === 'owner' ? 'Owner' : 'Member'} · Created <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString()}</time>
              {!history && <> · Expires <time dateTime={entry.expiresAt}>{new Date(entry.expiresAt).toLocaleDateString()}</time></>}
              {' · '}{entry.emailReceipt ? 'Email sent' : entry.emailError ? 'Email failed' : 'No email receipt'}
            </>} />
            {!history && <WorkspaceAction variant="secondary" disabled={busy} onClick={() => {
              setFeedback(undefined); setRevoking(entry);
            }}>Revoke</WorkspaceAction>}
          </li>)}
        </ul>}
      </>}
    </WorkspacePanel>
    {inviting && <WorkspaceDialog title="Invite member" onCancel={() => { if (!busy) setInviting(false); }}>
      <form className="ui-workspace-form" onSubmit={(event) => void invite(event)}>
        <WorkspaceField id="team-invite-email" label="Email address">
          <input id="team-invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required />
        </WorkspaceField>
        <WorkspaceChoice label="Role" options={roles} value={role} onChange={setRole} />
        <p className="ui-workspace-meta">The recipient can create an account after receiving the invitation.</p>
        {feedback && <p role="alert">{feedback.text}</p>}
        <div className="ui-workspace-links">
          <WorkspaceAction type="submit" variant="primary" disabled={busy}>Create invitation</WorkspaceAction>
          <WorkspaceAction variant="secondary" disabled={busy} onClick={() => setInviting(false)}>Cancel</WorkspaceAction>
        </div>
      </form>
    </WorkspaceDialog>}
    {revoking && <WorkspaceDialog title="Revoke invitation" onCancel={() => { if (!busy) setRevoking(undefined); }}>
      <p>{revoking.email} will lose the ability to accept this invitation.</p>
      {feedback && <p role="alert">{feedback.text}</p>}
      <div className="ui-workspace-links">
        <WorkspaceAction variant="primary" disabled={busy} onClick={() => void withdraw(revoking.id)}>Revoke invitation</WorkspaceAction>
        <WorkspaceAction variant="secondary" disabled={busy} onClick={() => setRevoking(undefined)}>Cancel</WorkspaceAction>
      </div>
    </WorkspaceDialog>}
  </>;
}
