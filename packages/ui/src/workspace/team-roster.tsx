import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';

type Member = SuccessOf<'listTeamMembers'>[number];
type Change = Member['role'] | 'remove';
type Selection = { member: Member; change: Change };

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

  return <section aria-labelledby="team-roster-heading">
    <h2 id="team-roster-heading">Roster</h2>
    {roster.state.status === 'pending' && <p role="status">Loading members…</p>}
    {roster.state.status === 'failed' && <p role="status">Couldn’t load members.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={roster.reload}>Try again</button>
    </p>}
    {problem && <p role="alert">{problem}</p>}
    {roster.state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(roster.state.freshness, clock().toISOString()).text}</p>
      {roster.state.data.length === 0 ? <p>No members to display.</p> : <ul className="ui-workspace-list">
        {roster.state.data.map((member) => {
          const role = member.role === 'owner' ? 'member' : 'owner';
          const name = member.self ? 'You' : member.invitedAddress ?? `Member ${member.personId.slice(-8)}`;
          const editing = selection?.member.personId === member.personId;
          return <li className="ui-workspace-row" key={member.personId}>
            <div><strong>{name}</strong><p className="ui-workspace-meta">
              {member.role === 'owner' ? 'Owner' : 'Member'} · Joined {new Date(member.addedAt).toLocaleDateString()}
            </p></div>
            {!member.self && (editing ? <div>
              <p>{selection.change === 'remove' ? `Remove ${name} from this team?` : `Set ${name} as ${selection.change}?`}</p>
              <button type="button" className="ui-workspace-primary ui-hit-primary" disabled={busy} onClick={() => void apply(selection)}>Confirm</button>{' '}
              <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={busy} onClick={() => setSelection(undefined)}>Cancel</button>
            </div> : <div className="ui-workspace-links">
              <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={busy} onClick={() => { setProblem(''); setSelection({ member, change: role }); }}>Set as {role}</button>
              <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={busy} onClick={() => { setProblem(''); setSelection({ member, change: 'remove' }); }}>Remove</button>
            </div>)}
          </li>;
        })}
      </ul>}
    </>}
  </section>;
}
