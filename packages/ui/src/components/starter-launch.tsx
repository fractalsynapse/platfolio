import * as React from 'react';
import { z } from 'zod';
import { ageLabel, useClock } from './freshness.ts';
import { defineComponent } from '../contract.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { isLoaded } from '../sdk/transport.ts';
import { WorkspacePanel } from '../workspace/workspace-panel.tsx';
import { WorkspaceLink } from '../workspace/workspace-link.tsx';
import { HostingRemoval } from '../workspace/hosting-removal.tsx';
import { WorkspaceAction } from '../workspace/workspace-action.tsx';
import { LaunchProgress } from '../workspace/launch-progress.tsx';
import { workspacePaths } from '../workspace/routes.ts';
import { StarterLaunchSetup } from './starter-launch-setup.tsx';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

import { sealOwnerRecovery } from './launch-recovery.ts';
import { IdentityAdminCredential } from '../workspace/identity-admin-credential.tsx';

type Launch = SuccessOf<'getStarterLaunch'>;
const headings: Record<Launch['state'], string> = {
  idle: 'Ready to set up', running: 'Setting up your app', ready: 'Your app is ready',
  failed: 'Setup needs attention', removing: 'Removing your app', kept: 'App removed. Data kept.', wiped: 'App removed. Data scheduled for deletion.',
};
const props = z.object({ teamId: z.string().min(1), teamName: z.string().min(1).optional(),
  managedProjectId: z.string().min(1).optional(), template: z.literal('shared-identity').optional(),
}).strict();

