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
    <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={connection.reload}>Try again</button>
  </p>;
  if (connection.state.status !== 'loaded') return null;
  const { state, release } = connection.state.data;
  if (state === 'unconfigured') return null;
  return <section aria-label="Marketplace connection">
    <h3>Marketplace</h3>
    <p className="ui-workspace-meta">{ageLabel(connection.state.freshness, clock().toISOString()).text}</p>
    {state === 'connected' && <p>Connected. Your marketplace team can revoke access without stopping your apps.</p>}
    {state === 'openbao-required' && <p>Unlock OpenBao to check this connection.</p>}
    {state === 'unavailable' && <p>Check that the private worker can read its Marketplace entry in OpenBao and reach the marketplace.</p>}
    {release && <p>Saved release <strong>Starter Web {release.version}</strong></p>}
    {state === 'disconnected' && <form onSubmit={(event) => void connect(event)}>
      <label>Marketplace connection code{' '}
        <input ref={input} type="password" required maxLength={80} autoComplete="off" spellCheck={false} disabled={pending} />
      </label>{' '}
      <button className="ui-hit-primary" type="submit" disabled={pending}>{pending ? 'Connecting…' : 'Connect marketplace'}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
