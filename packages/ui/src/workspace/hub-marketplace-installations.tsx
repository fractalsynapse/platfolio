import * as React from 'react';
import type { MarketplaceInstallation } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';

const stateLabel: Record<MarketplaceInstallation['state'], string> = {
  pending: 'Waiting for connection',
  connected: 'Connected',
  linked: 'Linked without a marketplace credential',
  disconnected: 'Disconnected',
};

export function HubMarketplaceInstallations({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const connections = useOperation('listMarketplaceInstallations', { params, key: `marketplace-installations-${teamId}` });
  const issue = useCommand('issueMarketplaceEnrollment');
  const disconnect = useCommand('disconnectMarketplaceInstallation');
  const clock = useClock();
  const now = clock();
  const nextId = React.useRef<string>(undefined);
  const [code, setCode] = React.useState<{ installationId: string; value: string; expiresAt: string }>();
  const [confirm, setConfirm] = React.useState<string>();
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const codeLabel = React.useId();

  async function issueCode(existingId?: string) {
    if (pending) return;
    const installationId = existingId ?? (nextId.current ??= crypto.randomUUID());
    setCode(undefined);
    setPending(true);
    setProblem('');
    try {
      const result = await issue({ params: { teamId, installationId } });
      if (!result.ok) {
        setProblem('Couldn’t issue a connection code. Check the installation state and try again.');
        return;
      }
      if (!existingId) nextId.current = undefined;
      setCode({ installationId, value: result.value.enrollmentCode, expiresAt: result.value.expiresAt });
    } finally {
      connections.reload();
      setPending(false);
    }
  }

  async function revoke(installationId: string) {
    if (pending) return;
    setPending(true);
    setProblem('');
    try {
      const result = await disconnect({ params: { teamId, installationId } });
      if (!result.ok) {
        setProblem('Couldn’t disconnect marketplace access. Try again.');
        return;
      }
      setCode((current) => current?.installationId === installationId ? undefined : current);
      setConfirm(undefined);
    } finally {
      connections.reload();
      setPending(false);
    }
  }

  const state = connections.state;
  if (state.status === 'pending') return <p role="status">Checking marketplace connections…</p>;
  if (state.status === 'failed') return state.error.status === 404
    ? <p>Connections are managed in the private Platfolio installation for this team.</p>
    : <p role="status">Couldn’t check marketplace connections.{' '}
      <button className="ui-hit-primary ui-workspace-trigger" type="button" onClick={connections.reload}>Try again</button>
    </p>;
  if (state.status !== 'loaded') return null;
  const codeState = state.data.find(({ installationId }) => installationId === code?.installationId)?.state;
  const showCode = code && Date.parse(code.expiresAt) > now.getTime() && (codeState === undefined || codeState === 'pending');

  return <section aria-label="Marketplace installations">
    <h2>Private installations</h2>
    <p>Create a one-time code for a private Platfolio to connect to your team’s marketplace.</p>
    <p className="ui-workspace-meta">{ageLabel(state.freshness, now.toISOString()).text}</p>
    <button className="ui-hit-primary ui-workspace-primary" type="button" disabled={pending} onClick={() => void issueCode()}>
      Create connection code
    </button>
    {showCode && <section aria-label="New connection code">
      <p>Paste the code into <strong>Connections → Marketplace</strong> in your private Platfolio.
        It expires at {new Date(code.expiresAt).toLocaleTimeString()}.</p>
      <label htmlFor={codeLabel}>One-time connection code</label>{' '}
      <input id={codeLabel} readOnly autoComplete="off" spellCheck={false} value={code.installationId + ':' + code.value}
        onFocus={(event) => event.currentTarget.select()} />{' '}
      <button className="ui-hit-primary ui-workspace-trigger" type="button" onClick={() => setCode(undefined)}>Hide code</button>
    </section>}
    {problem && <p role="alert">{problem}</p>}
    {state.data.length === 0 ? <p>No marketplace connections yet.</p> :
      <ul className="ui-workspace-list">{state.data.map(({ installationId, state: connection }) => <li className="ui-workspace-row" key={installationId}>
        <div>
          <strong>{stateLabel[connection]}</strong>
          <p className="ui-workspace-meta"><code>{installationId}</code></p>
        </div>
        {connection !== 'disconnected' && (confirm === installationId ? <div>
          <p>End marketplace access for this installation? Its apps and saved releases stay available.</p>
          <button className="ui-hit-primary" type="button" disabled={pending} onClick={() => void revoke(installationId)}>End access</button>{' '}
          <button className="ui-hit-primary ui-workspace-trigger" type="button" disabled={pending} onClick={() => setConfirm(undefined)}>Cancel</button>
        </div> : <div>
          {connection === 'pending' && <button className="ui-hit-primary ui-workspace-trigger" type="button" disabled={pending}
            onClick={() => void issueCode(installationId)}>Replace code</button>}{' '}
          <button className="ui-hit-primary ui-workspace-trigger" type="button" disabled={pending} onClick={() => setConfirm(installationId)}>
            {connection === 'pending' ? 'Cancel connection' : 'Disconnect'}
          </button>
        </div>)}
      </li>)}</ul>}
  </section>;
}
