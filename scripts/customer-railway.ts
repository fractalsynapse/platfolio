import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { HttpRailwayTransport, type RailwayTransport } from '../packages/contracts/src/railway-transport.ts';
import { configureRailwayService, createRailwayServiceDomain, deployRailwayService, writeRailwayVariable } from '../packages/contracts/src/railway-service.ts';
import { createRailwayProject, listRailwayProjects, type RailwayProject } from '../packages/contracts/src/railway-project.ts';
import { railwayRetainedVolumeIds, stopRailwayDeployments, wipeRailwayProject } from '../packages/contracts/src/railway-removal.ts';
import { customHostname, readRailwayCustomDomain, type RailwayCustomDomain } from '../packages/contracts/src/railway-domains.ts';

import { openBaoConfig, openBaoData, openBaoImage, openBaoStart, workerData, workerStart } from './customer-installation-topology.ts';

const provider = new HttpRailwayTransport();
const baoService = 'openbao-staging';
const workerService = 'installation-worker-staging';
const platformProjectName = 'platfolio';
const platformServices = new Set([baoService, workerService, 'private-api-staging', 'private-site-staging', 'private-identity-staging', 'private-db-staging']);
const appServices = new Set(['web-staging', 'app-db-staging']);
export type CustomerProjectTarget = { name: string; kind: 'installation' | 'app'; id?: string; create?: boolean };
export type CustomerRailwayGrant = { token: string; workspaceId: string; projectId?: string };
export type RailwayProgress = (event: { step: string; state: string; resourceId?: string; detail?: string }) => void;
type Entry = { id: string; name: string };
type Edges<T> = { edges: { node: T }[] };
type Stage = RailwayProject;
type Instance = { serviceId: string; serviceName: string; source: { image?: string; repo?: string } | null; startCommand?: string | null; latestDeployment: { id: string; status: string } | null; activeDeployments: { id: string; status: string }[]; domains: { customDomains: { id: string }[]; serviceDomains: { id: string; domain: string }[] } };

