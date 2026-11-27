import type { ReactNode } from 'react';
import { z } from 'zod';
import type { OperationId } from '@platfolio/api-contract/generated/types';
import { defineComponent } from '../contract.ts';
import type { ScreenDocument } from '../screens/screen.ts';
import { AccountPage } from './account-page.tsx';
import { ConnectionsPage } from './connections-page.tsx';
import { CreateTeamPage } from './create-team-page.tsx';
import { InvitationsPage } from './invitations-page.tsx';
import { NotificationsPage } from './notifications-page.tsx';
import { StarterSetupPage } from './starter-setup-page.tsx';
import { TeamMembershipPage } from './team-membership-page.tsx';
import { TeamWorkspace } from './team-workspace.tsx';
import { TemplatesPage } from './templates-page.tsx';
import { UnavailablePage } from './unavailable-page.tsx';
import { WorkspaceHomePage } from './workspace-home-page.tsx';
import { WORKSPACE_READS } from './workspace-model.ts';
import type { WorkspaceRoute } from './routes.ts';

const props = z.object({}).strict();
const starterReads = ['getStarterLaunch', 'listInstallableTemplates', 'startStarterLaunch', 'removeStarterLaunch'] as const;
const setupReads = ['getStarterLaunchSetup', 'initializeStarterOpenBao', 'unlockStarterOpenBao', 'beginStarterRailwayAuthorization'] as const;
const instanceReads = ['listInstances'] as const;
const environmentReads = [...instanceReads, 'getInstanceEnvironment'] as const;

function page<const Id extends string>(id: Id, title: string, render: () => ReactNode, reads: readonly OperationId[] = [], owner = false) {
  const contract = defineComponent({ id, props, render, reads: [...WORKSPACE_READS, ...reads], slots: ['stack'] });
  const screen: ScreenDocument = { id: `screen.${id}`, title, root: { slot: 'full-page', children: [{ slot: 'stack', components: [id] }] } };
  return { contract, screen, owner };
}

export const workspacePages = {
  'workspace.home': page('workspace.home', 'Your teams', WorkspaceHomePage, instanceReads),
  'workspace.create-team': page('workspace.create-team', 'Create a team', CreateTeamPage, ['createTeam']),
  'workspace.invitations': page('workspace.invitations', 'Invitations', InvitationsPage, ['acceptInvitation']),
  'workspace.notifications': page('workspace.notifications', 'Notifications', NotificationsPage,
    ['listInstances', 'listMyNotifications', 'createNotificationRule', 'updateNotificationRule', 'deleteNotificationRule']),
  'workspace.account-profile': page('workspace.account-profile', 'Account profile', AccountPage, ['updateAccountProfile']),
  'workspace.account-emails': page('workspace.account-emails', 'Account email', AccountPage),
  'workspace.account-password': page('workspace.account-password', 'Account password', AccountPage),
  'workspace.account-notifications': page('workspace.account-notifications', 'Account notifications', AccountPage,
    ['getMyNotificationEmail', 'updateMyNotificationEmail']),
  'workspace.templates': page('workspace.templates', 'Choose template', TemplatesPage, ['listInstallableTemplates'], true),
  'workspace.team-launch': page('workspace.team-launch', 'Set up Starter Web', StarterSetupPage, [...starterReads, ...setupReads], true),
  'workspace.team-members': page('workspace.team-members', 'Team members', TeamMembershipPage,
    ['listTeamMembers', 'updateTeamMemberRole', 'removeTeamMember'], true),
  'workspace.team-invitations': page('workspace.team-invitations', 'Team invitations', TeamMembershipPage,
    ['listInvitations', 'createInvitation', 'revokeInvitation'], true),
  'workspace.team-connections': page('workspace.team-connections', 'Connections', ConnectionsPage,
    [...setupReads, 'getHubInstallationOffer', 'listHubInstallationLaunches', 'authorizeHubInstallation', 'getHubInstallationLaunch', 'startHubInstallation', 'maintainHubInstallation', 'listMarketplaceInstallations', 'issueMarketplaceEnrollment',
      'disconnectMarketplaceInstallation', 'getPrivateMarketplaceConnection', 'enrollPrivateMarketplaceConnection'], true),
  'workspace.team': page('workspace.team', 'Team workspace', TeamWorkspace, [...instanceReads, 'listTeamActivity', 'listTeamMembers']),
  'workspace.team-activity': page('workspace.team-activity', 'Activity', TeamWorkspace, [...instanceReads, 'listTeamActivity']),
  'workspace.instance': page('workspace.instance', 'App overview', TeamWorkspace, instanceReads),
  'workspace.instance-status': page('workspace.instance-status', 'App status', TeamWorkspace, [...instanceReads, 'getHostedAppStatus']),
  'workspace.instance-setup': page('workspace.instance-setup', 'Manage app', TeamWorkspace, [...environmentReads, ...starterReads, ...setupReads,
    'getInstanceHostingState', 'applyInstanceHostingPlan', 'removeInstanceHosting', 'redeployInstance'], true),
  'workspace.environment-overview': page('workspace.environment-overview', 'Environment overview', TeamWorkspace, environmentReads),
  'workspace.environment-deployments': page('workspace.environment-deployments', 'Deployments', TeamWorkspace, [...environmentReads, 'redeployHostedStarter']),
  'workspace.environment-configuration': page('workspace.environment-configuration', 'Configuration', TeamWorkspace,
    [...environmentReads, 'getHostedStarterBrand', 'updateHostedStarterBrand', 'listSecretPresence']),
  'workspace.environment-domains': page('workspace.environment-domains', 'Domains', TeamWorkspace,
    [...environmentReads, 'listHostedCustomDomains', 'attachHostedCustomDomain', 'detachHostedCustomDomain']),
  'workspace.unavailable': page('workspace.unavailable', 'Page unavailable', UnavailablePage),
} as const;

export type WorkspacePageId = keyof typeof workspacePages;
export const workspacePageIds = Object.keys(workspacePages) as WorkspacePageId[];
export const workspacePageComponents = Object.fromEntries(workspacePageIds.map((id) => [id, workspacePages[id].contract])) as {
  [K in WorkspacePageId]: typeof workspacePages[K]['contract']
};

export function workspacePageId(route: WorkspaceRoute): WorkspacePageId {
  switch (route.kind) {
    case 'launch': return 'workspace.team-launch';
    case 'account': return `workspace.account-${route.tab}`;
    case 'environment': return `workspace.environment-${route.tab}`;
    default: return `workspace.${route.kind}`;
  }
}
