import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

type Deployment = SuccessOf<'getInstanceEnvironment'>['deployments'][number];
const resultText: Record<Deployment['result'], string> = {
  ok: 'Completed', partial: 'Partially completed', failed: 'Failed', noop: 'No changes',
};

export function EnvironmentDeployments({ deployments }: { readonly deployments: readonly Deployment[] }): React.ReactElement {
  return <section aria-label="Deployment reports">
    <h2>Deployment reports</h2>
    {deployments.length === 0 ? <p>No deployment reports for this environment.</p> : <ul className="ui-workspace-list">
      {deployments.map(({ id, result, reportedAt, commit, problem }) => <li className="ui-workspace-row" key={id}>
        <div>
          <strong>{resultText[result]}</strong>
          {commit && <p className="ui-workspace-meta">Commit <code>{commit.slice(0, 12)}</code></p>}
          {problem && <p>Reported issue <code>{problem}</code></p>}
        </div>
        <time className="ui-workspace-meta" dateTime={reportedAt}>{new Date(reportedAt).toLocaleString()}</time>
      </li>)}
    </ul>}
  </section>;
}
