import { WorkspaceField } from './workspace-field.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';

export function MarketplaceConnection({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const connection = useOperation('getPrivateMarketplaceConnection', { params, key: `marketplace-${teamId}` });
  const enroll = useCommand('enrollPrivateMarketplaceConnection');
  const clock = useClock();
  const input = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.current || pending) return;
    const handoff = input.current.value.trim();
    input.current.value = '';
    setError('');
    setPending(true);
    try {
      const result = await enroll({ params, body: { handoff } });
      if (!result.ok) setError(result.error.status === 409
        ? 'This code could not connect the installation. Ask your marketplace team for a current code.'
        : 'Check OpenBao and the marketplace connection, then paste your code again.');
    } finally {
      setPending(false);
      connection.reload();
    }
  }

  if (connection.state.status === 'pending') return <p role="status">Checking the marketplace connection…</p>;
  if (connection.state.status === 'failed') return <p role="status">Couldn’t check the marketplace connection.{' '}
    <WorkspaceAction type="button" onClick={connection.reload}>Try again</WorkspaceAction>
  </p>;
  if (connection.state.status !== 'loaded') return null;
  const { state, release } = connection.state.data;
  if (state === 'unconfigured') return null;
  return <section className="ui-setup-panel" aria-labelledby="setup-marketplace-title">
    <div className="ui-workspace-heading">
      <h3 id="setup-marketplace-title">Marketplace</h3>
      <span className="ui-setup-status">{state === 'connected' ? 'Connected' : state === 'unavailable' ? 'Needs attention' : 'Connection required'}</span>
    </div>
    <p>Use a one-time code from your hub team to get a saved copy of the Starter Web release.</p>
    <p className="ui-workspace-meta">{ageLabel(connection.state.freshness, clock().toISOString()).text}</p>
    {state === 'connected' && <p>Connected. Your marketplace team can revoke access without stopping your apps.</p>}
    {state === 'openbao-required' && <p>Unlock OpenBao to check this connection.</p>}
    {state === 'unavailable' && <p>Check that the private worker can read its Marketplace entry in OpenBao and reach the marketplace.</p>}
    {release && <p>Saved release <strong>Starter Web {release.version}</strong></p>}
    {state === 'disconnected' && <form className="ui-workspace-form" onSubmit={(event) => void connect(event)}>
      <WorkspaceField id="marketplace-code" label="Marketplace connection code">
        <input id="marketplace-code" ref={input} type="password" required maxLength={80} autoComplete="off" spellCheck={false} disabled={pending} />
      </WorkspaceField>
      <div><WorkspaceAction variant="primary" type="submit" disabled={pending}>{pending ? 'Connecting…' : 'Connect marketplace'}</WorkspaceAction></div>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
