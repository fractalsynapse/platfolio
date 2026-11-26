import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { StarterLaunch, StarterLaunchEvent, StarterLaunchReport, StarterRemoval } from '../apps/control-plane/src/starter-launch.ts';
import type { SourceReleaseHosting } from '../packages/contracts/src/source-release-hosting.ts';

export function customerLaunchRun(teamId: string, journalPath: string, provider: SourceReleaseHosting): StarterLaunch & {
  startWithBootstrap: (bootstrap: string) => StarterLaunchReport;
  redeploy: () => StarterLaunchReport;
  changeBrand: (value: string) => StarterLaunchReport;
} {
  const journal: StarterLaunchReport & { publicBrand?: string } = existsSync(journalPath)
    ? JSON.parse(readFileSync(journalPath, 'utf8'))
    : { state: 'idle', events: [], template: provider.template, revision: provider.revision, retainedVolumes: [] };
  if (journal.template !== provider.template) {
    throw new Error('The launch journal belongs to a different template');
  }
  let { publicBrand, ...report } = journal;
  function save() {
    const pending = `${journalPath}.tmp`;
    writeFileSync(pending, JSON.stringify({ ...report, publicBrand }, null, 2) + '\n', { mode: 0o600 });
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
  function start(redeploy = false, brand?: string, bootstrap?: string) {
    if (redeploy ? report.state !== 'ready' : ['running', 'removing', 'ready'].includes(report.state)) return report;
    if (brand !== undefined) publicBrand = brand;
    report.state = 'running';
    event(redeploy ? { step: brand === undefined ? 'Redeploy the pinned release' : 'Publish the app header label',
      state: 'WORKING', detail: 'The project and its database stay in place.' }
      : { step: 'Launch approved', state: 'READY', detail: 'One staging project, one database and one public HTTPS link.' });
    void (async () => {
      try {
        const installed = await provider.deploy({
          ...(bootstrap === undefined ? {} : { bootstrap }),
          ...(report.projectId ? { projectId: report.projectId } : {}),
          ...(publicBrand === undefined ? {} : { publicLabel: publicBrand }),
        }, {
          step: event,
          project(id) { report.projectId = id; save(); },
        });
        report = { ...report, state: 'ready', projectId: installed.project, deploymentId: installed.deployment, origin: installed.origin };
        event({ step: 'Open your app', state: 'READY' });
      } catch {
        report.state = 'failed';
        event({ step: 'Resume setup', state: 'FAILED', detail: 'Hosting setup did not finish. Check the last completed step and resume to reuse its resources.' });
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
        const removal = await provider.remove(projectId, data);
        delete report.origin;
        report.retainedVolumes = removal.retainedVolumes;
        if (data === 'wipe') {
          publicBrand = undefined;
          delete report.projectId;
          delete report.deploymentId;
          report.state = 'wiped';
          event({ step: 'Removal complete', state: 'READY', detail: 'The hosting provider confirmed the app project is gone. Stored data follows the provider’s deletion policy.' });
        } else {
          report.state = 'kept';
          event({ step: 'Removal complete', state: 'READY', detail: 'App and database deployments stopped. Storage remains attached for recovery and may incur storage charges.' });
        }
      } catch {
        report.state = 'failed';
        event({ step: 'Remove app', state: 'FAILED', detail: 'The hosting provider could not verify complete removal. Retry the selected removal option.' });
      }
    })();
    return report;
  }
  return { teamId, read: () => report, start: () => start(), startWithBootstrap: (bootstrap) => start(false, undefined, bootstrap), redeploy: () => start(true), changeBrand: (value) => start(true, value), remove };
}
