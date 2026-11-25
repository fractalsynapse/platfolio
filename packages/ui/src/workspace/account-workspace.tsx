import { Stack } from '../layout/index.ts';
import * as React from 'react';
import { AccountIdentity } from './account-identity.tsx';
import { AccountPassword } from './account-password.tsx';
import { NotificationEmailPreference } from './notification-email-preference.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';
import { accountTabs, workspacePaths } from './routes.ts';
import { SectionNav } from './section-nav.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';

export function AccountWorkspace({ tab }: { readonly tab: keyof typeof accountTabs }): React.ReactElement {
  return <>
    <WorkspaceHeading title="Account" />
    <SectionNav label="Account settings" links={Object.entries(accountTabs).map(([id, item]) => ({ ...item, current: id === tab }))} />
    {tab === 'notifications' ? <Stack>
      <NotificationEmailPreference />
      <WorkspacePanel title="Notification rules" context>
        <WorkspaceLink href={workspacePaths.notifications} className="ui-workspace-trigger ui-hit-primary">Manage notification rules</WorkspaceLink>
      </WorkspacePanel>
    </Stack> : tab === 'password' ? <AccountPassword /> : <AccountIdentity key={tab} tab={tab} />}
  </>;
}
