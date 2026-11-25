import * as React from 'react';
import { MyInvitations } from './my-invitations.tsx';
import { useWorkspaceModel } from './workspace-model.ts';

export function InvitationsPage(): React.ReactElement {
  const { invitations, reloadTeams } = useWorkspaceModel();
  return <MyInvitations invitations={invitations} onAccepted={reloadTeams} />;
}
