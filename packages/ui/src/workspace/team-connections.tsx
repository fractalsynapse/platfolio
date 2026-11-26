import { WorkspaceAction } from './workspace-action.tsx';
import { Stack } from '../layout/index.ts';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { StarterLaunchSetup } from '../components/starter-launch-setup.tsx';
import { useOperation } from '../sdk/use-operation.ts';
import { HubMarketplaceInstallations } from './hub-marketplace-installations.tsx';
import { HubInstallationLaunch } from './hub-installation-launch.tsx';
import { MarketplaceConnection } from './marketplace-connection.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { workspacePaths } from './routes.ts';

export function TeamConnections({ teamId, teamName }: { readonly teamId: string; readonly teamName: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const setup = useOperation('getStarterLaunchSetup', { params, key: `starter-setup-${teamId}` });
  const clock = useClock();
  return <section aria-label="Private installation connections"><Stack>
    {setup.state.status === 'pending' && <p role="status">Checking installation connections…</p>}
    {setup.state.status === 'failed' && (setup.state.error.status === 404
      ? <>
        <HubInstallationLaunch key={`offer-${teamId}`} teamId={teamId} />
        <HubMarketplaceInstallations key={teamId} teamId={teamId} />
      </>
      : <p role="status">Couldn’t check the installation connection.{' '}
        <WorkspaceAction type="button" onClick={setup.reload}>Try again</WorkspaceAction>
      </p>)}
    {setup.state.status === 'loaded' && <>
      <h2>Set up Platfolio</h2>
      <p>Set up secret storage, connect Railway, then connect to the marketplace to install templates.</p>
      <p className="ui-workspace-meta">{ageLabel(setup.state.freshness, clock().toISOString()).text}</p>
      <div className="ui-setup-steps" aria-label="Installation setup">
        <StarterLaunchSetup teamId={teamId} setup={setup.state.data} refresh={setup.reload} />
        <MarketplaceConnection key={teamId} teamId={teamId} />
      </div>
      <p><WorkspaceLink href={workspacePaths.launchForTeam(teamName)}>Set up Starter Web</WorkspaceLink></p>
    </>}
  </Stack></section>;
}
