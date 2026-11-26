import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { WorkspacePanel } from './workspace-panel.tsx';

type Environment = SuccessOf<'getInstanceEnvironment'>;

export function EnvironmentDomains({ domains, planned, hosting, observation, stale }: Pick<Environment, 'domains' | 'planned'> & {
  readonly hosting: Environment['hosting'];
  readonly observation?: string | undefined;
  readonly stale?: boolean | undefined;
}): React.ReactElement {
  const origin = hosting?.origin;
  const running = hosting && hosting.state !== 'paused' && hosting.state !== 'removed';
  return <WorkspacePanel title="Web addresses" observation={observation} stale={stale}>
    {origin && <div className="ui-workspace-list">
      <div className="ui-workspace-row">
        {running ? <a href={origin}>{new URL(origin).hostname}</a> : <span>{new URL(origin).hostname}</span>}
        <span className="ui-workspace-meta">{running ? 'Railway public address' : 'Last confirmed Railway address'}</span>
      </div>
    </div>}
    {domains.length > 0 ? <ul className="ui-workspace-list">{domains.map(({ host, service }) => <li className="ui-workspace-row" key={host}>
      <strong>{host}</strong><span className="ui-workspace-meta">Planned for {service}</span>
    </li>)}</ul> : !origin && <p>{hosting ? 'This worker has no public address.' : planned ? 'No domains are declared for this environment.' : 'Register a deployment plan to see its domains.'}</p>}
  </WorkspacePanel>;
}
