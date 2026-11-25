import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { StarterLaunchSetup } from '../components/starter-launch-setup.tsx';
import { useOperation } from '../sdk/use-operation.ts';
import { HubMarketplaceInstallations } from './hub-marketplace-installations.tsx';
import { MarketplaceConnection } from './marketplace-connection.tsx';

export function TeamConnections({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const setup = useOperation('getStarterLaunchSetup', { params, key: `starter-setup-${teamId}` });
  const clock = useClock();
  return <section aria-label="Private installation connections">
    {setup.state.status === 'pending' && <p role="status">Checking installation connections…</p>}
    {setup.state.status === 'failed' && (setup.state.error.status === 404
      ? <HubMarketplaceInstallations key={teamId} teamId={teamId} />
      : <p role="status">Couldn’t check the installation connection.{' '}
        <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={setup.reload}>Try again</button>
      </p>)}
    {setup.state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(setup.state.freshness, clock().toISOString()).text}</p>
      <StarterLaunchSetup teamId={teamId} setup={setup.state.data} refresh={setup.reload} />
      <MarketplaceConnection key={teamId} teamId={teamId} />
    </>}
  </section>;
}
