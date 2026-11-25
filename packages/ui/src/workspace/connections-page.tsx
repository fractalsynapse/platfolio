import * as React from 'react';
import { TeamConnections } from './team-connections.tsx';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { useWorkspaceTeam } from './workspace-model.ts';

export function ConnectionsPage(): React.ReactElement {
  const team = useWorkspaceTeam();
  return <>
    <WorkspaceHeading title="Connections" />
    <TeamTabs team={team} current="connections" />
    <TeamConnections key={team.teamId} teamId={team.teamId} teamName={team.name} />
  </>;
}
