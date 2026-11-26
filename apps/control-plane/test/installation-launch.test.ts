import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import type { SuccessOf } from '@platfolio/api-contract/generated/types';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import type { InstallationProvider } from '../../../packages/contracts/src/installation-provider.ts';
import { buildCapabilities } from '../src/capabilities.ts';
import { installationAuthorizationCallback } from '../src/installation-launch.ts';

test('a hub owner launches through the selected plugin without exposing the grant or bootstrap verifier', async () => {
  const fixture = createIdentityFixture();
  const permissions = { issuer: 'https://hosting.example.test', code: 'use-once' };
  let exchanges = 0;
  let executions = 0;
  let maintenanceCalls = 0;
  let interrupt = true;
  let unblock!: () => void;
  const provisioned = new Promise<void>((resolve) => { unblock = resolve; });
  const input = {
    workspaceId: 'owned-workspace-' + randomUUID().slice(0, 8), name: 'platfolio', environments: ['staging'],
    ownerEmail: 'owner@example.test', verifier: 'a'.repeat(86) + '==', salt: 'b'.repeat(22) + '==',
  };
  const installationProvider: InstallationProvider = {
    id: 'fixture-host', revision: 'c'.repeat(40),
    authorize: () => ({
      state: 'fixture-state', url: permissions.issuer + '/authorize',
      async complete(data) {
        exchanges++;
        assert.equal(data.code, permissions.code);
        assert.equal(data.issuer, permissions.issuer);
        return {
          workspaces: [{ id: input.workspaceId, name: 'Approved workspace' }], expires: Date.now() + 60_000,
          async launch() { throw new Error('A hub launch must use its durable binding'); },
          async recover(value, observer, recovery) {
            executions++;
            assert.ok(recovery);
            await observer.step('Create project', 'WORKING');
            await provisioned;
            await observer.project('project-id');
            if (interrupt) {
              await recovery.beforeWrite('staging');
              throw new Error('Railway disconnected after submission');
            }
            if (value.environments.includes('production')) {
              assert.deepEqual(recovery.verified, ['staging']);
              assert.equal(recovery.projectId, 'project-id');
              await observer.environment('production', 'https://production.example.test');
            } else {
              assert.deepEqual(recovery.submitted, ['staging']);
              assert.equal(recovery.projectId, 'project-id');
              await observer.environment('staging', 'https://private.example.test');
            }
            await observer.step('Create project', 'READY');
          },
          async maintain(target, action, observer, beforeWrite) {
            maintenanceCalls++;
            assert.equal(target.projectId, 'project-id');
            assert.equal(target.workspaceId, input.workspaceId);
            assert.deepEqual(target.requested, ['staging', 'production']);
            await beforeWrite();
            if (action.action === 'update') {
              assert.equal(action.environment, 'staging');
              await observer.environment('staging', 'https://private.example.test');
            }
            await observer.step('Verified provider result', 'READY');
          },
        };
      },
    }),
  };
  const database = process.env.PLATFOLIO_DB_URL;
  const boot = () => createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: database ? { driver: 'postgres', connectionString: database } : { driver: 'memory' },
    server: { port: 0 },
    requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: '0'.repeat(40), buildTime: new Date(0).toISOString() },
      marketplaceEnabled: true, installation: { provider: installationProvider, returnTo: 'https://hub.example.test' },
    }),
  });
  let app = await boot();
  const origin = () => 'http://127.0.0.1:' + app.server.address.port;
  const token = (subject: string) => signToken(fixture, { scope: 'platfolio.user', subject });
  const call = (path: string, method = 'GET', subject = 'owner', body?: unknown) => fetch(origin() + path, {
    redirect: 'manual', method, headers: { authorization: 'Bearer ' + token(subject), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  try {
    const created = await call('/api/v1/teams', 'POST', 'owner', { name: 'hub-installation-' + randomUUID().slice(0, 8) });
    const { teamId } = await created.json() as { teamId: string };
    const member = await app.store.resolvePerson({ issuer: fixture.issuer, subject: 'member' });
    assert.ok(member.ok);
    await app.store.putTeamMember({ teamId, personId: member.value.person.id, role: 'member' });
    const route = '/api/v1/teams/' + teamId + '/marketplace/installation-launches';
    assert.equal((await call(route, 'POST', 'member')).status, 403);
    assert.equal((await call(route, 'POST', 'other')).status, 404);
    const offer = await call(route, 'POST');
    assert.equal(offer.status, 201);
    const { id } = await offer.json() as { id: string };
    const status = route + '/' + id;
    assert.equal((await call(status, 'PUT', 'owner', input)).status, 409);
    const callback = (state: string) => fetch(origin() + installationAuthorizationCallback + '?' + new URLSearchParams({
      state, code: permissions.code, iss: permissions.issuer,
    }), { redirect: 'manual' });
    assert.equal((await callback('invalid')).status, 404);
    const completed = await callback('fixture-state');
    assert.equal(completed.status, 303);
    assert.equal(completed.headers.get('location'), 'https://hub.example.test');
    assert.equal((await callback('fixture-state')).status, 404);
    assert.equal(exchanges, 1);
    assert.equal((await call(status, 'GET', 'other')).status, 404);
    assert.equal((await call(status, 'PUT', 'owner', { ...input, workspaceId: 'outside' })).status, 409);
    assert.equal((await call(status, 'PUT', 'owner', { ...input, ownerEmail: '${{secret}}@example.test' })).status, 400);
    assert.equal((await call(status, 'PUT', 'owner', { ...input, environments: ['staging', 'staging'] })).status, 400);
    assert.equal((await call(status, 'PUT', 'owner', { ...input, password: 'plaintext' })).status, 400);
    const requests = await Promise.all([call(status, 'PUT', 'owner', input), call(status, 'PUT', 'owner', input)]);
    assert.deepEqual(requests.map(({ status: code }) => code).sort(), [202, 409]);
    assert.equal(executions, 1);
    unblock();
    async function waitFor(expected: string) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const response = await call(status);
        const value = await response.json() as { state: string; projectId?: string; environments: { name: string; origin: string }[] };
        if (value.state === expected) return value;
        await delay(10);
      }
      throw new Error('Did not reach ' + expected);
    }
    const interrupted = await waitFor('failed');
    assert.equal(interrupted.projectId, 'project-id');
    assert.deepEqual(interrupted.environments, []);
    assert.equal((await call(status, 'PUT', 'owner', input)).status, 409);
    const records = await call(route).then((response) => response.json());
    assert.deepEqual(records, [{ id, name: input.name, workspaceId: input.workspaceId, state: 'failed', requested: ['staging'], verified: [], installed: [], canRemove: true }]);
    assert.ok(!JSON.stringify(records).includes(input.verifier));
    const owner = await app.store.resolvePerson({ issuer: fixture.issuer, subject: 'owner' });
    assert.ok(owner.ok);
    const recorded = await app.store.getInstallationJournal(teamId, owner.value.person.id, id);
    assert.ok(recorded);
    assert.deepEqual(recorded.submitted, ['staging']);
    assert.doesNotMatch(JSON.stringify(recorded), new RegExp(input.ownerEmail));
    assert.ok(!JSON.stringify(recorded).includes(input.verifier) && !JSON.stringify(recorded).includes(input.salt));

    // Simulate the last checkpoint of a process that exited before recording its result.
    assert.equal(await app.store.saveInstallationJournal({
      ...recorded, state: 'running', version: recorded.version + 1, leaseUntil: new Date(0).toISOString(),
    }), true);
    if (database) {
      await disposeKernel(app);
      app = await boot();
      assert.equal((await call(status, 'PUT', 'owner', input)).status, 409);
      await waitFor('failed');
    }
    const recovery = async () => {
      const offer = await call(route, 'POST', 'owner', { installationId: id });
      assert.equal(offer.status, 201);
      assert.equal((await offer.json() as { id: string }).id, id);
      assert.equal((await callback('fixture-state')).status, 303);
    };
    interrupt = false;
    await recovery();
    assert.equal((await call(status, 'PUT', 'owner', { ...input, name: 'other-project' })).status, 409);
    assert.equal((await call(status, 'PUT', 'owner', { ...input, environments: ['production'] })).status, 409);
    assert.equal((await call(status, 'PUT', 'owner', input)).status, 202);
    const resumed = await waitFor('ready');
    assert.deepEqual(resumed.environments.map(({ name }) => name), ['staging']);

    await recovery();
    assert.equal((await call(status, 'PUT', 'owner', input)).status, 409);
    assert.equal((await call(status, 'PUT', 'owner', { ...input, environments: ['production'] })).status, 202);
    const expanded = await waitFor('ready');
    assert.equal(expanded.projectId, 'project-id');
    assert.deepEqual(expanded.environments.map(({ name }) => name), ['staging', 'production']);
    assert.equal(executions, 3);
    const maintenance = status + '/maintenance';
    assert.equal((await call(maintenance, 'POST', 'member', { action: 'wipe', confirmation: input.name })).status, 403);
    assert.equal((await call(maintenance, 'POST', 'owner', { action: 'wipe', confirmation: input.name })).status, 409);
    installationProvider.revision = 'd'.repeat(40);
    await recovery();
    const update = { action: 'update', environment: 'staging', revision: installationProvider.revision };
    assert.equal((await call(maintenance, 'POST', 'owner', { ...update, revision: 'c'.repeat(40) })).status, 409);
    assert.equal((await call(maintenance, 'POST', 'owner', update)).status, 202);
    await waitFor('ready');
    const listed = await call(route).then((response) => response.json()) as SuccessOf<'listHubInstallationLaunches'>;
    assert.deepEqual(listed[0]?.installed, [{ name: 'staging', revision: 'd'.repeat(40) }, { name: 'production', revision: 'c'.repeat(40) }]);
    await recovery();
    assert.equal((await call(maintenance, 'POST', 'owner', { action: 'wipe', confirmation: 'wrong-project' })).status, 400);
    assert.equal((await call(maintenance, 'POST', 'owner', { action: 'wipe', confirmation: input.name })).status, 202);
    assert.deepEqual((await waitFor('removed')).environments, []);
    assert.equal((await call(route, 'POST', 'owner', { installationId: id })).status, 404);
    assert.equal(maintenanceCalls, 2);
    const audit = await call('/api/v1/teams/' + teamId + '/activity').then((response) => response.text());
    assert.ok(!audit.includes(input.verifier));
  } finally {
    unblock();
    await disposeKernel(app);
  }
});
