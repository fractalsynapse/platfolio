import * as React from 'react';
import { WorkspaceNavigationContext } from './navigation.ts';

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

  return <section>
    <h2>Password</h2>
    <p>Confirm your identity and choose a new password. You’ll return here afterward.</p>
    <button type="button" className="ui-workspace-primary ui-hit-primary" disabled={pending || !navigation?.changePassword} onClick={() => void change()}>
      {pending ? 'Opening password change…' : 'Change password'}
    </button>
    {failed && <p role="alert">Couldn’t open password change. Try again.</p>}
  </section>;
}
