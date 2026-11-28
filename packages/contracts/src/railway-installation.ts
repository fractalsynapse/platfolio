import { setTimeout as delay } from 'node:timers/promises';
import type { InstallationCheckpointObserver, InstallationEnvironment, InstallationLaunchInput, InstallationObserver, InstallationProvider, InstallationRecovery, InstallationTarget, InstallationMaintenance } from './installation-provider.ts';
import { exchangeRailwayCode, railwayAuthorization, railwayAuthorizedWorkspaces } from './railway-oauth.ts';
import { createRailwayEnvironment, createRailwayProject, listRailwayProjects } from './railway-project.ts';
import { customerInstallationNames, customerInstallationServices as services, installationWorkerReadiness } from './customer-installation-services.ts';
import { deployRailwayTemplate, railwayTemplateDigest, readRailwayTemplate, type RailwayAccess, type RailwayTemplateConfig } from './railway-template.ts';
import { configureRailwayService, deployRailwayService } from './railway-service.ts';
import { wipeRailwayProject } from './railway-removal.ts';
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
  installer?: RailwayTemplateConfig;
}

function forEnvironment(config: RailwayTemplateConfig, environment: InstallationEnvironment, input?: InstallationLaunchInput) {
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
    if (input && logical === 'identity') {
      delete variables.PLATFOLIO_INSTALL_OWNER_PASSWORD;
      set('PLATFOLIO_INSTALL_OWNER_EMAIL', input.ownerEmail);
      set('PLATFOLIO_INSTALL_OWNER_VERIFIER', input.verifier);
      set('PLATFOLIO_INSTALL_OWNER_SALT', input.salt);
    }
    if (input && logical === 'worker') {
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
  latestDeployment?: { id: string; status: string };
  domains: { serviceDomains: { domain: string }[]; customDomains: { id: string }[] };
};

async function readServices(access: RailwayAccess, projectId: string, environmentId: string): Promise<Service[]> {
  type Instances = { edges: { node: Service }[]; pageInfo: { hasNextPage: boolean } };
  const { environment: observed } = await access.transport.graphql<{ environment: { serviceInstances: Instances } }>({
    ...access, operation: 'installationServices',
    query: 'query ($projectId: String!, $environmentId: String!) { environment(projectId: $projectId, id: $environmentId) { serviceInstances(first: 100) { edges { node { serviceId serviceName source { image } latestDeployment { id status } activeDeployments { status } domains { serviceDomains { domain } customDomains { id } } } } pageInfo { hasNextPage } } } }',
    variables: { projectId, environmentId },
  });
  if (observed.serviceInstances.pageInfo.hasNextPage) throw new Error('The environment has more services than the installer can verify');
  return observed.serviceInstances.edges.map(({ node }) => node);
}

async function readyOrigin(access: RailwayAccess, projectId: string, environmentId: string, environment: InstallationEnvironment,
  config: ReturnType<typeof forEnvironment>, request: typeof fetch, sleep: (ms: number) => Promise<unknown>, revision?: string) {
  const names = customerInstallationNames(environment);
  for (let attempt = 0; attempt < 84; attempt++) {
    const entries = await readServices(access, projectId, environmentId);
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
        const probe = (route: string) => request(origin + route, { redirect: 'error', signal: AbortSignal.timeout(5000) });
        const healthy = await probe(path)
          .then(async (response) => {
            if (!response.ok) return false;
            if (logical === 'api') {
              const ready = await response.json() as { checks?: { name: string; status: string }[] };
              if (!ready.checks?.some(({ name, status }) => name === 'database' && status === 'ok')) return false;
            }
            if (!revision || logical === 'identity') return true;
            const build = await probe(logical === 'site' ? '/version.json' : '/version');
            return build.ok && (await build.json() as { commit?: string }).commit === revision;
          }).catch(() => false);
        return healthy ? { logical, origin } : undefined;
      }));
      if (origins.every(Boolean)) return {
        site: origins.find((result) => result?.logical === 'site')!.origin,
        api: origins.find((result) => result?.logical === 'api')!.origin,
      };
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
          async function launch(input: InstallationLaunchInput, observe: InstallationObserver | InstallationCheckpointObserver,
            recovery?: InstallationRecovery) {
            if (expires <= Date.now() || !workspaces.some(({ id }) => id === input.workspaceId)) throw new Error('The workspace was not authorized');
            const { workspaceId, name } = input;
            const key = JSON.stringify([workspaceId, name]);
            if (active.has(key)) throw new Error('A launch is already creating this project');
            active.add(key);
            try {
              await createInstallation(access, config, input, observe, request, sleep, recovery);
            } finally {
              active.delete(key);
            }
          }
          return {
            expires, workspaces, launch, recover: launch,
            async maintain(target, action, observe, beforeWrite) {
              if (expires <= Date.now() || !workspaces.some(({ id }) => id === target.workspaceId)) {
                throw new Error('The original workspace was not authorized');
              }
              await maintainInstallation(access, config, target, action, observe, beforeWrite, request, sleep);
            },
          };
        },
      };
    },
  };
}

