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
import { useOperation } from '../sdk/use-operation.ts';

const params = {};

export function WorkspaceHomePage(): React.ReactElement {
  const { teams, invitations, hub } = useWorkspaceModel();
  const instances = useOperation('listInstances', { params, enabled: !hub && teams.data.length > 0 });
  const clock = useClock();
  const invitationCount = invitations.state.status === 'loaded' ? invitations.state.data.length : 0;
  const now = clock().toISOString();
  const teamAge = ageLabel(teams.freshness, now);
  const instanceAge = instances.state.status === 'loaded' ? ageLabel(instances.state.freshness, now) : undefined;
  const invitationAge = invitations.state.status === 'loaded' ? ageLabel(invitations.state.freshness, now) : undefined;
  let counts: Map<string, number> | undefined;
  if (instances.state.status === 'loaded') {
    counts = new Map();
    for (const { teamId } of instances.state.data) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  return <>
    <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Your teams' }]} />
    <WorkspaceHeading title="Your teams"><p>{hub
      ? 'Choose a team to manage its private Platfolio installations.'
      : 'Choose a team to view its platform instances.'}</p></WorkspaceHeading>
    <div className="ui-workspace-page-actions">
      <WorkspaceLink className="ui-workspace-primary ui-hit-primary" href={workspacePaths.createTeam}>Create team</WorkspaceLink>
    </div>
    <MainContext>
      <WorkspacePanel title="Teams" form={invitationCount === 0}
        observation={instanceAge ? `Teams ${teamAge.text}. Instance counts ${instanceAge.text}.` : teamAge.text}
        stale={teamAge.mayBeStale || instanceAge?.mayBeStale === true}>
        <TeamList teams={teams.data} instanceCounts={counts} />
        {instances.state.status === 'failed' && <p className="ui-workspace-meta">Instance counts are unavailable.</p>}
      </WorkspacePanel>
      {invitationCount > 0 && <WorkspacePanel title="Pending invitations" context observation={invitationAge?.text} stale={invitationAge?.mayBeStale}>
        <p>{invitationCount} {invitationCount === 1 ? 'invitation' : 'invitations'} for your verified email.</p>
        <WorkspaceLink className="ui-workspace-secondary ui-hit-primary" href={workspacePaths.invitations}>View invitations</WorkspaceLink>
      </WorkspacePanel>}
    </MainContext>
  </>;
}
