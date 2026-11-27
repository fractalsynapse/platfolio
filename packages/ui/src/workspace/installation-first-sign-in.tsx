import * as React from 'react';
import { WorkspaceField } from './workspace-field.tsx';

interface InstallationFirstSignInProps {
  readonly password: string;
  readonly confirmation?: { readonly saved: boolean; readonly change: (saved: boolean) => void };
}

export function InstallationFirstSignIn({ password, confirmation }: InstallationFirstSignInProps) {
  const fieldId = React.useId();
  return <fieldset>
    <legend>First sign-in</legend>
    <p>Sign in as <code>owner</code>. You’ll be required to choose a new password. If that screen expires, start sign-in again with this temporary password.</p>
    {!confirmation && <WorkspaceField id={fieldId} label="Temporary password">
      <input id={fieldId} readOnly value={password} autoComplete="off" spellCheck={false}
        onFocus={(event) => event.currentTarget.select()} />
    </WorkspaceField>}
    <p><a download="platfolio-first-sign-in.txt" href={'data:text/plain;charset=utf-8,' + encodeURIComponent(password)}>Download sign-in password</a></p>
    {confirmation && <label><input type="checkbox" required checked={confirmation.saved}
      onChange={(event) => confirmation.change(event.target.checked)} /> I saved the sign-in password in a secure place.</label>}
  </fieldset>;
}
