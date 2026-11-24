import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseCompose, validateManifest } from '../packages/manifest/src/index.ts';
import type { customerRailway } from './customer-railway.ts';
import { readReleaseCandidate } from './platform-candidate.ts';

export async function customerControlPlanePlan(candidateFile: string) {
  const candidate = readReleaseCandidate(candidateFile);
  const checkout = await readFile(resolve(import.meta.dirname, '../compose.yaml'), 'utf8');
  const { manifest, issues } = parseCompose([checkout], { resolveArtifact: (service) => {
    const image = candidate.images[service];
    if (!image) throw new Error(`Candidate has no pinned image for ${service}`);
    return `${image.image}@${image.digest}`;
  } });
  if (!manifest || issues.length || validateManifest(manifest).length) throw new Error('Candidate did not render the Platfolio platform manifest');
  const { api, site, identity } = manifest.spec.services;
  if (!api || !site || !identity || manifest.spec.resources?.database?.kind !== 'postgres') throw new Error('Platfolio must declare its API, site, identity, and Postgres');
  return { sourceCommit: candidate.sourceCommit, api, site, identity };
}

type Stage = Awaited<ReturnType<typeof customerRailway>>;

export async function launchCustomerControlPlane(stage: Stage, plan: Awaited<ReturnType<typeof customerControlPlanePlan>>, adminFile: string) {
  const mode = await stat(adminFile);
  if (!mode.isFile() || (mode.mode & 0o077)) throw new Error('Use a private file for the customer Keycloak bootstrap credential');
  const admin = (await readFile(adminFile, 'utf8')).trim();
  if (admin.length < 32) throw new Error('Use a fresh customer Keycloak bootstrap credential of at least 32 characters');

  const database = 'private-db-staging';
  await stage.privatePostgres(database);
  const services = await Promise.all(Object.entries({ api: plan.api, site: plan.site, identity: plan.identity }).map(async ([name, spec]) => {
    const service = await stage.ensureService(`private-${name}-staging`, `${spec.image}@${spec.digest}`);
    const origin = await stage.publicOrigin(service, spec.port);
    return { name, spec, service, origin };
  }));
  const api = services.find(({ name }) => name === 'api')!;
  const site = services.find(({ name }) => name === 'site')!;
  const identity = services.find(({ name }) => name === 'identity')!;
  const issuer = `${identity.origin}/realms/platfolio`;
  const outputs = {
    api: { PLATFOLIO_IDENTITY_ISSUER: issuer, PLATFOLIO_IDENTITY_JWKS_URI: `${issuer}/protocol/openid-connect/certs`, PLATFOLIO_ALLOWED_ORIGINS: site.origin, PLATFOLIO_DB_MIGRATE: 'true', PLATFOLIO_SCM_DRIVER: 'git' },
    site: { PLATFOLIO_SITE_ORIGIN: site.origin, PLATFOLIO_URL: api.origin, PLATFOLIO_IDENTITY_ISSUER: issuer },
    identity: { KC_HOSTNAME: identity.origin, KC_HOSTNAME_STRICT: 'true' },
  };
  for (const item of services) {
    const runtime = { ...item.spec.env, ...outputs[item.name as keyof typeof outputs], PORT: String(item.spec.port) };
    for (const [key, value] of Object.entries(runtime)) await stage.setConfig(item.service, key, value);
    for (const reference of item.spec.references ?? []) {
      if (reference.database !== 'main') throw new Error('Unexpected Platfolio database reference');
      await stage.setConfig(item.service, reference.variable, '${{' + `${database}.${reference.output ?? 'DATABASE_URL'}` + '}}');
    }
    await stage.configure(item.service, { numReplicas: 1, healthcheckPath: item.spec.healthPath ?? '/status', healthcheckTimeout: 240,
      ...(item.spec.start ? { startCommand: item.spec.start } : {}) });
  }
  await stage.setConfig(identity.service, 'KC_BOOTSTRAP_ADMIN_PASSWORD', admin).catch(() => {
    throw new Error('Railway rejected the customer Keycloak bootstrap credential');
  });
  await stage.deployImage(identity.service);
  await Promise.all([stage.deployImage(api.service), stage.deployImage(site.service)]);
  for (const [origin, path] of [[identity.origin, '/realms/master'], [api.origin, '/status'], [site.origin, '/status']] as const) {
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(3000) }).catch(() => undefined);
      await response?.body?.cancel();
      if (response?.ok) { healthy = true; break; }
      await delay(1500);
    }
    if (!healthy) throw new Error(`Railway ingress did not become ready for ${origin}${path}`);
  }
  return { api: api.origin, site: site.origin, identity: identity.origin, sourceCommit: plan.sourceCommit };
}
