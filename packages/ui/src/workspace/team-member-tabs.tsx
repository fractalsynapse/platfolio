import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function TeamMemberTabs({ team, current }: { team: string; current: 'roster' | 'invitations' }) {
  return <nav aria-label="Membership" className="ui-workspace-links">
    <WorkspaceLink href={workspacePaths.teamMembers(team)} aria-current={current === 'roster' ? 'page' : undefined}>Roster</WorkspaceLink>
    <WorkspaceLink href={workspacePaths.teamInvitations(team)} aria-current={current === 'invitations' ? 'page' : undefined}>Invitations</WorkspaceLink>
  </nav>;
}
