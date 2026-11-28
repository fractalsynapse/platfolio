import * as React from 'react';
import { StarterLaunchScreen } from '../screens/starter-launch.tsx';
import { describeTemplate } from './template-presentation.ts';
import { workspacePaths } from './routes.ts';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { useWorkspaceModel } from './workspace-model.ts';
import { HubInstallationLaunch } from './hub-installation-launch.tsx';

export function StarterSetupPage(): React.ReactElement {
  const { team, teams, route, hub } = useWorkspaceModel();
  const { template, release } = route.kind === 'team-launch' ? route : {};
  if (hub) {
    const owners = teams.data.filter(({ role }) => role === 'owner');
    return <>
      <WorkspaceHeading title="Private Platfolio" />
      {owners.length === 1 ? <HubInstallationLaunch teamId={owners[0]!.teamId} /> : <>
        <p>Choose the team that will manage the installation.</p>
        <ul className="ui-workspace-list">{owners.map(({ teamId, name }) => <li key={teamId}>
          <WorkspaceLink href={workspacePaths.teamConnections(name)}>{name}</WorkspaceLink>
        </li>)}</ul>
      </>}
    </>;
  }
  return <>
    {team ? <><WorkspaceHeading title={template ? `Set up ${describeTemplate(template).title}` : "Set up Starter Web"} /><TeamTabs team={team} current="templates" /></>
      : <p><WorkspaceLink href={workspacePaths.home}>Your teams</WorkspaceLink></p>}
    <StarterLaunchScreen teams={teams.data} template={template} release={release} {...(team ? { selectedTeamId: team.teamId } : {})} />
  </>;
}
