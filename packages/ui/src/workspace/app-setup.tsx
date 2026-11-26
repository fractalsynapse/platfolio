import { WorkspaceAction } from './workspace-action.tsx';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { InstanceHosting } from './instance-hosting.tsx';
import { useWorkspaceModel } from './workspace-model.ts';
import * as React from 'react';
import { StarterLaunchScreen } from '../screens/starter-launch.tsx';
import { useOperation } from '../sdk/use-operation.ts';

export function AppSetup({ app, teamId }: { readonly app: InstanceResponse; readonly teamId: string }) {
  const { teams } = useWorkspaceModel();
  const instanceId = app.id;
  const params = React.useMemo(() => ({ instanceId, environment: 'staging' }), [instanceId]);
  const staged = useOperation('getInstanceEnvironment', { params, key: `environment-${instanceId}-staging` });

  if (staged.state.status === 'pending') return <p role="status">Checking the app’s hosting connection…</p>;
  if (staged.state.status === 'failed' && staged.state.error.status !== 404) return <p role="status">
    Couldn’t check this app’s hosting connection.{' '}
    <WorkspaceAction type="button" onClick={staged.reload}>Try again</WorkspaceAction>
  </p>;
  if (staged.state.status !== 'loaded' || !staged.state.data.hosting) {
    return <InstanceHosting app={app} />;
  }
  return <StarterLaunchScreen teams={teams.data} selectedTeamId={teamId} managedProjectId={staged.state.data.hosting.projectId} />;
}
