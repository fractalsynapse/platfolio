import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { WorkspacePanel } from './workspace-panel.tsx';

export function HubInstallationLaunch({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const offer = useOperation('getHubInstallationOffer', { params, key: `installation-offer-${teamId}` });
  const clock = useClock();
  const state = offer.state;

  if (state.status === 'pending') return <p role="status">Checking the Platfolio installer…</p>;
  if (state.status === 'failed' && state.error.status === 404) return null;

  return <WorkspacePanel title="Launch private Platfolio">
    {state.status === 'failed' ? <p role="status">Couldn’t find the installer.{' '}
      <WorkspaceAction type="button" onClick={offer.reload}>Try again</WorkspaceAction>
    </p> : <>
      <p>Start a new Railway project named <strong>platfolio</strong>. Then sign in to your installation and open Connections to unlock secret storage.</p>
      <dl className="ui-workspace-facts">
        <div><dt>What runs</dt><dd>Platfolio, Keycloak, OpenBao, and PostgreSQL</dd></div>
        <div><dt>Hosting</dt><dd>Your Railway workspace. Railway charges for the resources you use.</dd></div>
        <div><dt>Installer build</dt><dd><code>{state.data.revision.slice(0, 7)}</code></dd></div>
      </dl>
      <p>Sign in with your setup email or <code>owner</code>. Railway generates the first password in the sign-in service’s Variables tab.</p>
      <p className="ui-workspace-links"><a className="ui-workspace-primary ui-hit-primary" target="_blank" rel="noopener"
        href={`https://railway.com/deploy/${state.data.templateCode}`}>Continue to Railway</a></p>
      <p className="ui-workspace-meta">Opens Railway in a new tab. {ageLabel(state.freshness, clock().toISOString()).text}</p>
    </>}
  </WorkspacePanel>;
}
