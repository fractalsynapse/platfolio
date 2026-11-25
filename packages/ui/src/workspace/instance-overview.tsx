import type { InstanceResponse, TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel } from '../components/freshness.ts';
import type { Freshness } from '../sdk/transport.ts';
import { EnvironmentList } from './environment-list.tsx';
import { workspacePaths } from './routes.ts';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export function InstanceOverview({ team, app, freshness, now }: {
  readonly team: TeamWithRole;
  readonly app: InstanceResponse;
  readonly freshness: Freshness;
  readonly now: string;
}) {
  return <>
    <header className="ui-workspace-page-heading"><h1>{app.name}</h1><p>Hosted app</p></header>
    <TeamTabs team={team} />
    <div className="ui-workspace-columns">
      <WorkspacePanel title="Environments">
        <p className="ui-workspace-meta">The most recent status for each environment.</p>
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
        {app.template === 'starter-web' && <div className="ui-workspace-links">
          <WorkspaceLink className="ui-workspace-secondary ui-hit-primary" href={workspacePaths.instanceStatus(team.name, app.name)}>Status</WorkspaceLink>
          {team.role === 'owner' && <WorkspaceLink className="ui-workspace-secondary ui-hit-primary"
            href={workspacePaths.instanceSetup(team.name, app.name)}>Manage app</WorkspaceLink>}
        </div>}
        <small className="ui-workspace-meta">{ageLabel(freshness, now).text}</small>
      </WorkspacePanel>
    </div>
  </>;
}
