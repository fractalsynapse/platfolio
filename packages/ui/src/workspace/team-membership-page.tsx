import * as React from 'react';
import { TeamInvitations } from './team-invitations.tsx';
import { TeamMemberTabs } from './team-member-tabs.tsx';
import { TeamRoster } from './team-roster.tsx';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { useWorkspaceModel, useWorkspaceTeam } from './workspace-model.ts';

export function TeamMembershipPage(): React.ReactElement {
  const { route } = useWorkspaceModel();
  const team = useWorkspaceTeam();
  const roster = route.kind === 'team-members';
  return <>
    <WorkspaceHeading title="Members" />
    <TeamTabs team={team} current="members" />
    <TeamMemberTabs team={team.name} current={roster ? 'roster' : 'invitations'} />
    {roster ? <TeamRoster key={team.teamId} teamId={team.teamId} /> : <TeamInvitations key={team.teamId} teamId={team.teamId} />}
  </>;
}
