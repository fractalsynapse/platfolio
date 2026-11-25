import * as React from 'react';
import { StarterLaunchScreen } from '../screens/starter-launch.tsx';
import { workspacePaths } from './routes.ts';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { useWorkspaceModel } from './workspace-model.ts';

export function StarterSetupPage(): React.ReactElement {
  const { team, teams } = useWorkspaceModel();
  return <>
    {team ? <><WorkspaceHeading title="Set up Starter Web" /><TeamTabs team={team} current="templates" /></>
      : <p><WorkspaceLink href={workspacePaths.home}>Your teams</WorkspaceLink></p>}
    <StarterLaunchScreen teams={teams.data} {...(team ? { selectedTeamId: team.teamId } : {})} />
  </>;
}
