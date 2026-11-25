import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { InstallationEnvironment, InstallationObserver } from '../src/installation-provider.ts';
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

function fixture(change: 'none' | 'drift' | 'conflict' | 'public-vault' = 'none') {
  const approved = [{ id: workspaceId, name: 'Owner workspace' }];
  const environments: { name: string; id: string }[] = [];
  const deployments = new Map<string, RailwayTemplateConfig>();
  const calls: string[] = [];
  let created: object | undefined;
  let challenge = '';
  const request: typeof fetch = async (url, options) => {
    if (url === railwayIssuer + '/oauth/token') {
      const body = new URLSearchParams(String(options?.body));
      assert.equal(body.get('redirect_uri'), callback);
      assert.equal(createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url'), challenge);
      return Response.json({ access_token: 'fixture-oauth-grant', expires_in: 3600, scope: 'openid workspace:admin' });
    }
    assert.match(String(url), /^https:\/\/[a-z-]+\.up\.railway\.app\/(status|readyz|realms\/platfolio)$/);
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.headers, undefined);
    return new Response(null, { status: 200 });
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
          return { templateDeployV2: { operationId: 'op-' + body.environmentId } } as T;
        }
        case 'installationServices': {
          assert.equal(variables?.projectId, projectId);
          const config = deployments.get(String(variables?.environmentId));
          const edges = Object.values(config?.services ?? {}).map((service) => ({ node: {
            serviceId: service.name, serviceName: service.name, source: service.source, activeDeployments: [{ status: 'SUCCESS' }],
            domains: { customDomains: [], serviceDomains: service.networking || change === 'public-vault' && String(service.name).startsWith('openbao')
              ? [{ domain: service.name + '.up.railway.app' }] : [] },
          } }));
          return { environment: { serviceInstances: { edges } } } as T;
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
    step() {}, project: (value) => assert.equal(value, projectId), environment: (name) => completed.push(name),
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
    await assert.rejects((await unsafe.grant).launch({ ...input, environments: ['staging'] }, unsafe.observer), /changed|already a project/);
    assert.ok(!unsafe.calls.includes('projectCreate'));
  }
});

test('browser install refuses readiness if Railway exposes OpenBao publicly', async () => {
  const run = fixture('public-vault');
  await assert.rejects((await run.grant).launch({ ...input, environments: ['staging'] }, run.observer), /public ingress/);
  assert.deepEqual(run.completed, []);
});
