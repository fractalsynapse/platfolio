import * as React from 'react';
import { AccountIdentity } from './account-identity.tsx';
import { AccountPassword } from './account-password.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { workspacePaths } from './routes.ts';

const tabs = [
  { id: 'profile', label: 'Profile', href: workspacePaths.account },
  { id: 'emails', label: 'Emails', href: workspacePaths.accountEmails },
  { id: 'password', label: 'Password', href: workspacePaths.accountPassword },
] as const;

export function AccountWorkspace({ tab }: { readonly tab: typeof tabs[number]['id'] }): React.ReactElement {
  return <>
    <h1>Account</h1>
    <nav className="ui-workspace-tabs" aria-label="Account settings">
      {tabs.map(({ id, label, href }) => <WorkspaceLink key={id} href={href} aria-current={id === tab ? 'page' : undefined}>{label}</WorkspaceLink>)}
    </nav>
    {tab === 'password' ? <AccountPassword /> : <AccountIdentity key={tab} tab={tab} />}
  </>;
}
