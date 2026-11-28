import { Stack } from '../layout/index.ts';
import * as React from 'react';
import { AccountEmails } from './account-emails.tsx';
import { AccountIdentity } from './account-identity.tsx';
import { AccountPassword } from './account-password.tsx';
import { NotificationEmailPreference } from './notification-email-preference.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';
import { accountTabs, workspacePaths } from './routes.ts';
import { SectionNav } from './section-nav.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { WorkspaceNavigationContext } from './navigation.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { PrivateSmtpForm } from './private-smtp-form.tsx';

const params = {};

export function AccountWorkspace({ tab }: { readonly tab: keyof typeof accountTabs }): React.ReactElement {
  const hub = React.useContext(WorkspaceNavigationContext)?.installationRole === 'hub';
  const setup = useOperation('getPrivateSetup', { params, enabled: !hub && tab === 'emails' });
  const managesSmtp = setup.state.status === 'loaded' && setup.state.data.smtpRequired;
  const person = useOperation('getCurrentPerson', { params, enabled: managesSmtp });
  const owner = person.state.status === 'loaded' && person.state.data.teams.find(({ role }) => role === 'owner');
  const [saved, setSaved] = React.useState(false);
  return <>
    <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Account' }]} />
    <WorkspaceHeading title="Account" />
    <div className="ui-account-settings">
      <SectionNav label="Account settings" links={Object.entries(accountTabs).map(([id, item]) => ({ ...item, current: id === tab }))} />
      {tab === 'notifications' ? <WorkspacePanel title="Notification routing" form>
        <Stack>
          <NotificationEmailPreference />
          {!hub && <WorkspaceLink href={workspacePaths.notifications} className="ui-workspace-secondary ui-hit-primary">Manage notification rules</WorkspaceLink>}
        </Stack>
      </WorkspacePanel> : tab === 'password' ? <AccountPassword /> : tab === 'emails' ? <AccountEmails /> : <AccountIdentity />}
      {tab === 'emails' && managesSmtp && owner && <WorkspacePanel title="Private SMTP relay" form>
        <PrivateSmtpForm teamId={owner.teamId} confirmed={() => { setSaved(true); setup.reload(); }} />
        {saved && <p role="status">SMTP relay verified and saved.</p>}
      </WorkspacePanel>}
    </div>
  </>;
}
