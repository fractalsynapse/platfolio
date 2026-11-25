import * as React from 'react';
import { AccountWorkspace } from './account-workspace.tsx';
import { useWorkspaceModel } from './workspace-model.ts';

export function AccountPage(): React.ReactElement {
  const { route } = useWorkspaceModel();
  if (route.kind !== 'account') throw new Error('Account page requires an account route');
  return <AccountWorkspace tab={route.tab} />;
}
