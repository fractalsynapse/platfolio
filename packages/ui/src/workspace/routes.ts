const slug = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
export const environmentTabs = {
  overview: 'Overview', deployments: 'Deployments', configuration: 'Configuration', domains: 'Domains',
} as const;
export type EnvironmentTab = keyof typeof environmentTabs;

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

export const accountTabs = {
  profile: { label: 'Profile', href: workspacePaths.account },
  emails: { label: 'Emails', href: workspacePaths.accountEmails },
  password: { label: 'Password', href: workspacePaths.accountPassword },
  notifications: { label: 'Notifications', href: workspacePaths.accountNotifications },
} as const;

export const teamSections = {
  apps: { label: 'Team workspace', href: workspacePaths.team, owner: false, menu: true },
  templates: { label: 'Choose template', href: workspacePaths.templates, owner: true, menu: false },
  activity: { label: 'Activity', href: workspacePaths.teamActivity, owner: false, menu: true },
  members: { label: 'Members', href: workspacePaths.teamMembers, owner: true, menu: true },
  connections: { label: 'Connections', href: workspacePaths.teamConnections, owner: true, menu: true },
} as const;

export function teamSectionLinks(team: { name: string; role: string }, current?: keyof typeof teamSections, menu = false) {
  return Object.entries(teamSections).flatMap(([id, entry]) =>
    (entry.owner && team.role !== 'owner') || (menu && !entry.menu) ? [] : [{ href: entry.href(team.name), label: entry.label, current: current === id }]);
}

export type WorkspaceRoute =
  | { kind: 'home' | 'create-team' | 'invitations' | 'notifications' | 'launch' | 'unavailable' }
  | { kind: 'account'; tab: keyof typeof accountTabs }
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

const staticRoutes = {
  home: workspacePaths.home, 'create-team': workspacePaths.createTeam, invitations: workspacePaths.invitations,
  notifications: workspacePaths.notifications, launch: workspacePaths.launch,
} as const;

const oneSegment = `(${slug})`;
const pathPattern = (path: string) => new RegExp(`^${path}$`);
const teamRoutes = {
  team: workspacePaths.team, 'team-activity': workspacePaths.teamActivity, 'team-members': workspacePaths.teamMembers,
  'team-connections': workspacePaths.teamConnections, 'team-invitations': workspacePaths.teamInvitations,
  templates: workspacePaths.templates, 'team-launch': workspacePaths.launchForTeam,
} as const;
const instanceRoutes = { instance: workspacePaths.instance, 'instance-status': workspacePaths.instanceStatus, 'instance-setup': workspacePaths.instanceSetup } as const;

function routePatterns<K extends string>(routes: Record<K, (...segments: string[]) => string>, params: string[]): [K, RegExp][] {
  return (Object.keys(routes) as K[]).map((kind) => [kind, pathPattern(routes[kind](...params))]);
}

const teamPatterns = routePatterns(teamRoutes, [oneSegment]);
const instancePatterns = routePatterns(instanceRoutes, [oneSegment, oneSegment]);
const environmentSuffixes = Object.keys(environmentTabs).filter((tab) => tab !== 'overview').join('|');
const environmentPattern = pathPattern(`${workspacePaths.environment(oneSegment, oneSegment, oneSegment)}(?:/(${environmentSuffixes}))?`);

export function matchWorkspaceRoute(path: string): WorkspaceRoute {
  const pathname = path.replace(/\/$/, '');
  for (const kind of Object.keys(staticRoutes) as (keyof typeof staticRoutes)[]) {
    if (pathname === staticRoutes[kind]) return { kind };
  }
  for (const tab of Object.keys(accountTabs) as (keyof typeof accountTabs)[]) {
    if (pathname === accountTabs[tab].href) return { kind: 'account', tab };
  }
  for (const [kind, pattern] of teamPatterns) {
    const team = pattern.exec(pathname)?.[1];
    if (team) return { kind, team };
  }
  for (const [kind, pattern] of instancePatterns) {
    const [, team, instance] = pattern.exec(pathname) ?? [];
    if (team && instance) return { kind, team, instance };
  }
  const [, team, instance, environment, subpage] = environmentPattern.exec(pathname) ?? [];
  if (team && instance && environment) {
    return { kind: 'environment', team, instance, environment, tab: (subpage ?? 'overview') as EnvironmentTab };
  }
  return { kind: 'unavailable' };
}

/** OAuth return destinations are local workspace paths with a bounded length. */
export function workspaceReturnPath(path: string | undefined): string | undefined {
  if (!path || path.length > 480 || /[^a-z0-9/-]/.test(path)) return undefined;
  return matchWorkspaceRoute(path).kind === 'unavailable' ? undefined : path;
}
