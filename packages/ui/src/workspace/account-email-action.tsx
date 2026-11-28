import * as React from 'react';
import type { RequestBodyOf } from '@platfolio/api-contract/generated/types';
import { useCommand } from '../sdk/use-operation.ts';
import { WorkspaceAction } from './workspace-action.tsx';

export function AccountEmailAction({ action, label }: {
  readonly action: RequestBodyOf<'requestAccountEmailAction'>['action'];
  readonly label: string;
}): React.ReactElement {
  const requestLink = useCommand('requestAccountEmailAction');
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [failed, setFailed] = React.useState(false);

  async function send() {
    setPending(true);
    setMessage('');
    try {
      const result = await requestLink({ params: {}, body: { action } });
      setFailed(!result.ok);
      setMessage(result.ok ? 'Check your primary inbox for a link. It expires in 15 minutes.' : result.error.message);
    } finally {
      setPending(false);
    }
  }

  return <div>
    <WorkspaceAction type="button" variant="primary" disabled={pending} onClick={() => void send()}>
      {pending ? 'Sending…' : label}
    </WorkspaceAction>
    {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
  </div>;
}
