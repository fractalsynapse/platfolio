const slug = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';

export const workspacePaths = {
  home: '/dashboard',
  createTeam: '/dashboard/create-team',
  invitations: '/dashboard/invitations',
  launch: '/dashboard/launch',
  team: (team: string) => `/dashboard/teams/${team}`,
  teamInvitations: (team: string) => `/dashboard/teams/${team}/members/invitations`,
  instance: (team: string, instance: string) => `/dashboard/teams/${team}/instances/${instance}`,
  environment: (team: string, instance: string, environment: string) =>
    `/dashboard/teams/${team}/instances/${instance}/environments/${environment}`,
} as const;

export type WorkspaceRoute =
  | { kind: 'home' | 'create-team' | 'invitations' | 'launch' | 'unavailable' }
  | { kind: 'team'; team: string }
  | { kind: 'team-invitations'; team: string }
  | { kind: 'instance'; team: string; instance: string }
  | { kind: 'environment'; team: string; instance: string; environment: string };

const teamRoute = new RegExp(`^${workspacePaths.team(`(${slug})`)}$`);
const teamInvitationsRoute = new RegExp(`^${workspacePaths.teamInvitations(`(${slug})`)}$`);
const appRoute = new RegExp(`^${workspacePaths.instance(`(${slug})`, `(${slug})`)}$`);
const environmentRoute = new RegExp(`^${workspacePaths.environment(`(${slug})`, `(${slug})`, `(${slug})`)}$`);

export function matchWorkspaceRoute(path: string): WorkspaceRoute {
  const pathname = path.replace(/\/$/, '');
  if (pathname === workspacePaths.home) return { kind: 'home' };
  if (pathname === workspacePaths.createTeam) return { kind: 'create-team' };
  if (pathname === workspacePaths.invitations) return { kind: 'invitations' };
  if (pathname === workspacePaths.launch) return { kind: 'launch' };
  const [, invitedTeam] = teamInvitationsRoute.exec(pathname) ?? [];
  if (invitedTeam) return { kind: 'team-invitations', team: invitedTeam };
  const [, team, instance, environment] = environmentRoute.exec(pathname) ?? [];
  if (team && instance && environment) return { kind: 'environment', team, instance, environment };
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
