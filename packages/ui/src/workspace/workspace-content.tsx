import * as React from 'react';
import { z } from 'zod';
import { defineComponent } from '../contract.ts';
import { ageLabel, useClock } from '../components/freshness.ts';
import { StarterLaunchScreen } from '../screens/starter-launch.tsx';
import { useOperation } from '../sdk/use-operation.ts';
import { WorkspaceNavigationContext } from './navigation.ts';
import { matchWorkspaceRoute, workspacePaths } from './routes.ts';
import { TeamList } from './team-list.tsx';
import { TeamWorkspace } from './team-workspace.tsx';
import { UnavailablePage } from './unavailable-page.tsx';
import { WorkspaceHeader } from './workspace-header.tsx';
import { WorkspaceLink } from './workspace-link.tsx';

const params = {};
const empty = [] as const;

function WorkspaceContent() {
  const navigation = React.useContext(WorkspaceNavigationContext);
  const route = matchWorkspaceRoute(navigation?.pathname ?? workspacePaths.home);
  const { state, reload } = useOperation('listTeams', { params });
  const clock = useClock();
  const reauthenticate = state.status === 'failed' && (state.error.status === 401 || state.error.code === 'auth_unavailable');
  const teams = state.status === 'loaded' ? state.data : empty;
  const team = 'team' in route ? teams.find((item) => item.name === route.team) : undefined;

  return <>
    <WorkspaceHeader teams={teams} team={team?.name} signOut={() => navigation?.signOut()} />
    <main id="workspace-content" className="ui-workspace-main" tabIndex={-1}>
      {state.status === 'pending' && <p role="status">Loading your workspace…</p>}
      {state.status === 'failed' && <div>
        <h1>Couldn’t open your workspace</h1>
        <p role="status">{ageLabel(state.freshness, clock().toISOString()).text}</p>
        <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reauthenticate ? navigation?.signIn : reload}>{reauthenticate ? 'Sign in again' : 'Try again'}</button>
      </div>}
      {state.status === 'loaded' && (route.kind === 'home' ? <>
        <div className="ui-workspace-heading"><h1>Your teams</h1><small className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</small></div>
        <TeamList teams={teams} />
        {teams.some(({ role }) => role === 'owner') && <p><WorkspaceLink href={workspacePaths.launch}>Starter setup</WorkspaceLink></p>}
      </> : route.kind === 'launch' ? <>
        <p><WorkspaceLink href={workspacePaths.home}>Your teams</WorkspaceLink></p><StarterLaunchScreen />
      </> : team && 'team' in route ? <TeamWorkspace team={team} route={route} /> : <UnavailablePage />)}
    </main>
  </>;
}

export const workspaceContent = defineComponent({
  id: 'workspace.content',
  props: z.object({}).strict(),
  reads: ['listTeams', 'listInstances', 'getStarterLaunch', 'startStarterLaunch', 'removeStarterLaunch'],
  slots: ['full-page'],
  render: WorkspaceContent,
});
