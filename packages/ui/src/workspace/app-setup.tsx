import * as React from 'react';
import { StarterLaunchScreen } from '../screens/starter-launch.tsx';
import { useOperation } from '../sdk/use-operation.ts';

export function AppSetup({ instanceId, teamId }: { readonly instanceId: string; readonly teamId: string }) {
  const params = React.useMemo(() => ({ instanceId, environment: 'staging' }), [instanceId]);
  const staged = useOperation('getInstanceEnvironment', { params, key: `environment-${instanceId}-staging` });

  if (staged.state.status === 'pending') return <p role="status">Checking the app’s hosting connection…</p>;
  if (staged.state.status === 'failed' && staged.state.error.status !== 404) return <p role="status">
    Couldn’t check this app’s hosting connection.{' '}
    <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={staged.reload}>Try again</button>
  </p>;
  if (staged.state.status !== 'loaded' || !staged.state.data.hosting) {
    return <p>This app has no verified private Railway launch to manage.</p>;
  }
  return <StarterLaunchScreen selectedTeamId={teamId} />;
}
