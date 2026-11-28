import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCompose, parseComposeDeploymentConfiguration, validateManifest, buildPlan } from '../packages/manifest/src/index.ts';
import { physicalServiceName, RailwayInfraProvider, redactCredentialShaped, type RailwayCredentialSource } from '../packages/contracts/src/index.ts';
import { listRailwayProjects } from '../packages/contracts/src/railway-project.ts';
import { HttpRailwayTransport } from '../packages/contracts/src/railway-transport.ts';
import { resolveCheckoutCandidate } from './platform-candidate.ts';
import { renderRailwayInstaller } from './render-railway-installer.ts';
import { installationAuthorizationCallback } from '../apps/control-plane/src/installation-launch.ts';

const root = new URL('../', import.meta.url);
const project = 'platfolio-hub';
const environment = 'staging';

function hostname(value: string) {
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error('Use a fully qualified lowercase hostname for each public hub service.');
  }
  return value;
}

export function stagingHubPlan(resolveArtifact: (service: string) => string, hosts: {
  site: string; api: string; identity: string;
}, ownerEmail: string, launcher?: Record<string, string>) {
  const site = hostname(hosts.site);
  const api = hostname(hosts.api);
  const identity = hostname(hosts.identity);
  if (new Set([site, api, identity]).size !== 3) throw new Error('The hub requires distinct site, API and Keycloak hostnames.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('Set an initial Keycloak owner email.');
  const siteOrigin = 'https://' + site;
  const apiOrigin = 'https://' + api;
  const identityOrigin = 'https://' + identity;
  const issuer = identityOrigin + '/realms/platfolio';
  const compose = ['compose.yaml', 'compose.hub.yaml'].map((name) => readFileSync(new URL(name, root), 'utf8'));
  const configuration = parseComposeDeploymentConfiguration(readFileSync(new URL('platfolio.hub.yaml', root), 'utf8'));
  const parsed = parseCompose(compose, {
    configuration,
    resolveArtifact: (service) => ['api', 'site', 'identity'].includes(service) ? resolveArtifact(service) : undefined,
  });
  if (!parsed.manifest || parsed.issues.length) {
    throw new Error('Hub Compose did not render: ' + parsed.issues.map(({ path, code }) => path + ' ' + code).join(', '));
  }
  const manifest = parsed.manifest;
  const role = { PLATFOLIO_INSTALLATION_ROLE: 'hub' };
  const settings = {
    api: { host: api, env: { ...role, PLATFOLIO_ALLOWED_ORIGINS: siteOrigin,
      PLATFOLIO_IDENTITY_ISSUER: issuer, PLATFOLIO_IDENTITY_JWKS_URI: issuer + '/protocol/openid-connect/certs', ...launcher } },
    site: { host: site, env: { ...role, PLATFOLIO_SITE_ORIGIN: siteOrigin, PLATFOLIO_URL: apiOrigin, PLATFOLIO_IDENTITY_ISSUER: issuer } },
    identity: { host: identity, env: { KC_HOSTNAME: identityOrigin, KC_HOSTNAME_STRICT: 'true', 'PLATFOLIO_ACCOUNT_POLICY': 'public',
      PLATFOLIO_SITE_ORIGIN: siteOrigin, PLATFOLIO_INSTALL_OWNER_EMAIL: ownerEmail } },
  };
  for (const [name, { host, env }] of Object.entries(settings)) {
    const service = manifest.spec.services[name]!;
    service.domains = [host];
    service.environmentDomains = { staging: [host] };
    Object.assign(service.env, env);
  }
  // The general manifest requires production for tenants. This first-party CI target explicitly has staging only.
  const problems = validateManifest(manifest).filter(({ code }) => code !== 'no-production');
  if (problems.length) throw new Error('Hub manifest did not validate: ' + problems.map(({ path, code }) => path + ' ' + code).join(', '));
  const plan = buildPlan(manifest, { environment, teamId: 'platfolio', instanceId: 'hub' });
  if (manifest.metadata.name !== project || manifest.spec.environments.production.enabled || manifest.spec.environments.preview.enabled ||
      plan.environments.length !== 1 || plan.environments[0]?.name !== environment) throw new Error('The hub plan must contain only staging.');
  return plan;
}

async function main() {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' },
    'site-host': { type: 'string' }, 'api-host': { type: 'string' }, 'auth-host': { type: 'string' },
    'owner-email': { type: 'string' }, apply: { type: 'boolean' },
  } });
  const candidateFile = values.candidate;
  const site = values['site-host'] ?? process.env.PLATFOLIO_HUB_SITE_HOST;
  const api = values['api-host'] ?? process.env.PLATFOLIO_HUB_API_HOST;
  const identity = values['auth-host'] ?? process.env.PLATFOLIO_HUB_AUTH_HOST;
  const owner = values['owner-email'] ?? process.env.PLATFOLIO_INSTALL_OWNER_EMAIL;
  if (!candidateFile || !site || !api || !identity || !owner) throw new Error('Supply the exact CI candidate, three hub hostnames and initial owner email.');
  const candidate = resolveCheckoutCandidate(candidateFile, fileURLToPath(root));
  const oauth = process.env.PLATFOLIO_HUB_RAILWAY_OAUTH_CLIENT;
  const template = process.env.PLATFOLIO_RAILWAY_INSTALL_TEMPLATE;
  if ((oauth && !/^[a-zA-Z0-9._-]+$/.test(oauth)) || (template && !/^[a-zA-Z0-9_-]{6,64}$/.test(template))) {
    throw new Error('Use a valid Railway OAuth client ID and spoke template code.');
  }
  if (Boolean(oauth) !== Boolean(template)) throw new Error('Configure both the spoke installer template and its Railway OAuth client.');
  const installer = oauth && template ? await renderRailwayInstaller(candidateFile, 'https://' + hostname(api)) : undefined;
  const plan = stagingHubPlan(candidate.resolveArtifact, { site, api, identity }, owner, installer && {
    PLATFOLIO_HUB_RAILWAY_OAUTH_CLIENT: oauth!,
    PLATFOLIO_HUB_RAILWAY_OAUTH_CALLBACK: 'https://' + api + installationAuthorizationCallback,
    PLATFOLIO_RAILWAY_INSTALL_TEMPLATE: template!,
    PLATFOLIO_RAILWAY_INSTALL_REVISION: installer.sourceCommit,
    PLATFOLIO_RAILWAY_INSTALL_CONFIG_SHA: installer.configDigest,
    // Railway must not interpolate the spoke's service references or generated secrets in the hub.
    PLATFOLIO_RAILWAY_INSTALL_CONFIG_JSON: JSON.stringify(installer).replaceAll('$', '\\u0024'),
  });
  const staging = plan.environments[0]!;
  console.log(`Hub staging plan ${plan.planHash}: ${staging.services.map(({ name }) => name).join(', ')}; ${staging.databases.map(({ name }) => name).join(', ')}`);
  if (!values.apply) return;
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/staging') {
    throw new Error('Apply the hub from the staging CI workflow.');
  }

  const token = process.env.RAILWAY_TOKEN;
  const workspaceId = process.env.RAILWAY_WORKSPACE_ID;
  const ownerPassword = process.env.PLATFOLIO_INSTALL_OWNER_PASSWORD;
  const adminPassword = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
  if (!token || !workspaceId || !ownerPassword || !/^[a-zA-Z0-9_-]{32,}$/.test(ownerPassword) || !adminPassword) {
    throw new Error('Set the staging Railway grant and both initial Keycloak credentials in CI.');
  }
  const credential = { kind: 'workspace', token } as const;
  const credentials: RailwayCredentialSource = {
    async workspace() { return credential; },
    async forEnvironment() { return credential; },
  };
  const transport = new HttpRailwayTransport();
  const existing = (await listRailwayProjects({ transport, credential }, workspaceId)).filter(({ name }) => name === project);
  if (existing.length > 1 || existing.some(({ workspaceId: bound, environments }) =>
    bound !== workspaceId || environments.edges.length !== 1 || environments.edges[0]?.node.name !== environment)) {
    throw new Error('The named Railway hub must have exactly one staging environment.');
  }
  const provider = new RailwayInfraProvider({ transport, credentials, workspaceId,
    project: { instanceId: plan.instanceId, name: project },
    deployBudget: 10, deployTimeoutMs: 600_000, deployAfterResources: true,
    initialSecret: ({ service, name }) => service !== 'identity' ? undefined
      : name === 'PLATFOLIO_INSTALL_OWNER_PASSWORD' ? ownerPassword
      : name === 'KC_BOOTSTRAP_ADMIN_PASSWORD' ? adminPassword : undefined,
  });
  const issues = provider.validatePlan(plan);
  if (issues.length) throw new Error(issues.map(({ path, code }) => path.join('.') + ' ' + code).join(', '));
  const result = await provider.applyPlan(plan);
  for (const { host, records } of result.domains) {
    for (const { type, fqdn, value } of records ?? []) console.log(`${host} DNS ${type} ${fqdn} ${value}`);
  }
  if (!result.verified || result.failures.length) {
    throw new Error('Hub deployment is incomplete: ' + result.failures.map(({ step, code }) => step + ' ' + code).join(', '));
  }
  const snapshot = await provider.readState(plan.instanceId);
  const expected = new Map(staging.services.map(({ name, image, digest }) =>
    [physicalServiceName(name, environment), `${image}@${digest}`]));
  const databases = staging.databases.map(({ name }) => physicalServiceName(name, environment));
  const ready = [...expected.keys(), ...databases].every((name) => snapshot.services.some((service) =>
    service.name === name && service.environment === environment && service.status === 'live' &&
    (!expected.has(name) || service.image === expected.get(name))));
  if (!ready) throw new Error('Railway did not read back the complete staging hub running the planned images.');
  console.log('Railway verified the hub staging services. Confirm the staged public origins and initialize OpenBao before onboarding.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    let detail = error instanceof Error ? error.message : 'Unexpected failure while applying the hub plan.';
    for (const secret of [process.env.RAILWAY_TOKEN, process.env.PLATFOLIO_INSTALL_OWNER_PASSWORD, process.env.KC_BOOTSTRAP_ADMIN_PASSWORD]) {
      if (secret) detail = detail.replaceAll(secret, '[redacted]');
    }
    detail = redactCredentialShaped(detail).replace(/\s+/g, ' ').slice(0, 400);
    if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Staging hub deployment::' + detail.replaceAll('%', '%25'));
    else console.error(detail);
    process.exitCode = 1;
  }
}
