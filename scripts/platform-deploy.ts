/**
 * Host platfolio with platfolio's own machinery (#172, D29/D33).
 *
 * This is the same path a tenant's platform takes -- compose + prod overlay -> manifest -> validation -> plan
 * -> provider -- with no Railway dashboard clicks and no hand-written GraphQL. If the format cannot describe
 * this deployment, that is a product defect, and finding it here is cheaper than a tenant finding it. That is
 * not a figure of speech: this script is how we learned the renderer turns `environment:` entries into plan
 * literals, so Compose-style `${VAR}` placeholders would have been shipped to the provider verbatim.
 *
 * Phases, because identity creates a chicken and an egg:
 *   1. `--apply --strip-domains`  deploy with Railway's generated hosts, so something is reachable.
 *   2. `--apply --from-state`     set the issuer/JWKS/hostname literals from the hosts the provider actually
 *                                 granted and re-apply. Asserting a URL before it exists bakes in a host that
 *                                 serves nothing (E27).
 *   3. `--apply`                  attach `api.platfolio.dev` / `auth.platfolio.dev` and report the DNS records
 *                                 the provider asks for. Railway reports pending forever for a zone we cannot
 *                                 edit, and this prints the exact record a human has to add.
 *
 * `--dry-run` (default) renders and validates the plan and touches nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCompose } from '../packages/manifest/src/compose.ts';
import { validateManifest } from '../packages/manifest/src/validate.ts';
import { buildPlan } from '../packages/manifest/src/build-plan.ts';
import type { InfraPlan } from '../packages/contracts/src/infra.ts';
import { secretWriteScope } from '../packages/contracts/src/infra.ts';
import { physicalServiceName, RailwayInfraProvider } from '../packages/contracts/src/railway-provider.ts';
import type { RailwayCredential, RailwayCredentialSource } from '../packages/contracts/src/railway-transport.ts';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name: string) => process.argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const token = process.env.RAILWAY_TOKEN ?? '';
const workspaceId = process.env.RAILWAY_WORKSPACE_ID ?? '';

/**
 * The managed tier's single grant (D24): one least-privilege workspace token. Minting per-environment project
 * tokens instead is #135's open question, not a choice this script gets to make silently.
 */
const credentials: RailwayCredentialSource = {
  async workspace(): Promise<RailwayCredential> { return { kind: 'workspace', token }; },
  async forEnvironment(): Promise<RailwayCredential> { return { kind: 'workspace', token }; },
};

function loadManifest(): NonNullable<ReturnType<typeof parseCompose>['manifest']> {
  const base = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
  const overlay = fs.readFileSync(path.join(root, 'compose.prod.yaml'), 'utf8');
  const parsed = parseCompose([base, overlay]);
  if (parsed.issues.length > 0) {
    console.error('  the renderer refused our own composition:');
    for (const i of parsed.issues) console.error(`    - ${i.path}: ${i.code} -- ${i.message}`);
    process.exit(1);
  }
  if (!parsed.manifest) { console.error('  no manifest produced'); process.exit(1); }
  const issues = validateManifest(parsed.manifest);
  if (issues.length > 0) {
    console.error('  manifest validation refused:');
    for (const i of issues) console.error(`    - ${i.path}: ${i.code} -- ${i.message}`);
    process.exit(1);
  }
  return parsed.manifest;
}

