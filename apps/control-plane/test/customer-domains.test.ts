import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerRailway } from '../../../scripts/customer-railway.ts';
import type { RailwayTransport } from '../../../packages/contracts/src/railway-transport.ts';

test('an explicit installation project is checked directly and fails closed outside its workspace', async () => {
  const target = { kind: 'installation', name: 'platfolio', id: 'chosen-installation' } as const;
  const grant = { workspaceId: 'owner-workspace', token: 'fixture-workspace-grant' };
  const project = { id: target.id, name: target.name, description: 'Platfolio project role installation/platfolio', workspaceId: grant.workspaceId,
    environments: { edges: [{ node: { id: 'staging-env', name: 'staging' } }] } };
  const transport: RailwayTransport = {
    async graphql<T>({ operation, variables }: Parameters<RailwayTransport['graphql']>[0]): Promise<T> {
      if (operation === 'selected installation project') {
        assert.deepEqual(variables, { id: target.id });
        return { project } as T;
      }
      assert.equal(operation, 'stage instances');
      assert.deepEqual(variables, { projectId: target.id, environmentId: 'staging-env' });
      return { environment: { serviceInstances: { edges: [] } } } as T;
    },
  };
  assert.equal((await customerRailway(target, undefined, grant, transport)).scope.projectId, target.id);
  project.workspaceId = 'other-workspace';
  await assert.rejects(customerRailway(target, undefined, grant, transport), /different Railway workspace/);
  project.workspaceId = grant.workspaceId;
  project.description = 'A different installation';
  await assert.rejects(customerRailway(target, undefined, grant, transport), /staging-only project/);
});

test('custom domains use the verified app service and read back every change from Railway', async () => {
  const domain = 'preview.example.test';
  const project = { id: 'app-project', name: 'starter-web', description: 'Platfolio project role app/starter-web', workspaceId: 'owner-workspace',
    environments: { edges: [{ node: { id: 'staging-env', name: 'staging' } }] } };
  const grant = { projectId: project.id, workspaceId: project.workspaceId, token: 'fixture-project-grant' };
  let attached = false;
  let attaches = 0;
  let detaches = 0;
  const wrap = (nodes: object[]) => ({ environment: { serviceInstances: { edges: nodes.map(node => ({ node })) } } });
  const transport: RailwayTransport = {
    async graphql<T>({ operation, variables, credential }: Parameters<RailwayTransport['graphql']>[0]): Promise<T> {
      assert.equal(credential.token, grant.token);
      switch (operation) {
        case 'selected app project':
          assert.deepEqual(variables, { id: project.id });
          return { project } as T;
        case 'stage instances':
          assert.deepEqual(variables, { environmentId: 'staging-env', projectId: 'app-project' });
          return wrap([{ serviceId: 'web-id', serviceName: 'web-staging', source: null,
            latestDeployment: { id: 'deployed', status: 'SUCCESS' }, activeDeployments: [{ id: 'deployed', status: 'SUCCESS' }],
            domains: { customDomains: [], serviceDomains: [{ id: 'generated-id', domain: 'generated.up.railway.app' }] } },
          { serviceId: 'db-id', serviceName: 'app-db-staging' }]) as T;
        case 'starter custom domain status':
          return wrap([{ serviceId: 'db-id', domains: { customDomains: [{ id: 'unrelated', domain }] } },
            { serviceId: 'web-id', domains: { customDomains: attached ? [{ id: 'custom-id', domain, status: {
              verified: false, certificateStatus: 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP',
              verificationDnsHost: '_railway-verify.preview', verificationToken: 'proof-value',
              dnsRecords: [{ fqdn: domain, hostlabel: 'preview', zone: 'example.test', recordType: 'DNS_RECORD_TYPE_CNAME',
                requiredValue: 'provider-host.up.railway.app', purpose: 'DNS_RECORD_PURPOSE_TRAFFIC_ROUTE' }],
            } }] : [] } }]) as T;
        case 'attach starter custom domain':
          assert.deepEqual(variables, { input: { projectId: 'app-project', environmentId: 'staging-env', serviceId: 'web-id', domain, targetPort: 8080 } });
          attached = true;
          attaches += 1;
          throw new Error('Response interrupted after provider accepted the hostname');
        case 'detach starter custom domain':
          assert.deepEqual(variables, { id: 'custom-id' });
          attached = false;
          detaches += 1;
          return { customDomainDelete: true } as T;
        default: throw new Error(`Unexpected provider operation ${operation}`);
      }
    },
  };
  await assert.rejects(customerRailway({ kind: 'app', name: 'starter-web', id: 'other-project' }, undefined, grant, transport), /limited to the selected/);
  const railway = await customerRailway({ kind: 'app', name: 'starter-web', id: project.id }, undefined, grant, transport);
  assert.deepEqual(await railway.starterDomains('stale-deployment', 'attach', domain), { outcome: 'conflict' });
  const first = await railway.starterDomains('deployed', 'attach', domain);
  assert.equal(first.outcome, 'attached');
  if (first.outcome !== 'attached') return;
  assert.equal(first.domain.certificateStatus, 'pending');
  assert.deepEqual(first.domain.records.map(({ type, fqdn, value }) => [type, fqdn, value]), [
    ['CNAME', domain, 'provider-host.up.railway.app'],
    ['TXT', '_railway-verify.preview.example.test', 'proof-value'],
  ]);
  assert.deepEqual(await railway.starterDomains('deployed', 'attach', domain), first);
  assert.deepEqual(await railway.starterDomains('deployed', 'attach', 'other.example.test'), { outcome: 'conflict' });
  assert.deepEqual(await railway.starterDomains('deployed', 'list'), { outcome: 'listed', domains: [first.domain] });
  assert.deepEqual(await railway.starterDomains('deployed', 'detach', domain), { outcome: 'detached' });
  assert.deepEqual(await railway.starterDomains('deployed', 'detach', domain), { outcome: 'detached' });
  assert.equal(attaches, 1);
  assert.equal(detaches, 1);
});
