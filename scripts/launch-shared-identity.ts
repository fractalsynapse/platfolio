import { setTimeout as delay } from 'node:timers/promises';
import { GitScm } from '../packages/contracts/src/git-scm.ts';
import type { SourceReleaseHosting } from '../packages/contracts/src/source-release-hosting.ts';
import {
  applyInventory, parseCompose, parseInventory, readTemplate, renderProdOverlay, SHARED_IDENTITY_RELEASE,
  templateCatalogEntry, validateInventory,
} from '../packages/manifest/src/index.ts';
import { customerRailway, removeCustomerApp, type CustomerRailwayGrant } from './customer-railway.ts';

const { template, version, revision, image } = SHARED_IDENTITY_RELEASE;
const keycloak = 'keycloak';
const realmPath = '/realms/master';
const discoveryPath = realmPath + '/.well-known/openid-configuration';
const signingKeysPath = realmPath + '/protocol/openid-connect/certs';
const bootstrapSetting = 'KC_BOOTSTRAP_ADMIN_PASSWORD';

export async function sharedIdentityReady(origin: string): Promise<boolean> {
  const read = async <T>(path: string): Promise<T | undefined> => {
    const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(4000) });
    return response.ok ? await response.json() as T : undefined;
  };
  try {
    const discovery = await read<{ issuer?: string; jwks_uri?: string }>(discoveryPath);
    if (discovery?.issuer !== origin + realmPath || discovery?.jwks_uri !== origin + signingKeysPath) return false;
    const keys = await read<{ keys?: unknown }>(signingKeysPath);
    return Array.isArray(keys?.keys) && keys.keys.some((key: { kid?: string; use?: string }) => key?.kid && key.use === 'sig');
  } catch { return false; }
}

export function railwaySharedIdentityHosting(credential: () => Promise<CustomerRailwayGrant>): SourceReleaseHosting {
  return {
    template, revision,
    async deploy({ projectId, bootstrap }, observer) {
      if (!bootstrap) throw new Error('A Keycloak bootstrap password is required');
      observer.step({ step: 'Read the pinned release', state: 'WORKING' });
      const scm = new GitScm();
      const source = await readTemplate((request) => scm.readRepositoryFile(request), templateCatalogEntry(template), revision);
      const [taggedImage, digest] = image.split('@') as [string, string];
      const [repository, tag] = taggedImage.split(':') as [string, string];
      const parsed = parseCompose([source.compose, renderProdOverlay(source.compose, { [keycloak]: { image: repository, tag, digest } })]);
      const inventory = parseInventory(source.inventory ?? '');
      if (!parsed.manifest || parsed.issues.length || inventory.issues.length || validateInventory(inventory.entries, parsed.manifest).length) {
        throw new Error('The pinned identity release has an invalid platform manifest');
      }
      const manifest = applyInventory(parsed.manifest, inventory.entries);
      const database = manifest.spec.resources.database;
      const service = manifest.spec.services[keycloak];
      if (manifest.metadata.name !== template || manifest.metadata.version !== version || manifest.metadata.mode !== 'hosted' ||
          !service?.public || service.image !== taggedImage || service.digest !== digest || !service.start || database?.kind !== 'postgres' ||
          service.references.some((ref) => ref.database !== database.name || !ref.output) ||
          !service.secrets.some(({ name }) => name === bootstrapSetting)) {
        throw new Error('Unexpected identity release topology');
      }
      const grant = await credential();
      if (grant.projectId) throw new Error('A workspace grant is required');
      const rail = await customerRailway({ name: template, kind: 'app', ...(projectId ? { id: projectId } : { create: true }) }, observer.step, grant);
      observer.project(rail.project.id);
      const databaseName = database.name + '-staging';
      observer.step({ step: 'Prepare the database', state: 'WORKING' });
      await rail.privatePostgres(databaseName);
      observer.step({ step: 'Prepare the database', state: 'READY' });
      const id = await rail.ensureService(keycloak + '-staging', image);
      const origin = await rail.publicOrigin(id, service.port);
      const values = { ...service.env, ...service.environmentValues.production, PORT: String(service.port), KC_HOSTNAME: origin };
      for (const [name, value] of Object.entries(values)) await rail.setConfig(id, name, value);
      for (const { variable, output } of service.references) await rail.setConfig(id, variable, ['${{', databaseName, '.', output, '}}'].join(''));
      await rail.setConfig(id, bootstrapSetting, bootstrap);
      // Railway rejected both the discovery and signing-key paths as service health checks.
      // Its API accepts the realm path. The public launch verification still checks both OIDC endpoints.
      await rail.configure(id, { numReplicas: service.replicas, startCommand: service.start,
        healthcheckPath: realmPath, healthcheckTimeout: 240 });
      observer.step({ step: 'Start Shared Identity', state: 'WORKING' });
      const deployment = await rail.deployImage(id);
      observer.step({ step: 'Check identity discovery and signing keys', state: 'WORKING', resourceId: deployment });
      for (let attempt = 0; attempt < 35; attempt += 1) {
        if (await sharedIdentityReady(origin)) {
          observer.step({ step: 'Check identity discovery and signing keys', state: 'READY', resourceId: deployment });
          return { project: rail.project.id, deployment, origin };
        }
        await delay(2000);
      }
      throw new Error('Identity discovery and signing keys did not pass HTTPS verification');
    },
    async remove(id, data) { return removeCustomerApp(template, id, data, await credential()); },
    async domains() { return { outcome: 'not-available' }; },
    async publicLabel() { return null; },
  };
}
