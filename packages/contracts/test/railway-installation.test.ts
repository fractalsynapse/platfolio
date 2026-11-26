import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { InstallationEnvironment, InstallationObserver, InstallationRecovery } from '../src/installation-provider.ts';
import { railwayInstallationProvider } from '../src/railway-installation.ts';
import { railwayIssuer } from '../src/railway-oauth.ts';
import { railwayTemplateDigest, type RailwayTemplateConfig } from '../src/railway-template.ts';
import type { RailwayTransport } from '../src/railway-transport.ts';

const names = ['private-site', 'private-api', 'private-identity', 'private-db', 'openbao', 'installation-worker'];
const image = 'example.test/candidate@sha256:' + 'c'.repeat(64);
const raw = { services: Object.fromEntries(names.map((name, index) => [index, {
  name: name + '-staging', source: { image },
  ...(index < 3 ? { networking: { serviceDomains: {} } } : {}),
  variables: { HOST_REFERENCE: { defaultValue: '${{private-db-staging.RAILWAY_PRIVATE_DOMAIN}}' } },
  deploy: name === 'installation-worker' ? { healthcheckPath: '/readyz' } : {},
}])) };
const callback = 'https://api.example.test/api/v1/hosting/installation-authorization/callback';
const workspaceId = 'workspace-owned';
const projectId = 'project-owned';
const input = { workspaceId, name: 'platfolio', ownerEmail: 'owner@example.test', verifier: 'fixture-verifier', salt: 'fixture-salt' };

function fixture(change: 'none' | 'drift' | 'conflict' | 'public-vault' | 'after-submit' = 'none') {
  const approved = [{ id: workspaceId, name: 'Owner workspace' }];
  const environments: { name: string; id: string }[] = [];
  const deployments = new Map<string, RailwayTemplateConfig>();
  const calls: string[] = [];
  let created: object | undefined;
  let challenge = '';
  let interrupted = false;
  const revisions = new Map<string, number>();
  const request: typeof fetch = async (url, options) => {
    if (url === railwayIssuer + '/oauth/token') {
      const body = new URLSearchParams(String(options?.body));
      assert.equal(body.get('redirect_uri'), callback);
      assert.equal(createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url'), challenge);
      return Response.json({ access_token: 'fixture-oauth-grant', expires_in: 3600, scope: 'openid workspace:admin' });
    }
    assert.match(String(url), /^https:\/\/[a-z-]+\.up\.railway\.app\/(status|readyz|version(?:\.json)?|realms\/platfolio)$/);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.headers, undefined);
    if (/\/version(?:\.json)?$/.test(String(url))) return Response.json({ commit: 'a'.repeat(40) });
    return String(url).endsWith('/readyz') ? Response.json({ checks: [{ name: 'database', status: 'ok' }] }) : new Response(null, { status: 200 });
  };
  const transport: RailwayTransport = {
    async graphql<T>({ operation, variables, credential }: Parameters<RailwayTransport['graphql']>[0]): Promise<T> {
      calls.push(operation);
      assert.deepEqual(credential, { kind: 'workspace', token: 'fixture-oauth-grant' });
      switch (operation) {
        case 'authorizedWorkspaces': return { me: { workspaces: approved } } as T;
        case 'template': {
          const serializedConfig = change === 'drift' ? { services: {} } : raw;
          return { template: { id: 'pinned-template', serializedConfig } } as T;
        }
        case 'projects': {
          assert.equal(variables?.workspaceId, workspaceId);
          const placement = { ...(change === 'conflict' ? { id: 'foreign-project', name: input.name } : created),
            workspaceId, environments: { edges: environments.map((node) => ({ node })) } };
          return { projects: { edges: created || change === 'conflict' ? [{ node: placement }] : [], pageInfo: { hasNextPage: false } } } as T;
        }
        case 'projectCreate': {
          const body = variables?.input as { defaultEnvironmentName: string; name: string; workspaceId: string; description: string };
          assert.equal(body.workspaceId, workspaceId);
          assert.equal(body.name, input.name);
          environments.push({ name: body.defaultEnvironmentName, id: 'env-' + body.defaultEnvironmentName });
          created = { id: projectId, name: body.name, description: body.description };
          return { projectCreate: { id: projectId } } as T;
        }
        case 'environmentCreate': {
          const body = variables?.input as { projectId: string; name: string; skipInitialDeploys: boolean };
          assert.equal(body.projectId, projectId);
          assert.equal(body.skipInitialDeploys, true);
          const node = { id: 'env-' + body.name, name: body.name };
          environments.push(node);
          return { environmentCreate: node } as T;
        }
        case 'templateDeployV2': {
          const body = variables?.input as { environmentId: string; workspaceId: string; projectId: string; serializedConfig: RailwayTemplateConfig };
          assert.equal(body.projectId, projectId);
          assert.equal(body.workspaceId, workspaceId);
          assert.ok(environments.some(({ id }) => id === body.environmentId));
          deployments.set(body.environmentId, body.serializedConfig);
          if (change === 'after-submit' && !interrupted) {
            interrupted = true;
            throw new Error('Connection lost after provider accepted the request');
          }
          return { templateDeployV2: { operationId: 'op-' + body.environmentId } } as T;
        }
        case 'serviceInstanceUpdate': {
          const config = deployments.get(String(variables?.environmentId));
          const service = Object.values(config?.services ?? {}).find(({ name }) => name === variables?.serviceId);
          assert.ok(service?.source);
          const { source } = variables?.input as { source: { image: string } };
          Object.assign(service.source, source);
          return { serviceInstanceUpdate: true } as T;
        }
        case 'serviceInstanceDeploy': {
          const name = String(variables?.serviceId);
          revisions.set(name, (revisions.get(name) ?? 0) + 1);
          return { serviceInstanceDeploy: true } as T;
        }
        case 'projectDelete': {
          assert.equal(variables?.id, projectId);
          created = undefined;
          return { projectDelete: true } as T;
        }
        case 'installationServices': {
          assert.equal(variables?.projectId, projectId);
          const config = deployments.get(String(variables?.environmentId));
          const edges = Object.values(config?.services ?? {}).map((service) => ({ node: {
            serviceId: service.name, serviceName: service.name, source: service.source, activeDeployments: [{ status: 'SUCCESS' }],
            latestDeployment: { id: service.name + '-' + (revisions.get(String(service.name)) ?? 0), status: 'SUCCESS' },
            domains: { customDomains: [], serviceDomains: service.networking || change === 'public-vault' && String(service.name).startsWith('openbao')
              ? [{ domain: service.name + '.up.railway.app' }] : [] },
          } }));
          return { environment: { serviceInstances: { edges, pageInfo: { hasNextPage: false } } } } as T;
        }
        case 'installationTcpIngress': return { tcpProxies: [] } as T;
        default: throw new Error('Unexpected Railway operation ' + operation);
      }
    },
  };
  const provider = railwayInstallationProvider({ clientId: 'fixture-client', templateCode: 'pinned-template', templateDigest: railwayTemplateDigest(raw),
    revision: 'a'.repeat(40), callback }, request, transport, async () => undefined);
  const auth = provider.authorize();
  const consent = new URL(auth.url);
  assert.ok(consent.searchParams.get('scope')?.includes('workspace:admin'));
  assert.ok(!consent.searchParams.get('scope')?.includes('offline_access'));
  challenge = consent.searchParams.get('code_challenge')!;
  const grant = auth.complete({ code: 'one-use', state: auth.state, issuer: railwayIssuer, error: '' });
  const completed: string[] = [];
  const observer: InstallationObserver = {
    step() {}, project: (value) => assert.equal(value, projectId), environment: (name) => { completed.push(name); },
  };
  return { grant, calls, deployments, environments, observer, completed };
}