function describePlan(plan: InfraPlan): void {
  console.log(`  plan: ${String(plan.environments.length)} environment(s), contract ${plan.contract}, provider ${plan.provider}`);
  // The PHYSICAL names the provider will create (D57), from the same rule the provider applies. The rule is
  // deterministic now, so this needs no preview helper and no provider read at all: the script and the provider
  // compute the same string from the same two inputs, which is what makes "which service will staging actually
  // get" answerable -- and answerable identically -- before anything is sent.
  for (const e of plan.environments) {
    const name = (logical: string): string => physicalServiceName(logical, e.name);
    console.log(`    env ${e.name}: databases=[${e.databases.map((d) => `${name(d.name)}:${d.kind}`).join(', ') || 'none'}]`);
    for (const s of e.services) {
      const env = s.env.map((x) => (x.literal === undefined ? `${x.name}=*declared-name*` : `${x.name}=${x.literal}`)).join(' ');
      console.log(`      ${name(s.name)}: ${s.image}@${s.digest.slice(7, 19)}… port ${String(s.port)} replicas ${String(s.replicas)}`);
      console.log(`        refs=[${(s.references ?? []).map((r) => `${r.variable}<-${name(r.database)}`).join(', ') || 'none'}]`);
      console.log(`        env: ${env}`);
    }
    // The domain target is spelled the same way the service above it is: one render, one vocabulary, and
    // `applyPlan` reports `targetService` as the physical name too. Printing `api` here next to
    // `api-production` above would be two answers to the same question on one screen.
    console.log(`      domains: ${e.domains.length > 0 ? e.domains.map((d) => `${d.host}->${name(d.service)}:${String(d.port)}`).join(', ') : '(generated hosts only)'}`);
  }
}

if (arg('bootstrap-vars')) {
  // An operator step, not a platform capability: platfolio must never hold a TENANT's secret values (D4), and
  // the provider deliberately refuses to create a declared secret it cannot find. This first-party deployment
  // is the other side of that rule -- platfolio's own credentials, supplied by whoever runs the deploy, read
  // from the local environment and written to Railway. Names go in logs; values never do.
  const supplied: Record<string, string | undefined> = {
    KEYCLOAK_ADMIN: process.env.KEYCLOAK_ADMIN,
    KEYCLOAK_ADMIN_PASSWORD: process.env.KEYCLOAK_ADMIN_PASSWORD,
  };
  const project = await (await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ query: 'query($w:String!){ projects(workspaceId:$w, first:50){ edges{ node{ id name } } } }', variables: { w: workspaceId } }),
  })).json() as { data?: { projects?: { edges?: Array<{ node: { id: string; name: string } }> } } };
  // Resolved by what is IN the project, not by its name: the provider names projects after the *instance*
  // (`platfolio-selfhost`, by design -- railway-provider's own comment records that keying the name to the
  // manifest identity was caught by the conformance suite), so matching a hardcoded string would break the
  // first time an instance id differs from a template id.
  const withServices = async (id: string) => {
    const r = await (await fetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({ query: 'query($id:String!){ project(id:$id){ services(first:20){ edges{ node{ id name } } } } }', variables: { id } }),
    })).json() as { data?: { project?: { services?: { edges?: Array<{ node: { id: string; name: string } }> } } } };
    return r.data?.project?.services?.edges ?? [];
  };
  let target: { node: { id: string; name: string } } | undefined;
  let foundServices: Array<{ node: { id: string; name: string } }> = [];
  for (const candidate of project.data?.projects?.edges ?? []) {
    const list = await withServices(candidate.node.id);
    const names = new Set(list.map((x) => x.node.name));
    // The names this looks for are PHYSICAL, and they come from the same rule the provider applies: a project
    // whose services are `api-production` and `identity-production` is a platfolio-managed one, and after the
    // D57 amendment that is the shape every managed project has. The bare names are what a NOT-YET-MIGRATED
    // project still holds, so they are recognized as that case rather than silently matching a hand-made project.
    const managed = names.has(physicalServiceName('api', 'production')) && names.has(physicalServiceName('identity', 'production'));
    const preMigration = names.has('api') && names.has('identity');
    if (managed || preMigration) { target = candidate; foundServices = list; break; }
  }
  if (!target) { console.error(`  no project in this workspace has both \`${physicalServiceName('api', 'production')}\` and \`${physicalServiceName('identity', 'production')}\` services; run the apply first`); process.exit(1); }
  const envs = await (await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: token },
    body: JSON.stringify({ query: 'query($id:String!){ project(id:$id){ environments(first:10){ edges{ node{ id name } } } } }', variables: { id: target.node.id } }),
  })).json() as { data?: { project?: { environments?: { edges?: Array<{ node: { id: string; name: string } }> } } } };
  const production = (envs.data?.project?.environments?.edges ?? []).find((e) => e.node.name === 'production');
  if (!production) { console.error('  no production environment found'); process.exit(1); }
  // Railway variables are per SERVICE, not per environment, and the field is `name` -- both read off the
  // provider's own working call rather than guessed, because guessing produced a validation error naming a
  // field that does not exist.
  const services = foundServices;
  const owner = (needle: string) => services.find((x) => x.node.name === needle)?.node.id;
  const plan2: Array<{ service: string; variable: string }> = [
    { service: 'identity', variable: 'KEYCLOAK_ADMIN' },
    { service: 'identity', variable: 'KEYCLOAK_ADMIN_PASSWORD' },
  ];
  for (const entry of plan2) {
    const value = supplied[entry.variable];
    if (value === undefined || value.length === 0) { console.error(`  ${entry.variable} is not set in the local environment`); process.exit(1); }
    // Suffix first, bare second: this operator step has to work on a project that has not been migrated yet, and
    // writing onto the bare row is correct HERE because the row is the same service the apply is about to rename.
    const serviceId = owner(physicalServiceName(entry.service, 'production')) ?? owner(entry.service);
    if (!serviceId) { console.error(`  no "${physicalServiceName(entry.service, 'production')}" service in this project yet -- run the apply first`); process.exit(1); }
    const r = await (await fetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({ query: 'mutation($input:VariableUpsertInput!){ variableUpsert(input:$input) }', variables: { input: { projectId: target.node.id, environmentId: production.node.id, serviceId, name: entry.variable, value, skipDeploys: true } } }),
    })).json() as { errors?: Array<{ message: string }> };
    if (r.errors) { console.error(`  ${entry.variable}: ${JSON.stringify(r.errors).slice(0, 140)}`); process.exit(1); }
    console.log(`  set ${entry.service}.${entry.variable} (value withheld${entry.variable.includes('PASSWORD') ? ', marked secret' : ''})`);
  }
  console.log(`  project ${target.node.id}, environment ${production.node.id} -- re-run the apply to let the plan find them`);
  process.exit(0);
}

