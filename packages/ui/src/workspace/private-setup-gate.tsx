import * as React from 'react';
import { useOperation } from '../sdk/use-operation.ts';
import { PrivateSmtpForm } from './private-smtp-form.tsx';
import { WorkspaceAction } from './workspace-action.tsx';

const params = {};

export function PrivateSetupGate({ children }: { readonly children: React.ReactNode }) {
  const setup = useOperation('getPrivateSetup', { params });
  const needsSetup = setup.state.status === 'loaded' && setup.state.data.smtpRequired && !setup.state.data.smtpConfigured;
  const person = useOperation('getCurrentPerson', { params, enabled: needsSetup });
  if (setup.state.status === 'loaded' && !needsSetup) return children;
  const owner = person.state.status === 'loaded' ? person.state.data.teams.find(({ role }) => role === 'owner') : undefined;
  return <main className="ui-workspace-panel ui-auth-card">
    <h1>Set up private Platfolio email</h1>
    {setup.state.status === 'failed' ? <p role="alert">Couldn’t check email setup. <WorkspaceAction onClick={setup.reload}>Try again</WorkspaceAction></p>
      : owner ? <><p>Connect your SMTP relay to enable password recovery and open the workspace.</p>
        <PrivateSmtpForm teamId={owner.teamId} confirmed={setup.reload} /></>
        : <p role="status">{person.state.status === 'loaded' ? 'The private owner must configure email.' : 'Checking installation setup…'}</p>}
  </main>;
}
