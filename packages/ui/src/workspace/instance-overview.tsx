import * as React from 'react';
import { MainContext } from '../layout/main-context.tsx';
import type { InstanceResponse, TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel } from '../components/freshness.ts';
import type { Freshness } from '../sdk/transport.ts';
import { EnvironmentList } from './environment-list.tsx';
import { workspacePaths } from './routes.ts';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';

export function InstanceOverview({ team, app, freshness, now }: {
  readonly team: TeamWithRole;
  readonly app: InstanceResponse;
  readonly freshness: Freshness;
  readonly now: string;
}): React.ReactElement {
  const observation = ageLabel(freshness, now);
  return <>
    <WorkspaceHeading title={app.name}><p>Hosted app</p></WorkspaceHeading>
    <TeamTabs team={team} />
    <MainContext>
      <WorkspacePanel title="Environments" observation={observation.text} stale={observation.mayBeStale}>
        <EnvironmentList team={team.name} app={app} freshness={freshness} now={now} />
      </WorkspacePanel>
      <WorkspacePanel title="App details" context>
        <dl className="ui-workspace-facts">
          {app.templateRef && <div>
            <dt>GitHub repository</dt>
            <dd><a href={`https://github.com/${app.templateRef.repo}`}>{app.templateRef.repo}</a></dd>
          </div>}
          <div><dt>Team</dt><dd>{team.name}</dd></div>
        </dl>
        <div className="ui-workspace-links">
          {app.template === 'starter-web' && <WorkspaceLink className="ui-workspace-secondary ui-hit-primary" href={workspacePaths.instanceStatus(team.name, app.name)}>Status</WorkspaceLink>}
          {team.role === 'owner' && <WorkspaceLink className="ui-workspace-secondary ui-hit-primary"
            href={workspacePaths.instanceSetup(team.name, app.name)}>Manage app</WorkspaceLink>}
        </div>
      </WorkspacePanel>
    </MainContext>
  </>;
}
