import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import type { InstallationProvider } from '../../../packages/contracts/src/installation-provider.ts';
import { buildCapabilities } from '../src/capabilities.ts';
import { installationAuthorizationCallback } from '../src/installation-launch.ts';

test('a hub owner launches through the selected plugin without exposing the grant or bootstrap verifier', async () => {
  const fixture = createIdentityFixture();
  const permissions = { issuer: 'https://hosting.example.test', code: 'use-once' };
  let exchanges = 0;
  let executions = 0;
  let unblock!: () => void;
  const provisioned = new Promise<void>((resolve) => { unblock = resolve; });
  const input = {
    workspaceId: 'owned-workspace', name: 'platfolio', environments: ['staging', 'production'],
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
          async launch(value, observer) {
            executions++;
            assert.deepEqual(value, input);
            observer.step('Create project', 'WORKING');
            await provisioned;
            observer.project('project-id');
            observer.environment('staging', 'https://private.example.test');
            observer.step('Create project', 'READY');
          },
        };
      },
    }),
  };
  const app = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: '0'.repeat(40), buildTime: new Date(0).toISOString() },
      marketplaceEnabled: true, installation: { provider: installationProvider, returnTo: 'https://hub.example.test' },
    }),
  });
  const origin = 'http://127.0.0.1:' + app.server.address.port;
  const token = (subject: string) => signToken(fixture, { scope: 'platfolio.user', subject });
  const call = (path: string, method = 'GET', subject = 'owner', body?: unknown) => fetch(origin + path, {
    redirect: 'manual', method, headers: { authorization: 'Bearer ' + token(subject), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  try {
    const created = await call('/api/v1/teams', 'POST', 'owner', { name: 'hub-installation' });
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
    const callback = (state: string) => fetch(origin + installationAuthorizationCallback + '?' + new URLSearchParams({
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
    const report = await call(status);
    assert.equal(report.status, 200);
    const result = await report.text();
    assert.match(result, /project-id/);
    assert.match(result, /"state":"ready"/);
    assert.ok(!result.includes(input.verifier) && !result.includes(input.salt) && !result.includes(input.ownerEmail));
    const audit = await call('/api/v1/teams/' + teamId + '/activity').then((response) => response.text());
    assert.ok(!audit.includes(input.verifier));
  } finally {
    unblock();
    await disposeKernel(app);
  }
});
