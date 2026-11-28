import { customerInstallationNames, installationWorkerReadiness } from '../packages/contracts/src/customer-installation-services.ts';
import { railwayTemplateDigest } from '../packages/contracts/src/railway-template.ts';
import { RAILWAY_AUTHORIZATION_CALLBACK } from '../packages/contracts/src/customer-hosting-commands.ts';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { EnvName } from '../packages/manifest/src/environments.ts';
import { customerControlPlanePlan } from './launch-customer-control-plane.ts';
import { openBaoConfig, openBaoData, openBaoImage, openBaoStart, workerData, workerStart } from './customer-installation-topology.ts';
import { resolveCheckoutCandidate } from './platform-candidate.ts';

const databaseImage = 'postgres:17.11@sha256:ff87138949ad9a46f32ff23bd6852b52ce024a13dffe9b4087be98292cdd3b4f';
const databaseVolume = '/var/lib/postgresql/data';
const reference = (service: string, variable: string) => '${{' + service + '.' + variable + '}}';
const publicOrigin = (service: string) => 'https://' + reference(service, 'RAILWAY_PUBLIC_DOMAIN');
const privateHost = (service: string) => reference(service, 'RAILWAY_PRIVATE_DOMAIN');
const secret = '${{secret(48, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")}}';
const hex = (length: number) => '${{secret(' + length + ', "0123456789abcdef")}}';
const subject = hex(8) + '-' + hex(4) + '-4' + hex(3) + '-a' + hex(3) + '-' + hex(12);
interface TemplateVariable { defaultValue: string; description?: string; isOptional?: boolean }

function variables(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([name, defaultValue]) => [name, { defaultValue }]));
}

// Railway’s template config addresses services and mounts by UUID. Keep those IDs stable across renders.
function resourceId(name: string) {
  const hex = createHash('sha256').update('platfolio-railway-template:' + name).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16), '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
}

