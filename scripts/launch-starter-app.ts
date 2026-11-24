import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { GitScm } from '../packages/contracts/src/git-scm.ts';
import { FREE_STARTER_RELEASE, parseInventory, readTemplate, templateCatalogEntry } from '../packages/manifest/src/index.ts';
import { customerRailway, type CustomerRailwayGrant, type RailwayProgress } from './customer-railway.ts';
import { parse as parseYaml } from 'yaml';

const listing = FREE_STARTER_RELEASE;
const entry = templateCatalogEntry(listing.template);

export async function launchStarterApp(app: string, project?: string, progress?: RailwayProgress, grant?: CustomerRailwayGrant) {
  const scm = new GitScm();
  progress?.({ step: 'Read the pinned release', state: 'WORKING' });
  const source = await readTemplate((request) => scm.readRepositoryFile(request), entry, listing.revision);
  // This uses Railway's source builder. An image-based InfraPlan is only valid after an artifact is published.
  const compose = parseYaml(source.compose) as { services?: Record<string, { build?: { dockerfile?: string } }>; 'x-platfolio'?: { metadata?: { name?: string; version?: string }; resources?: { database?: { kind?: string } } } };
  const metadata = compose['x-platfolio']?.metadata;
  const inventory = parseInventory(source.inventory ?? '');
  const database = inventory.entries.find((variable) => variable.name === 'DATABASE_URL');
  if (metadata?.name !== listing.template || metadata.version !== listing.version || compose.services?.web?.build?.dockerfile !== 'Dockerfile' ||
      compose['x-platfolio']?.resources?.database?.kind !== 'postgres' || inventory.issues.length || database?.kind !== 'reference' ||
      database.service !== 'web' || database.database !== 'app-db' || database.output !== 'DATABASE_URL') {
    throw new Error('Pinned starter does not match the reviewed source-build and database placement');
  }
  const target = project ?? grant?.projectId;
  const rail = await customerRailway({ name: app, kind: 'app', ...(target ? { id: target } : {}), create: !target }, progress, grant);
  progress?.({ step: 'Prepare the database', state: 'WORKING' });
  await rail.privatePostgres('app-db-staging');
  progress?.({ step: 'Prepare the database', state: 'READY' });
  const web = await rail.ensureService('web-staging');
  await rail.setConfig(web, 'PORT', '8080');
  await rail.setConfig(web, 'DATABASE_URL', '${{app-db-staging.DATABASE_URL}}');
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
      ready = response?.ok === true && health?.ok === true && health.database === 'configured';
      if (!ready) await delay(1500);
    }
    if (!ready) throw new Error('The starter is deployed but its launch check failed');
    progress?.({ step: 'Check the app', state: 'READY', resourceId: deployment });
    return { project: rail.project.id, service: web, deployment, template: listing.template, revision: listing.revision, blobs: source.blobs, origin };
  } finally {
    await rm(archive, { recursive: true, force: true });
  }
}
