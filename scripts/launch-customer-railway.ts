import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { customerRailway } from './customer-railway.ts';
import { customerControlPlanePlan, launchCustomerControlPlane } from './launch-customer-control-plane.ts';

const { values } = parseArgs({ options: { project: { type: 'string' }, candidate: { type: 'string' }, 'identity-bootstrap-file': { type: 'string' }, apply: { type: 'boolean' } } });
const stage = await customerRailway({ name: 'platfolio', kind: 'installation', ...(values.project ? { id: values.project } : {}), create: values.apply === true });
console.log(`Target ${stage.project.name}/staging (${stage.scope.projectId})`);
console.log('Place one OpenBao volume and one installation worker on the project’s private network.');
const plan = values.candidate ? await customerControlPlanePlan(values.candidate) : undefined;
if (plan) console.log(`Place Platfolio API, site, Keycloak, and private Postgres for candidate ${plan.sourceCommit}.`);
if (values.apply) {
  if (plan && !values['identity-bootstrap-file']) throw new Error('Pass --identity-bootstrap-file for the customer Keycloak bootstrap credential');
  if (plan && values['identity-bootstrap-file']) console.log(JSON.stringify(await launchCustomerControlPlane(stage, plan, values['identity-bootstrap-file'])));
  const workerSource = resolve(import.meta.dirname, '../apps/installation-worker');
  console.log(JSON.stringify(await stage.launch(workerSource)));
}
