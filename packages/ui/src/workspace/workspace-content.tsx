import * as React from 'react';
import { z } from 'zod';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
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
import { CreateTeam } from './create-team.tsx';
import { MyInvitations } from './my-invitations.tsx';
import { TeamTabs } from './team-tabs.tsx';
import { TeamMemberTabs } from './team-member-tabs.tsx';
import { TeamRoster } from './team-roster.tsx';
import { TeamConnections } from './team-connections.tsx';
import { TeamInvitations } from './team-invitations.tsx';
import { FreeTemplatePicker } from './free-template-picker.tsx';
import { NotificationsWorkspace } from './notifications-workspace.tsx';
import { AccountWorkspace } from './account-workspace.tsx';

const params = {};
const empty = [] as const;

function WorkspaceContent() {
  const navigation = React.useContext(WorkspaceNavigationContext);
  const route = matchWorkspaceRoute(navigation?.pathname ?? workspacePaths.home);
  const { state, reload } = useOperation('listTeams', { params });
  const invitations = useOperation('listMyInvitations', { params });
  const profile = useOperation('getAccountProfile', { params });
  const [created, setCreated] = React.useState<TeamWithRole>();
  const clock = useClock();
  const reauthenticate = state.status === 'failed' && (state.error.status === 401 || state.error.code === 'auth_unavailable');
  const teams = state.status === 'loaded' ? state.data : empty;
  const team = 'team' in route ? teams.find((item) => item.name === route.team) : undefined;
  const invitationsCount = invitations.state.status === 'loaded' ? invitations.state.data.length : undefined;
  React.useEffect(() => {
    if (route.kind === 'create-team' && created && teams.some(({ teamId }) => teamId === created.teamId)) {
      navigation?.navigate(workspacePaths.team(created.name));
      setCreated(undefined);
    }
  }, [route.kind, created, navigation, teams]);

  return <>
    <WorkspaceHeader teams={teams} team={team?.name} invitationCount={invitationsCount}
      displayName={profile.state.status === 'loaded' ? profile.state.data.displayName : undefined} signOut={() => navigation?.signOut()} />
    <main id="workspace-content" className="ui-workspace-main" tabIndex={-1}>
      {state.status === 'pending' && <p role="status">Loading your workspace…</p>}
      {state.status === 'failed' && <div>
        <h1>Couldn’t open your workspace</h1>
        <p role="status">{ageLabel(state.freshness, clock().toISOString()).text}</p>
        <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reauthenticate ? navigation?.signIn : reload}>{reauthenticate ? 'Sign in again' : 'Try again'}</button>
      </div>}
      {state.status === 'loaded' && (route.kind === 'home' ? <>
        <div className="ui-workspace-heading"><h1>Your teams</h1><WorkspaceLink href={workspacePaths.createTeam}>Create a team</WorkspaceLink></div>
        <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
        <TeamList teams={teams} />
        {teams.some(({ role }) => role === 'owner') && <p><WorkspaceLink href={workspacePaths.launch}>Starter setup</WorkspaceLink></p>}
      </> : route.kind === 'create-team' ? <CreateTeam onCreated={(result) => { setCreated(result); reload(); }} />
        : route.kind === 'invitations' ? <MyInvitations invitations={invitations} onAccepted={reload} />
        : route.kind === 'notifications' ? <NotificationsWorkspace teams={teams} />
        : route.kind === 'account' ? <AccountWorkspace tab={route.tab} />
        : route.kind === 'templates' ? team?.role === 'owner' ? <>
          <h1>Choose template</h1>
          <TeamTabs team={team} current="templates" />
          <FreeTemplatePicker team={team.name} />
        </> : <UnavailablePage />
        : route.kind === 'team-launch' ? team?.role === 'owner' ? <>
          <h1>Set up Starter Web</h1>
          <TeamTabs team={team} current="templates" />
          <StarterLaunchScreen selectedTeamId={team.teamId} />
        </> : <UnavailablePage />
        : route.kind === 'team-invitations' || route.kind === 'team-members' ? team?.role === 'owner' ? <>
          <h1>Members</h1>
          <TeamTabs team={team} current="members" />
          <TeamMemberTabs team={team.name} current={route.kind === 'team-members' ? 'roster' : 'invitations'} />
          {route.kind === 'team-members' ? <TeamRoster key={team.teamId} teamId={team.teamId} />
            : <TeamInvitations key={team.teamId} teamId={team.teamId} />}
        </> : <UnavailablePage />
        : route.kind === 'team-connections' ? team?.role === 'owner' ? <>
          <h1>Connections</h1>
          <TeamTabs team={team} current="connections" />
          <TeamConnections key={team.teamId} teamId={team.teamId} teamName={team.name} />
        </> : <UnavailablePage /> : route.kind === 'launch' ? <>
        <p><WorkspaceLink href={workspacePaths.home}>Your teams</WorkspaceLink></p><StarterLaunchScreen />
      </> : team && 'team' in route ? <TeamWorkspace team={team} route={route} /> : <UnavailablePage />)}
    </main>
  </>;
}

export const workspaceContent = defineComponent({
  id: 'workspace.content',
  props: z.object({}).strict(),
  reads: ['listTeams', 'listInstances', 'getStarterLaunch', 'startStarterLaunch', 'removeStarterLaunch',
    'createTeam', 'listMyInvitations', 'acceptInvitation', 'listInvitations', 'createInvitation', 'revokeInvitation', 'listInstallableTemplates',
    'getAccountProfile', 'updateAccountProfile', 'getInstanceEnvironment', 'listSecretPresence',
    'getStarterLaunchSetup', 'initializeStarterOpenBao', 'unlockStarterOpenBao', 'beginStarterRailwayAuthorization',
    'listTeamMembers', 'updateTeamMemberRole', 'removeTeamMember', 'listTeamActivity', 'getHostedAppStatus',
    'listMyNotifications', 'createNotificationRule', 'updateNotificationRule', 'deleteNotificationRule', 'redeployHostedStarter',
    'getMyNotificationEmail', 'updateMyNotificationEmail',
    'listHostedCustomDomains', 'attachHostedCustomDomain', 'detachHostedCustomDomain', 'getHostedStarterBrand', 'updateHostedStarterBrand',
    'listMarketplaceInstallations', 'issueMarketplaceEnrollment', 'disconnectMarketplaceInstallation',
    'getPrivateMarketplaceConnection', 'enrollPrivateMarketplaceConnection'],
  slots: ['full-page'],
  render: WorkspaceContent,
});