/**
 * The lookup the maintenance paths share: a provider call bound to the workspace token, the self-host project,
 * one environment, and the project's service names.
 *
 * Hoisted out of the `--prune-vars` branch because both maintenance actions need it, and because leaving it
 * inline produced two defects at once in `--redeploy`: it only ran as a side effect of pruning (so
 * `--redeploy=api-staging --apply` printed a plan and did nothing), and the environment was hard-wired to
 * `production` -- which for a staging service means "silently cannot find the instance", and for a production
 * service means a maintenance flag that can only ever touch the live environment. A flag that appears to work is
 * worse than a missing one, so the environment is now explicit and defaulted only where it always was.
 */
async function maintenanceTarget(token: string, workspaceId: string, environmentName: string) {
  const auth = { 'content-type': 'application/json', authorization: token };
  const call = async (query: string, variables?: Record<string, unknown>) =>
    (await (await fetch('https://backboard.railway.com/graphql/v2', { method: 'POST', headers: auth, body: JSON.stringify({ query, variables }) })).json() as any);
  const projects = await call('query($w:String!){ projects(workspaceId:$w, first:50){ edges{ node{ id name } } } }', { w: workspaceId });
  const project = (projects.data?.projects?.edges ?? []).find((x: any) => x.node.name === 'platfolio-selfhost');
  if (!project) { console.error('  no platfolio-selfhost project -- run the apply first'); process.exit(1); }
  const projectId: string = project.node.id;
  const detail = await call('query($p:String!){ project(id:$p){ environments(first:10){ edges{ node{ id name } } } services(first:30){ edges{ node{ id name } } } } }', { p: projectId });
  const environments = (detail.data?.project?.environments?.edges ?? []).map((x: any) => x.node) as Array<{ id: string; name: string }>;
  const environmentId = environments.find((e) => e.name === environmentName)?.id;
  if (!environmentId) {
    console.error(`  no environment "${environmentName}" in this project (have: ${environments.map((e) => e.name).join(', ') || 'none'})`);
    process.exit(1);
  }
  const nameToId = new Map<string, string>(((detail.data?.project?.services?.edges ?? []) as any[]).map((x) => [x.node.name, x.node.id]));
  return { call, projectId, environmentId: environmentId as string, nameToId };
}

