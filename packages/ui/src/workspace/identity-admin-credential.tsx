import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';

export function IdentityAdminCredential({ password, change }: {
  readonly password: string;
  readonly change: (password: string) => void;
}) {
  function generate() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    change(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
  }

  return <div className="ui-workspace-form">
    <p>Use <strong>admin</strong> and this password to sign in to Keycloak. Save the password before launching.</p>
    <WorkspaceField id="identity-admin-password" label="Keycloak admin password">
      <input id="identity-admin-password" type="password" autoComplete="new-password" maxLength={64}
        value={password} onChange={(event) => change(event.target.value)} />
    </WorkspaceField>
    <div className="ui-workspace-links">
      <WorkspaceAction type="button" onClick={generate}>Generate password</WorkspaceAction>
      {password && <a download="shared-identity-admin.txt"
        href={'data:text/plain;charset=utf-8,' + encodeURIComponent(password)}>Download password</a>}
    </div>
  </div>;
}
