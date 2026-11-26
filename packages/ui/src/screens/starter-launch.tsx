import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { useOperation, isLoaded } from '../sdk/use-operation.ts';
import { WorkspaceChoice } from '../workspace/workspace-choice.tsx';
import { renderScreen, type ScreenDocument } from './screen.ts';

export const STARTER_LAUNCH_SCREEN: ScreenDocument = {
  id: 'screen.starter-launch', title: 'Launch a starter', root: { slot: 'full-page', components: ['launch.starter'] },
};

export function StarterLaunchScreen({ selectedTeamId, teams, managedProjectId }: {
  readonly selectedTeamId?: string;
  readonly teams?: readonly TeamWithRole[];
  readonly managedProjectId?: string;
} = {}) {
  const params = React.useMemo(() => ({}), []);
  const lookup = useOperation('listTeams', { params, enabled: teams === undefined });
  const [choice, setChoice] = React.useState('');
  const owners = (teams ?? (isLoaded(lookup.state) ? lookup.state.data : [])).filter(({ role }) => role === 'owner');
  const selected = selectedTeamId
    ? owners.find((item) => item.teamId === selectedTeamId)
    : owners.find((item) => item.teamId === choice) ?? owners[0];
  if (!selected) return null;
  const teamId = selected.teamId;
  return <>
    {!selectedTeamId && owners.length > 1 && <WorkspaceChoice label="Launch for" value={teamId} onChange={setChoice}
      options={owners.map(({ teamId, name }) => ({ value: teamId, label: name }))} />}
    <React.Fragment key={teamId}>{renderScreen(STARTER_LAUNCH_SCREEN, () => ({
      teamId, teamName: selected.name, ...(managedProjectId ? { managedProjectId } : {}),
    }))}</React.Fragment>
  </>;
}
