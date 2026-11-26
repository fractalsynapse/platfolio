import { setTimeout as delay } from 'node:timers/promises';
import { GitScm } from '../packages/contracts/src/git-scm.ts';
import type { SourceReleaseHosting } from '../packages/contracts/src/source-release-hosting.ts';
import { readTemplate, STARTER_WORKER_RELEASE, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import { customerRailway, removeCustomerApp, type CustomerRailwayGrant } from './customer-railway.ts';
import { validateWorkerSource } from '../packages/manifest/src/starter-worker-release.ts';
import { withReleaseSource } from './source-release-upload.ts';

const { template } = STARTER_WORKER_RELEASE;

export function railwayStarterWorkerHosting(credential: () => Promise<CustomerRailwayGrant>): SourceReleaseHosting {
  return {
    template, revision: STARTER_WORKER_RELEASE.revision,
    async deploy({ projectId, release = STARTER_WORKER_RELEASE }, observer) {
      const { version, revision } = release;
      observer.step({ step: 'Read the pinned release', state: 'WORKING' });
      const scm = new GitScm();
      const source = await readTemplate((request) => scm.readRepositoryFile(request), templateCatalogEntry(template), revision);
      const { service, volume, healthPath, port, environment, inventory } = validateWorkerSource(source.compose, source.inventory ?? '', version);
      const grant = await credential();
      if (grant.projectId) throw new Error('A workspace grant is required for the worker’s own project');
      const rail = await customerRailway({ name: template, kind: 'app', ...(projectId ? { id: projectId } : { create: true }) }, observer.step, grant);
      observer.project(rail.project.id);
      const id = await rail.ensureService(service + '-staging');
      await rail.assertPrivate(id);
      observer.step({ step: 'Prepare persistent storage', state: 'WORKING' });
      await rail.ensureVolume(id, volume.mountPath);
      let disk = await rail.mountedVolume(id, volume.mountPath);
      for (let attempt = 0; !disk && attempt < 30; attempt++) {
        await delay(1000);
        disk = await rail.mountedVolume(id, volume.mountPath);
      }
      if (!disk) throw new Error('Railway did not confirm the worker’s volume mount');
      observer.step({ step: 'Prepare persistent storage', state: 'READY', resourceId: disk });
      const values = { ...environment, PORT: String(port), STATE_DIR: volume.mountPath, RAILWAY_RUN_UID: '0' };
      for (const entry of inventory) {
        if (entry.kind === 'value' && entry.default !== undefined) await rail.setConfig(id, entry.name, entry.default);
      }
      for (const [name, value] of Object.entries(values)) await rail.setConfig(id, name, value);
      await rail.configure(id, { numReplicas: 1, healthcheckPath: healthPath, healthcheckTimeout: 120 });
      const deployment = await withReleaseSource(source.sources, (directory) =>
        rail.upload(id, directory, `Marketplace ${template} at ${revision}`));
      await rail.wait(id, deployment);
      await rail.assertPrivate(id);
      const placed = (await rail.instances()).find(({ serviceId }) => serviceId === id);
      if (!placed?.activeDeployments.some((item) => item.id === deployment && item.status === 'SUCCESS') ||
          await rail.mountedVolume(id, volume.mountPath) !== disk) {
        throw new Error('Railway did not confirm the active worker and its original storage');
      }
      return { project: rail.project.id, deployment };
    },
    async remove(id, data) { return removeCustomerApp(template, id, data, await credential()); },
    async domains() { return { outcome: 'not-available' }; },
    async publicLabel() { return null; },
  };
}
