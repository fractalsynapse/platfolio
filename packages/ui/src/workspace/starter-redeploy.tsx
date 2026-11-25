import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { ParamsOf } from '@platfolio/api-contract/generated/types';
import { useCommand } from '../sdk/use-operation.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function StarterRedeploy({ params, progressPath }: {
  readonly params: ParamsOf<'redeployHostedStarter'>;
  readonly progressPath: string;
}) {
  const deploy = useCommand('redeployHostedStarter');
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ message: string; error: boolean }>();

  async function requestDeployment() {
    setPending(true);
    setFeedback(undefined);
    try {
      const result = await deploy({ params });
      setFeedback(result.ok ? { message: 'Deployment requested.', error: false }
        : { message: result.error.status === 409 ? 'Finish the current setup before deploying again.'
          : 'Couldn’t start a deployment. Check the Railway and OpenBao connections.', error: true });
    } finally { setPending(false); }
  }

  return <section aria-label="Deploy pinned release">
    <h2>Deploy pinned release</h2>
    <p>Rebuild this release in the existing staging project. The database and storage stay in place.</p>
    <WorkspaceAction variant="primary" type="button" disabled={pending}
      onClick={() => void requestDeployment()}>{pending ? 'Requesting deployment…' : 'Deploy again'}</WorkspaceAction>
    {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.message}{' '}
      <WorkspaceLink href={progressPath}>View setup progress</WorkspaceLink></p>}
  </section>;
}
