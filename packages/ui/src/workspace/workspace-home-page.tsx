import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { TeamList } from './team-list.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { useWorkspaceModel } from './workspace-model.ts';
import { workspacePaths } from './routes.ts';
import { MainContext } from '../layout/main-context.tsx';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export function WorkspaceHomePage(): React.ReactElement {
  const { teams, invitations } = useWorkspaceModel();
  const clock = useClock();
  const invitationCount = invitations.state.status === 'loaded' ? invitations.state.data.length : 0;
  return <>
    <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Your teams' }]} />
    <WorkspaceHeading title="Your teams"><p>Choose a team to view its platform instances.</p></WorkspaceHeading>
    <div className="ui-workspace-page-actions">
      <WorkspaceLink className="ui-workspace-primary ui-hit-primary" href={workspacePaths.createTeam}>Create team</WorkspaceLink>
    </div>
    <MainContext>
      <WorkspacePanel title="Teams" form>
        <p className="ui-workspace-meta">{ageLabel(teams.freshness, clock().toISOString()).text}</p>
        <TeamList teams={teams.data} />
        {teams.data.some(({ role }) => role === 'owner') && <p><WorkspaceLink href={workspacePaths.launch}>Starter setup</WorkspaceLink></p>}
      </WorkspacePanel>
      {invitationCount > 0 && <WorkspacePanel title="Pending invitations" context>
        <p>{invitationCount} {invitationCount === 1 ? 'invitation' : 'invitations'} for your verified email.</p>
        <WorkspaceLink className="ui-workspace-secondary ui-hit-primary" href={workspacePaths.invitations}>View invitations</WorkspaceLink>
      </WorkspacePanel>}
    </MainContext>
  </>;
}
