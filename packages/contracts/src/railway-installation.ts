import { setTimeout as delay } from 'node:timers/promises';
import type { InstallationEnvironment, InstallationLaunchInput, InstallationObserver, InstallationProvider } from './installation-provider.ts';
import { exchangeRailwayCode, railwayAuthorization, railwayAuthorizedWorkspaces } from './railway-oauth.ts';
import { createRailwayEnvironment, createRailwayProject, listRailwayProjects } from './railway-project.ts';
import { customerInstallationNames, customerInstallationServices as services, installationWorkerReadiness } from './customer-installation-services.ts';
import { deployRailwayTemplate, railwayTemplateDigest, readRailwayTemplate, type RailwayAccess, type RailwayTemplateConfig } from './railway-template.ts';
import { HttpRailwayTransport } from './railway-transport.ts';

const scope = 'workspace:admin';
const healthPaths = { site: '/status', api: '/readyz', identity: '/realms/platfolio' } as const;
const roles = Object.keys(services) as (keyof typeof services)[];

export interface RailwayInstallationConfig {
  clientId: string;
  callback: string;
  templateCode: string;
  templateDigest: string;
  revision: string;
}

function forEnvironment(config: RailwayTemplateConfig, input: InstallationLaunchInput, environment: InstallationEnvironment) {
  const names = customerInstallationNames(environment);
  const staging = customerInstallationNames('staging');
  const source = config.services ?? {};
  const entries = Object.entries(source);
  if (entries.length !== roles.length ||
      roles.some((logical) => entries.filter(([, service]) => service.name === staging[logical]).length !== 1)) {
    throw new Error('The installer does not contain the expected services');
  }
  const services = Object.fromEntries(entries.map(([key, service]) => {
    const logical = roles.find((name) => staging[name] === service.name)!;
    const renamed = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return roles.reduce((current, name) => current.replaceAll(staging[name]!, names[name]!), value);
      }
      if (Array.isArray(value)) return value.map(renamed);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, inner]) => [field, renamed(inner)]));
      return value;
    };
    const placed = renamed(service) as {
      name: string; source?: { image?: string }; networking?: { serviceDomains?: object };
      variables?: Record<string, unknown>; deploy?: { healthcheckPath?: string };
    };
    if (!placed.source?.image || !/@sha256:[a-f0-9]{64}$/.test(placed.source.image) ||
        (Boolean(placed.networking?.serviceDomains) !== Object.hasOwn(healthPaths, logical)) ||
        (!Object.hasOwn(healthPaths, logical) && placed.networking !== undefined) ||
        (logical === 'worker' && placed.deploy?.healthcheckPath !== installationWorkerReadiness)) throw new Error('The installer service layout is invalid');
    const variables = placed.variables ??= {};
    const set = (key: string, defaultValue: string) => { variables[key] = { defaultValue }; };
    if (logical === 'identity') {
      delete variables.PLATFOLIO_INSTALL_OWNER_PASSWORD;
      set('PLATFOLIO_INSTALL_OWNER_EMAIL', input.ownerEmail);
      set('PLATFOLIO_INSTALL_OWNER_VERIFIER', input.verifier);
      set('PLATFOLIO_INSTALL_OWNER_SALT', input.salt);
    }
    if (logical === 'worker') {
      set('RAILWAY_WORKSPACE_ID', input.workspaceId);
      delete variables.PLATFOLIO_LAUNCH_APP_PROJECT;
    }
    return [key, placed];
  }));
  return { ...config, services } satisfies RailwayTemplateConfig;
}

type Service = {
  serviceId: string;
  serviceName: string;
  source: { image?: string } | null;
  activeDeployments: { status: string }[];
  domains: { serviceDomains: { domain: string }[]; customDomains: { id: string }[] };
};

