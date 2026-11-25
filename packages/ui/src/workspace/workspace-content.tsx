import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { renderScreen } from '../screens/screen.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { WorkspaceNavigationContext } from './navigation.ts';
import { OperationState } from './operation-state.tsx';
import { matchWorkspaceRoute, workspacePaths } from './routes.ts';
import { WorkspaceHeader } from './workspace-header.tsx';
import { WorkspaceModelContext } from './workspace-model.ts';
import { workspacePageId, workspacePages } from './workspace-pages.ts';

const params = {};
const empty = [] as const;

export function WorkspaceContent() {
  const navigation = React.useContext(WorkspaceNavigationContext);
  const route = matchWorkspaceRoute(navigation?.pathname ?? workspacePaths.home);
  const { state, reload } = useOperation('listTeams', { params });
  const invitations = useOperation('listMyInvitations', { params });
  const profile = useOperation('getAccountProfile', { params });
  const clock = useClock();
  const reauthenticate = state.status === 'failed' && (state.error.status === 401 || state.error.code === 'auth_unavailable');
  const teams = state.status === 'loaded' ? state.data : empty;
  const team = 'team' in route ? teams.find((item) => item.name === route.team) : undefined;
  const page = workspacePages[workspacePageId(route)];
  const allowed = (!('team' in route) || team !== undefined) && (!page.owner || team?.role === 'owner');
  const document = allowed ? page.screen : workspacePages['workspace.unavailable'].screen;

  return <>
    <WorkspaceHeader teams={teams} team={team?.name} invitationCount={invitations.state.status === 'loaded' ? invitations.state.data.length : undefined}
      displayName={profile.state.status === 'loaded' ? profile.state.data.displayName : undefined} signOut={() => navigation?.signOut()} />
    <main id="workspace-content" className="ui-workspace-main" tabIndex={-1}>
      <OperationState status={state.status} pending="Loading your workspace…" retry={reauthenticate ? navigation?.signIn : reload}
        retryLabel={reauthenticate ? 'Sign in again' : 'Try again'}
        failed={<><h1>Couldn’t open your workspace</h1>{state.status === 'failed' && <p>{ageLabel(state.freshness, clock().toISOString()).text}</p>}</>} />
      {state.status === 'loaded' && <WorkspaceModelContext.Provider value={{ route, teams: state, team, reloadTeams: reload, invitations, profile }}>
        {renderScreen(document, () => ({}))}
      </WorkspaceModelContext.Provider>}
    </main>
  </>;
}
