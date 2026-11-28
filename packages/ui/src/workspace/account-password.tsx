import * as React from 'react';
import { AccountEmailAction } from './account-email-action.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export function AccountPassword(): React.ReactElement {
  return <WorkspacePanel title="Reset password" form>
    <p>Send a password reset link to your verified primary email.</p>
    <AccountEmailAction action="reset-password" label="Send password reset link" />
  </WorkspacePanel>;
}
