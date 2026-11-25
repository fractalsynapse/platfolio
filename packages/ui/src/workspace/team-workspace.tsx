import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { AppStatus } from './app-status.tsx';
import { AppSetup } from './app-setup.tsx';
import { AppList } from './app-list.tsx';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { InstanceOverview } from './instance-overview.tsx';
import { EnvironmentWorkspace } from './environment-workspace.tsx';
import { workspacePaths, type WorkspaceRoute } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { TeamActivity } from './team-activity.tsx';
import { TeamTabs } from './team-tabs.tsx';
import { UnavailablePage } from './unavailable-page.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const params = {};
type TeamRoute = Extract<WorkspaceRoute, { kind: 'team' | 'team-activity' | 'instance' | 'instance-setup' | 'instance-status' | 'environment' }>;

export function TeamWorkspace({ team, route }: { readonly team: TeamWithRole; readonly route: TeamRoute }): React.ReactElement {
  const { state, reload } = useOperation('listInstances', { params });
  const clock = useClock();
  if (state.status === 'pending') return <p role="status">Loading apps…</p>;
  if (state.status === 'failed') return <div>
    <p role="status">Couldn’t load this team’s apps. {ageLabel(state.freshness, clock().toISOString()).text}</p>
    <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button>
  </div>;

  const apps = state.data.filter((app) => app.teamId === team.teamId);
  const now = clock().toISOString();
  const age = ageLabel(state.freshness, now).text;
  if (route.kind === 'team') return <>
    <h1>Team workspace</h1>
    <TeamTabs team={team} current="apps" />
    <div className="ui-workspace-columns">
      <WorkspacePanel title="Apps">
        <p className="ui-workspace-meta">{age}</p>
        <AppList team={team.name} apps={apps} />
        {team.role === 'owner' && apps.length === 0 && <WorkspaceLink
          className="ui-workspace-primary ui-hit-primary" href={workspacePaths.templates(team.name)}>Choose a template</WorkspaceLink>}
      </WorkspacePanel>
      <div className="ui-workspace-section-stack"><TeamActivity key={team.teamId} team={team} apps={apps} summary /></div>
    </div>
  </>;
  if (route.kind === 'team-activity') return <>
    <h1>Activity</h1>
    <TeamTabs team={team} current="activity" />
    <TeamActivity key={team.teamId} team={team} apps={apps} />
  </>;

  const app = apps.find(({ name }) => name === route.instance);
  if (!app) return <UnavailablePage />;
  if (route.kind === 'instance') return <InstanceOverview team={team} app={app} freshness={state.freshness} now={now} />;

  if (route.kind === 'instance-status') return <>
    <Breadcrumbs items={[{ label: app.name, href: workspacePaths.instance(team.name, app.name) }, { label: 'Status' }]} />
    <h1>Status</h1>
    <TeamTabs team={team} />
    <AppStatus key={app.id} instanceId={app.id} />
  </>;

  if (route.kind === 'instance-setup') return team.role === 'owner' ? <>
    <Breadcrumbs items={[{ label: app.name, href: workspacePaths.instance(team.name, app.name) }, { label: 'Manage app' }]} />
    <h1>Manage app</h1>
    <TeamTabs team={team} />
    <AppSetup key={app.id} instanceId={app.id} teamId={team.teamId} />
  </> : <UnavailablePage />;

  const environment = app.environments.find((item) => item.environment === route.environment);
  if (!environment) return <UnavailablePage />;
  const title = environment.environment.charAt(0).toUpperCase() + environment.environment.slice(1);
  return <>
    <Breadcrumbs items={[{ label: app.name, href: workspacePaths.instance(team.name, app.name) },
      ...(route.tab === 'overview' ? [] : [{ label: title, href: workspacePaths.environment(team.name, app.name, route.environment) }])]} />
    <div className="ui-workspace-page-heading">
      <h1>{title}</h1>
      {environment.environment === 'staging' && <p>A separate place to test changes.</p>}
      {environment.environment === 'production' && <p>The version people use.</p>}
    </div>
    <TeamTabs team={team} />
    <EnvironmentWorkspace key={`${app.id}-${environment.environment}`} instanceId={app.id} canManage={team.role === 'owner'}
      environment={environment} targets={app.environments.map(({ environment }) => environment)} route={route} freshness={state.freshness} now={now} />
  </>;
}
