import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { GitScm } from '../packages/contracts/src/git-scm.ts';
import { StarterBrandChangeSchema } from '../packages/contracts/src/starter-brand.ts';
import { FREE_STARTER_RELEASE, readTemplate, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import type { SourceReleaseHosting, SourceReleaseObserver, SourceReleaseProgress } from '../packages/contracts/src/source-release-hosting.ts';
import { customerRailway, type CustomerRailwayGrant } from './customer-railway.ts';
import { validateStarterSource } from '../packages/manifest/src/starter-release.ts';

const listing = FREE_STARTER_RELEASE;
const entry = templateCatalogEntry(listing.template);
const brandSetting = 'UI_BRAND';

export async function readStarterBrand(origin: string): Promise<string | null> {
  if (!/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return null;
  try {
    const response = await fetch(`${origin}/api/ping`, { signal: AbortSignal.timeout(3000), redirect: 'error', headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) return null;
    const body = await response.json() as { brand?: unknown; service?: string; database?: string } | null;
    if (body?.service !== listing.template || body.database !== 'configured') return null;
    const parsed = StarterBrandChangeSchema.safeParse({ value: body.brand });
    return parsed.success ? parsed.data.value : null;
  } catch { return null; }
}

export async function launchStarterApp(app: string, project?: string, progress?: (event: SourceReleaseProgress) => void, grant?: CustomerRailwayGrant, brand?: string, observedProject?: SourceReleaseObserver['project']) {
  const scm = new GitScm();
  progress?.({ step: 'Read the pinned release', state: 'WORKING' });
  const source = await readTemplate((request) => scm.readRepositoryFile(request), entry, listing.revision);
  const inventory = validateStarterSource(source.compose, source.inventory);
  if (brand !== undefined) {
    const declaration = inventory.find(({ name }) => name === brandSetting);
    if (declaration?.kind !== 'value' || declaration.service !== 'web' ||
        (declaration.environments && !declaration.environments.includes('staging')) ||
        !StarterBrandChangeSchema.safeParse({ value: brand }).success) {
      throw new Error('This pinned release does not support the requested public label');
    }
  }
  const target = project ?? grant?.projectId;
  const rail = await customerRailway({ name: app, kind: 'app', ...(target ? { id: target } : {}), create: !target }, progress, grant);
  observedProject?.(rail.project.id);
  progress?.({ step: 'Prepare the database', state: 'WORKING' });
  await rail.privatePostgres('app-db-staging');
  progress?.({ step: 'Prepare the database', state: 'READY' });
  const web = await rail.ensureService('web-staging');
  await rail.setConfig(web, 'PORT', '8080');
  await rail.setConfig(web, 'DATABASE_URL', '${{app-db-staging.DATABASE_URL}}');
  if (brand !== undefined) await rail.setConfig(web, brandSetting, brand);
  await rail.configure(web, { numReplicas: 1, healthcheckPath: '/healthz', healthcheckTimeout: 120 });
  const archive = await mkdtemp(join(tmpdir(), 'platfolio-starter-build-'));
  try {
    for (const [path, content] of Object.entries(source.sources)) {
      const target = join(archive, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const deployment = await rail.upload(web, archive, `Marketplace ${listing.template} at ${listing.revision}`);
    await rail.wait(web, deployment);
    const origin = await rail.publicOrigin(web, 8080);
    progress?.({ step: 'Check the app', state: 'WORKING', resourceId: deployment });
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt++) {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3000), redirect: 'error' }).catch(() => undefined);
      const health = await response?.json().catch(() => undefined) as { ok?: boolean; database?: string } | undefined;
      ready = response?.ok === true && health?.ok === true && health.database === 'configured' &&
        (brand === undefined || await readStarterBrand(origin) === brand);
      if (!ready) await delay(1500);
    }
    if (!ready) throw new Error('The starter is deployed but its launch check failed');
    progress?.({ step: 'Check the app', state: 'READY', resourceId: deployment });
    return { project: rail.project.id, service: web, deployment, template: listing.template, revision: listing.revision, blobs: source.blobs, origin };
  } finally {
    await rm(archive, { recursive: true, force: true });
  }
}

export function railwayStarterHosting(credential?: () => Promise<CustomerRailwayGrant>): SourceReleaseHosting {
  const { template, revision } = listing;
  async function project(id: string) {
    return customerRailway({ kind: 'app', name: template, id }, undefined, await credential?.());
  }

  return {
    template, revision,
    async deploy({ projectId, publicLabel }, observer) {
      return launchStarterApp(template, projectId, observer.step, await credential?.(), publicLabel, observer.project);
    },
    async remove(id, data) { return (await project(id)).remove(data); },
    async domains(id, deployId, action, hostname) { return (await project(id)).starterDomains(deployId, action, hostname); },
    publicLabel: readStarterBrand,
  };
}
