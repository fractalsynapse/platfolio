import * as React from 'react';
import { useOperation, isLoaded } from '../sdk/use-operation.ts';
import { renderScreen, type ScreenDocument } from './screen.ts';

export const STARTER_LAUNCH_SCREEN: ScreenDocument = {
  id: 'screen.starter-launch', title: 'Launch a starter', root: { slot: 'full-page', components: ['launch.starter'] },
};

export function StarterLaunchScreen() {
  const params = React.useMemo(() => ({}), []);
  const teams = useOperation('listTeams', { params });
  const [choice, setChoice] = React.useState('');
  const owners = isLoaded(teams.state) ? teams.state.data.filter(({ role }) => role === 'owner') : [];
  const teamId = owners.find((item) => item.teamId === choice)?.teamId ?? owners[0]?.teamId;
  if (!teamId) return null;
  return <>
    {owners.length > 1 && <p><label>Launch for <select value={teamId} onChange={(event) => setChoice(event.target.value)}>
      {owners.map(({ teamId, name }) => <option key={teamId} value={teamId}>{name}</option>)}
    </select></label></p>}
    <React.Fragment key={teamId}>{renderScreen(STARTER_LAUNCH_SCREEN, () => ({ teamId }))}</React.Fragment>
  </>;
}
