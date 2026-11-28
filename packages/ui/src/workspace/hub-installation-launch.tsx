import * as React from 'react';
import type { RequestBodyOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { createInstallationOwner } from '../web/installation-owner.ts';
import { InstallationFirstSignIn } from './installation-first-sign-in.tsx';
import { LaunchProgress } from './launch-progress.tsx';
import { OperationState } from './operation-state.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceChoice } from './workspace-choice.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

type Maintenance = RequestBodyOf<'maintainHubInstallation'>;
type MaintenanceChoice = Omit<Extract<Maintenance, { action: 'wipe' }>, 'confirmation'> | Extract<Maintenance, { action: 'update' }>;

const environmentChoices = ['staging', 'production'] as const;

export function HubInstallationLaunch({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const offer = useOperation('getHubInstallationOffer', { params, key: 'installation-offer-' + teamId });
  const offeredRevision = offer.state.status === 'loaded' ? offer.state.data.revision : undefined;
  const managedFirstSignIn = offer.state.status === 'loaded' && offer.state.data.managedFirstSignIn === true;
  const [activeId, setActiveId] = React.useState('');
  const journals = useOperation('listHubInstallationLaunches', { params, enabled: offer.state.status === 'loaded' });
  const history = journals.state.status === 'loaded' ? journals.state.data : [];
  const selection = history.find(({ id }) => id === activeId);
  const authorize = useCommand('authorizeHubInstallation');
  const start = useCommand('startHubInstallation');
  const maintain = useCommand('maintainHubInstallation');
  const forget = useCommand('forgetHubInstallation');
  const reveal = useCommand('getHubInstallationFirstSignIn');
  const [maintenance, setMaintenance] = React.useState<MaintenanceChoice>();
  const [consent, setConsent] = React.useState<SuccessOf<'authorizeHubInstallation'>>();
  const [workspace, setWorkspace] = React.useState('');
  const [firstSignIn, setFirstSignIn] = React.useState<{ credential: Awaited<ReturnType<typeof createInstallationOwner>>; saved: boolean }>();
  const [revealed, setRevealed] = React.useState<{ id: string; password: string }>();
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const fieldId = React.useId();
  const launchParams = React.useMemo(() => ({ teamId, launchId: activeId }), [teamId, activeId]);
  const progress = useOperation('getHubInstallationLaunch', { params: launchParams, key: 'installation-launch-' + launchParams.launchId, enabled: Boolean(activeId) });
  const report = progress.state.status === 'loaded' && progress.state.params.launchId === activeId ? progress.state.data : undefined;
  const clock = useClock();

  async function run(action: () => Promise<void>) {
    setPending(true);
    setProblem('');
    try { await action(); }
    catch { setProblem('Platfolio couldn’t finish this step. Try again.'); }
    finally { setPending(false); }
  }

  async function prepare(installationId?: string, operation?: MaintenanceChoice) {
    const result = await authorize({ params, ...(installationId ? { body: { installationId } } : {}) });
    if (!result.ok) { setProblem(result.error.message); return; }
    const url = new URL(result.value.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid provider authorization URL');
    setWorkspace('');
    setMaintenance(operation);
    setFirstSignIn(undefined);
    setRevealed(undefined);
    setConsent({ ...result.value, authorizationUrl: url.href });
    setActiveId(result.value.id);
    if (result.value.id === activeId) progress.reload();
  }

  async function deploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const environments = selection?.state === 'failed' ? selection.requested : environmentChoices.filter((name) => form.has(name));
    if (environments.length === 0) { setProblem('Choose staging, production, or both.'); return; }
    await run(async () => {
      if (!managedFirstSignIn && !firstSignIn) {
        setFirstSignIn({ credential: await createInstallationOwner(), saved: false });
        return;
      }
      if (firstSignIn && !firstSignIn.saved) { setProblem('Save the first sign-in file before launching.'); return; }
      const { verifier, salt } = firstSignIn?.credential ?? await createInstallationOwner();
      const result = await start({ params: launchParams, body: {
        workspaceId: selection?.workspaceId ?? (workspace || report?.workspaces[0]?.id || ''),
        name: selection?.name ?? String(form.get('name') ?? ''),
        ownerEmail: String(form.get('email') ?? ''),
        environments, verifier, salt,
      } });
      if (!result.ok) { setProblem(result.error.message); return; }
      setConsent(undefined);
      progress.acceptConfirmed(result.value);
      journals.reload();
    });
  }

  async function maintainInstallation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!maintenance || !selection) return;
    const fields = new FormData(event.currentTarget);
    const body: Maintenance = maintenance.action === 'wipe'
      ? { action: 'wipe', confirmation: String(fields.get('confirmation') ?? '') }
      : maintenance;
    await run(async () => {
      const result = await maintain({ params: launchParams, body });
      if (!result.ok) { setProblem(result.error.message); return; }
      setConsent(undefined);
      progress.acceptConfirmed(result.value);
      journals.reload();
    });
  }

  const completed = report?.state === 'ready' || report?.state === 'failed' || report?.state === 'removed';
  React.useEffect(() => {
    if (completed) journals.reload();
  }, [completed, journals.reload]);

  if (offer.state.status === 'failed' && offer.state.error.status === 404) return null;
  return <WorkspacePanel title="Launch private Platfolio">
    <OperationState status={offer.state.status} pending="Checking the Platfolio installer…" failed="Couldn’t find the installer."
      retry={offer.reload}>
      {offer.state.status === 'loaded' && <>
        <p>Run Platfolio, Keycloak, OpenBao, and PostgreSQL in your own hosting workspace. Your hosting provider bills you for the resources you use.</p>
        <p className="ui-workspace-meta">Installer build <code>{offer.state.data.revision.slice(0, 7)}</code> · {ageLabel(offer.state.freshness, clock().toISOString()).text}</p>
        {journals.state.status === 'failed' && <p role="status">Couldn’t load previous installations.{' '}
          <WorkspaceAction onClick={journals.reload}>Try again</WorkspaceAction>
        </p>}
        {history.length > 0 && <ul className="ui-workspace-list" aria-label="Your private installations">
          {history.map((row) => <li className="ui-workspace-row" key={row.id}>
            <div>
              <strong>{row.name}</strong>
              <p className="ui-workspace-meta">
                {row.state === 'removed' ? 'Removed' : row.verified.length ? row.verified.join(' and ') : 'Setup incomplete'}
              </p>
            </div>
            <div className="ui-workspace-links">
              <WorkspaceAction onClick={() => {
                if (row.id !== activeId) setFirstSignIn(undefined);
                setRevealed(undefined);
                setActiveId(row.id);
                setConsent(undefined);
                setMaintenance(undefined);
              }}>View progress</WorkspaceAction>
              {row.state === 'failed' && !row.maintenance && <WorkspaceAction disabled={pending} onClick={() => void run(() => prepare(row.id))}>Resume setup</WorkspaceAction>}
              {row.state === 'ready' && row.verified.length < environmentChoices.length &&
                <WorkspaceAction disabled={pending} onClick={() => void run(() => prepare(row.id))}>Add environment</WorkspaceAction>}
              {offeredRevision && row.installed?.filter(({ name, revision }) => revision !== offeredRevision &&
                (row.state === 'ready' || (row.state === 'failed' && row.maintenanceEnvironment === name)))
                .map(({ name }) => <WorkspaceAction key={name} disabled={pending}
                  onClick={() => void run(() => prepare(row.id, { action: 'update', environment: name, revision: offeredRevision }))}>Update {name}</WorkspaceAction>)}
              {row.canRemove && row.state !== 'running' && <WorkspaceAction disabled={pending}
                onClick={() => void run(() => prepare(row.id, { action: 'wipe' }))}>Remove installation</WorkspaceAction>}
              {row.state === 'removed' && <WorkspaceAction disabled={pending} onClick={() => void run(async () => {
                const result = await forget({ params: { teamId, launchId: row.id } });
                if (!result.ok) { setProblem(result.error.message); return; }
                if (activeId === row.id) setActiveId('');
                journals.reload();
              })}>Forget removed installation</WorkspaceAction>}
            </div>
          </li>)}
        </ul>}
        {!consent && <WorkspaceAction variant="primary" disabled={pending} onClick={() => void run(() => prepare())}>Connect hosting provider</WorkspaceAction>}
        {consent && (!report || report.state === 'authorizing') && <p className="ui-workspace-links">
          <a className="ui-workspace-primary ui-hit-primary" href={consent.authorizationUrl} target="_blank" rel="noopener">Authorize workspace</a>
          <WorkspaceAction onClick={progress.reload}>Check authorization</WorkspaceAction>
        </p>}
        {report?.state === 'authorized' && selection && !report.workspaces.some(({ id }) => id === selection.workspaceId) &&
          <p role="status">Authorize the workspace that owns {selection.name}. <WorkspaceAction disabled={pending}
            onClick={() => void run(() => prepare(selection.id, maintenance))}>Authorize again</WorkspaceAction></p>}
        {report?.state === 'authorized' && selection && maintenance &&
          report.workspaces.some(({ id }) => id === selection.workspaceId) &&
          <form className="ui-workspace-form" onSubmit={(event) => void maintainInstallation(event)}>
            {maintenance.action === 'wipe' ? <>
              <p>Remove <strong>{selection.name}</strong>, all its environments, and their stored data. Your apps in separate projects stay in Railway.</p>
              <WorkspaceField id={fieldId + '-confirmation'} label="Type the project name">
                <input id={fieldId + '-confirmation'} name="confirmation" autoComplete="off" required maxLength={63} />
              </WorkspaceField>
              <WorkspaceAction type="submit" variant="primary" disabled={pending}>Wipe installation data</WorkspaceAction>
            </> : <>
              <p>Update <strong>{selection.name}</strong> · {maintenance.environment} to build <code>{maintenance.revision.slice(0, 7)}</code>. Its settings, domains and data stay in place.</p>
              <WorkspaceAction type="submit" variant="primary" disabled={pending}>Apply update</WorkspaceAction>
            </>}
          </form>}
        {report?.state === 'authorized' && !maintenance && (!selection || report.workspaces.some(({ id }) => id === selection.workspaceId)) &&
          <form className="ui-workspace-form" onSubmit={(event) => void deploy(event)}>
          {selection ? <p>Hosting project <strong>{selection.name}</strong></p> : <>
            <WorkspaceChoice label="Hosting workspace" value={workspace || report.workspaces[0]?.id || ''}
              options={report.workspaces.map(({ id, name }) => ({ value: id, label: name }))} onChange={setWorkspace} />
            <WorkspaceField id={fieldId + '-name'} label="Project name">
              <input id={fieldId + '-name'} name="name" defaultValue="platfolio" pattern="[a-z][a-z0-9\x2d]{1,62}" required />
            </WorkspaceField>
          </>}
          <WorkspaceField id={fieldId + '-email'} label="Owner email">
            <input id={fieldId + '-email'} name="email" type="email" required autoComplete="email" />
          </WorkspaceField>
          {selection?.state === 'failed' ? <p>Continue setup for {selection.requested.join(' and ')}. Environments already deployed keep their existing sign-in.</p> :
            <fieldset>
              <legend>Environments</legend>
              {environmentChoices.filter((name) => !selection?.verified.includes(name)).map((name) =>
                <label key={name}><input name={name} type="checkbox" defaultChecked={Boolean(selection) || name === 'staging'} />
                  {name === 'staging' ? 'Staging' : 'Production'}
                </label>)}
            </fieldset>}
          {firstSignIn && <InstallationFirstSignIn password={firstSignIn.credential.password} confirmation={{
            saved: firstSignIn.saved, change: (saved) => setFirstSignIn({ ...firstSignIn, saved }),
          }} />}
          <WorkspaceAction variant="primary" type="submit" disabled={pending || Boolean(firstSignIn && !firstSignIn.saved)}>
            {!managedFirstSignIn && !firstSignIn ? 'Prepare first sign-in' : selection?.state === 'failed' ? 'Continue setup' : selection ? 'Add environment' : 'Launch Platfolio'}
          </WorkspaceAction>
        </form>}
        {firstSignIn && !consent && report?.state === 'ready' && <InstallationFirstSignIn password={firstSignIn.credential.password} />}
        {report && <>
          {report.state === 'running' && <p role="status">Working on your installation…</p>}
          {report.state === 'removed' && <p role="status">The hosting provider confirmed the installation was removed.</p>}
          {report.state === 'failed' && <p role="status">{selection?.maintenance || maintenance
            ? 'Maintenance paused. Review the last step and authorize the workspace again to retry.'
            : selection
            ? 'Setup paused. Review the last step and resume with a new authorization.'
            : 'Setup did not finish. Check the progress and try a new authorization.'}{' '}
            {!selection && <WorkspaceAction disabled={pending} onClick={() => void run(() => prepare())}>Try again</WorkspaceAction>}</p>}
          {report.environments.length > 0 && <ul className="ui-workspace-list">
            {report.environments.map(({ name, origin }) => <li key={name}>
              <a href={origin}>Open {name} Platfolio</a>
              {managedFirstSignIn && <WorkspaceAction disabled={pending} onClick={() => void run(async () => {
                setRevealed(undefined);
                const result = await reveal({ params: { ...launchParams, environment: name } });
                if (!result.ok) { setProblem(result.error.status === 404 ? 'The first sign-in password is no longer available.' : result.error.message); return; }
                setRevealed({ id: activeId, password: result.value.temporaryPassword });
              })}>Show {name} first sign-in password</WorkspaceAction>}
            </li>)}
          </ul>}
          {revealed?.id === activeId && <InstallationFirstSignIn password={revealed.password} />}
          {report.state === 'ready' && !managedFirstSignIn && !firstSignIn && <p>For first sign-in, use the saved password file from setup.</p>}
          <LaunchProgress report={report} />
          {progress.state.status === 'loaded' && <p className="ui-workspace-meta">{ageLabel(progress.state.freshness, clock().toISOString()).text}</p>}
        </>}
      </>}
    </OperationState>
    {problem && <p role="alert">{problem}</p>}
  </WorkspacePanel>;
}