for (const environments of [['staging'], ['production'], ['staging', 'production']] satisfies InstallationEnvironment[][]) {
  test('browser install creates only the requested environments: ' + environments.join(', '), async () => {
    const run = fixture();
    await (await run.grant).launch({ ...input, environments }, run.observer);
    assert.deepEqual(run.environments.map(({ name }) => name), environments);
    assert.deepEqual(run.completed, environments);
    assert.equal(run.calls.filter((operation) => operation === 'projectCreate').length, 1);
    for (const name of environments) {
      const services = Object.values(run.deployments.get('env-' + name)?.services ?? {});
      assert.deepEqual(services.map((service) => service.name), names.map((logical) => logical + '-' + name));
      const identity = services.find((service) => service.name === 'private-identity-' + name);
      assert.match(JSON.stringify(identity), new RegExp('private-db-' + name));
      assert.match(JSON.stringify(identity), /fixture-verifier/);
      assert.doesNotMatch(JSON.stringify(identity), /PLATFOLIO_INSTALL_OWNER_PASSWORD/);
      const worker = services.find((service) => service.name === 'installation-worker-' + name);
      assert.match(JSON.stringify(worker), /workspace-owned/);
      assert.equal(worker?.networking, undefined);
    }
  });
}

test('browser install refuses unapproved workspaces, changed templates and pre-existing projects', async () => {
  const run = fixture();
  await assert.rejects((await run.grant).launch({ ...input, workspaceId: 'other', environments: ['staging'] }, run.observer), /not authorized/);
  assert.deepEqual(run.calls, ['authorizedWorkspaces']);
  for (const issue of ['drift', 'conflict'] as const) {
    const unsafe = fixture(issue);
    await assert.rejects((await unsafe.grant).launch({ ...input, environments: ['staging'] }, unsafe.observer), /changed|could not be verified/);
    assert.ok(!unsafe.calls.includes('projectCreate'));
  }
});

