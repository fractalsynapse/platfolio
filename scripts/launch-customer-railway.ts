import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { customerRailway } from './customer-railway.ts';
import { privateMarketplaceOrigin } from './customer-marketplace-connection.ts';
import { customerControlPlanePlan, launchCustomerControlPlane } from './launch-customer-control-plane.ts';
import { resolveCheckoutCandidate } from './platform-candidate.ts';

const { values } = parseArgs({ options: {
  project: { type: 'string' }, candidate: { type: 'string' }, 'identity-bootstrap-file': { type: 'string' },
  'owner-bootstrap-file': { type: 'string' },
  'launch-config-file': { type: 'string' }, apply: { type: 'boolean' }, 'update-images': { type: 'boolean' },
  'registry-origin': { type: 'string' },
} });
const registryOrigin = privateMarketplaceOrigin(values['registry-origin']);
if (registryOrigin && !values['launch-config-file']) throw new Error('A registry origin requires the customer launch configuration');
if (values['update-images'] || values['launch-config-file']) {
  if (!values.apply || !values.candidate || !values.project) throw new Error('Updating a hosted installation requires --apply, --candidate, and the exact --project ID');
  resolveCheckoutCandidate(values.candidate, resolve(import.meta.dirname, '..'));
}
async function privateConfig(file: string, description: string): Promise<Record<string, unknown>> {
  const mode = await stat(file);
  if (!mode.isFile() || mode.mode & 0o077) throw new Error(`Use a private file for ${description}`);
  const saved = await readFile(file, 'utf8');
  try {
    const config = JSON.parse(saved) as Record<string, unknown> | null;
    if (config && typeof config === 'object' && !Array.isArray(config)) return config;
  } catch { /* Do not surface a JSON parse error that might quote the credential file. */ }
  throw new Error(`Use a valid JSON object for ${description}`);
}

async function ownerLaunchConfig(file: string) {
  const config = await privateConfig(file, 'the customer launch configuration');
  const { team, client, workerKey, openBaoSecret, appProject } = config;
  if (typeof team !== 'string' || !team || (client !== undefined && (typeof client !== 'string' || !client)) ||
      typeof workerKey !== 'string' || !/^[a-zA-Z0-9_-]{43,128}$/.test(workerKey) ||
      typeof openBaoSecret !== 'string' || !/^[a-zA-Z0-9_-]{43,128}$/.test(openBaoSecret) || openBaoSecret === workerKey) throw new Error('Provide the team ID and two distinct installation credentials. A Railway OAuth client ID is optional.');
  if (appProject !== undefined && (typeof appProject !== 'string' || !/^[a-f0-9-]{36}$/.test(appProject))) throw new Error('Use a valid app project ID');
  return { team, workerKey, openBaoSecret, ...(client ? { client } : {}), ...(appProject ? { appProject } : {}) };
}
const launchConfig = values['launch-config-file'] ? await ownerLaunchConfig(values['launch-config-file']) : undefined;
const ownerFile = values['owner-bootstrap-file'];
function ownerMail(smtp: unknown) {
  if (smtp === undefined) return;
  const message = 'Supply the host, port, sender address, username and password for the private STARTTLS mail relay';
  if (!smtp || typeof smtp !== 'object' || Array.isArray(smtp)) throw new Error(message);
  const { host, port, from, user, password } = smtp as Record<string, unknown>;
  if (typeof host !== 'string' || host.length > 253 || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host) ||
      typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535 ||
      typeof from !== 'string' || from.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ||
      typeof user !== 'string' || !user || user.length > 512 ||
      typeof password !== 'string' || !password || password.length > 1024) throw new Error(message);
  return { host, port, from, user, password };
}
async function privateOwner(file: string) {
  const { email, password, smtp } = await privateConfig(file, 'the initial owner credentials');
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(password)) throw new Error('Supply the first owner email and a generated URL-safe password');
  const mail = ownerMail(smtp);
  return { email, password, ...(mail ? { smtp: mail } : {}) };
}
if (ownerFile && (!values.apply || !values.candidate)) throw new Error('Private owner bootstrap requires --apply and --candidate');
if (ownerFile && values.candidate) resolveCheckoutCandidate(values.candidate, resolve(import.meta.dirname, '..'));
const owner = ownerFile ? await privateOwner(ownerFile) : undefined;
const adminFile = values['identity-bootstrap-file'];
if (values.apply && values.candidate && !adminFile && !owner) throw new Error('Pass --owner-bootstrap-file or --identity-bootstrap-file');
const stage = await customerRailway({ name: 'platfolio', kind: 'installation', ...(values.project ? { id: values.project } : {}), create: values.apply === true && !values['update-images'] });
console.log(`Target ${stage.project.name}/staging (${stage.scope.projectId})`);
console.log('Place one OpenBao volume and one installation worker on the project’s private network.');
const plan = values.candidate ? await customerControlPlanePlan(values.candidate) : undefined;
if (plan) console.log(`Place Platfolio API, site, Keycloak, and private Postgres for candidate ${plan.sourceCommit}.`);
if (values.apply) {
  if (plan) {
    const origins = await launchCustomerControlPlane(stage, plan, { ...(adminFile ? { adminFile } : {}), ...(owner ? { owner } : {}),
      updateImages: values['update-images'] === true, ...(launchConfig ? { launchConfig } : {}) });
    console.log(JSON.stringify(origins));
    if (launchConfig) {
      console.log(JSON.stringify(await stage.installLaunchWorker(plan.api.image + '@' + plan.api.digest, {
        ...launchConfig, callback: origins.api + '/api/v1/railway/callback', ...(registryOrigin ? { registryOrigin } : {}),
      })));
    }
  }
  if (!launchConfig) {
    const workerSource = resolve(import.meta.dirname, '../apps/installation-worker');
    console.log(JSON.stringify(await stage.launch(workerSource)));
  }
}
