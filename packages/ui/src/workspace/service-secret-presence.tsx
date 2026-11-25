import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { ParamsOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';

export function ServiceSecretPresence({ scope, names }: {
  readonly scope: ParamsOf<'listSecretPresence'>;
  readonly names: readonly string[];
}): React.ReactElement {
  const { environment, instanceId, service } = scope;
  const params = React.useMemo(() => ({ environment, instanceId, service }), [environment, instanceId, service]);
  const { state, reload } = useOperation('listSecretPresence', { params, key: `presence-${instanceId}-${environment}-${service}` });
  const clock = useClock();
  const presence = state.status === 'loaded' ? new Map(state.data.presence.map((entry) => [entry.name, entry.state])) : new Map();
  return <section aria-label={service}>
    <h3>{service}</h3>
    {state.status === 'pending' && <p role="status">Checking the declared secrets…</p>}
    {state.status === 'failed' && <p role="status">Couldn’t verify secret presence.{' '}
      <WorkspaceAction type="button" onClick={reload}>Check again</WorkspaceAction>
    </p>}
    {state.status === 'loaded' && <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>}
    <ul className="ui-workspace-list">{names.map((name) => {
      const status = presence.get(name);
      return <li className="ui-workspace-row" key={name}>
        <code>{name}</code>
        <span className="ui-workspace-meta">{status === 'set' ? 'Set' : status === 'missing' ? 'Missing' : 'Unverified'}</span>
      </li>;
    })}</ul>
  </section>;
}
