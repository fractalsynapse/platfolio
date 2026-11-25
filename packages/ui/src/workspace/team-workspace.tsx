import { Stack } from '../layout/index.ts';
import { MainContext } from '../layout/main-context.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { AppStatus } from './app-status.tsx';
import { AppSetup } from './app-setup.tsx';
import { AppList } from './app-list.tsx';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { InstanceOverview } from './instance-overview.tsx';
import { EnvironmentWorkspace } from './environment-workspace.tsx';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { TeamActivity } from './team-activity.tsx';
import { TeamTabs } from './team-tabs.tsx';
import { UnavailablePage } from './unavailable-page.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { useWorkspaceModel, useWorkspaceTeam } from './workspace-model.ts';
import { OperationState } from './operation-state.tsx';

const params = {};
export function TeamWorkspace(): React.ReactElement {
  const { route } = useWorkspaceModel();
  const team = useWorkspaceTeam();
  const { state, reload } = useOperation('listInstances', { params });
  const clock = useClock();
  if (state.status !== 'loaded') return <OperationState status={state.status} pending="Loading apps…" retry={reload}
    failed={<>Couldn’t load this team’s apps. {state.status === 'failed' && ageLabel(state.freshness, clock().toISOString()).text}</>} />;

  const apps = state.data.filter((app) => app.teamId === team.teamId);
  const now = clock().toISOString();
  const age = ageLabel(state.freshness, now).text;
  if (route.kind === 'team') return <>
    <WorkspaceHeading title="Team workspace" />
    <TeamTabs team={team} current="apps" />
    <MainContext>
      <WorkspacePanel title="Apps">
        <p className="ui-workspace-meta">{age}</p>
        <AppList team={team.name} apps={apps} />
        {team.role === 'owner' && apps.length === 0 && <WorkspaceLink
          className="ui-workspace-primary ui-hit-primary" href={workspacePaths.templates(team.name)}>Choose a template</WorkspaceLink>}
      </WorkspacePanel>
      <Stack><TeamActivity key={team.teamId} team={team} apps={apps} summary /></Stack>
    </MainContext>
  </>;
  if (route.kind === 'team-activity') return <>
    <WorkspaceHeading title="Activity" />
    <TeamTabs team={team} current="activity" />
    <TeamActivity key={team.teamId} team={team} apps={apps} />
  </>;

  if (!('instance' in route)) return <UnavailablePage />;
  const app = apps.find(({ name }) => name === route.instance);
  if (!app) return <UnavailablePage />;
  if (route.kind === 'instance') return <InstanceOverview team={team} app={app} freshness={state.freshness} now={now} />;

  if (route.kind === 'instance-status') return <>
    <Breadcrumbs items={[{ label: app.name, href: workspacePaths.instance(team.name, app.name) }, { label: 'Status' }]} />
    <WorkspaceHeading title="Status" />
    <TeamTabs team={team} />
    <AppStatus key={app.id} instanceId={app.id} />
  </>;

  if (route.kind === 'instance-setup') return team.role === 'owner' ? <>
    <Breadcrumbs items={[{ label: app.name, href: workspacePaths.instance(team.name, app.name) }, { label: 'Manage app' }]} />
    <WorkspaceHeading title="Manage app" />
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
