import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function TeamTabs({ team, current }: { team: TeamWithRole; current: 'apps' | 'members' | 'connections' }) {
  return <nav aria-label="Team" className="ui-workspace-links">
    <WorkspaceLink href={workspacePaths.team(team.name)} aria-current={current === 'apps' ? 'page' : undefined}>Apps</WorkspaceLink>
    {team.role === 'owner' && <>
      <WorkspaceLink href={workspacePaths.teamMembers(team.name)} aria-current={current === 'members' ? 'page' : undefined}>Members</WorkspaceLink>
      <WorkspaceLink href={workspacePaths.teamConnections(team.name)} aria-current={current === 'connections' ? 'page' : undefined}>Connections</WorkspaceLink>
    </>}
  </nav>;
}