async function readyOrigin(access: RailwayAccess, projectId: string, environmentId: string, environment: InstallationEnvironment,
  config: ReturnType<typeof forEnvironment>, request: typeof fetch, sleep: (ms: number) => Promise<unknown>) {
  const names = customerInstallationNames(environment);
  for (let attempt = 0; attempt < 84; attempt++) {
    const { environment: observed } = await access.transport.graphql<{ environment: { serviceInstances: { edges: { node: Service }[] } } }>({
      ...access, operation: 'installationServices',
      query: 'query ($projectId: String!, $environmentId: String!) { environment(projectId: $projectId, id: $environmentId) { serviceInstances(first: 100) { edges { node { serviceId serviceName source { image } activeDeployments { status } domains { serviceDomains { domain } customDomains { id } } } } } } }',
      variables: { projectId, environmentId },
    });
    const entries = observed.serviceInstances.edges.map(({ node }) => node);
    const expected = Object.values(config.services);
    if (entries.some(({ serviceName }) => !expected.some(({ name }) => serviceName === name))) throw new Error('Unexpected service in the new environment');
    if (expected.every((service) => entries.some((row) => row.serviceName === service.name && row.source?.image === service.source?.image &&
        row.activeDeployments.some(({ status }) => status === 'SUCCESS')))) {
      const privateServices = entries.filter(({ serviceName }) => !roles.some((role) => Object.hasOwn(healthPaths, role) && names[role] === serviceName));
      await Promise.all(privateServices.map(async ({ serviceId, domains }) => {
        const { tcpProxies } = await access.transport.graphql<{ tcpProxies: { id: string }[] }>({
          ...access, operation: 'installationTcpIngress',
          query: 'query ($environmentId: String!, $serviceId: String!) { tcpProxies(environmentId: $environmentId, serviceId: $serviceId) { id } }',
          variables: { environmentId, serviceId },
        });
        if (domains.serviceDomains.length || domains.customDomains.length || tcpProxies.length) throw new Error('A private installation service has public ingress');
      }));
      const origins = await Promise.all((Object.entries(healthPaths) as [keyof typeof healthPaths, string][]).map(async ([logical, path]) => {
        const domain = entries.find(({ serviceName }) => serviceName === names[logical])?.domains.serviceDomains[0]?.domain;
        if (!domain || !/^[a-z0-9-]+\.up\.railway\.app$/.test(domain)) return;
        const origin = 'https://' + domain;
        const healthy = await request(origin + path, { redirect: 'error', signal: AbortSignal.timeout(5000) }).then((response) => response.ok, () => false);
        return healthy ? { logical, origin } : undefined;
      }));
      if (origins.every(Boolean)) return origins.find((result) => result?.logical === 'site')!.origin;
    }
    await sleep(5000);
  }
  throw new Error('The new environment did not become ready');
}

export function railwayInstallationProvider(config: RailwayInstallationConfig, request: typeof fetch = fetch,
  transport = new HttpRailwayTransport({ fetch: request }) as RailwayAccess['transport'], sleep: (ms: number) => Promise<unknown> = delay): InstallationProvider {
  const active = new Set<string>();
  return {
    id: 'railway', revision: config.revision,
    authorize() {
      const { state, verifier, url } = railwayAuthorization(config.clientId, config.callback, 'openid email profile ' + scope);
      return {
        state, url,
        async complete(callback) {
          if (callback.state !== state) throw new Error('Railway returned a different authorization state');
          const { access: token, expires } = await exchangeRailwayCode(request, config.clientId, config.callback, verifier, callback, scope);
          const workspaces = await railwayAuthorizedWorkspaces(token, transport);
          const access: RailwayAccess = { transport, credential: { kind: 'workspace', token } };
          return { expires, workspaces,
            async launch(input, observe) {
              if (expires <= Date.now() || !workspaces.some(({ id }) => id === input.workspaceId)) throw new Error('The workspace was not authorized');
              const { workspaceId, name } = input;
              const key = JSON.stringify([workspaceId, name]);
              if (active.has(key)) throw new Error('A launch is already creating this project');
              active.add(key);
              try {
                await createInstallation(access, config, input, observe, request, sleep);
              } finally {
                active.delete(key);
              }
            },
          };
        },
      };
    },
  };
}

async function createInstallation(access: RailwayAccess, config: RailwayInstallationConfig, input: InstallationLaunchInput, observe: InstallationObserver,
  request: typeof fetch, sleep: (ms: number) => Promise<unknown>) {
  const { step, project, environment } = observe;
  step('Verify the pinned installer', 'WORKING');
  const { id: templateId, serializedConfig } = await readRailwayTemplate(access, config.templateCode);
  if (!templateId || !serializedConfig || railwayTemplateDigest(serializedConfig) !== config.templateDigest) throw new Error('The published installer changed');
  const plans = input.environments.map((name) => ({ name, config: forEnvironment(serializedConfig, input, name) }));
  if (!plans.length) throw new Error('Choose an environment');
  step('Verify the pinned installer', 'READY');
  const { name, workspaceId } = input;
  step('Create the hosting project', 'WORKING');
  const projects = () => listRailwayProjects(access, workspaceId);
  if ((await projects()).some((row) => row.name === name)) throw new Error('There is already a project with this name');
  const description = 'Platfolio project role installation/' + name;
  const id = await createRailwayProject(access, { name, workspaceId, description, defaultEnvironmentName: plans[0]!.name, prDeploys: false });
  const created = (await projects()).find((row) => row.id === id);
  const initial = created?.environments.edges.map(({ node }) => node);
  if (created?.workspaceId !== workspaceId || created.name !== name || created.description !== description ||
      initial?.length !== 1 || initial[0]?.name !== plans[0]!.name) throw new Error('Could not verify the project and its first environment');
  project(id);
  step('Create the hosting project', 'READY');
  for (const plan of plans) {
    const label = 'Deploy and check ' + plan.name;
    step(label, 'WORKING');
    const placement = initial.find((row) => row.name === plan.name) ?? await createRailwayEnvironment(access, id, plan.name);
    if (placement.name !== plan.name || !placement.id) throw new Error('The provider returned a different environment');
    await deployRailwayTemplate(access, { projectId: id, environmentId: placement.id, workspaceId, templateId, serializedConfig: plan.config });
    const origin = await readyOrigin(access, id, placement.id, plan.name, plan.config, request, sleep);
    environment(plan.name, origin);
    step(label, 'READY');
  }
}
