import * as React from 'react';
import type { ParamsOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function HostedStarterBrand({ params, canManage, progressPath }: {
  readonly params: ParamsOf<'getHostedStarterBrand'>;
  readonly canManage: boolean;
  readonly progressPath: string;
}) {
  const brand = useOperation('getHostedStarterBrand', { params, key: `starter-brand-${params.instanceId}-${params.environment}` });
  const update = useCommand('updateHostedStarterBrand');
  const clock = useClock();
  const hint = React.useId();
  const [draft, setDraft] = React.useState<string>();
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const [requested, setRequested] = React.useState<string>();
  const current = brand.state.status === 'loaded' ? brand.state.data : undefined;
  const label = draft ?? current?.value ?? '';
  const waiting = current?.state === 'deploying' ||
    (!!requested && current?.state === 'ready' && current.value !== requested);

  React.useEffect(() => {
    if (current?.state === 'failed' || (current?.state === 'ready' && current.value === requested)) setRequested(undefined);
  }, [current, requested]);

  async function save(value: string) {
    setPending(true);
    setProblem('');
    try {
      const result = await update({ params, body: { value } });
      if (result.ok) {
        setDraft(undefined);
        setRequested(value);
      } else {
        setProblem(result.error.status === 503 ? 'Couldn’t start a deployment. Check the Railway and OpenBao connections.' : result.error.message);
      }
      brand.reload();
    } finally { setPending(false); }
  }

  return <section aria-label="App appearance">
    <h3>App appearance</h3>
    {brand.state.status === 'pending' && <p role="status">Checking the app’s header label…</p>}
    {brand.state.status === 'failed' && <p role="status">Couldn’t check the header label.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={brand.reload}>Try again</button>
    </p>}
    {brand.state.status === 'loaded' && <>
      <p>Current header label <strong>{brand.state.data.value ?? 'Unavailable'}</strong></p>
      <p className="ui-workspace-meta">{ageLabel(brand.state.freshness, clock().toISOString()).text}</p>
    </>}
    {current?.state === 'failed' && <p role="status">Deployment needs attention.{' '}
      {canManage && <WorkspaceLink href={progressPath}>Open app setup</WorkspaceLink>}
    </p>}
    {waiting &&
      <p role="status">Waiting for deployment.{' '}{canManage && <WorkspaceLink href={progressPath}>View setup progress</WorkspaceLink>}</p>}
    {canManage && current?.state === 'ready' && !waiting && <form onSubmit={(event) => {
      event.preventDefault();
      if (!pending && label.trim() && label.trim() !== current.value) void save(label.trim());
    }}>
      <p><label>Header label <input type="text" autoComplete="off" maxLength={60} required
        aria-describedby={hint} value={label} onChange={(event) => setDraft(event.currentTarget.value)} disabled={pending} /></label></p>
      <p id={hint}>This label appears publicly in your app. Saving it starts a new staging deployment and keeps the existing database.</p>
      <button type="submit" className="ui-workspace-primary ui-hit-primary"
        disabled={pending || !label.trim() || label.trim() === current.value}>
        {pending ? 'Requesting deployment…' : 'Save and deploy'}
      </button>
    </form>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
