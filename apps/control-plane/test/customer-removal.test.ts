import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { customerLaunchRun } from '../../../scripts/customer-launch-run.ts';
import { removeCustomerStarter } from '../../../scripts/customer-railway.ts';
import { FREE_STARTER_RELEASE as release, MARKETPLACE_RELEASES } from '@platfolio/manifest';
import type { RailwayTransport } from '@platfolio/contracts';

const project = {
  id: '135466ce-d854-4618-b290-b0c8af1af161', name: 'starter-web',
  description: 'Platfolio project role app/starter-web', workspaceId: 'owner-workspace',
  environments: { edges: [{ node: { id: 'stage', name: 'staging' } }] },
};
const grant = { workspaceId: project.workspaceId, token: 'fixture-workspace-grant' };
const page = (items: object[]) => ({ projects: { edges: items.map((node) => ({ node })), pageInfo: { hasNextPage: false } } });

test('the Starter Web journal waits for Railway to stop listing the project before reporting wiped', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'platfolio-wipe-'));
  context.after(() => rmSync(directory, { recursive: true }));
  const journal = join(directory, 'launch.json');
  writeFileSync(journal, JSON.stringify({ state: 'ready', projectId: project.id, template: release.template,
    revision: release.revision, events: [], retainedVolumes: ['active-volume'] }));
  let deletes = 0;
  let observations = 0;
  const transport: RailwayTransport = {
    async graphql<T>({ operation, variables }: Parameters<RailwayTransport['graphql']>[0]): Promise<T> {
      switch (operation) {
        case 'projects':
          assert.equal(variables?.workspaceId, grant.workspaceId);
          return page(deletes && ++observations > 1 ? [] : [project]) as T;
        case 'selected app project': return { project } as T;
        case 'stage instances': return { environment: { serviceInstances: { edges: [] } } } as T;
        case 'projectDelete':
          assert.deepEqual(variables, { id: project.id });
          deletes++;
          return { projectDelete: true } as T;
        default: throw new Error(`Unexpected operation ${operation}`);
      }
    },
  };
  const run = customerLaunchRun('test-team', journal, {
    template: release.template, revision: release.revision,
    remove: (id, data) => removeCustomerStarter(id, data, grant, transport),
    async deploy() { throw new Error('Unexpected deployment'); },
    async domains() { throw new Error('Unexpected domain operation'); },
    async publicLabel() { throw new Error('Unexpected public label lookup'); },
  });
  assert.equal(run.remove('wipe').state, 'removing');
  for (let i = 0; i < 60 && run.read().state === 'removing'; i++) await delay(50);
  assert.equal(run.read().state, 'wiped');
  assert.deepEqual(run.read().retainedVolumes, []);
  assert.equal(run.read().events.at(-1)?.step, 'Removal complete');
  assert.equal(deletes, 1);
  assert.equal(observations, 2);
});


test('a wipe retry settles the recorded ID even when a replacement project has the same name', async () => {
  const transport: RailwayTransport = {
    async graphql<T>({ operation }: Parameters<RailwayTransport['graphql']>[0]): Promise<T> {
      assert.equal(operation, 'projects');
      return page([{ ...project, id: 'replacement-id' }]) as T;
    },
  };
  assert.deepEqual(await removeCustomerStarter(project.id, 'wipe', grant, transport), { projectId: project.id, retainedVolumes: [] });
  await assert.rejects(removeCustomerStarter(project.id, 'wipe', { ...grant, projectId: project.id }, transport), /project-only/);
  await assert.rejects(removeCustomerStarter(project.id, 'wipe', grant, { async graphql() { throw new Error('Not Authorized'); } }), /Not Authorized/);
});


test('the journal saves the selected release before provisioning and redeploys it after restart', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'platfolio-pin-'));
  context.after(() => rmSync(directory, { recursive: true }));
  const journal = join(directory, 'worker.json');
  const baseline = MARKETPLACE_RELEASES.find(({ template }) => template === 'starter-worker')!;
  const selected = { ...baseline, version: '0.1.2', revision: '1'.repeat(40) };
  const newer = { ...selected, version: '0.1.3', revision: '2'.repeat(40) };
  const deployments: string[] = [];
  const provider = {
    template: baseline.template, revision: baseline.revision,
    async deploy(input: Parameters<import('@platfolio/contracts').SourceReleaseHosting['deploy']>[0]) {
      const saved = JSON.parse(readFileSync(journal, 'utf8'));
      assert.equal(saved.state, 'running');
      assert.deepEqual(saved.pinnedRelease, input.release);
      assert.ok(input.release);
      deployments.push(input.release.revision);
      return { project: project.id, deployment: 'deployment-' + deployments.length };
    },
    async remove() { return { retainedVolumes: [] }; },
    async domains() { return { outcome: 'not-available' as const }; },
    async publicLabel() { return null; },
  };
  const ready = async (run: ReturnType<typeof customerLaunchRun>) => {
    for (let attempt = 0; attempt < 40 && run.read().state === 'running'; attempt++) await delay(10);
    assert.equal(run.read().state, 'ready');
  };

  const first = customerLaunchRun('test-team', journal, provider);
  assert.equal(first.startWithRelease(selected).revision, selected.revision);
  await ready(first);
  const restarted = customerLaunchRun('test-team', journal, { ...provider, revision: newer.revision });
  assert.equal(restarted.needsRelease(), false);
  assert.equal(restarted.redeploy().revision, selected.revision);
  await ready(restarted);
  assert.deepEqual(deployments, [selected.revision, selected.revision]);
  assert.equal(restarted.read().version, selected.version);
  assert.equal(restarted.read().deploymentId, 'deployment-2');
});