if (arg('redeploy') && !arg('prune-vars')) {
  // Standalone: restarting one service in one environment, which is what an operator reaches for when a
  // reference resolves only after the service first booted -- exactly today's staging case, where `api-staging`
  // started before its `main-staging` database finished provisioning (provider references are asynchronous),
  // read an empty `PLATFOLIO_DB_URL`, and fell back to the in-memory store while still answering `ready`.
  const service = value('redeploy');
  const environmentName = value('environment') ?? 'production';
  if (!service) { console.error('  usage: --redeploy=<service> --environment=<name> --apply'); process.exit(1); }
  if (!arg('apply')) {
    console.error(`  --redeploy=${service} --environment=${environmentName} mutates a running service; add --apply`);
    process.exit(1);
  }
  const token = process.env.RAILWAY_TOKEN;
  const workspaceId = process.env.RAILWAY_WORKSPACE_ID;
  if (!token || !workspaceId) { console.error('  --redeploy needs RAILWAY_TOKEN and RAILWAY_WORKSPACE_ID'); process.exit(1); }
  const { call, projectId, environmentId, nameToId } = await maintenanceTarget(token, workspaceId, environmentName);
  const serviceId = nameToId.get(service);
  if (!serviceId) {
    console.error(`  --redeploy: no service named "${service}" in this project (have: ${[...nameToId.keys()].join(', ')})`);
    console.error('  note that names are physical after D57, for EVERY environment: production runs api-production and main-production, staging runs api-staging and main-staging.');
    process.exit(1);
  }
  const inst = await call('query($p:String!,$e:String!){ environment(projectId:$p, id:$e){ serviceInstances{ edges{ node{ serviceId id } } } } }', { p: projectId, e: environmentId });
  const instance = (inst.data?.environment?.serviceInstances?.edges ?? []).find((x: any) => x.node.serviceId === serviceId);
  if (!instance) { console.error(`  --redeploy: ${service} has no instance in "${environmentName}"`); process.exit(1); }
  const dep = await call('mutation($e:String!,$s:String!){ serviceInstanceDeploy(environmentId:$e, serviceId:$s, latestCommit:true) }', { e: environmentId, s: serviceId });
  if (dep.errors) { console.error(`  --redeploy failed: ${JSON.stringify(dep.errors).slice(0, 160)}`); process.exit(1); }
  console.log(`  redeploy requested for ${service} in ${environmentName} (instance ${String(instance.node.id).slice(0, 8)})`);
  process.exit(0);
}

