const slug = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
export type EnvironmentTab = 'overview' | 'deployments' | 'configuration' | 'domains';

export const workspacePaths = {
  home: '/dashboard',
  createTeam: '/dashboard/create-team',
  account: '/dashboard/account',
  accountEmails: '/dashboard/account/emails',
  accountPassword: '/dashboard/account/password',
  accountNotifications: '/dashboard/account/notifications',
  invitations: '/dashboard/invitations',
  notifications: '/dashboard/notifications',
  launch: '/dashboard/launch',
  team: (team: string) => `/dashboard/teams/${team}`,
  teamActivity: (team: string) => `/dashboard/teams/${team}/activity`,
  teamMembers: (team: string) => `/dashboard/teams/${team}/members`,
  teamConnections: (team: string) => `/dashboard/teams/${team}/connections`,
  teamInvitations: (team: string) => `/dashboard/teams/${team}/members/invitations`,
  templates: (team: string) => `/dashboard/teams/${team}/create-instance`,
  launchForTeam: (team: string) => `/dashboard/teams/${team}/create-instance/launch`,
  instanceStatus: (team: string, instance: string) => `/dashboard/teams/${team}/instances/${instance}/status`,
  instanceSetup: (team: string, instance: string) => `/dashboard/teams/${team}/instances/${instance}/setup`,
  instance: (team: string, instance: string) => `/dashboard/teams/${team}/instances/${instance}`,
  environment: (team: string, instance: string, environment: string, tab: EnvironmentTab = 'overview') =>
    `/dashboard/teams/${team}/instances/${instance}/environments/${environment}${tab === 'overview' ? '' : `/${tab}`}`,
} as const;

export type WorkspaceRoute =
  | { kind: 'home' | 'create-team' | 'invitations' | 'notifications' | 'launch' | 'unavailable' }
  | { kind: 'account'; tab: 'profile' | 'emails' | 'password' | 'notifications' }
  | { kind: 'team'; team: string }
  | { kind: 'team-activity'; team: string }
  | { kind: 'team-members'; team: string }
  | { kind: 'team-invitations'; team: string }
  | { kind: 'team-connections'; team: string }
  | { kind: 'templates'; team: string }
  | { kind: 'team-launch'; team: string }
  | { kind: 'instance'; team: string; instance: string }
  | { kind: 'instance-setup'; team: string; instance: string }
  | { kind: 'instance-status'; team: string; instance: string }
  | { kind: 'environment'; team: string; instance: string; environment: string; tab: EnvironmentTab };

const teamRoute = new RegExp(`^${workspacePaths.team(`(${slug})`)}$`);
const teamActivityRoute = new RegExp(`^${workspacePaths.teamActivity(`(${slug})`)}$`);
const teamMembersRoute = new RegExp(`^${workspacePaths.teamMembers(`(${slug})`)}$`);
const teamConnectionsRoute = new RegExp(`^${workspacePaths.teamConnections(`(${slug})`)}$`);
const teamInvitationsRoute = new RegExp(`^${workspacePaths.teamInvitations(`(${slug})`)}$`);
const templatesRoute = new RegExp(`^${workspacePaths.templates(`(${slug})`)}$`);
const teamLaunchRoute = new RegExp(`^${workspacePaths.launchForTeam(`(${slug})`)}$`);
const appStatusRoute = new RegExp(`^${workspacePaths.instanceStatus(`(${slug})`, `(${slug})`)}$`);
const appSetupRoute = new RegExp(`^${workspacePaths.instanceSetup(`(${slug})`, `(${slug})`)}$`);
const appRoute = new RegExp(`^${workspacePaths.instance(`(${slug})`, `(${slug})`)}$`);
const environmentRoute = new RegExp(`^${workspacePaths.environment(`(${slug})`, `(${slug})`, `(${slug})`)}(?:/(deployments|configuration|domains))?$`);

export function matchWorkspaceRoute(path: string): WorkspaceRoute {
  const pathname = path.replace(/\/$/, '');
  if (pathname === workspacePaths.home) return { kind: 'home' };
  if (pathname === workspacePaths.createTeam) return { kind: 'create-team' };
  if (pathname === workspacePaths.account) return { kind: 'account', tab: 'profile' };
  if (pathname === workspacePaths.accountEmails) return { kind: 'account', tab: 'emails' };
  if (pathname === workspacePaths.accountPassword) return { kind: 'account', tab: 'password' };
  if (pathname === workspacePaths.accountNotifications) return { kind: 'account', tab: 'notifications' };
  if (pathname === workspacePaths.invitations) return { kind: 'invitations' };
  if (pathname === workspacePaths.notifications) return { kind: 'notifications' };
  if (pathname === workspacePaths.launch) return { kind: 'launch' };
  const [, activityTeam] = teamActivityRoute.exec(pathname) ?? [];
  if (activityTeam) return { kind: 'team-activity', team: activityTeam };
  const [, membersTeam] = teamMembersRoute.exec(pathname) ?? [];
  if (membersTeam) return { kind: 'team-members', team: membersTeam };
  const [, connectedTeam] = teamConnectionsRoute.exec(pathname) ?? [];
  if (connectedTeam) return { kind: 'team-connections', team: connectedTeam };
  const [, invitedTeam] = teamInvitationsRoute.exec(pathname) ?? [];
  if (invitedTeam) return { kind: 'team-invitations', team: invitedTeam };
  const [, templateTeam] = templatesRoute.exec(pathname) ?? [];
  if (templateTeam) return { kind: 'templates', team: templateTeam };
  const [, launchTeam] = teamLaunchRoute.exec(pathname) ?? [];
  if (launchTeam) return { kind: 'team-launch', team: launchTeam };
  const [, team, instance, environment, subpage] = environmentRoute.exec(pathname) ?? [];
  if (team && instance && environment) return {
    kind: 'environment', team, instance, environment,
    tab: subpage === 'deployments' || subpage === 'configuration' || subpage === 'domains' ? subpage : 'overview',
  };
  const [, statusTeam, statusApp] = appStatusRoute.exec(pathname) ?? [];
  if (statusTeam && statusApp) return { kind: 'instance-status', team: statusTeam, instance: statusApp };
  const [, setupTeam, setupApp] = appSetupRoute.exec(pathname) ?? [];
  if (setupTeam && setupApp) return { kind: 'instance-setup', team: setupTeam, instance: setupApp };
  const [, appTeam, app] = appRoute.exec(pathname) ?? [];
  if (appTeam && app) return { kind: 'instance', team: appTeam, instance: app };
  const [, teamName] = teamRoute.exec(pathname) ?? [];
  if (teamName) return { kind: 'team', team: teamName };
  return { kind: 'unavailable' };
}

/** OAuth return destinations are local workspace paths with a bounded length. */
export function workspaceReturnPath(path: string | undefined): string | undefined {
  if (!path || path.length > 480 || /[^a-z0-9/-]/.test(path)) return undefined;
  return matchWorkspaceRoute(path).kind === 'unavailable' ? undefined : path;
}
