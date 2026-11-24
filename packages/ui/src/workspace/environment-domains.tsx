import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

type Domain = SuccessOf<'getInstanceEnvironment'>['domains'][number];

export function EnvironmentDomains({ domains, planned }: { readonly domains: readonly Domain[]; readonly planned: boolean }): React.ReactElement {
  return <section aria-label="Planned domains">
    <h2>Planned domains</h2>
    {domains.length === 0 ? <p>{planned ? 'No domains are declared for this environment.' : 'Register a deployment plan to see its domains.'}</p>
      : <ul className="ui-workspace-list">{domains.map(({ host, service }) => <li className="ui-workspace-row" key={host}>
        <strong>{host}</strong><span className="ui-workspace-meta">Service {service}</span>
      </li>)}</ul>}
  </section>;
}