if (arg('prune-vars')) {

  // An operator action, spelled out rather than hidden in the provider: the provider writes the plan's
  // references and never deletes variables a later plan dropped, because silently removing configuration a
  // tenant may have set by hand is a worse surprise than a stale variable. Pruning is therefore ours to do
  // deliberately when we change our own composition -- here `KC_DB_URL`, which Keycloak would otherwise prefer
  // over the component references #198 introduced, and keep failing to parse.
  const entries = (value('prune-vars') ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const [serviceName, variable] = x.split('.');
    if (!serviceName || !variable) { console.error(`  --prune-vars expects service.VARIABLE, got "${x}"`); process.exit(1); }
    return { serviceName, variable };
  });
  if (entries.length === 0) { console.error('  usage: --prune-vars=identity.KC_DB_URL[,service.VAR...]'); process.exit(1); }
  const auth = { 'content-type': 'application/json', authorization: token };
  const call = async (query: string, variables?: Record<string, unknown>) => (await (await fetch('https://backboard.railway.com/graphql/v2', { method: 'POST', headers: auth, body: JSON.stringify({ query, variables }) })).json() as any);

  const projects = await call('query($w:String!){ projects(workspaceId:$w, first:50){ edges{ node{ id name } } } }', { w: workspaceId });
  const project = (projects.data?.projects?.edges ?? []).find((x: any) => x.node.name === 'platfolio-selfhost');
  if (!project) { console.error('  no platfolio-selfhost project -- run the apply first'); process.exit(1); }
  const projectId: string = project.node.id;
  const detail = await call('query($p:String!){ project(id:$p){ environments(first:10){ edges{ node{ id name } } } services(first:30){ edges{ node{ id name } } } } }', { p: projectId });
  const environmentId: string | undefined = (detail.data?.project?.environments?.edges ?? []).find((x: any) => x.node.name === 'production')?.node.id;
  const nameToId = new Map<string, string>(((detail.data?.project?.services?.edges ?? []) as any[]).map((x) => [x.node.name, x.node.id]));
  if (!environmentId) { console.error('  no production environment'); process.exit(1); }

  const cfg = await call('query($p:String!,$e:String!){ environment(projectId:$p, id:$e){ config } }', { p: projectId, e: environmentId });
  const raw = cfg.data?.environment?.config;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  for (const entry of entries) {
    const serviceId = nameToId.get(entry.serviceName);
    if (!serviceId) { console.error(`  no service named "${entry.serviceName}" in this project`); process.exit(1); }
    const present = Object.keys(parsed?.services?.[serviceId]?.variables ?? {});
    if (!present.includes(entry.variable)) { console.log(`  ${entry.serviceName}.${entry.variable} already absent (of ${String(present.length)} variables)`); continue; }
    const del = await call('mutation($input:VariableDeleteInput!){ variableDelete(input:$input) }', { input: { projectId, environmentId, serviceId, name: entry.variable } });
    if (del.errors) { console.error(`  ${entry.serviceName}.${entry.variable}: ${JSON.stringify(del.errors).slice(0, 160)}`); process.exit(1); }
    console.log(`  deleted ${entry.serviceName}.${entry.variable} -- re-apply to redeploy with the surviving references`);
  }
  // Pruning changes nothing the plan can see, and `applyPlan` is idempotent by planHash -- so without an
  // explicit deploy the service would keep running with the old environment forever. The provider refuses to
  // delete variables a plan dropped (a tenant may have set them by hand); restarting our own service is the
  // other half of that same operator decision.
  const redeploy = value('redeploy');
  if (redeploy) {
    const serviceId = nameToId.get(redeploy);
    if (!serviceId) { console.error(`  --redeploy: no service named "${redeploy}"`); process.exit(1); }
    const inst = await call('query($p:String!,$e:String!){ environment(projectId:$p, id:$e){ serviceInstances{ edges{ node{ serviceId id } } } } }', { p: projectId, e: environmentId });
    const instanceId = (inst.data?.environment?.serviceInstances?.edges ?? []).find((x: any) => x.node.serviceId === serviceId)?.node?.id;
    if (!instanceId) { console.error('  --redeploy: no service instance found'); process.exit(1); }
    const dep = await call('mutation($e:String!,$s:String!){ serviceInstanceDeploy(environmentId:$e, serviceId:$s, latestCommit:true) }', { e: environmentId, s: serviceId });
    if (dep.errors) { console.error(`  --redeploy failed: ${JSON.stringify(dep.errors).slice(0, 160)}`); process.exit(1); }
    console.log(`  redeploy requested for ${redeploy} (instance ${String(instanceId).slice(0, 8)})`);
  }
  process.exit(0);
}

