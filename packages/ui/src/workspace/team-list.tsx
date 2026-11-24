import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function TeamList({ teams }: { readonly teams: readonly TeamWithRole[] }): React.ReactElement {
  if (teams.length === 0) return <p className="ui-workspace-empty">You haven’t joined a team yet.</p>;
  return <ul className="ui-workspace-list" aria-label="Your teams">
    {teams.map((team) => <li key={team.teamId}>
      <WorkspaceLink className="ui-workspace-row ui-hit-primary" href={workspacePaths.team(team.name)}>
        <strong>{team.name}</strong><span className="ui-workspace-meta">{team.role === 'owner' ? 'Owner' : 'Member'}</span>
      </WorkspaceLink>
    </li>)}
  </ul>;
}
