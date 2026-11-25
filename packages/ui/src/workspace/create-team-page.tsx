import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { CreateTeam } from './create-team.tsx';
import { WorkspaceNavigationContext } from './navigation.ts';
import { workspacePaths } from './routes.ts';
import { useWorkspaceModel } from './workspace-model.ts';

export function CreateTeamPage() {
  const { teams, reloadTeams } = useWorkspaceModel();
  const navigation = React.useContext(WorkspaceNavigationContext);
  const [created, setCreated] = React.useState<TeamWithRole>();
  React.useEffect(() => {
    if (created && teams.data.some(({ teamId }) => teamId === created.teamId)) {
      navigation?.navigate(workspacePaths.team(created.name));
    }
  }, [created, navigation, teams.data]);
  return <CreateTeam onCreated={(value) => { setCreated(value); reloadTeams(); }} />;
}
