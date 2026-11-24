import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { AppList } from './app-list.tsx';
import { Breadcrumbs, type Breadcrumb } from './breadcrumbs.tsx';
import { EnvironmentList } from './environment-list.tsx';
import { EnvironmentOverview } from './environment-overview.tsx';
import { workspacePaths, type WorkspaceRoute } from './routes.ts';
import { UnavailablePage } from './unavailable-page.tsx';

const params = {};
type TeamRoute = Extract<WorkspaceRoute, { team: string }>;

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
    <section aria-labelledby="workspace-apps"><div className="ui-workspace-heading">
      <h2 id="workspace-apps">Apps</h2><small className="ui-workspace-meta">{age}</small>
    </div><AppList team={team.name} apps={apps} /></section>
  </>;

  const app = apps.find(({ name }) => name === route.instance);
  if (!app) return <UnavailablePage />;
  const parent: Breadcrumb = { label: 'Team workspace', href: workspacePaths.team(team.name) };
  if (route.kind === 'instance') return <>
    <Breadcrumbs items={[parent, { label: app.name }]} />
    <h1>{app.name}</h1>
    <p className="ui-workspace-meta">{app.template}{app.templateRef && <> · <code>{app.templateRef.commitSha.slice(0, 12)}</code></>}</p>
    <section aria-labelledby="app-environments"><div className="ui-workspace-heading">
      <h2 id="app-environments">Environments</h2>{app.environments.length === 0 && <small className="ui-workspace-meta">{age}</small>}
    </div><EnvironmentList team={team.name} app={app} freshness={state.freshness} now={now} /></section>
  </>;

  const environment = app.environments.find((item) => item.environment === route.environment);
  if (!environment) return <UnavailablePage />;
  return <>
    <Breadcrumbs items={[parent, { label: app.name, href: workspacePaths.instance(team.name, app.name) }, { label: environment.environment }]} />
    <h1>{environment.environment}</h1>
    <EnvironmentOverview environment={environment} freshness={state.freshness} now={now} />
  </>;
}
