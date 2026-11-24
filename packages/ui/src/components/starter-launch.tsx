import * as React from 'react';
import { z } from 'zod';
import { ageLabel, useClock } from './freshness.ts';
import { defineComponent } from '../contract.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { isLoaded } from '../sdk/transport.ts';
import { StarterLaunchSetup } from './starter-launch-setup.tsx';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';

type Launch = SuccessOf<'getStarterLaunch'>;
const headings: Record<Launch['state'], string> = {
  idle: 'Ready to set up', running: 'Setting up your app', ready: 'Your app is ready',
  failed: 'Setup needs attention', removing: 'Removing your app', kept: 'App removed. Data kept.', wiped: 'App removed. Data scheduled for deletion.',
};
const status = (value: string) => ({ WORKING: 'Working', READY: 'Complete', SUCCESS: 'Complete', FAILED: 'Needs attention' }[value] ?? value.toLowerCase());
const props = z.object({ teamId: z.string().min(1) }).strict();

function LaunchPanel({ teamId }: z.infer<typeof props>) {
  const params = React.useMemo(() => ({ teamId }), [teamId]);
  const launch = useOperation('getStarterLaunch', { params, key: `starter-${teamId}` });
  const setup = useOperation('getStarterLaunchSetup', { params, key: `starter-setup-${teamId}` });
  const local = setup.state.status === 'failed' && setup.state.error.status === 404;
  const ready = local || setup.state.status === 'loaded' && setup.state.data.openBao === 'ready' && setup.state.data.railway === 'connected';
  const start = useCommand('startStarterLaunch');
  const remove = useCommand('removeStarterLaunch');
  const [confirmation, setConfirmation] = React.useState('');
  const [selected, select] = React.useState<'keep' | 'wipe' | null>(null);
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const report = isLoaded(launch.state) ? launch.state.data : null;
  const now = useClock();

  async function act(action: 'start' | 'keep' | 'wipe') {
    setProblem('');
    setPending(true);
    try {
      const result = action === 'start' ? await start({ params })
        : await remove({ params, body: { data: action, ...(action === 'wipe' ? { confirmation } : {}) } });
      if (!result.ok) setProblem(result.error.status === 400 ? result.error.message : 'Platfolio could not accept that action. Try again.');
      else { select(null); setConfirmation(''); }
    } finally {
      launch.reload();
      setPending(false);
    }
  }

  return <section aria-label="Starter launch">
    <h2>Launch Starter Web</h2>
    {launch.state.status === 'pending' && <p role="status">Checking your launch setup…</p>}
    {launch.state.status === 'failed' && <p role="status">{launch.state.error.status === 404
      ? 'This team needs a connected Railway launcher.' : `Could not check launch setup. Try again. (${launch.state.error.code})`}</p>}
    {setup.state.status === 'loaded' && <>
      <StarterLaunchSetup teamId={teamId} setup={setup.state.data} refresh={setup.reload} />
      <small>{ageLabel(setup.state.freshness, now().toISOString()).text}</small>
    </>}
    {report && <>
      <p role="status" aria-label="Launch status"><strong>{headings[report.state]}</strong></p>
      {launch.state.status === 'loaded' && <small>{ageLabel(launch.state.freshness, now().toISOString()).text}</small>}
      {ready && ['idle', 'failed', 'kept', 'wiped'].includes(report.state) && <>
        <p>Use your connected Railway workspace. This creates a dedicated staging project and database. Anyone with the generated app link can open it. Railway charges apply to the resources you use.</p>
        <button className="ui-hit-primary" type="button" disabled={pending} onClick={() => void act('start')}>{report.state === 'kept' ? 'Restore app' : report.state === 'failed' ? 'Resume setup' : 'Launch starter'}</button>
      </>}
      {report.state === 'ready' && report.origin && <p><a href={report.origin}>Open app</a></p>}
      <p>Starter Web uses a generated database connection.</p>
      {report.events.length > 0 && <details open>
        <summary>Setup progress</summary>
        <ol aria-label="Setup progress">
          {report.events.map((event, index) => <li key={`${event.at}-${index}`}>
            <strong>{event.step}</strong>{` · ${status(event.state)}`}
            {event.detail && <p>{event.detail}</p>}
          </li>)}
        </ol>
        <a download="platfolio-launch-report.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`}>Download troubleshooting report</a>
      </details>}
      {ready && report.projectId && ['ready', 'kept', 'failed'].includes(report.state) && <details>
        <summary>Remove app</summary>
        <p>Choose what happens to the app’s storage.</p>
        <button type="button" className="ui-hit-primary" onClick={() => select('keep')}>Remove and keep data</button>{' '}
        <button type="button" className="ui-hit-primary" onClick={() => select('wipe')}>Remove and wipe data</button>
        {selected === 'keep' && <p>Stops the app and database. Railway keeps the storage and can still charge for it. <button type="button" className="ui-hit-primary" disabled={pending} onClick={() => void act('keep')}>Confirm removal</button></p>}
        {selected === 'wipe' && <div>
          <p>Removes the project and schedules deletion of its storage. Type <strong>starter-web</strong> to confirm.</p>
          <label>App name <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{' '}
          <button type="button" className="ui-hit-primary" disabled={pending || confirmation !== 'starter-web'} onClick={() => void act('wipe')}>Wipe app data</button>
        </div>}
      </details>}
    </>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}

export const starterLaunch = defineComponent({
  id: 'launch.starter', props, reads: ['getStarterLaunch', 'startStarterLaunch', 'removeStarterLaunch', 'getStarterLaunchSetup', 'initializeStarterOpenBao', 'unlockStarterOpenBao', 'beginStarterRailwayAuthorization'],
  slots: ['full-page'], render: (value: z.infer<typeof props>) => <LaunchPanel {...value} />,
});