const manifest = loadManifest();


if (arg('from-state')) {
  const host = value('issuer-host');
  const authHost = value('auth-host');
  if (!host || !authHost) {
    console.error('  --from-state needs --issuer-host= and --auth-host= (read back from the provider, never typed)');
    process.exit(1);
  }
  // Patched into the MANIFEST, before buildPlan -- not into the plan afterwards. The first version assigned
  // these values to `plan.environments[...].services[...]` and the apply then reported `noop`: planHash is
  // computed over the environments inside buildPlan, so mutating the plan afterward left the hash describing
  // the old content and the provider correctly concluded nothing had changed. A hash that does not cover what
  // is applied is a hash that is lying, and the fix was to stop editing after it was computed.
  for (const [service, sets] of [
    ['api', { PLATFOLIO_IDENTITY_ISSUER: `https://${authHost}/realms/platfolio`, PLATFOLIO_IDENTITY_JWKS_URI: `https://${authHost}/realms/platfolio/protocol/openid-connect/certs` }],
    ['identity', { KC_HOSTNAME: authHost }],
  ] as const) {
    const svc = manifest.spec.services[service];
    if (!svc) { console.error(`  no "${service}" service in the composition`); process.exit(1); }
    for (const [name, literal] of Object.entries(sets)) svc.env[name] = literal;
  }
  console.log(`  composition patched: api issuer https://${authHost}/realms/platfolio, identity hostname ${authHost}`);
}

const plan = buildPlan(manifest, { instanceId: 'selfhost', teamId: 'platfolio' });

if (arg('strip-domains')) {
  for (const e of plan.environments) e.domains = [];
  console.log('  custom domains stripped for this pass; Railway generated hosts will be used');
}

if (arg('generated-domains')) {
  // A sentinel hostname ending in `.up.railway.app` makes the provider ask Railway to mint one and read the
  // actual host back (railway-provider's createDomain does exactly that); the alternative is to sit without a
  // URL until DNS lands at a registrar we do not control, which is E27 all over again.
  for (const e of plan.environments) {
    // Every planned service here is meant to be reachable -- the database is a `database`, not a service -- and
    // `verificationName` is required by the plan schema even though a Railway-minted host never needs the TXT
    // record (that is the custom-domain path, where it carries the DNS proof).
    e.domains = e.services.map((s) => ({ host: `${s.name}.generated.up.railway.app`, service: s.name, port: s.port, verificationName: `${s.name}-verify` }));
    console.log(`  requesting Railway-generated hosts for ${e.domains.map((d) => d.service).join(', ')}`);
  }
}

/**
 * Deliver the credentials THIS composition declares, through the provider seam rather than by hand.
 *
 * Why it exists: the first-party stack declares three shared-variable secrets on its `api` service (the GitHub
 * App identity), and the only delivery path before D53 was `--bootstrap-vars` -- hand-written GraphQL, two
 * variable names, production only. When staging was created those credentials did not exist in it, and the plan
 * check correctly failed `secret-unavailable` in both environments. That is the gap D48 describes: behaviour
 * living in a script instead of behind an operation.
 *
 * D4 in this function's terms: values are read from the local environment, written once, and never logged,
 * stored or echoed. Names appear in the output because a name is not a secret.
 */
