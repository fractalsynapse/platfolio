import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { customerRailway } from './customer-railway.ts';
import { privateMarketplaceOrigin } from './customer-marketplace-connection.ts';
import { customerControlPlanePlan, launchCustomerControlPlane } from './launch-customer-control-plane.ts';
import { resolveCheckoutCandidate } from './platform-candidate.ts';

const { values } = parseArgs({ options: {
  project: { type: 'string' }, candidate: { type: 'string' }, 'identity-bootstrap-file': { type: 'string' },
  'launch-config-file': { type: 'string' }, apply: { type: 'boolean' }, 'update-images': { type: 'boolean' },
  'registry-origin': { type: 'string' },
} });
const registryOrigin = privateMarketplaceOrigin(values['registry-origin']);
if (registryOrigin && !values['launch-config-file']) throw new Error('A registry origin requires the customer launch configuration');
if (values['update-images'] || values['launch-config-file']) {
  if (!values.apply || !values.candidate || !values.project) throw new Error('Updating a hosted installation requires --apply, --candidate, and the exact --project ID');
  resolveCheckoutCandidate(values.candidate, resolve(import.meta.dirname, '..'));
}
async function ownerLaunchConfig(file: string) {
  const mode = await stat(file);
  if (!mode.isFile() || mode.mode & 0o077) throw new Error('Use a private file for the customer launch configuration');
  const config = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  const { team, client, workerKey, openBaoSecret, appProject } = config;
  if (typeof team !== 'string' || !team || (client !== undefined && (typeof client !== 'string' || !client)) ||
      typeof workerKey !== 'string' || !/^[a-zA-Z0-9_-]{43,128}$/.test(workerKey) ||
      typeof openBaoSecret !== 'string' || !/^[a-zA-Z0-9_-]{43,128}$/.test(openBaoSecret) || openBaoSecret === workerKey) throw new Error('Provide the team ID and two distinct installation credentials. A Railway OAuth client ID is optional.');
  if (appProject !== undefined && (typeof appProject !== 'string' || !/^[a-f0-9-]{36}$/.test(appProject))) throw new Error('Use a valid app project ID');
  return { team, workerKey, openBaoSecret, ...(client ? { client } : {}), ...(appProject ? { appProject } : {}) };
}
const launchConfig = values['launch-config-file'] ? await ownerLaunchConfig(values['launch-config-file']) : undefined;
const stage = await customerRailway({ name: 'platfolio', kind: 'installation', ...(values.project ? { id: values.project } : {}), create: values.apply === true && !values['update-images'] });
console.log(`Target ${stage.project.name}/staging (${stage.scope.projectId})`);
console.log('Place one OpenBao volume and one installation worker on the project’s private network.');
const plan = values.candidate ? await customerControlPlanePlan(values.candidate) : undefined;
if (plan) console.log(`Place Platfolio API, site, Keycloak, and private Postgres for candidate ${plan.sourceCommit}.`);
if (values.apply) {
  if (plan && !values['identity-bootstrap-file']) throw new Error('Pass --identity-bootstrap-file for the customer Keycloak bootstrap credential');
  if (plan && values['identity-bootstrap-file']) {
    const origins = await launchCustomerControlPlane(stage, plan, values['identity-bootstrap-file'], values['update-images'], launchConfig);
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
