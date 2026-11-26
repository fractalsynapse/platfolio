import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { ResourceLink } from './resource-link.tsx';

export function TeamList({ teams, instanceCounts }: {
  readonly teams: readonly TeamWithRole[];
  readonly instanceCounts: ReadonlyMap<string, number> | undefined;
}): React.ReactElement {
  if (teams.length === 0) return <p className="ui-workspace-empty">You don’t belong to a team yet.</p>;
  return <ul className="ui-environment-list" aria-label="Your teams">
    {teams.map((team) => {
      const role = team.role === 'owner' ? 'Owner' : 'Member';
      const count = instanceCounts?.get(team.teamId) ?? 0;
      const detail = instanceCounts ? `${role} · ${count} ${count === 1 ? 'instance' : 'instances'}` : role;
      return <li key={team.teamId}><ResourceLink href={workspacePaths.team(team.name)} title={team.name} detail={detail} kind="team" /></li>;
    })}
  </ul>;
}
