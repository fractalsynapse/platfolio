import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function TeamTabs({ team, current }: { team: TeamWithRole; current?: 'apps' | 'templates' | 'activity' | 'members' | 'connections' }) {
  return <nav aria-label="Team workspace pages" className="ui-workspace-tabs">
    <WorkspaceLink href={workspacePaths.team(team.name)} aria-current={current === 'apps' ? 'page' : undefined}>Team workspace</WorkspaceLink>
    {team.role === 'owner' && <WorkspaceLink href={workspacePaths.templates(team.name)} aria-current={current === 'templates' ? 'page' : undefined}>Choose template</WorkspaceLink>}
    <WorkspaceLink href={workspacePaths.teamActivity(team.name)} aria-current={current === 'activity' ? 'page' : undefined}>Activity</WorkspaceLink>
    {team.role === 'owner' && <>
      <WorkspaceLink href={workspacePaths.teamMembers(team.name)} aria-current={current === 'members' ? 'page' : undefined}>Members</WorkspaceLink>
      <WorkspaceLink href={workspacePaths.teamConnections(team.name)} aria-current={current === 'connections' ? 'page' : undefined}>Connections</WorkspaceLink>
    </>}
  </nav>;
}
