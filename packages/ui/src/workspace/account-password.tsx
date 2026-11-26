import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { WorkspaceNavigationContext } from './navigation.ts';
import { WorkspacePanel } from './workspace-panel.tsx';

export function AccountPassword(): React.ReactElement {
  const navigation = React.useContext(WorkspaceNavigationContext);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function change() {
    setPending(true);
    setFailed(false);
    try {
      await navigation?.changePassword?.();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return <WorkspacePanel title="Change password" form>
    <p>Confirm your identity and choose a new password. You’ll return here afterward.</p>
    <WorkspaceAction type="button" variant="primary" disabled={pending || !navigation?.changePassword} onClick={() => void change()}>
      {pending ? 'Opening password change…' : 'Change password'}
    </WorkspaceAction>
    {failed && <p role="alert">Couldn’t open password change. Try again.</p>}
  </WorkspacePanel>;
}
