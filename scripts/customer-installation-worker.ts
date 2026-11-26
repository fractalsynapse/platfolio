import { installationWorkerReadiness } from '../packages/contracts/src/customer-installation-services.ts';
import { timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { customerLaunchRun } from './customer-launch-run.ts';
import { customerOpenBao } from './customer-openbao.ts';
import { customerMarketplaceConnection, privateMarketplaceOrigin } from './customer-marketplace-connection.ts';
import { customerRailwayOAuth } from './customer-railway-oauth.ts';
import { StarterBrandChangeSchema } from '../packages/contracts/src/starter-brand.ts';
import { railwayStarterWorkerHosting } from './launch-starter-worker.ts';
import { railwaySharedIdentityHosting } from './launch-shared-identity.ts';
import { railwayStarterHosting } from './launch-starter-app.ts';
import { CustomerHostingCommandSchema, type PrivateLaunchTemplate } from '../packages/contracts/src/customer-hosting-commands.ts';
import { privateRailwayExecution } from '../apps/control-plane/src/private-railway-execution.ts';
import { createKernel } from '../packages/kernel/src/index.ts';

const directory = process.env.PLATFOLIO_LAUNCH_STATE_DIR;
const workerKey = process.env.PLATFOLIO_LAUNCH_WORKER_KEY;
const team = process.env.PLATFOLIO_LAUNCH_TEAM;
const client = process.env.PLATFOLIO_RAILWAY_OAUTH_CLIENT;
const callback = process.env.PLATFOLIO_RAILWAY_OAUTH_CALLBACK;
const project = process.env.PLATFOLIO_LAUNCH_APP_PROJECT || undefined;
const workspace = process.env.RAILWAY_WORKSPACE_ID;
const baoSecret = process.env.PLATFOLIO_OPENBAO_WORKER_SECRET;
const baoOrigin = process.env.PLATFOLIO_OPENBAO_URL;
if (!directory || !workerKey || workerKey.length < 32 || !team || !callback || !workspace || !baoSecret || baoSecret.length < 32 || !baoOrigin) {
  throw new Error('Complete customer installation worker configuration before starting');
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
const bao = customerOpenBao(baoOrigin, baoSecret, directory);
const marketplace = customerMarketplaceConnection(privateMarketplaceOrigin(process.env.PLATFOLIO_REGISTRY_ORIGIN), bao);
const oauth = customerRailwayOAuth({ callback, workspaceId: workspace, ...(client ? { clientId: client } : {}), ...(project ? { projectId: project } : {}) }, bao);
const sourceHosting = railwayStarterHosting(oauth.credential);
const launch = customerLaunchRun(team, join(directory, 'launch.json'), sourceHosting);
const privateProviders = {
  'shared-identity': railwaySharedIdentityHosting(oauth.credential),
  'starter-worker': railwayStarterWorkerHosting(oauth.credential),
} satisfies Record<PrivateLaunchTemplate, ReturnType<typeof railwayStarterWorkerHosting>>;
const privateRuns = new Map<PrivateLaunchTemplate, ReturnType<typeof customerLaunchRun>>();
function privateRun(template: PrivateLaunchTemplate) {
  const existing = privateRuns.get(template);
  if (existing) return existing;
  const initialized = customerLaunchRun(team!, join(directory!, template + '.json'), privateProviders[template]);
  privateRuns.set(template, initialized);
  return initialized;
}
const execution = await createKernel({ provider: 'railway', infrastructure: [privateRailwayExecution(team, async () => {
  if (await bao.status() !== 'ready') throw new Error('Unlock OpenBao before managing a project');
  return oauth.credential();
})], requiredServices: ['infra'] });
const expected = Buffer.from('Bearer ' + workerKey);
const replyError = { error: 'launcher-setup-unavailable', message: 'Check OpenBao and Railway connection, then try again.' };
let changingDomain = false;

const server = createServer({ requestTimeout: 10000 }, (request, response) => {
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (request.method === 'GET' && request.url === installationWorkerReadiness) {
    void bao.status().then((state) => reply(state === 'unreachable' ? 503 : 200, { status: state }));
    return;
  }
  if (request.method === 'GET' && request.url === '/status') { reply(200, { status: 'ok' }); return; }
  const auth = Buffer.from(request.headers.authorization ?? '');
  if (request.method !== 'POST' || request.url !== '/launch' || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
    reply(404, null);
    return;
  }
  void (async () => {
    let text = '';
    for await (const chunk of request) {
      text += String(chunk);
      if (text.length > 512 * 1024) { reply(400, null); return; }
    }
    const parsed = CustomerHostingCommandSchema.safeParse(JSON.parse(text));
    if (!parsed.success) { reply(400, null); return; }
    const command = parsed.data;
    switch (command.action) {
      case 'marketplace-status': reply(200, await marketplace.connection()); return;
      case 'marketplace-enroll': reply(200, await marketplace.enroll(command.body.handoff)); return;
      case 'marketplace-catalog': reply(200, await marketplace.catalog()); return;
      case 'template-report': reply(200, privateRun(command.body.template).read()); return;
      case 'template-start':
      case 'template-remove':
      case 'template-redeploy': {
        if (project || await bao.status() !== 'ready' || !(await bao.readGrant()).grant) { reply(503, replyError); return; }
        const runner = privateRun(command.body.template);
        if (command.action === 'template-remove') { reply(200, runner.remove(command.body.data)); return; }
        const current = runner.read();
        if (command.action === 'template-redeploy') {
          if (current.projectId !== command.body.projectId || current.deploymentId !== command.body.deploymentId ||
              !['ready', 'running'].includes(current.state)) { reply(409, null); return; }
          reply(200, runner.redeploy());
          return;
        }
        // An existing install can be recovered even if its marketplace connection changes.
        if (!current.projectId && !(await marketplace.catalog()).some(({ template, installable }) => template === command.body.template && installable)) {
          reply(409, { error: 'marketplace-connection-required' });
          return;
        }
        if (command.body.template === 'starter-worker') { reply(200, runner.start()); return; }
        const bootstrap = bao.openEnvelope(command.body.bootstrap);
        if (!/^[A-Za-z0-9_-]{32,64}$/.test(bootstrap)) { reply(400, null); return; }
        reply(200, runner.startWithBootstrap(bootstrap));
        return;
      }
      case 'report': reply(200, await launch.read()); return;
      case 'setup': {
        const openBao = await bao.status();
        const railway = openBao === 'ready' && (await bao.readGrant()).grant ? 'connected' : 'connect';
        reply(200, { openBao, railway, workerKey: bao.publicKey, canWipeData: !project });
        return;
      }
      case 'initialize': reply(200, { recovery: await bao.initialize(command.body.publicKey) }); return;
      case 'unlock': await bao.unlock(command.body.recovery); reply(200, null); return;
      case 'authorize':
        if (await bao.status() !== 'ready') { reply(503, replyError); return; }
        reply(200, { authorizationUrl: await oauth.begin() }); return;
      case 'callback':
        reply(200, await oauth.complete(command.body));
        return;
      case 'brand-read': {
        const current = await launch.read();
        if (current.projectId !== command.body.projectId || current.deploymentId !== command.body.deploymentId || !current.origin ||
            !['running', 'ready', 'failed'].includes(current.state)) { reply(200, { outcome: 'conflict' }); return; }
        const value = await sourceHosting.publicLabel(current.origin);
        const latest = await launch.read();
        if (latest.deploymentId !== command.body.deploymentId || latest.origin !== current.origin ||
            !['running', 'ready', 'failed'].includes(latest.state)) { reply(200, { outcome: 'conflict' }); return; }
        reply(200, { outcome: 'read', configuration: { value, state: latest.state === 'running' ? 'deploying' : latest.state } });
        return;
      }
      case 'brand-apply': {
        const input = StarterBrandChangeSchema.safeParse({ value: command.body.value });
        if (!input.success) { reply(400, null); return; }
        if (await bao.status() !== 'ready' || !(await bao.readGrant()).grant) { reply(503, replyError); return; }
        const current = await launch.read();
        if (changingDomain || current.state !== 'ready' || !current.origin || !current.projectId || !current.deploymentId ||
            current.projectId !== command.body.projectId || current.deploymentId !== command.body.deploymentId) {
          reply(200, { outcome: 'conflict' });
          return;
        }
        launch.changeBrand(input.data.value);
        reply(200, { outcome: 'requested' });
        return;
      }
      case 'domains-list':
      case 'domain-attach':
      case 'domain-detach': {
        const current = await launch.read();
        if (current.state !== 'ready' || !current.projectId || !current.deploymentId || current.projectId !== command.body.projectId ||
            current.deploymentId !== command.body.deploymentId) { reply(200, { outcome: 'conflict' }); return; }
        const action = command.action === 'domains-list' ? 'list' : command.action === 'domain-attach' ? 'attach' : 'detach';
        if (changingDomain) { reply(200, { outcome: 'conflict' }); return; }
        if (action !== 'list') changingDomain = true;
        try {
          if (await bao.status() !== 'ready') { reply(503, replyError); return; }
          const result = await sourceHosting.domains(current.projectId, current.deploymentId, action, command.action === 'domains-list' ? undefined : command.body.hostname);
          reply(200, result);
        } finally { if (action !== 'list') changingDomain = false; }
        return;
      }
      case 'start':
      case 'redeploy':
      case 'remove':
        if (await bao.status() !== 'ready' || !(await bao.readGrant()).grant) { reply(503, replyError); return; }
        if (changingDomain) { reply(409, null); return; }
        if (command.action === 'start') {
          const current = await launch.read();
          if (!current.deploymentId && !await marketplace.canLaunchStarter()) {
            reply(409, { error: 'marketplace-claim-required' });
            return;
          }
          reply(200, await launch.start());
        }
        else if (command.action === 'redeploy') {
          const current = await launch.read();
          if (typeof command.body.projectId !== 'string' || typeof command.body.deploymentId !== 'string' ||
              current.projectId !== command.body.projectId || current.deploymentId !== command.body.deploymentId ||
              !['ready', 'running'].includes(current.state)) { reply(409, null); return; }
          reply(200, await launch.redeploy());
        } else if (command.body.data === 'keep' || !project) reply(200, await launch.remove(command.body.data));
        else reply(400, null);
        return;
      case 'hosting-apply':
      case 'hosting-observe':
      case 'hosting-remove':
      case 'hosting-redeploy': {
        const target = command.action === 'hosting-observe' ? command.body : command.body.target;
        const plugin = execution.infra.forInstance(target);
        if (!plugin) { reply(404, null); return; }
        if (command.action === 'hosting-apply') reply(200, await plugin.applyPlan(command.body.plan));
        else if (command.action === 'hosting-observe') reply(200, await plugin.readState(target.id));
        else if (command.action === 'hosting-remove') reply(200, await plugin.deleteInstance(target.id, command.body.options));
        else {
          const { environment, service } = command.body;
          reply(200, await plugin.redeploy?.({ instanceId: target.id, environment, ...(service === undefined ? {} : { service }) }));
        }
        return;
      }
      default: reply(404, null);
    }
  })().catch(() => reply(503, replyError));
});

// Railway private networking can be IPv6-only on existing environments.
server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '::', () => console.log('Customer installation worker ready'));
