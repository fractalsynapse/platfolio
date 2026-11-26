import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, type UseOperationResult } from '../sdk/use-operation.ts';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { WorkspaceAvatar } from './workspace-avatar.tsx';
import { ResourceText } from './resource-text.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export function MyInvitations({ invitations, onAccepted }: {
  readonly invitations: UseOperationResult<'listMyInvitations'>;
  readonly onAccepted: () => void;
}): React.ReactElement {
  const accept = useCommand('acceptInvitation');
  const clock = useClock();
  const [pendingId, setPendingId] = React.useState<string>();
  const [feedback, setFeedback] = React.useState<{ text: string; failed: boolean }>();
  const { state, reload } = invitations;

  async function acceptOne(invitationId: string) {
    setPendingId(invitationId);
    setFeedback(undefined);
    try {
      const result = await accept({ params: { invitationId } });
      if (result.ok) {
        setFeedback({ text: 'You joined the team. You can open it from Your teams.', failed: false });
        onAccepted();
      } else {
        setFeedback({ text: 'This invitation could not be accepted. It may have expired or been withdrawn.', failed: true });
      }
      reload();
    } finally {
      setPendingId(undefined);
    }
  }

  const observation = state.status === 'loaded' ? ageLabel(state.freshness, clock().toISOString()) : undefined;
  return <>
    <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Invitations' }]} />
    <WorkspaceHeading title="Invitations"><p>Invitations are matched to your verified primary email.</p></WorkspaceHeading>
    <WorkspacePanel title="Pending invitations" form observation={observation?.text} stale={observation?.mayBeStale}>
      {state.status === 'pending' && <p role="status">Checking your invitations…</p>}
      {state.status === 'failed' && <p role="status">{state.error.status === 409
        ? 'Verify your sign-in email to view invitations.' : 'Couldn’t check your invitations. Try again.'} <WorkspaceAction type="button" onClick={reload}>Check again</WorkspaceAction></p>}
      {state.status === 'loaded' && <>
        {state.data.length === 0 ? <p className="ui-workspace-empty">No pending invitations for this address.</p> : <ul className="ui-workspace-list ui-resource-list">
          {state.data.map(({ id, teamName, role, expiresAt }) => <li key={id} className="ui-workspace-resource">
            <WorkspaceAvatar name={teamName} limit={1} />
            <ResourceText title={teamName ?? 'Team name unavailable'} detail={<>
              {role === 'owner' ? 'Owner' : 'Member'} · Expires <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleDateString()}</time>
            </>} />
            <WorkspaceAction type="button" variant="secondary" disabled={!teamName || pendingId !== undefined} onClick={() => void acceptOne(id)}>{pendingId === id ? 'Joining…' : 'Accept invitation'}</WorkspaceAction>
          </li>)}
        </ul>}
      </>}
      {feedback && <p role={feedback.failed ? 'alert' : 'status'}>{feedback.text}</p>}
    </WorkspacePanel>
  </>;
}