async function createInstallation(access: RailwayAccess, config: RailwayInstallationConfig, input: InstallationLaunchInput, observe: InstallationObserver | InstallationCheckpointObserver,
  request: typeof fetch, sleep: (ms: number) => Promise<unknown>, recovery?: InstallationRecovery) {
  const { step, project, environment } = observe;
  await step('Verify the pinned installer', 'WORKING');
  const { templateId, serializedConfig } = await pinnedInstaller(access, config);
  const plans = await Promise.all(input.environments.filter((name) => !recovery?.verified.includes(name))
    .map(async (name) => ({ name, config: forEnvironment(serializedConfig, name,
      { ...input, ...await recovery?.firstSignIn?.(name) }) })));
  await step('Verify the pinned installer', 'READY');

  const { name, workspaceId } = input;
  const description = recovery ? 'Platfolio installation ' + recovery.id : 'Platfolio project role installation/' + name;
  const projects = () => listRailwayProjects(access, workspaceId);
  const matches = (await projects()).filter((row) => row.name === name || row.id === recovery?.projectId);
  const owns = (row: typeof matches[number] | undefined) =>
    row?.workspaceId === workspaceId && row.name === name && row.description === description &&
    (!recovery?.projectId || recovery.projectId === row.id);
  let bound = matches[0];
  if (matches.length > 1 || (bound && (!recovery || !owns(bound))) || (!bound && recovery?.projectId)) {
    throw new Error('The original project could not be verified');
  }
  if (!bound) {
    if (!plans[0]) throw new Error('Choose an environment');
    await step('Create the hosting project', 'WORKING');
    await recovery?.beforeWrite();
    const id = await createRailwayProject(access, { name, workspaceId, description, defaultEnvironmentName: plans[0].name, prDeploys: false });
    bound = (await projects()).find((row) => row.id === id);
  }
  if (!bound || !owns(bound)) throw new Error('Could not verify the project and its placement');
  const id = bound.id;
  const initial = bound.environments.edges.map(({ node }) => node);
  const allowed = new Set(input.environments);
  if (!initial.length || initial.some((row) => !allowed.has(row.name as InstallationEnvironment)) ||
      new Set(initial.map((row) => row.name)).size !== initial.length ||
      recovery?.verified.some((name) => !initial.some((row) => row.name === name))) throw new Error('Unexpected environments in the bound project');
  await project(id);
  await step('Verify the hosting project', 'READY');

  for (const plan of plans) {
    const submitted = recovery?.submitted.includes(plan.name) ?? false;
    const label = (submitted ? 'Check the earlier deployment of ' : 'Deploy and check ') + plan.name;
    await step(label, 'WORKING');
    let placement = initial.find((row) => row.name === plan.name);
    if (submitted && !placement) throw new Error('Previously submitted environment is missing');
    if (!placement) {
      await recovery?.beforeWrite();
      placement = await createRailwayEnvironment(access, id, plan.name);
    }
    if (placement.name !== plan.name || !placement.id) throw new Error('The provider returned a different environment');
    if (!submitted) {
      if ((await readServices(access, id, placement.id)).length !== 0) throw new Error('The environment already contains services');
      await recovery?.beforeWrite(plan.name);
      await deployRailwayTemplate(access, { projectId: id, environmentId: placement.id, workspaceId, templateId, serializedConfig: plan.config });
    }
    const origin = await readyOrigin(access, id, placement.id, plan.name, plan.config, request, sleep);
    recovery?.observeApiOrigin?.(plan.name, origin.api);
    await environment(plan.name, origin.site);
    await step(label, 'READY');
  }
}
async function pinnedInstaller(access: RailwayAccess, config: RailwayInstallationConfig) {
  const { id: templateId, serializedConfig: saved } = await readRailwayTemplate(access, config.templateCode);
  const serializedConfig = config.installer ?? saved;
  if (!templateId || !serializedConfig || railwayTemplateDigest(serializedConfig) !== config.templateDigest) {
    throw new Error('The published installer changed');
  }
  return { templateId, serializedConfig };
}

