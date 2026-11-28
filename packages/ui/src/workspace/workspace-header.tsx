import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { BrandLabel } from './brand-label.tsx';
import { teamSectionLinks, workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { templatePaths } from './template-presentation.ts';
import { WorkspaceAvatar } from './workspace-avatar.tsx';
import { WorkspaceMenu } from './workspace-menu.tsx';

interface WorkspaceHeaderProps {
  readonly teams: readonly TeamWithRole[];
  readonly team?: string | undefined;
  readonly invitationCount?: number | undefined;
  readonly displayName?: string | undefined;
  readonly signOut: () => void;
  readonly hub?: boolean;
}

export function WorkspaceHeader({ teams, team, invitationCount, displayName, signOut, hub = false }: WorkspaceHeaderProps): React.ReactElement {
  const active = teams.find(({ name }) => name === team) ?? teams[0];
  return <header className="ui-workspace-header">
    <div className="ui-workspace-header-inner">
    <WorkspaceMenu kind="wordmark" label="Platfolio navigation" trigger={<BrandLabel />}>
      <a className="ui-workspace-item ui-hit-primary" href="/">Home</a>
      <a className="ui-workspace-item ui-hit-primary" href={templatePaths.catalog}>Templates</a>
      {active && <div className="ui-workspace-menu-section">
        {teamSectionLinks(active, undefined, true, hub).map(({ href, label }) =>
          <WorkspaceLink key={href} className="ui-workspace-item ui-hit-primary" href={href}>{label}</WorkspaceLink>)}
      </div>}
    </WorkspaceMenu>
    <nav aria-label="Workspace" className="ui-workspace-tools">
      <WorkspaceMenu kind="selector" align="end" label={active ? `Switch team, current team ${active.name}` : 'Switch team'} trigger={<><span className="ui-workspace-team-label">{active?.name ?? 'Choose team'}</span><span aria-hidden="true">▾</span></>}>
        {teams.length ? teams.map((item) => <WorkspaceLink key={item.teamId} href={workspacePaths.team(item.name)}
          className="ui-workspace-item ui-hit-primary" aria-current={active?.name === item.name ? 'true' : undefined}>{item.name}</WorkspaceLink>)
          : <span className="ui-workspace-item">No teams available</span>}
      </WorkspaceMenu>
      <WorkspaceMenu kind="avatar" align="end" hover label="Account menu" trigger={<WorkspaceAvatar name={displayName} />}>
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.account}>Account</WorkspaceLink>
        {!hub && <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.notifications}>Notifications</WorkspaceLink>}
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.home}>Your teams</WorkspaceLink>
        <WorkspaceLink className="ui-workspace-item ui-hit-primary" href={workspacePaths.invitations}>
          Invitations{invitationCount ? ` (${invitationCount})` : ''}
        </WorkspaceLink>
        <WorkspaceAction variant="menu" type="button" onClick={signOut}>Log out</WorkspaceAction>
      </WorkspaceMenu>
    </nav>
    </div>
  </header>;
}