async function deliverDeclaredSecrets(target: RailwayInfraProvider): Promise<void> {
  let delivered = 0;
  const absent: string[] = [];
  for (const env of plan.environments) {
    for (const svc of env.services) {
      for (const secret of svc.secrets) {
        const value = process.env[secret.name];
        if (value === undefined || value.length === 0) { absent.push(`${env.name}/${svc.name}.${secret.name}`); continue; }
        const result = await target.putSecretValue({
          instanceId: plan.instanceId, environment: env.name, service: svc.name, name: secret.name, value,
          // The scope comes from the description, not from whoever is running the deploy -- the same
          // `secretWriteScope` the API handler calls, so the two cannot drift.
          source: secretWriteScope(secret.source),
        });
        if (!result.ok) {
          console.error(`  FAILED ${env.name}/${svc.name}.${secret.name} (${secret.source}): ${result.code} -- ${result.reason}`);
          process.exitCode = 1;
          continue;
        }
        delivered++;
        // `verified` is the provider's presence read-back for the DECLARING service, so a shared variable that
        // was written but never attached says so here rather than at the next boot.
        console.log(`  delivered ${env.name}/${svc.name}.${secret.name} (source ${secret.source}, verified ${String(result.verified)}) -- value withheld`);
      }
    }
  }
  if (absent.length > 0) {
    console.log(`  not supplied locally, left alone: ${absent.join(', ')}`);
    console.log('  platfolio does not invent a value for a declared credential; export it (or set it in your own provider project) and re-run');
  }
  console.log(`  ${String(delivered)} delivered, ${String(absent.length)} left unset -- re-run the apply to let the plan check see them`);
}

describePlan(plan);

// A dry run must stay a dry run: it renders and validates the plan and asks for nothing, which is the whole
// reason it is the default. Requiring provider credentials before this check turned `platform:plan` into a
// credentialed operation -- a regression I introduced while moving this block and caught by running it.
if (!arg('apply') && !arg('deliver-secrets')) {
  console.log('\n  DRY RUN -- nothing was created or changed. Re-run with --apply.');
  process.exit(0);
}

if (!token || !workspaceId) {
  console.error('  --apply and --deliver-secrets both need RAILWAY_TOKEN and RAILWAY_WORKSPACE_ID in the environment');
  process.exit(1);
}

// Keycloak's cold start against a shared Postgres runs past the provider's default three-minute
// window, and timing out a deploy that is merely slow would leave a half-deployed first-party stack.
const provider = new RailwayInfraProvider({ credentials, workspaceId, deployBudget: Number(process.env.PLATFOLIO_DEPLOY_BUDGET ?? 4), deployTimeoutMs: Number(process.env.PLATFOLIO_DEPLOY_TIMEOUT_MS ?? 600_000) });

// Credential delivery is the same hosting operation through the same seam as the apply, so it shares this one
// provider instance rather than constructing a second with its own budget and wiring.
if (arg('deliver-secrets')) {
  await deliverDeclaredSecrets(provider);
  process.exit(process.exitCode ?? 0);
}

const info = provider.describe();
console.log(`\n  applying via ${info.provider} (contract ${info.contract}; ${String(info.operations.length)} operations)...`);
const result = await provider.applyPlan(plan);
// `verified` is the provider's own claim that every step was read back, and it is the only thing here that
// makes "deployed" mean anything -- applyPlan returns the state it observed, not the state it intended.
console.log(`  apply: instance=${result.instanceId} verified=${String(result.verified)} noop=${String(result.noop)} plan=${result.planHash.slice(0, 12)}…`);
for (const f of result.failures) console.log(`    FAILURE ${f.step}: ${f.code} -- ${f.message}`);
for (const n of result.notes ?? []) console.log(`    note ${n.step}: ${n.code} -- ${n.message}`);
for (const s of result.services) console.log(`    service ${s.name}: ${s.status}${s.externalId ? ` (${s.externalId})` : ''}`);
for (const d of result.domains) {
  console.log(`    domain ${d.host}: dns=${d.dnsStatus} cert=${d.certificateStatus ?? 'n/a'} target=${d.targetService}`);
  if (d.records) console.log(`      provider asks for: ${JSON.stringify(d.records)}`);
}
const reachable = result.domains.map((d) => d.host).filter((h) => h.endsWith('.up.railway.app'));
if (reachable.length > 0) console.log(`\n  generated hosts: ${reachable.map((h) => `https://${h}`).join(', ')}`);
process.exit(result.verified && result.failures.length === 0 ? 0 : 1);