export async function customerRailway(target: CustomerProjectTarget, progress?: RailwayProgress, grant?: CustomerRailwayGrant, transport: RailwayTransport = provider) {
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(target.name) || (target.name === platformProjectName) !== (target.kind === 'installation')) {
    throw new Error('Platfolio must run in the project named platfolio. Every app requires its own project name.');
  }
  const allowed = target.kind === 'installation' ? platformServices : appServices;
  const marker = `Platfolio project role ${target.kind}/${target.name}`;
  const token = grant?.token ?? process.env.RAILWAY_TOKEN;
  const workspaceId = grant?.workspaceId ?? process.env.RAILWAY_WORKSPACE_ID;
  if (!token || !workspaceId) throw new Error('Provide the customer workspace ID and workspace token locally');
  const credential = { kind: 'workspace' as const, token };
  const call = <T>(operation: string, query: string, variables: Record<string, unknown>) =>
    transport.graphql<T>({ operation, query, variables, credential });
  const projectFields = 'id name description environments{edges{node{id name}}}';
  const access = { transport, credential };
  const workspaceProjects = () => listRailwayProjects(access, workspaceId);

  if (grant?.projectId && (target.kind !== 'app' || target.id !== grant.projectId)) throw new Error('The Railway grant is limited to the selected app project');
  const selected = target.id ? (await call<{ project: Stage & { workspaceId: string } }>(
    target.kind === 'app' ? 'selected app project' : 'selected installation project',
    `query($id:String!){project(id:$id){${projectFields} workspaceId}}`, { id: target.id })).project : undefined;
  if (selected && selected.workspaceId !== workspaceId) throw new Error('The selected project is in a different Railway workspace');
  const matches = (selected ? [selected] : await workspaceProjects()).filter(({ name }) => name === target.name);
  if (matches.length > 1) throw new Error('More than one project has this name. Choose a unique app name.');
  let project = matches[0];
  if (target.id && project?.id !== target.id) throw new Error('Railway project ID does not match the approved name and workspace');
  if (!project && target.create) {
    const id = await createRailwayProject(access, {
      name: target.name, description: marker, workspaceId, defaultEnvironmentName: 'staging', prDeploys: false,
    });
    project = (await call<{ project: Stage }>('selected created project',
      'query ($id: String!) { project(id: $id) { id name description workspaceId environments { edges { node { id name } } } } }', { id })).project;
    if (project?.id !== id || project.workspaceId !== workspaceId || project.name !== target.name) {
      throw new Error('Could not verify the newly created Railway project');
    }
  }
  const environments = project?.environments.edges.map(({ node }) => node);
  const environment = environments?.find(({ name }) => name === 'staging');
  if (!project || project.description !== marker || environments?.length !== 1 || !environment) {
    throw new Error('Use a staging-only project created for this exact platform by the customer launcher');
  }
  const scope = { projectId: project.id, environmentId: environment.id };

  async function instances() {
    const data = await call<{ environment: { serviceInstances: Edges<Instance> } }>('stage instances',
      'query($projectId:String!,$environmentId:String!){environment(projectId:$projectId,id:$environmentId){serviceInstances(first:100){edges{node{serviceId serviceName source{image repo} startCommand latestDeployment{id status} activeDeployments{id status} domains{customDomains{id} serviceDomains{id domain}}}}}}}', scope);
    const services = data.environment.serviceInstances.edges.map(({ node }) => node);
    if (services.some(({ serviceName }) => !allowed.has(serviceName))) throw new Error('The project contains services for a different platform');
    return services;
  }
  async function ensureService(name: string, image?: string, options: { updateImage?: boolean } = {}) {
    if (!allowed.has(name)) throw new Error('Service is outside the approved platform project');
    const found = (await instances()).find((item) => item.serviceName === name);
    if (found) {
      if (image && found.source?.image !== image) {
        if (!options.updateImage || target.kind !== 'installation' || !/^private-(api|site|identity)-staging$/.test(name) ||
            !found.source?.image || found.source.repo || !/@sha256:[a-f0-9]{64}$/.test(image)) {
          throw new Error(`Existing ${name} must use the launcher image pin. Use an explicit candidate update for a private Platfolio installation.`);
        }
        await configure(found.serviceId, { source: { image } });
        const updated = (await instances()).find(({ serviceId }) => serviceId === found.serviceId);
        if (updated?.source?.image !== image) throw new Error(`Railway did not set the candidate image for ${name}`);
      }
      return found.serviceId;
    }
    const { serviceCreate } = await call<{ serviceCreate: Entry }>('stage service create',
      'mutation($input:ServiceCreateInput!){serviceCreate(input:$input){id name}}', { input: { ...scope, name, ...(image ? { source: { image } } : {}) } });
    return serviceCreate.id;
  }
  const placement = (serviceId: string) => ({ environmentId: scope.environmentId, serviceId });
  const configure = (serviceId: string, input: Record<string, unknown>) =>
    configureRailwayService(access, placement(serviceId), input);
  const setConfig = (serviceId: string, name: string, value: string) =>
    writeRailwayVariable(access, { ...scope, serviceId, name, value });
  async function assertPrivate(serviceId: string) {
    const service = (await instances()).find((item) => item.serviceId === serviceId);
    const { tcpProxies } = await call<{ tcpProxies: { id: string }[] }>('stage TCP ingress',
      'query($environmentId:String!,$serviceId:String!){tcpProxies(environmentId:$environmentId,serviceId:$serviceId){id}}', { environmentId: scope.environmentId, serviceId });
    if (!service || tcpProxies.length || service.domains.customDomains.length || service.domains.serviceDomains.length) {
      throw new Error('A private service has public ingress or is absent from the intended environment');
    }
  }
  async function upload(serviceId: string, source: string, message: string) {
    const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
    childEnv.RAILWAY_API_TOKEN = token;
    const result = await promisify(execFile)('npm', ['exec', '--yes', '--package=@railway/cli@5.75.0', '--', 'railway', 'up', '.', '--path-as-root', '--detach',
      '--project', scope.projectId, '--environment', scope.environmentId, '--service', serviceId, '--message', message],
      { cwd: source, encoding: 'utf8', timeout: 120_000, env: childEnv }).catch(() => {
      throw new Error('Railway could not upload the pinned source. Check your connection and resume setup.');
    });
    const id = /[?&]id=([0-9a-f-]{36})\b/.exec(result.stdout)?.[1];
    if (!id) throw new Error('Railway did not report a deployment ID');
    return id;
  }
  async function wait(serviceId: string, deploymentId?: string, previousId?: string) {
    let previousStatus = '';
    for (let attempt = 0; attempt < 84; attempt++) {
      const deployment = (await instances()).find((item) => item.serviceId === serviceId)?.latestDeployment;
      if (deployment && deployment.id !== previousId && (!deploymentId || deployment.id === deploymentId)) {
        if (deployment.status !== previousStatus) progress?.({ step: 'Railway deployment', state: deployment.status, resourceId: deployment.id });
        previousStatus = deployment.status;
        if (deployment.status === 'SUCCESS') return deployment.id;
        if (['FAILED', 'CRASHED', 'REMOVED'].includes(deployment.status)) throw new Error(`Staging deployment ${deployment.id} is ${deployment.status}`);
      }
      await delay(5000);
    }
    throw new Error('Timed out waiting for the exact staging deployment');
  }
  async function deployImage(serviceId: string) {
    const current = (await instances()).find((item) => item.serviceId === serviceId);
    await deployRailwayService(access, placement(serviceId));
    return wait(serviceId, undefined, current?.latestDeployment?.id);
  }
  async function publicOrigin(serviceId: string, port: number) {
    const service = (await instances()).find((item) => item.serviceId === serviceId);
    if (!service) throw new Error('Railway service is outside the staging placement');
    const domain = service.domains.serviceDomains[0]?.domain ??
      await createRailwayServiceDomain(access, placement(serviceId), port);
    if (!/^[a-z0-9-]+\.up\.railway\.app$/.test(domain)) throw new Error('Unexpected Railway ingress hostname');
    return `https://${domain}`;
  }

  async function starterDomains(deploymentId: string, action: 'list' | 'attach' | 'detach', rawHost?: string) {
    if (target.kind !== 'app' || target.name !== 'starter-web' || !target.id) throw new Error('Select the verified Starter Web project');
    const host = rawHost && customHostname(rawHost);
    if (action !== 'list' && !host) throw new Error('Supply a custom hostname');
    const service = (await instances()).find(({ serviceName }) => serviceName === 'web-staging');
    if (!service || service.source?.repo || service.latestDeployment?.id !== deploymentId ||
        !service.activeDeployments.some(({ id, status }) => id === deploymentId && status === 'SUCCESS') ||
        service.domains.serviceDomains.length === 0) return { outcome: 'conflict' as const };
    const serviceId = service.serviceId;
    const read = async () => {
      const data = await call<{ environment: { serviceInstances: Edges<{ serviceId: string; domains: { customDomains: RailwayCustomDomain[] } }> } }>(
        'starter custom domain status',
        'query($projectId:String!,$environmentId:String!){environment(projectId:$projectId,id:$environmentId){serviceInstances(first:100){edges{node{serviceId domains{customDomains{id domain status{verified certificateStatus verificationDnsHost verificationToken dnsRecords{fqdn hostlabel zone recordType requiredValue currentValue status purpose}}}}}}}}}',
        scope,
      );
      const selected = data.environment.serviceInstances.edges.find(({ node }) => node.serviceId === serviceId);
      if (!selected) throw new Error('Railway did not return the approved service');
      return selected.node.domains.customDomains;
    };
    const domains = await read();
    if (action === 'list') return { outcome: 'listed' as const, domains: domains.map(readRailwayCustomDomain) };
    const existing = domains.find(({ domain }) => domain === host);
    if (action === 'detach') {
      if (existing) {
        if (!existing.id) throw new Error('Railway did not return the domain ID');
        await call<{ customDomainDelete: boolean }>('detach starter custom domain',
          'mutation($id:String!){customDomainDelete(id:$id)}', { id: existing.id }).catch(() => undefined);
        if ((await read()).some(({ domain }) => domain === host)) throw new Error('Railway still reports the domain');
      }
      return { outcome: 'detached' as const };
    }
    if (existing) return { outcome: 'attached' as const, domain: readRailwayCustomDomain(existing) };
    if (domains.length > 0) return { outcome: 'conflict' as const };
    const accepted = await call<{ customDomainCreate: { domain: string } }>('attach starter custom domain',
      'mutation($input:CustomDomainCreateInput!){customDomainCreate(input:$input){id domain}}',
      { input: { ...scope, serviceId, domain: host, targetPort: 8080 } })
      .then(({ customDomainCreate }) => customDomainCreate.domain === host, () => false);
    const attached = (await read()).find(({ domain }) => domain === host);
    if (!attached && !accepted) return { outcome: 'not-available' as const };
    if (!attached) throw new Error('Railway did not confirm the requested domain');
    return { outcome: 'attached' as const, domain: readRailwayCustomDomain(attached) };
  }
  async function privatePostgres(name: string) {
    if (!allowed.has(name)) throw new Error('Database is outside the approved platform project');
    let database = (await instances()).find((item) => item.serviceName === name);
    const existingDatabase = Boolean(database);
    if (!database) {
      type Template = { id: string; serializedConfig: { services: Record<string, Record<string, unknown>> } };
      const { template } = await call<{ template: Template }>('Postgres template', 'query{template(code:"postgresql"){id serializedConfig}}', {});
      const entries = Object.entries(template.serializedConfig.services);
      if (entries.length !== 1 || !entries[0]) throw new Error('Unexpected Railway Postgres template');
      const [key, configuration] = entries[0];
      const { networking: _networking, ...privateConfiguration } = configuration;
      await call('stage private Postgres creation', 'mutation($input:TemplateDeployV2Input!){templateDeployV2(input:$input){operationId}}', {
        input: { ...scope, workspaceId, templateId: template.id, serializedConfig: { services: { [key]: { ...privateConfiguration, name } } } },
      });
      for (let attempt = 0; attempt < 60 && !database; attempt++) {
        await delay(2000);
        database = (await instances()).find((item) => item.serviceName === name);
      }
    }
    if (!database) throw new Error('PostgreSQL did not appear in the staging environment');
    if (existingDatabase && (!database.latestDeployment || database.latestDeployment.status === 'REMOVED')) await deployImage(database.serviceId);
    else await wait(database.serviceId);
    await assertPrivate(database.serviceId);
  }
  async function verifyWorker(deploymentId: string) {
    for (let attempt = 0; attempt < 25; attempt++) {
      const { deploymentLogs } = await call<{ deploymentLogs: { message: string }[] }>('stage worker network evidence',
        'query($deploymentId:String!){deploymentLogs(deploymentId:$deploymentId,limit:50){message}}', { deploymentId });
      const proof = deploymentLogs.find(({ message }) => /^PLATFOLIO_OPENBAO_NETWORK reachable=true http=\d{3} initialized=(true|false) sealed=(true|false)$/.test(message));
      if (proof) return proof.message;
      await delay(2000);
    }
    throw new Error('The worker did not verify a private OpenBao health response');
  }
  async function ensureVolume(serviceId: string, mountPath: string) {
    const volumes = await call<{ environment: { volumeInstances: Edges<{ serviceId: string; mountPath: string }> } }>('stage storage placement',
      'query($environmentId:String!){environment(id:$environmentId){volumeInstances(first:100){edges{node{serviceId mountPath}}}}}', { environmentId: scope.environmentId });
    const mounted = volumes.environment.volumeInstances.edges.some(({ node }) => node.serviceId === serviceId && node.mountPath === mountPath);
    if (!mounted) await call('stage volume create', 'mutation($input:VolumeCreateInput!){volumeCreate(input:$input){id}}', { input: { ...scope, serviceId, mountPath } });
    return mounted;
  }

  async function deployOpenBao() {
    const serviceId = await ensureService(baoService, openBaoImage);
    await assertPrivate(serviceId);
    const mounted = await ensureVolume(serviceId, openBaoData);
    const address = `${baoService}.railway.internal`;
    const current = (await instances()).find((item) => item.serviceId === serviceId);
    if (!mounted || current?.startCommand !== openBaoStart || current.latestDeployment?.status !== 'SUCCESS') {
      await setConfig(serviceId, 'RAILWAY_RUN_UID', '0');
      await setConfig(serviceId, 'BAO_LOCAL_CONFIG', openBaoConfig(address, baoService));
      await configure(serviceId, { startCommand: openBaoStart, numReplicas: 1 });
      await deployImage(serviceId);
    }
    await assertPrivate(serviceId);
    return `http://${address}:8200`;
  }

  async function remove(data: 'keep' | 'wipe') {
    if (target.kind !== 'app') throw new Error('App removal must target its own project');
    const read = async () => (await instances()).flatMap((service) => {
      if (service.source?.repo) throw new Error('Disconnect automatic repository deployment before removing this app');
      return [...service.activeDeployments, ...(service.latestDeployment ? [service.latestDeployment] : [])];
    });
    if (data === 'wipe') {
      await read();
      if (grant?.projectId) throw new Error('A project-only connection cannot verify permanent project removal');
      const failure = await wipeRailwayProject({
        transport, credential, projectId: scope.projectId,
        projectExists: async () => (await workspaceProjects()).some(({ id }) => id === scope.projectId),
      });
      if (failure) throw new Error(failure.message);
      return { projectId: scope.projectId, retainedVolumes: [] as string[] };
    }
    const volumes = () => railwayRetainedVolumeIds(access, scope.environmentId);
    const kept = await volumes();
    await stopRailwayDeployments({ transport, credential, read, sleep: delay, attempts: 60, intervalMs: 1500 });
    if ((await volumes()).join() !== kept.join()) throw new Error('Storage changed while stopping the app');
    return { projectId: scope.projectId, retainedVolumes: kept };
  }

  await instances();
  progress?.({ step: 'Railway project', state: 'CONNECTED', resourceId: project.id });
  return { project, scope, instances, ensureService, assertPrivate, setConfig, configure, upload, wait, deployImage, privatePostgres, publicOrigin, starterDomains, remove,
  async installLaunchWorker(image: string, config: {
    team: string; workerKey: string; openBaoSecret: string; client?: string; callback: string; appProject?: string; registryOrigin?: string;
  }) {
    if (target.kind !== 'installation') throw new Error('The launch worker belongs in the Platfolio project');
    const openbao = await deployOpenBao();
    const service = await ensureService(workerService);
    await assertPrivate(service);
    const worker = (await instances()).find(({ serviceId }) => serviceId === service);
    if (worker?.source?.repo || !/^[^@]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('A launch worker requires a pinned candidate image');
    await ensureVolume(service, workerData);
    const runtime = { PLATFOLIO_OPENBAO_URL: openbao, PLATFOLIO_OPENBAO_WORKER_SECRET: config.openBaoSecret,
      ...(config.registryOrigin ? { PLATFOLIO_REGISTRY_ORIGIN: config.registryOrigin } : {}),
      PLATFOLIO_LAUNCH_STATE_DIR: workerData, PLATFOLIO_LAUNCH_WORKER_KEY: config.workerKey, PLATFOLIO_LAUNCH_TEAM: config.team,
      PLATFOLIO_RAILWAY_OAUTH_CLIENT: config.client ?? '', PLATFOLIO_RAILWAY_OAUTH_CALLBACK: config.callback,
      RAILWAY_WORKSPACE_ID: workspaceId, PLATFOLIO_LAUNCH_APP_PROJECT: config.appProject ?? '', RAILWAY_RUN_UID: '0', PORT: '8080', HOST: '::' };
    for (const [name, value] of Object.entries(runtime)) {
      await setConfig(service, name, value).catch(() => { throw new Error(`Railway did not apply worker setting ${name}`); });
    }
    await configure(service, { source: { image }, numReplicas: 1, healthcheckPath: '/status', healthcheckTimeout: 120,
      startCommand: workerStart });
    const deployment = await deployImage(service);
    await assertPrivate(service);
    const verified = (await instances()).find(({ serviceId }) => serviceId === service);
    if (verified?.source?.image !== image || verified.latestDeployment?.id !== deployment) throw new Error('Worker candidate did not match at read-back');
    return { worker: service, deployment };
  },
  async launch(workerSource: string) {
    if (target.kind !== 'installation') throw new Error('OpenBao and its worker belong in the platfolio project');
    const openbaoUrl = await deployOpenBao();
    const worker = await ensureService(workerService);
    await assertPrivate(worker);
    const existing = (await instances()).find(({ serviceId }) => serviceId === worker);
    if (existing?.source?.image) throw new Error('Pass the owner launch configuration to preserve the hosted worker');
    await setConfig(worker, 'PLATFOLIO_OPENBAO_URL', openbaoUrl);
    const deployment = await upload(worker, workerSource, 'Platfolio customer installation worker');
    await wait(worker, deployment);
    await assertPrivate(worker);
    return { worker, deployment, openbao: await verifyWorker(deployment) };
  } };
}
