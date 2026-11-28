import { WorkspaceAction } from '../workspace/workspace-action.tsx';
import * as React from 'react';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { useCommand } from '../sdk/use-operation.ts';
import { createOwnerKey, recoverOwnerFile, sealOwnerRecovery, type OwnerRecoveryKey } from './launch-recovery.ts';

type Setup = SuccessOf<'getStarterLaunchSetup'>;
const labels: Record<Setup['openBao'], string> = {
  unreachable: 'Connection unavailable', uninitialized: 'Ready to set up', sealed: 'Locked',
  'setup-required': 'Setup needs attention', ready: 'Ready',
};

export function StarterLaunchSetup({ teamId, setup, refresh }: { readonly teamId: string; readonly setup: Setup; readonly refresh: () => void }) {
  const initialize = useCommand('initializeStarterOpenBao');
  const unlock = useCommand('unlockStarterOpenBao');
  const authorize = useCommand('beginStarterRailwayAuthorization');
  const owner = React.useRef<OwnerRecoveryKey | undefined>(undefined);
  const saved = React.useRef<string | undefined>(undefined);
  const [phase, setPhase] = React.useState<'key' | 'prepared' | 'recovery'>('key');
  const [download, setDownload] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const params = { teamId };
  React.useEffect(() => () => { if (download) URL.revokeObjectURL(download); }, [download]);
  const fileUrl = (data: string) => URL.createObjectURL(new Blob([data], { type: 'application/json' }));

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setProblem('');
    try { await operation(); }
    catch { setProblem('Platfolio could not finish this step. Check the file or connection and try again.'); }
    finally { setPending(false); refresh(); }
  }

  async function prepare() {
    const key = await createOwnerKey();
    owner.current = key;
    setDownload(fileUrl(JSON.stringify(key)));
    setPhase('prepared');
  }

  async function createRecovery() {
    const key = owner.current;
    if (!key) return;
    const response = await initialize({ params, body: { publicKey: key.publicKey } });
    if (!response.ok) throw new Error('Initialization failed');
    const recovered = await recoverOwnerFile(key, response.value.recovery);
    saved.current = recovered;
    setDownload(fileUrl(recovered));
    owner.current = undefined;
    setPhase('recovery');
  }

  async function restoreKey(file: File) {
    if (file.size > 5000) throw new Error('Invalid owner key');
    const key = JSON.parse(await file.text()) as OwnerRecoveryKey;
    if (typeof key.publicKey !== 'string' || typeof key.privateKey !== 'string') throw new Error('Invalid owner key');
    owner.current = key;
    setPhase('prepared');
    await createRecovery();
  }

  async function unlockWith(contents: ArrayBuffer | Uint8Array<ArrayBuffer>) {
    const recovery = await sealOwnerRecovery(setup.workerKey, contents);
    const response = await unlock({ params, body: { recovery } });
    if (!response.ok) throw new Error('Unlock failed');
    saved.current = undefined;
    setDownload('');
    setPhase('key');
  }

  async function beginConsent() {
    const response = await authorize({ params });
    if (!response.ok) throw new Error('Authorization unavailable');
    const url = new URL(response.value.authorizationUrl);
    if (url.origin !== 'https://backboard.railway.com' || url.pathname !== '/oauth/auth') throw new Error('Authorization URL is invalid');
    globalThis.location.assign(url.href);
  }

  const ownerRecoveryInput = <input type="file" accept=".json" disabled={pending} onChange={(event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void run(async () => {
      if (file.size > 300) throw new Error('Invalid recovery file');
      await unlockWith(await file.arrayBuffer());
    });
  }} />;

  return <>
    <section className="ui-setup-panel" aria-labelledby="setup-openbao-title">
      <div className="ui-workspace-heading">
        <h3 id="setup-openbao-title">Secret storage</h3>
        <span className="ui-setup-status">{labels[setup.openBao]}</span>
      </div>
      <p>OpenBao keeps app credentials in your Railway project. Keep your recovery file private so you can unlock it after a restart.</p>
      {setup.openBao === 'unreachable' && <p>Check the private OpenBao service and try again.</p>}
      {setup.openBao === 'ready' && setup.identityPolicyNeedsRecovery &&
        <p><label>Enable Shared Identity with your saved recovery file {ownerRecoveryInput}</label></p>}
      {setup.openBao !== 'ready' && setup.openBao !== 'unreachable' && <>
        {setup.openBao === 'uninitialized' && phase === 'key' && <>
          <p>Save the owner key first. It lets you retrieve your recovery file if you leave this page during setup.</p>
          <WorkspaceAction type="button" variant="primary" disabled={pending} onClick={() => void run(prepare)}>Create owner key</WorkspaceAction>
        </>}
        {phase === 'prepared' && <>
          {download && <p><a href={download} download="platfolio-owner-key.json">Download owner key</a></p>}
          <button type="button" className="ui-hit-primary" disabled={pending} onClick={() => void run(createRecovery)}>Initialize OpenBao</button>
        </>}
        {phase === 'recovery' && download && <>
          <p><a href={download} download="platfolio-openbao-recovery.json">Download OpenBao recovery file</a></p>
          <button type="button" className="ui-hit-primary" disabled={pending} onClick={() => void run(async () => {
            if (saved.current) await unlockWith(new TextEncoder().encode(saved.current));
          })}>I saved the recovery file. Unlock OpenBao</button>
        </>}
        {setup.openBao !== 'uninitialized' && <>
          {phase === 'key' && <p><label>Retrieve recovery file with your owner key <input type="file" accept=".json" disabled={pending}
            onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void run(() => restoreKey(file)); }} /></label></p>}
          <label>Unlock with your saved recovery file {ownerRecoveryInput}</label>
        </>}
      </>}
    </section>
    <section className="ui-setup-panel" aria-labelledby="setup-railway-title">
      <div className="ui-workspace-heading">
        <h3 id="setup-railway-title">Railway</h3>
        <span className="ui-setup-status">{setup.railway === 'connected' ? 'Connected' : 'Connection required'}</span>
      </div>
      {setup.openBao !== 'ready' && <p>Unlock OpenBao to connect Railway.</p>}
      {setup.openBao === 'ready' && setup.railway !== 'connected' && <>
        <p>Review the requested access in Railway. Your authorization is stored in your OpenBao.</p>
        {!setup.canWipeData && <p>In Railway, select only the Starter Web project.</p>}
        <WorkspaceAction type="button" variant="primary" disabled={pending} onClick={() => void run(beginConsent)}>Connect Railway</WorkspaceAction>
      </>}
    </section>
    {problem && <p role="alert">{problem}</p>}
  </>;
}
