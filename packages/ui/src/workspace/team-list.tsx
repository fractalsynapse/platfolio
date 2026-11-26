import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { ResourceLink } from './resource-link.tsx';

export function TeamList({ teams }: { readonly teams: readonly TeamWithRole[] }): React.ReactElement {
  if (teams.length === 0) return <p className="ui-workspace-empty">You haven’t joined a team yet.</p>;
  return <ul className="ui-environment-list" aria-label="Your teams">
    {teams.map((team) => <li key={team.teamId}>
      <ResourceLink href={workspacePaths.team(team.name)} title={team.name} detail={team.role === 'owner' ? 'Owner' : 'Member'} kind="team" />
    </li>)}
  </ul>;
}
