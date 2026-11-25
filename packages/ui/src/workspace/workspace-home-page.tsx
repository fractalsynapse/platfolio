import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { TeamList } from './team-list.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { useWorkspaceModel } from './workspace-model.ts';
import { workspacePaths } from './routes.ts';

export function WorkspaceHomePage(): React.ReactElement {
  const { teams } = useWorkspaceModel();
  const clock = useClock();
  return <>
    <div className="ui-workspace-heading"><h1>Your teams</h1><WorkspaceLink href={workspacePaths.createTeam}>Create a team</WorkspaceLink></div>
    <p className="ui-workspace-meta">{ageLabel(teams.freshness, clock().toISOString()).text}</p>
    <TeamList teams={teams.data} />
    {teams.data.some(({ role }) => role === 'owner') && <p><WorkspaceLink href={workspacePaths.launch}>Starter setup</WorkspaceLink></p>}
  </>;
}
