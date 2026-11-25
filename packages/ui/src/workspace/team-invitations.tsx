import { OperationState } from './operation-state.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';

export function TeamInvitations({ teamId }: { readonly teamId: string }): React.ReactElement {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const { state, reload } = useOperation('listInvitations', { params, key: `team-invitations-${teamId}` });
  const create = useCommand('createInvitation');
  const revoke = useCommand('revokeInvitation');
  const clock = useClock();
  const [email, setEmail] = React.useState('');
  const [history, setHistory] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ text: string; failed: boolean }>();
  const now = clock();
  const active = (entry: { state: string; expiresAt: string }) => entry.state === 'pending' && Date.parse(entry.expiresAt) > now.getTime();

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await create({ params, body: { email: email.trim(), role: 'member' } });
      if (result.ok) {
        setEmail('');
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
      reload();
    } finally {
      setBusy(false);
    }
  }

  const displayed = state.status === 'loaded' ? state.data.filter((entry) => active(entry) !== history) : [];
  return <section aria-labelledby="team-invitations-heading">
    <h2 id="team-invitations-heading">Invitations</h2>
    <form className="ui-workspace-form" onSubmit={(event) => void invite(event)}>
      <WorkspaceField id="team-invite-email" label="Invite a member">
        <input id="team-invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required />
      </WorkspaceField>
      <WorkspaceAction type="submit" variant="primary" disabled={busy}>Send invitation</WorkspaceAction>
    </form>
    {feedback && <p role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</p>}
    <div className="ui-workspace-heading" role="group" aria-label="Invitation history">
      <WorkspaceAction type="button" aria-pressed={!history} onClick={() => setHistory(false)}>Active</WorkspaceAction>
      <WorkspaceAction type="button" aria-pressed={history} onClick={() => setHistory(true)}>History</WorkspaceAction>
    </div>
    <OperationState status={state.status} pending="Checking team invitations…" failed="Couldn’t load team invitations." retry={reload} />
    {state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(state.freshness, now.toISOString()).text}</p>
      {displayed.length === 0 ? <p>{history ? 'No past invitations.' : 'No active invitations.'}</p> : <ul className="ui-workspace-list">
        {displayed.map((entry) => <li className="ui-workspace-row" key={entry.id}>
          <div><strong>{entry.email}</strong><p className="ui-workspace-meta">{history ? entry.state === 'pending' ? 'Expired' : entry.state : 'Pending'} · {entry.emailReceipt ? 'Email sent' : entry.emailError ? 'Email failed' : 'No email receipt'} · Sent {new Date(entry.createdAt).toLocaleDateString()}</p></div>
          {!history && <WorkspaceAction type="button" disabled={busy} onClick={() => void withdraw(entry.id)}>Withdraw</WorkspaceAction>}
        </li>)}
      </ul>}
    </>}
  </section>;
}