test('browser install refuses readiness if Railway exposes OpenBao publicly', async () => {
  const run = fixture('public-vault');
  await assert.rejects((await run.grant).launch({ ...input, environments: ['staging'] }, run.observer), /public ingress/);
  assert.deepEqual(run.completed, []);
});

test('recovery observes the existing deployment and expansion deploys only the new environment', async () => {
  const run = fixture('after-submit');
  const grant = await run.grant;
  assert.ok(grant.recover);
  const observe = {
    async step() {},
    async project(id: string) { run.observer.project(id); },
    async environment(name: InstallationEnvironment, origin: string) { run.observer.environment(name, origin); },
  };
  const initial: InstallationRecovery = {
    id: 'marked-launch', verified: [], submitted: [],
    async beforeWrite(name) { if (name) assert.equal(name, 'staging'); },
  };
  await assert.rejects(grant.recover({ ...input, environments: ['staging'] }, observe, initial), /Connection lost/);
  assert.equal(run.calls.filter((operation) => operation === 'templateDeployV2').length, 1);

  const resumed = { ...initial, projectId, submitted: ['staging'] as const,
    async beforeWrite() { throw new Error('Recovery must not replay a write'); } };
  await grant.recover({ ...input, environments: ['staging'] }, observe, resumed);
  const staging = run.deployments.get('env-staging');
  assert.ok(staging);
  assert.equal(run.calls.filter((operation) => operation === 'templateDeployV2').length, 1);

  const expanded = { ...resumed, verified: ['staging'] as const,
    async beforeWrite(name?: InstallationEnvironment) { if (name) assert.equal(name, 'production'); } };
  await grant.recover({ ...input, environments: ['staging', 'production'] }, observe, expanded);
  assert.deepEqual(run.completed, ['staging', 'production']);
  assert.equal(run.deployments.get('env-staging'), staging);
  assert.equal(run.calls.filter((operation) => operation === 'templateDeployV2').length, 2);
  assert.equal(run.calls.filter((operation) => operation === 'projectCreate').length, 1);
});


test('maintenance updates the installed environment in place and wipes only the verified project', async () => {
  const run = fixture();
  const grant = await run.grant;
  assert.ok(grant.recover && grant.maintain);
  const observe = {
    async step() {},
    async project(id: string) { run.observer.project(id); },
    async environment(name: InstallationEnvironment, origin: string) { run.observer.environment(name, origin); },
  };
  await grant.recover({ ...input, environments: ['staging', 'production'] }, observe,
    { id: 'marked-launch', verified: [], submitted: [], async beforeWrite() {} });
  const staging = run.deployments.get('env-staging');
  const production = structuredClone(run.deployments.get('env-production'));
  const site = Object.values(staging?.services ?? {}).find(({ name }) => name === 'private-site-staging');
  assert.ok(site?.source);
  const installedSource = site.source as { image: string };
  installedSource.image = 'example.test/prior@sha256:' + 'a'.repeat(64);
  const existingVault = structuredClone(Object.values(staging?.services ?? {}).find(({ name }) => name === 'openbao-staging'));
  const target = { id: 'marked-launch', projectId, workspaceId, name: input.name, requested: ['staging', 'production'] as const };
  await assert.rejects(grant.maintain({ ...target, id: 'another-launch' }, { action: 'wipe' }, observe, async () => {}), /not be verified/);
  assert.ok(staging?.services);
  const stagingServices: NonNullable<RailwayTemplateConfig['services']> = staging.services;
  stagingServices.unmanaged = { name: 'unmanaged', source: { image } };
  await assert.rejects(grant.maintain(target, { action: 'wipe' }, observe, async () => {}), /unexpected service/);
  delete stagingServices.unmanaged;
  assert.ok(!run.calls.includes('projectDelete'));
  await grant.maintain(target, { action: 'update', environment: 'staging' }, observe, async () => {});
  assert.equal(installedSource.image, image);
  assert.deepEqual(run.deployments.get('env-production'), production);
  assert.deepEqual(Object.values(staging?.services ?? {}).find(({ name }) => name === 'openbao-staging'), existingVault);
  assert.equal(run.calls.filter((name) => name === 'templateDeployV2').length, 2);
  await grant.maintain(target, { action: 'wipe' }, observe, async () => {});
  await grant.maintain(target, { action: 'wipe' }, observe, async () => { throw new Error('Already removed'); });
  assert.equal(run.calls.filter((name) => name === 'projectDelete').length, 1);
});