function service(name: string, image: string, values: Record<string, TemplateVariable>, options: {
  readonly start?: string;
  readonly port?: number;
  readonly health?: string;
  readonly volume?: string;
} = {}) {
  if (!/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Installer images must be pinned by digest');
  const { start, port, health, volume } = options;
  return {
    name, source: { image }, variables: values,
    ...(start || health ? { deploy: { numReplicas: 1,
      ...(start ? { startCommand: start } : {}),
      ...(health ? { healthcheckPath: health, healthcheckTimeout: 240 } : {}),
    } } : {}),
    ...(port ? { networking: { serviceDomains: { '<hasDomain>': { port } } } } : {}),
    ...(volume ? { volumeMounts: { [resourceId(name + '-data')]: { mountPath: volume } } } : {}),
  };
}

export async function renderRailwayInstaller(candidateFile: string, registryOrigin: string, environment: EnvName = 'staging') {
  const registry = new URL(registryOrigin);
  if (registry.protocol !== 'https:' || registry.origin !== registryOrigin) throw new Error('Use an exact HTTPS marketplace origin');
  const plan = await customerControlPlanePlan(candidateFile);
  const { database, identity, site, api, worker, vault } = customerInstallationNames(environment);
  const issuer = publicOrigin(identity) + '/realms/platfolio';
  const ownerSubject = reference(identity, 'PLATFOLIO_INSTALL_OWNER_SUBJECT');
  const apiImage = plan.api.image + '@' + plan.api.digest;
  const pass = reference(database, 'POSTGRES_PASSWORD');
  const team = 'team-' + ownerSubject;
  const key = reference(worker, 'PLATFOLIO_LAUNCH_WORKER_KEY');
  const fromManifest = (spec: typeof plan.api) => Object.fromEntries((spec.references ?? []).map(({ database: resource, variable, output }) => {
    if (resource !== 'main') throw new Error('Unexpected installation database reference');
    return [variable, reference(database, output ?? 'DATABASE_URL')];
  }));

  const serializedConfig = { services: {
      [resourceId(database)]: service(database, databaseImage, variables({ POSTGRES_DB: 'platfolio', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: secret,
        'PGDATA': databaseVolume + '/pgdata',
        PGHOST: privateHost(database), PGPORT: '5432', DATABASE_URL: 'postgresql://postgres:' + pass + '@' + privateHost(database) + ':5432/platfolio',
      }), { volume: databaseVolume }),
      [resourceId(identity)]: service(identity, plan.identity.image + '@' + plan.identity.digest, {
        ...variables({ ...plan.identity.env, ...fromManifest(plan.identity), PORT: String(plan.identity.port), KC_HOSTNAME: publicOrigin(identity),
          KC_HOSTNAME_STRICT: 'true', PLATFOLIO_SITE_ORIGIN: publicOrigin(site),
          PLATFOLIO_INSTALL_OWNER_SUBJECT: subject, PLATFOLIO_INSTALL_OWNER_PASSWORD: secret, PLATFOLIO_PRIVATE_SETUP_KEY: secret,
        }),
        PLATFOLIO_INSTALL_OWNER_EMAIL: { defaultValue: '', description: 'The email address for the first Platfolio owner.' },
        'PLATFOLIO_ACCOUNT_POLICY': { defaultValue: 'managed', description: 'Use managed for administrator-approved users or public for self-service accounts.' },
      }, { port: plan.identity.port, start: '/opt/keycloak/bin/platfolio-entrypoint.sh start-private', health: '/realms/platfolio' }),
      [resourceId(api)]: service(api, apiImage, variables({ ...plan.api.env, ...fromManifest(plan.api), PORT: String(plan.api.port),
        PLATFOLIO_IDENTITY_ISSUER: issuer, PLATFOLIO_IDENTITY_JWKS_URI: issuer + '/protocol/openid-connect/certs',
        PLATFOLIO_ALLOWED_ORIGINS: publicOrigin(site), PLATFOLIO_SCM_DRIVER: 'git', PLATFOLIO_INSTALLATION_ROLE: 'private',
        PLATFOLIO_INSTALL_OWNER_SUBJECT: ownerSubject, PLATFOLIO_LAUNCH_TEAM: team, PLATFOLIO_LAUNCH_WORKER_KEY: key,
        PLATFOLIO_PRIVATE_SETUP_KEY: reference(identity, 'PLATFOLIO_PRIVATE_SETUP_KEY'),
        PLATFOLIO_LAUNCH_WORKER_URL: 'http://' + privateHost(worker) + ':8080',
      }), { port: plan.api.port, health: plan.api.healthPath ?? '/readyz' }),
      [resourceId(site)]: service(site, plan.site.image + '@' + plan.site.digest, variables({ ...plan.site.env, PORT: String(plan.site.port),
        PLATFOLIO_SITE_ORIGIN: publicOrigin(site), PLATFOLIO_URL: publicOrigin(api), PLATFOLIO_IDENTITY_ISSUER: issuer,
        PLATFOLIO_INSTALLATION_ROLE: 'private',
      }), { port: plan.site.port, health: plan.site.healthPath ?? '/status' }),
      [resourceId(vault)]: service(vault, openBaoImage, variables({ RAILWAY_RUN_UID: '0', BAO_LOCAL_CONFIG: openBaoConfig(privateHost(vault), vault) }),
        { start: openBaoStart, volume: openBaoData }),
      [resourceId(worker)]: service(worker, apiImage, {
        ...variables({ PORT: '8080', HOST: '::', RAILWAY_RUN_UID: '0', PLATFOLIO_LAUNCH_STATE_DIR: workerData,
          PLATFOLIO_LAUNCH_TEAM: team, PLATFOLIO_LAUNCH_WORKER_KEY: secret, PLATFOLIO_OPENBAO_WORKER_SECRET: secret,
          PLATFOLIO_OPENBAO_URL: 'http://' + privateHost(vault) + ':8200', PLATFOLIO_REGISTRY_ORIGIN: registryOrigin,
          PLATFOLIO_RAILWAY_OAUTH_CALLBACK: publicOrigin(api) + RAILWAY_AUTHORIZATION_CALLBACK,
        }),
        RAILWAY_WORKSPACE_ID: { defaultValue: '', description: 'The ID of the Railway workspace that owns this project.' },
        PLATFOLIO_LAUNCH_APP_PROJECT: { defaultValue: '', isOptional: true, description: 'Limit Railway authorization to an existing app project.' },
      }, { start: workerStart, health: installationWorkerReadiness, volume: workerData }),
    } };
  return { sourceCommit: plan.sourceCommit, serializedConfig, configDigest: railwayTemplateDigest(serializedConfig) };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const { values } = parseArgs({ options: { candidate: { type: 'string' }, registry: { type: 'string' }, environment: { type: 'string' } } });
  if (!values.candidate || !values.registry) throw new Error('Pass --candidate and --registry to render the installer');
  resolveCheckoutCandidate(values.candidate, fileURLToPath(new URL('..', import.meta.url)));
  const environment = values.environment ?? 'staging';
  if (environment !== 'staging' && environment !== 'production') throw new Error('Choose staging or production');
  const installer = await renderRailwayInstaller(values.candidate, values.registry, environment);
  // Railway expands references in its own variables. Preserve the JSON until the hub decodes it.
  process.stdout.write(JSON.stringify(installer, null, 2).replaceAll('$', '\\u0024') + '\n');
}
