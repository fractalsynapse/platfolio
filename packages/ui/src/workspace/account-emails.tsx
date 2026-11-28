import * as React from 'react';
import type { RequestBodyOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { AccountEmailAction } from './account-email-action.tsx';
import { OperationState } from './operation-state.tsx';
import { ResourceText } from './resource-text.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { useWorkspaceModel } from './workspace-model.ts';
import { WorkspacePanel } from './workspace-panel.tsx';

const params = {};

export function AccountEmails(): React.ReactElement {
  const emails = useOperation('getAccountEmails', { params });
  const update = useCommand('updateAccountEmails');
  const { profile } = useWorkspaceModel();
  const clock = useClock();
  const [address, setAddress] = React.useState('');
  const [code, setCode] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ text: string; failed: boolean }>();

  async function save(body: RequestBodyOf<'updateAccountEmails'>) {
    setPending(true);
    setMessage(undefined);
    try {
      const result = await update({ params, body });
      if (!result.ok) {
        setMessage({ text: result.error.message, failed: true });
        return;
      }
      emails.acceptConfirmed(result.value);
      if (body.action === 'make-primary') profile.reload();
      setCode('');
      setAddress('');
      setMessage({ text: body.action === 'add' ? 'Check that inbox for a verification code.' : 'Email settings saved.', failed: false });
    } finally {
      setPending(false);
    }
  }

  const loaded = emails.state.status === 'loaded' ? emails.state : undefined;
  const observation = loaded && ageLabel(loaded.freshness, clock().toISOString());
  return <WorkspacePanel title="Email addresses" observation={observation?.text} stale={observation?.mayBeStale}>
    <OperationState status={emails.state.status} pending="Loading your addresses…" retry={emails.reload} failed="Couldn’t open your email settings." />
    {loaded && <>
      <p>Sign in with your username or primary email. Team invitations go to your verified primary email.</p>
      <ul className="ui-workspace-list ui-resource-list">
        {loaded.data.addresses.map(({ email, primary, verified }) => <li key={email} className="ui-workspace-row">
          <ResourceText title={email} detail={primary ? 'Primary email' : 'Secondary email'} />
          <span className="ui-setup-status" data-tone={verified ? 'success' : 'attention'}>{verified ? 'Verified' : 'Unverified'}</span>
          {primary && !verified && loaded.data.selfVerification &&
            <AccountEmailAction action="verify-primary" label="Send verification link" />}
          {!primary && verified && loaded.data.multipleEmails &&
            <WorkspaceAction type="button" disabled={pending} onClick={() => void save({ action: 'make-primary', email })}>Make primary</WorkspaceAction>}
          {!primary && loaded.data.multipleEmails &&
            <WorkspaceAction type="button" disabled={pending} onClick={() => void save({ action: 'remove', email })}>Remove</WorkspaceAction>}
          {!primary && !verified && loaded.data.multipleEmails &&
            <form className="ui-workspace-form" onSubmit={(event) => {
              event.preventDefault();
              void save({ action: 'verify', email, code: code.trim() });
            }}>
              <WorkspaceField id="verify-email-code" label="Verification code">
                <input id="verify-email-code" value={code} autoComplete="one-time-code" minLength={24} maxLength={24} required
                  onChange={(event) => setCode(event.target.value)} />
              </WorkspaceField>
              <WorkspaceAction type="submit" disabled={pending}>Verify email</WorkspaceAction>
              <WorkspaceAction type="button" disabled={pending} onClick={() => void save({ action: 'add', email })}>Resend code</WorkspaceAction>
            </form>}
        </li>)}
      </ul>
      {loaded.data.multipleEmails && <form className="ui-workspace-form" onSubmit={(event) => {
        event.preventDefault();
        void save({ action: 'add', email: address.trim() });
      }}>
        <WorkspaceField id="add-account-email" label="Add email address">
          <input id="add-account-email" type="email" maxLength={254} value={address} required onChange={(event) => setAddress(event.target.value)} />
        </WorkspaceField>
        <WorkspaceAction type="submit" variant="primary" disabled={pending}>Send verification code</WorkspaceAction>
      </form>}
      {message && <p role={message.failed ? 'alert' : 'status'}>{message.text}</p>}
    </>}
  </WorkspacePanel>;
}
