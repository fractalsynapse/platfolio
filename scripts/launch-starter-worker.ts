import { setTimeout as delay } from 'node:timers/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { GitScm } from '../packages/contracts/src/git-scm.ts';
import type { SourceReleaseHosting } from '../packages/contracts/src/source-release-hosting.ts';
import { parseInventory, readTemplate, STARTER_WORKER_RELEASE, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import { customerRailway, removeCustomerApp, type CustomerRailwayGrant } from './customer-railway.ts';
import { withReleaseSource } from './source-release-upload.ts';

const { template, version, revision } = STARTER_WORKER_RELEASE;
const service = 'queue';
const deploymentName = service + '-staging';

// This path builds from the pinned repository. The image-based manifest renderer needs a published artifact.
const sourceTopology = z.object({
  services: z.object({
    [service]: z.object({
      build: z.object({ context: z.literal('.'), dockerfile: z.literal('Dockerfile') }),
      environment: z.record(z.string(), z.string()),
      expose: z.tuple([z.coerce.number().int().min(1).max(65535)]),
      healthcheck: z.object({ test: z.array(z.string()) }),
      volumes: z.tuple([z.string()]),
      'x-platfolio': z.object({ public: z.literal(false).optional(), environments: z.array(z.string()) }),
    }).strict(),
  }).strict(),
  'x-platfolio': z.object({
    metadata: z.object({ name: z.literal(template), version: z.literal(version), kind: z.literal('worker') }),
    resources: z.object({ volumes: z.tuple([z.object({
      name: z.string(), service: z.literal(service), mountPath: z.string().startsWith('/'), retention: z.literal('survive'),
    })]) }).strict(),
    environments: z.object({ staging: z.object({ enabled: z.literal(true) }) }),
  }),
});

export function validateWorkerSource(compose: string, registry: string) {
  const source = sourceTopology.parse(parseYaml(compose, { uniqueKeys: true }));
  const worker = source.services[service];
  const [volume] = source['x-platfolio'].resources.volumes;
  const healthPath = worker.healthcheck.test.join(' ').match(/http:\/\/127\.0\.0\.1:\d+(\/[a-z0-9-]+)\b/)?.[1];
  const inventory = parseInventory(registry);
  if (worker.volumes[0] !== volume.name + ':' + volume.mountPath || !worker['x-platfolio'].environments.includes('staging') ||
      !healthPath || inventory.issues.length || inventory.entries.some((entry) => entry.kind !== 'value' || entry.service !== service)) {
    throw new Error('The pinned worker must use one retained mount and an internal readiness check');
  }
  return { volume, healthPath, port: worker.expose[0], environment: worker.environment, inventory: inventory.entries };
}

export function railwayStarterWorkerHosting(credential: () => Promise<CustomerRailwayGrant>): SourceReleaseHosting {
  return {
    template, revision,
    async deploy({ projectId }, observer) {
      observer.step({ step: 'Read the pinned release', state: 'WORKING' });
      const scm = new GitScm();
      const source = await readTemplate((request) => scm.readRepositoryFile(request), templateCatalogEntry(template), revision);
      const { volume, healthPath, port, environment, inventory } = validateWorkerSource(source.compose, source.inventory ?? '');
      const grant = await credential();
      if (grant.projectId) throw new Error('A workspace grant is required for the worker’s own project');
      const rail = await customerRailway({ name: template, kind: 'app', ...(projectId ? { id: projectId } : { create: true }) }, observer.step, grant);
      observer.project(rail.project.id);
      const id = await rail.ensureService(deploymentName);
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
