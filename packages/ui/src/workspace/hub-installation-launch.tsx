import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { createInstallationOwner } from '../web/installation-owner.ts';
import { LaunchProgress } from './launch-progress.tsx';
import { OperationState } from './operation-state.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceChoice } from './workspace-choice.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const environmentChoices = ['staging', 'production'] as const;

export function HubInstallationLaunch({ teamId }: { readonly teamId: string }) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const offer = useOperation('getHubInstallationOffer', { params, key: 'installation-offer-' + teamId });
  const authorize = useCommand('authorizeHubInstallation');
  const start = useCommand('startHubInstallation');
  const [consent, setConsent] = React.useState<SuccessOf<'authorizeHubInstallation'>>();
  const [workspace, setWorkspace] = React.useState('');
  const [credential, setCredential] = React.useState<Awaited<ReturnType<typeof createInstallationOwner>>>();
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const fieldId = React.useId();
  const launchParams = React.useMemo(() => ({ teamId, launchId: consent?.id ?? '' }), [teamId, consent?.id]);
  const progress = useOperation('getHubInstallationLaunch', { params: launchParams, key: 'installation-launch-' + launchParams.launchId, enabled: Boolean(consent) });
  const report = progress.state.status === 'loaded' && progress.state.params.launchId === consent?.id ? progress.state.data : undefined;
  const clock = useClock();

  async function run(action: () => Promise<void>) {
    setPending(true);
    setProblem('');
    try { await action(); }
    catch { setProblem('Platfolio couldn’t finish this step. Try again.'); }
    finally { setPending(false); }
  }

  async function prepare() {
    const result = await authorize({ params });
    if (!result.ok) { setProblem(result.error.message); return; }
    const url = new URL(result.value.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid provider authorization URL');
    setWorkspace('');
    setCredential(undefined);
    setConsent({ ...result.value, authorizationUrl: url.href });
  }

  async function deploy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const environments = environmentChoices.filter((name) => form.has(name));
    if (environments.length === 0) { setProblem('Choose staging, production, or both.'); return; }
    await run(async () => {
      const setup = credential ?? await createInstallationOwner();
      setCredential(setup);
      const result = await start({ params: launchParams, body: {
        workspaceId: workspace || report?.workspaces[0]?.id || '',
        name: String(form.get('name') ?? ''),
        ownerEmail: String(form.get('email') ?? ''),
        environments, verifier: setup.verifier, salt: setup.salt,
      } });
      if (!result.ok) { setProblem(result.error.message); return; }
      progress.acceptConfirmed(result.value);
    });
  }

  if (offer.state.status === 'failed' && offer.state.error.status === 404) return null;
  return <WorkspacePanel title="Launch private Platfolio">
    <OperationState status={offer.state.status} pending="Checking the Platfolio installer…" failed="Couldn’t find the installer."
      retry={offer.reload}>
      {offer.state.status === 'loaded' && <>
        <p>Run Platfolio, Keycloak, OpenBao, and PostgreSQL in your own hosting workspace. Your hosting provider bills you for the resources you use.</p>
        <p className="ui-workspace-meta">Installer build <code>{offer.state.data.revision.slice(0, 7)}</code> · {ageLabel(offer.state.freshness, clock().toISOString()).text}</p>
        {!consent && <WorkspaceAction variant="primary" disabled={pending} onClick={() => void run(prepare)}>Connect hosting provider</WorkspaceAction>}
        {consent && (!report || report.state === 'authorizing') && <p className="ui-workspace-links">
          <a className="ui-workspace-primary ui-hit-primary" href={consent.authorizationUrl} target="_blank" rel="noopener">Authorize workspace</a>
          <WorkspaceAction onClick={progress.reload}>Check authorization</WorkspaceAction>
          <WorkspaceAction disabled={pending} onClick={() => void run(prepare)}>Start a new authorization</WorkspaceAction>
        </p>}
        {report?.state === 'authorized' && <form className="ui-workspace-form" onSubmit={(event) => void deploy(event)}>
          <WorkspaceChoice label="Hosting workspace" value={workspace || report.workspaces[0]?.id || ''}
            options={report.workspaces.map(({ id, name }) => ({ value: id, label: name }))} onChange={setWorkspace} />
          <WorkspaceField id={fieldId + '-name'} label="Project name">
            <input id={fieldId + '-name'} name="name" defaultValue="platfolio" pattern="[a-z][a-z0-9\x2d]{1,62}" required />
          </WorkspaceField>
          <WorkspaceField id={fieldId + '-email'} label="Owner email">
            <input id={fieldId + '-email'} name="email" type="email" required autoComplete="email" />
          </WorkspaceField>
          <fieldset>
            <legend>Environments</legend>
            <label><input name="staging" type="checkbox" defaultChecked /> Staging</label>{' '}
            <label><input name="production" type="checkbox" /> Production</label>
          </fieldset>
          <WorkspaceAction variant="primary" type="submit" disabled={pending}>Launch Platfolio</WorkspaceAction>
        </form>}
        {credential && <p>Save this one-time password for <code>owner</code>. You’ll replace it when you sign in.
          {' '}<a download="platfolio-first-sign-in.txt" href={'data:text/plain;charset=utf-8,' + encodeURIComponent(credential.password)}>Download sign-in password</a></p>}
        {report && <>
          {report.state === 'running' && <p role="status">Setting up your installation…</p>}
          {report.state === 'failed' && <p role="status">{report.projectId
            ? 'Setup stopped after the project was created. Keep this report with the project ID so you can identify what was created.'
            : 'Setup did not finish. Check the progress and try a new authorization.'}{' '}
            {!report.projectId && <WorkspaceAction disabled={pending} onClick={() => void run(prepare)}>Try again</WorkspaceAction>}</p>}
          {report.environments.length > 0 && <ul className="ui-workspace-list">
            {report.environments.map(({ name, origin }) => <li key={name}><a href={origin}>Open {name} Platfolio</a></li>)}
          </ul>}
          <LaunchProgress report={report} />
          {progress.state.status === 'loaded' && <p className="ui-workspace-meta">{ageLabel(progress.state.freshness, clock().toISOString()).text}</p>}
        </>}
      </>}
    </OperationState>
    {problem && <p role="alert">{problem}</p>}
  </WorkspacePanel>;
}
