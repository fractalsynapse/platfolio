import type { ReactElement } from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

type Environment = SuccessOf<'getInstanceEnvironment'>;

export function EnvironmentDomains({ domains, planned, hosting }: Pick<Environment, 'domains' | 'planned'> & { readonly hosting: Environment['hosting'] }): ReactElement {
  const running = hosting && hosting.state !== 'paused' && hosting.state !== 'removed';
  return <section aria-label="Environment domains">
    <h2>Domains</h2>
    {hosting && <div className="ui-workspace-list">
      <div className="ui-workspace-row">
        {running ? <a href={hosting.origin}>{new URL(hosting.origin).hostname}</a> : <span>{new URL(hosting.origin).hostname}</span>}
        <span className="ui-workspace-meta">{running ? 'Railway public address' : 'Last confirmed Railway address'}</span>
      </div>
    </div>}
    {domains.length > 0 ? <ul className="ui-workspace-list">{domains.map(({ host, service }) => <li className="ui-workspace-row" key={host}>
      <strong>{host}</strong><span className="ui-workspace-meta">Planned for {service}</span>
    </li>)}</ul> : !hosting && <p>{planned ? 'No domains are declared for this environment.' : 'Register a deployment plan to see its domains.'}</p>}
  </section>;
}
