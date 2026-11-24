import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { customerLaunch, customerLaunchConfig } from '../src/customer-launch.ts';

test('customer launch is owner scoped and passes only the intended fields to a private worker', async () => {
  const identity = createIdentityFixture();
  const headers = (subject: string) => ({
    authorization: 'Bearer ' + signToken(identity, { scope: 'platfolio.user', subject }),
    'content-type': 'application/json',
  });
  const worker = 'http://installation-worker.railway.internal:8080';
  const siteOrigin = 'https://private.example.test';
  const workerKey = 'test-fixture-worker-key-for-owner-access';
  let teamId = '';
  let last: { action: string; body?: unknown } | undefined;
  const config = {
    get teamId() { return teamId; },
    siteOrigin, workerKey, workerUrl: worker,
  };
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, worker + '/launch');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + workerKey);
    assert.equal(init?.redirect, 'error');
    last = JSON.parse(String(init?.body)) as typeof last;
    return Response.json(last?.action === 'setup' ? { openBao: 'sealed', railway: 'connect', workerKey: 'public' } : false);
  };
  const kernel = await createKernel({
    identity: defaultIdentityConfig(identity), identityKeys: [identity.jwk], provider: 'fake', custody: 'strict',
    server: { port: 0 }, store: { driver: 'memory' }, requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: 'a'.repeat(40), buildTime: '2026-11-24T00:00:00Z' },
      customerLaunch: {
        ...customerLaunch(config, request),
        get teamId() { return teamId; },
      },
    }),
  });
  try {
    const api = `http://127.0.0.1:${kernel.server.address.port}/api/v1`;
    const created = await fetch(api + '/teams', { method: 'POST', headers: headers('owner'), body: JSON.stringify({ name: 'launch-team' }) });
    assert.equal(created.status, 201);
    teamId = (await created.json() as { teamId: string }).teamId;
    const path = api + '/teams/' + teamId + '/starter-launch';
    assert.equal((await fetch(path + '/setup')).status, 401);
    assert.equal((await fetch(path + '/setup', { headers: headers('other') })).status, 404);
    assert.equal(last, undefined);
    const setup = await fetch(path + '/setup', { headers: headers('owner') });
    assert.equal(setup.status, 200);
    assert.deepEqual(await setup.json(), { openBao: 'sealed', railway: 'connect', workerKey: 'public' });
    const response = await fetch(api + '/railway/callback?state=' + 'a'.repeat(43) + '&code=local-test', { redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), siteOrigin + '/dashboard/launch?railway=retry');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  } finally { await disposeKernel(kernel); }
});

test('a hub or an external worker origin cannot configure customer launch', () => {
  assert.equal(customerLaunchConfig({}, []), undefined);
  const env = {
    PLATFOLIO_LAUNCH_WORKER_URL: 'https://public.example.test',
    PLATFOLIO_LAUNCH_WORKER_KEY: 'x'.repeat(43),
    PLATFOLIO_LAUNCH_TEAM: 'local-team',
  };
  assert.throws(() => customerLaunchConfig(env, ['https://private.example.test']), /private network/);
  assert.throws(() => customerLaunchConfig({ ...env, PLATFOLIO_LAUNCH_WORKER_URL: 'http://worker.railway.internal', PLATFOLIO_MARKETPLACE_ENABLED: 'true' }, ['https://private.example.test']));
});