async function maintainInstallation(access: RailwayAccess, config: RailwayInstallationConfig, target: InstallationTarget,
  action: InstallationMaintenance, observe: InstallationCheckpointObserver, beforeWrite: () => Promise<void>,
  request: typeof fetch, sleep: (ms: number) => Promise<unknown>) {
  const projects = () => listRailwayProjects(access, target.workspaceId);
  const project = (await projects()).find(({ id }) => id === target.projectId);
  if (!project && action.action === 'wipe') {
    await observe.step('Verify the hosting project is gone', 'READY');
    return;
  }
  if (!project || project.workspaceId !== target.workspaceId || project.name !== target.name ||
      project.description !== `Platfolio installation ${target.id}`) {
    throw new Error('The original project could not be verified');
  }
  const placements = project.environments.edges.map(({ node }) => node);
  if (!placements.length || placements.some(({ name }) => !target.requested.some((expected) => expected === name))) {
    throw new Error('The project contains an unexpected environment');
  }
  if (action.action === 'wipe') {
    for (const placement of placements) {
      const expected = Object.values(customerInstallationNames(placement.name as InstallationEnvironment));
      if ((await readServices(access, project.id, placement.id)).some(({ serviceName }) => !expected.includes(serviceName))) {
        throw new Error('The project contains an unexpected service');
      }
    }
    await observe.step('Remove the hosting project and its storage', 'WORKING');
    await beforeWrite();
    const failure = await wipeRailwayProject({
      ...access, projectId: project.id,
      projectExists: async () => (await projects()).some(({ id }) => id === project.id),
    });
    if (failure) throw new Error(failure.message);
    await observe.step('Verify the hosting project is gone', 'READY');
    return;
  }

  const placement = placements.find(({ name }) => name === action.environment);
  if (!placement) throw new Error('The requested environment does not exist');
  const { serializedConfig } = await pinnedInstaller(access, config);
  const plan = forEnvironment(serializedConfig, action.environment);
  const desired = Object.values(plan.services);
  const existing = await readServices(access, project.id, placement.id);
  if (existing.length !== desired.length || desired.some(({ name }) => !existing.some((row) => row.serviceName === name))) {
    throw new Error('The environment contains a different service layout');
  }
  const names = customerInstallationNames(action.environment);
  const upgrade = new Set<string>([names.identity, names.api, names.worker, names.site]);
  for (const item of desired) {
    const source = existing.find(({ serviceName }) => serviceName === item.name)?.source?.image;
    if (!source || !/@sha256:[a-f0-9]{64}$/.test(source) || (!upgrade.has(item.name) && source !== item.source?.image)) {
      throw new Error('The database or secret storage requires a separate upgrade procedure');
    }
  }
  // Leave all configuration, service identities, storage and networking in place.
  for (const name of upgrade) {
    const current = existing.find(({ serviceName }) => serviceName === name)!;
    const image = desired.find((item) => item.name === name)!.source!.image!;
    const scope = { environmentId: placement.id, serviceId: current.serviceId };
    const label = `Update ${name}`;
    await observe.step(label, 'WORKING');
    await beforeWrite();
    if (current.source?.image !== image) await configureRailwayService(access, scope, { source: { image } });
    await beforeWrite();
    await deployRailwayService(access, scope);
    let verified = false;
    for (let attempt = 0; attempt < 84; attempt++) {
      const result = (await readServices(access, project.id, placement.id)).find(({ serviceId }) => serviceId === current.serviceId);
      const next = result?.latestDeployment;
      if (next && next.id !== current.latestDeployment?.id && result?.source?.image === image) {
        if (next.status === 'SUCCESS') { verified = true; break; }
        if (['FAILED', 'CRASHED', 'REMOVED'].includes(next.status)) break;
      }
      await sleep(5000);
    }
    if (!verified) throw new Error('The new deployment could not be verified');
    await observe.step(label, 'READY');
  }
  const origin = await readyOrigin(access, project.id, placement.id, action.environment, plan, request, sleep, config.revision);
  await observe.environment(action.environment, origin.site);
}
