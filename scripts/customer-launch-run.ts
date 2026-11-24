import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { StarterLaunch, StarterLaunchEvent, StarterLaunchReport, StarterRemoval } from '../apps/control-plane/src/starter-launch.ts';
import { FREE_STARTER_RELEASE } from '../packages/manifest/src/template-catalog.ts';
import { customerRailway } from './customer-railway.ts';
import { launchStarterApp } from './launch-starter-app.ts';

const app = FREE_STARTER_RELEASE.template;

export function customerLaunchRun(teamId: string, journalPath: string): StarterLaunch {
  let report: StarterLaunchReport = existsSync(journalPath)
    ? JSON.parse(readFileSync(journalPath, 'utf8')) as StarterLaunchReport
    : { state: 'idle', events: [], template: app, revision: FREE_STARTER_RELEASE.revision, retainedVolumes: [] };
  function save() {
    const pending = `${journalPath}.tmp`;
    writeFileSync(pending, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    renameSync(pending, journalPath);
  }
  function event(data: Omit<StarterLaunchEvent, 'at'>) {
    report.events.push({ at: new Date().toISOString(), ...data });
    save();
  }
  if (report.state === 'running' || report.state === 'removing') {
    report.state = 'failed';
    event({ step: 'Resume setup', state: 'FAILED', detail: 'The runner restarted. Resume the previous operation.' });
  }
  function start() {
    if (['running', 'removing', 'ready'].includes(report.state)) return report;
    report.state = 'running';
    event({ step: 'Launch approved', state: 'READY', detail: 'One staging project, one database and one public HTTPS link.' });
    void (async () => {
      try {
        await customerRailway({ kind: 'installation', name: 'platfolio' });
        event({ step: 'Find your Platfolio installation', state: 'READY' });
        const installed = await launchStarterApp(app, report.projectId, (data) => {
          if (data.step === 'Railway project' && data.resourceId) report.projectId = data.resourceId;
          event(data);
        });
        report = { ...report, state: 'ready', projectId: installed.project, deploymentId: installed.deployment, origin: installed.origin };
        event({ step: 'Open your app', state: 'READY' });
      } catch {
        report.state = 'failed';
        event({ step: 'Resume setup', state: 'FAILED', detail: 'Railway setup did not finish. Check the last completed step and resume to reuse its resources.' });
      }
    })();
    return report;
  }
  function remove(data: StarterRemoval) {
    const projectId = report.projectId;
    if (['running', 'removing', 'wiped'].includes(report.state) || !projectId) return report;
    report.state = 'removing';
    event({ step: data === 'keep' ? 'Remove and keep data' : 'Remove and wipe data', state: 'WORKING', resourceId: projectId });
    void (async () => {
      try {
        const rail = await customerRailway({ kind: 'app', name: app, id: projectId });
        const removal = await rail.remove(data);
        delete report.origin;
        report.retainedVolumes = removal.retainedVolumes;
        if (data === 'wipe') {
          delete report.projectId;
          delete report.deploymentId;
          report.state = 'wiped';
          event({ step: 'Removal complete', state: 'READY', detail: 'Railway confirmed the app project is gone. Volume deletion follows Railway’s recovery window.' });
        } else {
          report.state = 'kept';
          event({ step: 'Removal complete', state: 'READY', detail: 'App and database deployments stopped. Storage remains attached for recovery and may incur storage charges.' });
        }
      } catch {
        report.state = 'failed';
        event({ step: 'Remove app', state: 'FAILED', detail: 'Railway could not verify complete removal. Retry the selected removal option.' });
      }
    })();
    return report;
  }
  return { teamId, read: () => report, start, remove };
}
