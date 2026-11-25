import * as React from 'react';
import { NotificationsWorkspace } from './notifications-workspace.tsx';
import { useWorkspaceModel } from './workspace-model.ts';

export function NotificationsPage(): React.ReactElement {
  return <NotificationsWorkspace teams={useWorkspaceModel().teams.data} />;
}
