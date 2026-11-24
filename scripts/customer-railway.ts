import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { HttpRailwayTransport } from '../packages/contracts/src/railway-transport.ts';

const provider = new HttpRailwayTransport();
const baoImage = 'quay.io/openbao/openbao@sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315';
const dataPath = '/openbao/file';
const baoService = 'openbao-staging';
const workerService = 'installation-worker-staging';
type Entry = { id: string; name: string };
type Edges<T> = { edges: { node: T }[] };
type Stage = { id: string; name: string; environments: Edges<Entry> };
type Instance = { serviceId: string; serviceName: string; source: { image?: string } | null; startCommand?: string | null; latestDeployment: { id: string; status: string } | null; domains: { customDomains: { id: string }[]; serviceDomains: { id: string; domain: string }[] } };

export async function customerRailway(projectId: string) {
  const token = process.env.RAILWAY_TOKEN;
  const workspaceId = process.env.RAILWAY_WORKSPACE_ID;
  if (!token || !workspaceId) throw new Error('Provide the customer workspace ID and workspace token locally');
  const call = <T>(operation: string, query: string, variables: Record<string, unknown>) =>
    provider.graphql<T>({ operation, query, variables, credential: { kind: 'workspace', token } });
  const { projects } = await call<{ projects: Edges<Stage> }>('customer projects',
    'query($w:String!){projects(workspaceId:$w,first:100){edges{node{id name environments{edges{node{id name}}}}}}}', { w: workspaceId });
  const project = projects.edges.find(({ node }) => node.id === projectId)?.node;
  const environments = project?.environments.edges.map(({ node }) => node);
  const environment = environments?.find(({ name }) => name === 'staging');
  if (!project || environments?.length !== 1 || !environment) throw new Error('Use an existing customer project with only a staging environment');
  const scope = { projectId, environmentId: environment.id };

  async function instances() {
    const data = await call<{ environment: { serviceInstances: Edges<Instance> } }>('stage instances',
      'query($projectId:String!,$environmentId:String!){environment(projectId:$projectId,id:$environmentId){serviceInstances(first:100){edges{node{serviceId serviceName source{image} startCommand latestDeployment{id status} domains{customDomains{id} serviceDomains{id domain}}}}}}}', scope);
    return data.environment.serviceInstances.edges.map(({ node }) => node);
  }
  async function ensureService(name: string, image?: string) {
    const found = (await instances()).find((item) => item.serviceName === name);
    if (found) {
      if (image && found.source?.image !== image) throw new Error(`Existing ${name} must use the launcher image pin`);
      return found.serviceId;
    }
    const { serviceCreate } = await call<{ serviceCreate: Entry }>('stage service create',
      'mutation($input:ServiceCreateInput!){serviceCreate(input:$input){id name}}', { input: { ...scope, name, ...(image ? { source: { image } } : {}) } });
    return serviceCreate.id;
  }
  async function configure(serviceId: string, input: Record<string, unknown>) {
    const result = await call<{ serviceInstanceUpdate: boolean }>('stage instance settings',
      'mutation($environmentId:String!,$serviceId:String!,$input:ServiceInstanceUpdateInput!){serviceInstanceUpdate(environmentId:$environmentId,serviceId:$serviceId,input:$input)}',
      { environmentId: scope.environmentId, serviceId, input });
    if (!result.serviceInstanceUpdate) throw new Error('Railway did not apply service settings');
  }
  async function setConfig(serviceId: string, name: string, value: string) {
    const result = await call<{ variableUpsert: boolean }>('stage runtime configuration',
      'mutation($input:VariableUpsertInput!){variableUpsert(input:$input)}', { input: { ...scope, serviceId, name, value, skipDeploys: true } });
    if (!result.variableUpsert) throw new Error(`Railway did not apply ${name}`);
  }
  async function assertPrivate(serviceId: string) {
    const service = (await instances()).find((item) => item.serviceId === serviceId);
    const { tcpProxies } = await call<{ tcpProxies: { id: string }[] }>('stage TCP ingress',
      'query($environmentId:String!,$serviceId:String!){tcpProxies(environmentId:$environmentId,serviceId:$serviceId){id}}', { environmentId: scope.environmentId, serviceId });
    if (!service || tcpProxies.length || service.domains.customDomains.length || service.domains.serviceDomains.length) {
      throw new Error('A private service has public ingress or is absent from the intended environment');
    }
  }
  function upload(serviceId: string, source: string, message: string) {
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    childEnv['RAILWAY_API_TOKEN'] = token;
    delete childEnv.RAILWAY_TOKEN;
    const result = spawnSync('npm', ['exec', '--yes', '--package=@railway/cli@5.75.0', '--', 'railway', 'up', '.', '--path-as-root', '--detach',
      '--project', scope.projectId, '--environment', scope.environmentId, '--service', serviceId, '--message', message],
      { cwd: source, encoding: 'utf8', timeout: 120_000, env: childEnv });
    if (result.error || result.status !== 0) throw new Error(`Railway source upload failed (${result.error?.name ?? result.status})`);
    const id = /[?&]id=([0-9a-f-]{36})\b/.exec(result.stdout)?.[1];
    if (!id) throw new Error('Railway did not report a deployment ID');
    return id;
  }
  async function wait(serviceId: string, deploymentId?: string, previousId?: string) {
    for (let attempt = 0; attempt < 84; attempt++) {
      const deployment = (await instances()).find((item) => item.serviceId === serviceId)?.latestDeployment;
      if (deployment && deployment.id !== previousId && (!deploymentId || deployment.id === deploymentId)) {
        if (deployment.status === 'SUCCESS') return deployment.id;
        if (['FAILED', 'CRASHED', 'REMOVED'].includes(deployment.status)) throw new Error(`Staging deployment ${deployment.id} is ${deployment.status}`);
      }
      await delay(5000);
    }
    throw new Error('Timed out waiting for the exact staging deployment');
  }
  async function deployImage(serviceId: string) {
    const current = (await instances()).find((item) => item.serviceId === serviceId);
    const { serviceInstanceDeploy } = await call<{ serviceInstanceDeploy: boolean }>('stage image deployment',
      'mutation($serviceId:String!,$environmentId:String!){serviceInstanceDeploy(serviceId:$serviceId,environmentId:$environmentId,latestCommit:true)}',
      { serviceId, environmentId: scope.environmentId });
    if (!serviceInstanceDeploy) throw new Error('Railway did not accept the image deployment');
    return wait(serviceId, undefined, current?.latestDeployment?.id);
  }
  async function publicOrigin(serviceId: string, port: number) {
    const service = (await instances()).find((item) => item.serviceId === serviceId);
    if (!service) throw new Error('Railway service is outside the staging placement');
    const domain = service.domains.serviceDomains[0]?.domain ?? (await call<{ serviceDomainCreate: { domain: string } }>('stage HTTPS ingress',
      'mutation($input:ServiceDomainCreateInput!){serviceDomainCreate(input:$input){domain}}', { input: { environmentId: scope.environmentId, serviceId, targetPort: port } })).serviceDomainCreate.domain;
    if (!/^[a-z0-9-]+\.up\.railway\.app$/.test(domain)) throw new Error('Unexpected Railway ingress hostname');
    return `https://${domain}`;
  }
  async function privatePostgres(name: string) {
    let database = (await instances()).find((item) => item.serviceName === name);
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
    await wait(database.serviceId);
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
  async function deployOpenBao() {
    const serviceId = await ensureService(baoService, baoImage);
    await assertPrivate(serviceId);
    const volumes = await call<{ environment: { volumeInstances: Edges<{ serviceId: string; mountPath: string }> } }>('stage storage placement',
      'query($environmentId:String!){environment(id:$environmentId){volumeInstances(first:100){edges{node{serviceId mountPath}}}}}', { environmentId: scope.environmentId });
    const mounted = volumes.environment.volumeInstances.edges.some(({ node }) => node.serviceId === serviceId && node.mountPath === dataPath);
    if (!mounted) await call('stage volume create', 'mutation($input:VolumeCreateInput!){volumeCreate(input:$input){id}}', { input: { ...scope, serviceId, mountPath: dataPath } });
    const address = `${baoService}.railway.internal`;
    const startCommand = 'docker-entrypoint.sh server';
    const current = (await instances()).find((item) => item.serviceId === serviceId);
    if (!mounted || current?.startCommand !== startCommand || current.latestDeployment?.status !== 'SUCCESS') {
      await setConfig(serviceId, 'RAILWAY_RUN_UID', '0');
      await setConfig(serviceId, 'BAO_LOCAL_CONFIG', JSON.stringify({ disable_mlock: true, api_addr: `http://${address}:8200`,
        cluster_addr: `http://${address}:8201`, storage: { raft: { path: dataPath, node_id: baoService } },
        listener: { tcp: { address: '[::]:8200', tls_disable: true } } }));
      await configure(serviceId, { startCommand, numReplicas: 1 });
      await deployImage(serviceId);
    }
    await assertPrivate(serviceId);
    return `http://${address}:8200`;
  }

  return { project, scope, instances, ensureService, assertPrivate, setConfig, configure, upload, wait, deployImage, privatePostgres, publicOrigin, async launch(workerSource: string) {
    const openbaoUrl = await deployOpenBao();
    const worker = await ensureService(workerService);
    await assertPrivate(worker);
    await setConfig(worker, 'PLATFOLIO_OPENBAO_URL', openbaoUrl);
    if ((await instances()).some(({ serviceName }) => serviceName === 'web-staging')) {
      await setConfig(worker, 'PLATFOLIO_STARTER_HEALTH_URL', 'http://web-staging.railway.internal:8080/healthz');
    }
    const deployment = upload(worker, workerSource, 'Platfolio customer installation worker');
    await wait(worker, deployment);
    await assertPrivate(worker);
    return { worker, deployment, openbao: await verifyWorker(deployment) };
  } };
}
