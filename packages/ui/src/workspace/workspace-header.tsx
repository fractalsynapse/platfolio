import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspaceMenu } from './workspace-menu.tsx';

interface WorkspaceHeaderProps {
  readonly teams: readonly TeamWithRole[];
  readonly team?: string | undefined;
  readonly invitationCount?: number | undefined;
  readonly signOut: () => void;
}

export function WorkspaceHeader({ teams, team, invitationCount, signOut }: WorkspaceHeaderProps): React.ReactElement {
  return <header className="ui-workspace-header">
    <WorkspaceMenu label="Platfolio navigation" trigger={<><span className="ui-workspace-mark" aria-hidden="true">P</span> Platfolio</>}>
      <a className="ui-workspace-item ui-hit-primary" href="/">Home</a>
      {team && <div className="ui-workspace-menu-section">
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.team(team)}>Team workspace</WorkspaceLink>
      </div>}
    </WorkspaceMenu>
    <nav aria-label="Workspace" className="ui-workspace-tools">
      <WorkspaceMenu align="end" label={team ? `Switch team, current team ${team}` : 'Switch team'} trigger={<><span className="ui-workspace-team-label">{team ?? 'Choose team'}</span><span aria-hidden="true">▾</span></>}>
        {teams.length ? teams.map((item) => <WorkspaceLink key={item.teamId} href={workspacePaths.team(item.name)}
          className="ui-workspace-item ui-hit-primary" aria-current={team === item.name ? 'true' : undefined}>{item.name}</WorkspaceLink>)
          : <span className="ui-workspace-item">No teams available</span>}
      </WorkspaceMenu>
      <WorkspaceMenu align="end" hover label="Account menu" trigger={<span className="ui-workspace-avatar" aria-hidden="true"><span className="ui-workspace-avatar-head" /><span className="ui-workspace-avatar-body" /></span>}>
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.account}>Account</WorkspaceLink>
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.home}>Your teams</WorkspaceLink>
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.invitations}>
          Invitations{invitationCount ? ` (${invitationCount})` : ''}
        </WorkspaceLink>
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.notifications}>Notifications</WorkspaceLink>
        <button className="ui-workspace-item ui-hit-primary" type="button" onClick={signOut}>Log out</button>
      </WorkspaceMenu>
    </nav>
  </header>;
}
