import { createHash } from 'node:crypto';
import { InfraPlanSchema, type InfraPlan } from '@platfolio/contracts';
import { enabledEnvironments, serviceEnvironments } from './environments.ts';
import { stagingHost } from './render.ts';
import type { Manifest } from './schema.ts';

/**
 * Translating a platform manifest into the plan a provider applies (issue #84).
 *
 * Until now nothing did this: the renderer emitted files and the tests hand-built plans in scripts, which
 * is exactly why "provisioned and deleted a database live" was true while "hosted a platform" was not. This
 * is the seam every live claim has been resting on.
 *
 * Two rules it enforces rather than assumes:
 * - a **placeholder digest is refused**. Templates ship `sha256:1111…` as documentation, and the plan schema
 *   accepts that shape happily, so only an explicit check stops a manifest's example image from becoming a
 *   tenant's broken deploy. Pinning is the release job's job.
 * - **secret values never appear**. Names and sources only; literals come from `env` alone, so the wiring a
 *   provider cannot read is never a value it has to hold.
 */
export interface InstanceConfig {
  instanceId: string;
  teamId: string;
  /** Default `railway`. */
  provider?: string;
  /**
   * Real image coordinates substituted for the template's documented ones, keyed by service name. This is
   * what a release pipeline produces after building and pinning; without it a manifest cannot be deployed,
   * and that is the intended failure rather than a convenience.
   */
  images?: Record<string, { image: string; digest: string }>;
}

// Template documentation values, e.g. sha256:1111... or sha2222...: a single repeated character is not what a
// registry returns. A real digest that happens to repeat one character 64 times is astronomically unlikely,
// and being strict here is the cheap side of the trade -- the alternative is deploying a placeholder.
const PLACEHOLDER = /^sha256:([0-9a-f])\1{63}$/;

export function buildPlan(manifest: Manifest, config: InstanceConfig): InfraPlan {
  const platform = manifest.metadata.name;
  const enabled = enabledEnvironments(manifest);
  const database = manifest.spec.resources?.database;
  const storage = manifest.spec.resources?.storage;
  const declaredVolumes = manifest.spec.resources?.volumes ?? [];
  const stagingPrefix = manifest.spec.dns?.stagingPrefix ?? 'staging';
  const verificationName = `${platform}-verify`;

  const environments = enabled.map((envName) => {
    const services = Object.entries(manifest.spec.services)
      .filter(([, svc]) => serviceEnvironments(svc, enabled).includes(envName))
      .map(([name, svc]) => {
        const image = config.images?.[name];
        const digest = image?.digest ?? svc.digest;
        if (PLACEHOLDER.test(digest)) {
          throw new Error(`service "${name}" has a placeholder digest (${digest.slice(0, 18)}…); pin it via the release pipeline before building a plan (issue #84)`);
        }
        const limits = svc.limits ?? { cpu: 1, memoryMB: 512 };
        return {
          name,
          image: image?.image ?? svc.image,
          digest,
          ...(svc.start ? { command: svc.start } : {}),
          ...(svc.preDeploy ? { preDeployCommand: svc.preDeploy } : {}),
          port: svc.port,
          healthPath: svc.healthPath ?? '/',
          // Staging is a duplicate that sleeps by default (D23): one replica, never the production count.
          replicas: envName === 'production' ? svc.replicas : 1,
          limits,
          // Base values first, then this environment's overrides (D56). Applied here, in the one place that
          // knows which environment it is building, so no consumer has to re-derive an effective value.
          env: Object.entries({ ...svc.env, ...(svc.environmentValues?.[envName] ?? {}) })
            .map(([key, value]) => ({ name: key, literal: value })),
          secrets: svc.secrets.map((s) => ({ name: s.name, source: s.source })),
          references: svc.references ?? [],
        };
      });

    const placedNames = new Set(services.map((s) => s.name));
    const domains = services.flatMap((s) => {
      const svc = manifest.spec.services[s.name]!;
      if (!svc.public) return [];
      return svc.domains.map((host) => ({
        host: envName === 'production' ? host : stagingHost(host, stagingPrefix),
        service: s.name,
        port: s.port,
        verificationName,
      }));
    });

    return {
      name: envName,
      ...(envName === 'staging' && enabled.includes('production') ? { cloneFrom: 'production' } : {}),
      services,
      domains,
      // Declared in every environment: the provider provisions a template database once and places it in the
      // duplicate, which is the behaviour measured live rather than an assumption (service names are
      // project-wide).
      databases: database && placedNames.size ? [{ name: database.name, kind: database.kind }] : [],
      buckets: storage && placedNames.size ? [{ name: storage.name, ...(storage.region ? { region: storage.region } : {}) }] : [],
      volumes: declaredVolumes
        .filter((v) => placedNames.has(v.service))
        .map((v) => ({ name: v.name, service: v.service, mountPath: v.mountPath, ...(v.sizeGB ? { sizeMB: v.sizeGB * 1024 } : {}), ...(v.retention ? { retention: v.retention } : {}) })),
    };
  });

  const plan = {
    instanceId: config.instanceId,
    teamId: config.teamId,
    provider: config.provider ?? 'railway',
    contract: '1.0.0',
    // Hash of the rendered desired state, so a re-apply of an unchanged manifest is idempotent.
    planHash: createHash('sha256').update(JSON.stringify({ platform, version: manifest.metadata.version, environments })).digest('hex'),
    manifestRef: { template: platform, version: manifest.metadata.version },
    environments,
  };

  return InfraPlanSchema.parse(plan);
}
