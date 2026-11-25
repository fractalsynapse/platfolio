import { timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { customerLaunchRun } from './customer-launch-run.ts';
import { customerOpenBao } from './customer-openbao.ts';
import { customerMarketplaceConnection, privateMarketplaceOrigin } from './customer-marketplace-connection.ts';
import { customerRailwayOAuth } from './customer-railway-oauth.ts';
import { customerRailway } from './customer-railway.ts';
import { FREE_STARTER_RELEASE } from '../packages/manifest/src/template-catalog.ts';
import { StarterBrandChangeSchema } from '../packages/contracts/src/starter-brand.ts';
import { readStarterBrand } from './launch-starter-app.ts';

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
const launch = customerLaunchRun(team, join(directory, 'launch.json'), oauth.credential);
const expected = Buffer.from('Bearer ' + workerKey);
const replyError = { error: 'launcher-setup-unavailable', message: 'Check OpenBao and Railway connection, then try again.' };
let changingDomain = false;

const server = createServer({ requestTimeout: 10000 }, (request, response) => {
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  };
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
      if (text.length > 4096) { reply(400, null); return; }
    }
    const command = JSON.parse(text) as { action: string; body?: Record<string, unknown> };
    const body = command.body ?? {};
    switch (command.action) {
      case 'marketplace-status': reply(200, await marketplace.connection()); return;
      case 'marketplace-enroll': reply(200, await marketplace.enroll(String(body.handoff))); return;
      case 'report': reply(200, await launch.read()); return;
      case 'setup': {
        const openBao = await bao.status();
        const railway = openBao === 'ready' && (await bao.readGrant()).grant ? 'connected' : 'connect';
        reply(200, { openBao, railway, workerKey: bao.publicKey, canWipeData: !project });
        return;
      }
      case 'initialize': reply(200, { recovery: await bao.initialize(String(body.publicKey)) }); return;
      case 'unlock': await bao.unlock(String(body.recovery)); reply(200, null); return;
      case 'authorize':
        if (await bao.status() !== 'ready') { reply(503, replyError); return; }
        reply(200, { authorizationUrl: await oauth.begin() }); return;
      case 'callback':
        reply(200, await oauth.complete({ code: String(body.code), state: String(body.state), issuer: String(body.issuer), error: String(body.error) }));
        return;
      case 'brand-read': {
        const current = await launch.read();
        if (current.projectId !== body.projectId || current.deploymentId !== body.deploymentId || !current.origin ||
            !['running', 'ready', 'failed'].includes(current.state)) { reply(200, { outcome: 'conflict' }); return; }
        const value = await readStarterBrand(current.origin);
        const latest = await launch.read();
        if (latest.deploymentId !== body.deploymentId || latest.origin !== current.origin ||
            !['running', 'ready', 'failed'].includes(latest.state)) { reply(200, { outcome: 'conflict' }); return; }
        reply(200, { outcome: 'read', configuration: { value, state: latest.state === 'running' ? 'deploying' : latest.state } });
        return;
      }
      case 'brand-apply': {
        const input = StarterBrandChangeSchema.safeParse({ value: body.value });
        if (!input.success) { reply(400, null); return; }
        if (await bao.status() !== 'ready' || !(await bao.readGrant()).grant) { reply(503, replyError); return; }
        const current = await launch.read();
        if (changingDomain || current.state !== 'ready' || !current.origin || !current.projectId || !current.deploymentId ||
            current.projectId !== body.projectId || current.deploymentId !== body.deploymentId) {
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
        if (current.state !== 'ready' || !current.projectId || !current.deploymentId || current.projectId !== body.projectId ||
            current.deploymentId !== body.deploymentId) { reply(200, { outcome: 'conflict' }); return; }
        const action = command.action === 'domains-list' ? 'list' : command.action === 'domain-attach' ? 'attach' : 'detach';
        if (changingDomain) { reply(200, { outcome: 'conflict' }); return; }
        if (action !== 'list') changingDomain = true;
        try {
          if (await bao.status() !== 'ready') { reply(503, replyError); return; }
          const rail = await customerRailway({ name: FREE_STARTER_RELEASE.template, kind: 'app', id: current.projectId }, undefined, await oauth.credential());
          const result = await rail.starterDomains(current.deploymentId, action, typeof body.hostname === 'string' ? body.hostname : undefined);
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
          if (typeof body.projectId !== 'string' || typeof body.deploymentId !== 'string' ||
              current.projectId !== body.projectId || current.deploymentId !== body.deploymentId ||
              !['ready', 'running'].includes(current.state)) { reply(409, null); return; }
          reply(200, await launch.redeploy());
        } else if (body.data === 'keep' || (body.data === 'wipe' && !project)) reply(200, await launch.remove(body.data));
        else reply(400, null);
        return;
      default: reply(404, null);
    }
  })().catch(() => reply(503, replyError));
});

// Railway private networking can be IPv6-only on existing environments.
server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '::', () => console.log('Customer installation worker ready'));