function LaunchPanel({ teamId, teamName, managedProjectId, template }: z.infer<typeof props>) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const selected = React.useMemo(() => ({ teamId, ...(template ? { template } : {}) }), [teamId, template]);
  const launch = useOperation('getStarterLaunch', { params: selected, key: `starter-${teamId}-${template ?? 'starter-web'}` });
  const setup = useOperation('getStarterLaunchSetup', { params, key: `starter-setup-${teamId}` });
  const local = setup.state.status === 'failed' && setup.state.error.status === 404;
  const ready = (!template && local) || setup.state.status === 'loaded' && setup.state.data.openBao === 'ready' && setup.state.data.railway === 'connected';
  const canWipeData = local || setup.state.status === 'loaded' && setup.state.data.canWipeData === true;
  const start = useCommand('startStarterLaunch');
  const remove = useCommand('removeStarterLaunch');
  const [password, setPassword] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const report = isLoaded(launch.state) ? launch.state.data : null;
  const now = useClock();

  async function act(action: 'start' | 'keep' | 'wipe', confirmation?: string) {
    setProblem('');
    setPending(true);
    try {
      const bootstrap = action === 'start' && template && setup.state.status === 'loaded'
        ? await sealOwnerRecovery(setup.state.data.workerKey, new TextEncoder().encode(password)) : undefined;
      const result = action === 'start' ? await start({ params: selected, ...(bootstrap ? { body: { bootstrap } } : {}) })
        : await remove({ params: selected, body: { data: action, ...(confirmation === undefined ? {} : { confirmation }) } });
      if (!result.ok) setProblem([400, 409].includes(result.error.status) ? result.error.message : 'Platfolio could not accept that action. Try again.');
      if (result.ok) setPassword('');
      return result.ok;
    } catch {
      setProblem('Could not prepare the request. Refresh the page and try again.');
      return false;
    } finally {
      launch.reload();
      setPending(false);
    }
  }

  const reportedProjectId = report?.state === 'wiped' ? report.removedProjectId : report?.projectId;
  if (managedProjectId && reportedProjectId !== managedProjectId && launch.state.status === 'loaded') {
    return <WorkspacePanel title="Hosting">Platfolio couldn’t match this app’s Railway project to the saved launch.</WorkspacePanel>;
  }
  if (!managedProjectId && report?.registration === 'recorded' && report.instanceName && teamName) {
    return <WorkspacePanel title="Your app is ready">
      <div className="ui-workspace-links">
        <WorkspaceLink className="ui-workspace-primary ui-hit-primary" href={workspacePaths.instanceSetup(teamName, report.instanceName)}>Manage app</WorkspaceLink>
        {report.origin && <a className="ui-workspace-secondary ui-hit-primary" href={report.origin}>Open app</a>}
      </div>
    </WorkspacePanel>;
  }

  return <WorkspacePanel title={managedProjectId ? 'Hosting' : template ? 'Launch Shared Identity' : 'Launch Starter Web'}>
    {launch.state.status === 'pending' && <p role="status">Checking your launch setup…</p>}
    {launch.state.status === 'failed' && <p role="status">{launch.state.error.status === 404
      ? 'This team needs a connected Railway launcher.' : `Could not check launch setup. Try again. (${launch.state.error.code})`}</p>}
    {setup.state.status === 'loaded' && !managedProjectId && <>
      <div className="ui-setup-steps" aria-label="Installation setup">
        <StarterLaunchSetup teamId={teamId} setup={setup.state.data} refresh={setup.reload} />
      </div>
      <small>{ageLabel(setup.state.freshness, now().toISOString()).text}</small>
    </>}
    {report && <>
      <p role="status" aria-label="Launch status"><strong>{headings[report.state]}</strong></p>
      {launch.state.status === 'loaded' && <small>{ageLabel(launch.state.freshness, now().toISOString()).text}</small>}
      {ready && (managedProjectId ? report.state === 'kept' : ['idle', 'failed', 'kept', 'wiped'].includes(report.state)) && <>
        <p>{report.state === 'kept'
          ? 'Restore the app and reconnect its retained data in Railway.'
          : 'Use your connected Railway workspace. This creates a dedicated staging project and database. Anyone with the generated app link can open it. Railway charges apply to the resources you use.'}</p>
        {template && <IdentityAdminCredential password={password} change={setPassword} />}
        <WorkspaceAction variant="primary" disabled={pending || !!template && !/^[A-Za-z0-9_-]{32,64}$/.test(password)}
          onClick={() => void act('start')}>{report.state === 'kept' ? 'Restore app' : report.state === 'failed' ? 'Resume setup' : template ? 'Launch Shared Identity' : 'Launch starter'}</WorkspaceAction>
      </>}
      {report.state === 'ready' && <p className="ui-workspace-links">
        {report.origin && <a href={report.origin}>Open app</a>}
      </p>}
      {report.registration === 'pending' && <p role="status">Adding this app to Team workspace…</p>}
      {report.registration === 'conflict' && <p role="status">Another instance uses this name. Its settings have been preserved.</p>}
      <p>{template ? 'Shared Identity uses a private PostgreSQL database. Create your own realm in Keycloak for your apps.' : 'Starter Web uses a generated database connection.'}</p>
      <LaunchProgress report={report} />
      {ready && report.projectId && ['ready', 'kept', 'failed'].includes(report.state) &&
        <HostingRemoval name={report.instanceName ?? report.template} pending={pending} canWipe={canWipeData}
          onRemove={({ data, confirmation }) => act(data, confirmation)} />}
    </>}
    {problem && <p role="alert">{problem}</p>}
    {managedProjectId && report?.state !== 'wiped' && !ready && teamName &&
      <WorkspaceLink href={workspacePaths.teamConnections(teamName)}>Check team connections</WorkspaceLink>}
  </WorkspacePanel>;
}

export const starterLaunch = defineComponent({
  id: 'launch.starter', props, reads: ['getStarterLaunch', 'startStarterLaunch', 'removeStarterLaunch', 'getStarterLaunchSetup', 'initializeStarterOpenBao', 'unlockStarterOpenBao', 'beginStarterRailwayAuthorization'],
  slots: ['full-page'], render: LaunchPanel,
});
