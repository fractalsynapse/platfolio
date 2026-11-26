import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { parseInventory } from './inventory.ts';
import { STARTER_WORKER_RELEASE } from './template-catalog.ts';

const { template, version } = STARTER_WORKER_RELEASE;
const service = 'queue';

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
  return { service, volume, healthPath, port: worker.expose[0], environment: worker.environment, inventory: inventory.entries };
}

