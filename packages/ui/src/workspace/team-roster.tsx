import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { WorkspaceDialog } from './workspace-dialog.tsx';
import { WorkspaceAvatar } from './workspace-avatar.tsx';
import { ResourceText } from './resource-text.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

type Member = SuccessOf<'listTeamMembers'>[number];
type Change = Member['role'] | 'remove';
type Selection = { member: Member; change: Change };
const nameFor = (member: Member) => member.self ? 'You' : member.invitedAddress ?? `Member ${member.personId.slice(-8)}`;

export function TeamRoster({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const roster = useOperation('listTeamMembers', { params, key: `team-roster-${teamId}` });
  const changeRole = useCommand('updateTeamMemberRole');
  const remove = useCommand('removeTeamMember');
  const [selection, setSelection] = React.useState<Selection>();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const clock = useClock();

  async function apply({ member, change }: Selection) {
    setBusy(true);
    setProblem('');
    try {
      const target = { teamId, personId: member.personId };
      const result = change === 'remove' ? await remove({ params: target }) : await changeRole({ params: target, body: { role: change } });
      if (result.ok) setSelection(undefined);
      else setProblem('Couldn’t change this membership. Check the latest roster and try again.');
      roster.reload();
    } finally {
      setBusy(false);
    }
  }

  const observation = roster.state.status === 'loaded' ? ageLabel(roster.state.freshness, clock().toISOString()) : undefined;
  return <WorkspacePanel title="Team roster" observation={observation?.text} stale={observation?.mayBeStale}>
    {roster.state.status === 'pending' && <p role="status">Loading members…</p>}
    {roster.state.status === 'failed' && <p role="status">Couldn’t load members.{' '}
      <WorkspaceAction type="button" onClick={roster.reload}>Try again</WorkspaceAction>
    </p>}
    {roster.state.status === 'loaded' && <>
      {roster.state.data.length === 0 ? <p className="ui-workspace-empty">No members to display.</p> : <ul className="ui-workspace-list">
        {roster.state.data.map((member) => {
          const role = member.role === 'owner' ? 'member' : 'owner';
          const name = nameFor(member);
          return <li className="ui-workspace-row" key={member.personId}>
            <div className="ui-workspace-links">
              <WorkspaceAvatar name={name} />
              <ResourceText title={name} detail={<>Joined <time dateTime={member.addedAt}>{new Date(member.addedAt).toLocaleDateString()}</time></>} />
              <span className="ui-setup-status">{member.role === 'owner' ? 'Owner' : 'Member'}</span>
            </div>
            {!member.self && <div className="ui-workspace-links">
              <WorkspaceAction variant="secondary" aria-label={`Change role for ${name}`} disabled={busy}
                onClick={() => { setProblem(''); setSelection({ member, change: role }); }}>Change role</WorkspaceAction>
              <WorkspaceAction variant="secondary" aria-label={`Remove ${name}`} disabled={busy}
                onClick={() => { setProblem(''); setSelection({ member, change: 'remove' }); }}>Remove</WorkspaceAction>
            </div>}
          </li>;
        })}
      </ul>}
    </>}
    {selection && <WorkspaceDialog title={selection.change === 'remove' ? 'Remove member' : 'Change role'}
      onCancel={() => { if (!busy) setSelection(undefined); }}>
      <p>{selection.change === 'remove' ? `${nameFor(selection.member)} will lose access to this team.`
        : `Set ${nameFor(selection.member)} as ${selection.change}?`}</p>
      {problem && <p role="alert">{problem}</p>}
      <div className="ui-workspace-links">
        <WorkspaceAction variant="primary" disabled={busy} onClick={() => void apply(selection)}>
          {selection.change === 'remove' ? 'Remove member' : 'Save role'}
        </WorkspaceAction>
        <WorkspaceAction variant="secondary" disabled={busy} onClick={() => setSelection(undefined)}>Cancel</WorkspaceAction>
      </div>
    </WorkspaceDialog>}
  </WorkspacePanel>;
}
