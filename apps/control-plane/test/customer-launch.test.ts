import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { FREE_STARTER_RELEASE, SHARED_IDENTITY_RELEASE, STARTER_WORKER_RELEASE } from '@platfolio/manifest';
import { hostedStarterObservation } from '../src/hosted-starter.ts';
import { buildCapabilities } from '../src/capabilities.ts';
import { customerLaunch, customerLaunchConfig, privateHostingPlugin } from '../src/customer-launch.ts';

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
  const ids = { projectId: randomUUID(), deploymentId: randomUUID() };
  let workerReport: object | false = false;
  let brandOutcome = 'requested';
  const domain = { host: 'preview.example.test', dnsStatus: 'pending', certificateStatus: 'pending', records: [] };
  const config = {
    get teamId() { return teamId; },
    siteOrigin, workerKey, workerUrl: worker,
  };
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, worker + '/launch');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + workerKey);
    assert.equal(init?.redirect, 'error');
    last = JSON.parse(String(init?.body)) as typeof last;
    if (last?.action === 'report') return Response.json(workerReport);
    if (last?.action === 'template-start') {
      const release = (last.body as { template: string }).template === 'starter-worker' ? STARTER_WORKER_RELEASE : SHARED_IDENTITY_RELEASE;
      return Response.json({
        template: release.template, revision: release.revision, state: 'running', events: [], retainedVolumes: [],
      });
    }
    if (last?.action === 'template-restore') return workerReport && 'state' in workerReport && workerReport.state === 'kept'
      ? Response.json({ template: SHARED_IDENTITY_RELEASE.template, revision: SHARED_IDENTITY_RELEASE.revision, state: 'running', events: [], retainedVolumes: [] })
      : Response.json(null, { status: 400 });
    if (last?.action === 'redeploy' || last?.action === 'template-redeploy') {
      const target = last.body as typeof ids;
      if (!workerReport || !('state' in workerReport) || !('projectId' in workerReport) || !('deploymentId' in workerReport) ||
          workerReport.state !== 'ready' || target.projectId !== workerReport.projectId ||
          target.deploymentId !== workerReport.deploymentId) return Response.json(null, { status: 409 });
      return Response.json({ state: 'running' });
    }
    if (last?.action === 'marketplace-status') return Response.json({ state: 'disconnected' });
    if (last?.action === 'marketplace-enroll') return Response.json('enrolled');
    if (last?.action === 'start') return Response.json({ error: 'marketplace-claim-required' }, { status: 409 });
    if (last?.action === 'domains-list') return Response.json({ outcome: 'listed', domains: [domain] });
    if (last?.action === 'domain-attach') return Response.json({ outcome: 'attached', domain });
    if (last?.action === 'domain-detach') return Response.json({ outcome: 'detached' });
    if (last?.action === 'brand-read') return Response.json({ outcome: 'read', configuration: { value: 'Starter', state: 'ready' } });
    if (last?.action === 'brand-apply') return Response.json({ outcome: brandOutcome });
    return Response.json(last?.action === 'setup' ? { openBao: 'sealed', railway: 'connect', workerKey: 'public' } : false);
  };
  const customer = { ...customerLaunch(config, request), get teamId() { return teamId; } };
  const kernel = await createKernel({
    identity: defaultIdentityConfig(identity), identityKeys: [identity.jwk], provider: 'railway', custody: 'strict',
    infrastructure: [privateHostingPlugin(customer)],
    server: { port: 0 }, store: { driver: 'memory' }, requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: 'a'.repeat(40), buildTime: '2026-11-24T00:00:00Z' },
      customerLaunch: customer,
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
    const marketplace = api + '/teams/' + teamId + '/marketplace/connection';
    assert.equal((await fetch(marketplace, { headers: headers('other') })).status, 404);
    const connection = await fetch(marketplace, { headers: headers('owner') });
    assert.equal(connection.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await connection.json(), { state: 'disconnected' });
    const handoff = randomUUID() + ':' + 'c'.repeat(43);
    const connect = (actor: string, input: string) => fetch(marketplace, {
      method: 'POST', headers: headers(actor), body: JSON.stringify({ handoff: input }),
    });
    assert.equal((await connect('other', handoff)).status, 404);
    assert.equal((await connect('owner', 'wrong-format')).status, 400);
    assert.equal((await connect('owner', handoff)).status, 204);
    assert.deepEqual(last, { action: 'marketplace-enroll', body: { handoff } });
    const launch = await fetch(path, { method: 'POST', headers: headers('owner') });
    assert.equal(launch.status, 409);
    assert.deepEqual(await launch.json(), {
      error: 'marketplace-release-unavailable', message: 'Check Marketplace in Connections, then open Choose template and select an available release.',
    });
    const shared = path + '?template=shared-identity';
    assert.equal((await fetch(path + '?template=unknown', { method: 'POST', headers: headers('owner') })).status, 400);
    assert.equal((await fetch(shared + '&template=shared-identity', { headers: headers('owner') })).status, 400);
    assert.equal((await fetch(shared, { method: 'POST', headers: headers('owner') })).status, 400);
    const bootstrap = 'A'.repeat(512);
    const sharedLaunch = (actor: string) => fetch(shared, {
      method: 'POST', headers: headers(actor), body: JSON.stringify({ bootstrap }),
    });
    assert.equal((await sharedLaunch('other')).status, 404);
    assert.equal((await sharedLaunch('owner')).status, 200);
    assert.deepEqual(last, { action: 'template-start', body: { template: 'shared-identity', bootstrap } });
    const worker = path + '?template=starter-worker';
    assert.equal((await fetch(worker, { method: 'POST', headers: headers('other') })).status, 404);
    const selection = { version: '0.1.2', revision: '1'.repeat(40) };
    const launchWorker = await fetch(worker, { method: 'POST', headers: headers('owner'), body: JSON.stringify({ release: selection }) });
    assert.equal(launchWorker.status, 200);
    assert.deepEqual(last, { action: 'template-start', body: { template: 'starter-worker', release: selection } });
    assert.equal((await launchWorker.json() as { origin?: string }).origin, undefined);
    const response = await fetch(api + '/railway/callback?state=' + 'a'.repeat(43) + '&code=local-test', { redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), siteOrigin + '/dashboard/launch?railway=retry');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');

    const managed = await kernel.store.recordHostedStarter({
      ...ids, teamId, name: 'starter-web', template: 'starter-web', state: 'live',
      templateRef: { repo: 'platfolio-fixtures/starter-web', commitSha: 'b'.repeat(40) },
      origin: 'https://starter.up.railway.app', observedAt: '2026-11-24T00:00:00.000Z',
    });
    assert.ok(managed.ok);
    const member = await kernel.store.resolvePerson({ issuer: identity.issuer, subject: 'member' });
    assert.ok(member.ok);
    assert.ok((await kernel.store.putTeamMember({ teamId, personId: member.value.person.id, role: 'member' })).ok);
    const domains = (environment: string) => api + '/instances/' + managed.value.id + '/environments/' + environment + '/custom-domains';
    const read = (actor: string) => fetch(domains('staging'), { headers: headers(actor) });
    const change = (hostname: string, actor: string, method = 'PUT', environment = 'staging') =>
      fetch(domains(environment) + '/' + encodeURIComponent(hostname), { method, headers: headers(actor) });
    assert.equal((await read('other')).status, 404);
    assert.deepEqual(await (await read('member')).json(), [domain]);
    assert.equal((await change(domain.host, 'member')).status, 403);
    assert.equal((await change(domain.host, 'owner', 'PUT', 'production')).status, 404);
    assert.equal((await change('https://invalid.example.test', 'owner')).status, 400);
    assert.equal((await change('auto.up.railway.app', 'owner', 'DELETE')).status, 400);
    assert.equal((await change(domain.host.toUpperCase(), 'owner')).status, 200);
    assert.deepEqual(last, { action: 'domain-attach', body: { ...ids, hostname: domain.host } });
    assert.equal((await change(domain.host, 'owner', 'DELETE')).status, 204);
    assert.deepEqual(last, { action: 'domain-detach', body: { ...ids, hostname: domain.host } });
    const brand = (environment: string) => api + '/instances/' + managed.value.id + '/environments/' + environment + '/configuration/starter-brand';
    const readBrand = (actor: string) => fetch(brand('staging'), { headers: headers(actor) });
    const changeBrand = (body: object, actor = 'owner', environment = 'staging') =>
      fetch(brand(environment), { method: 'PUT', headers: headers(actor), body: JSON.stringify(body) });
    assert.equal((await readBrand('other')).status, 404);
    assert.deepEqual(await (await readBrand('member')).json(), { value: 'Starter', state: 'ready' });
    assert.deepEqual(last, { action: 'brand-read', body: ids });
    assert.equal((await changeBrand({ value: 'Team app' }, 'member')).status, 403);
    assert.equal((await changeBrand({ value: 'Team app' }, 'owner', 'production')).status, 404);
    assert.equal((await changeBrand({ value: 'Hello <world>' })).status, 400);
    assert.equal((await changeBrand({ value: 'Hello\n' })).status, 400);
    assert.equal((await changeBrand({ value: 'Team app', key: 'DATABASE_URL' })).status, 400);
    assert.deepEqual(last, { action: 'brand-read', body: ids });
    const brandChanged = await changeBrand({ value: 'Team app' });
    assert.equal(brandChanged.status, 202);
    assert.deepEqual(await brandChanged.json(), { state: 'requested' });
    assert.deepEqual(last, { action: 'brand-apply', body: { ...ids, value: 'Team app' } });
    const audit = await kernel.store.recentAuditForTargets([managed.value.id], 15);
    assert.deepEqual(audit.find(({ action }) => action === 'configuration.request')?.detail, { name: 'UI_BRAND', environment: 'staging' });
    brandOutcome = 'conflict';
    assert.equal((await changeBrand({ value: 'Another label' })).status, 409);
    const deploy = (environment: string, actor = 'owner', instanceId = managed.value.id) =>
      fetch(api + '/instances/' + instanceId + '/environments/' + environment + '/deployments', { method: 'POST', headers: headers(actor) });
    assert.equal((await deploy('staging', 'other')).status, 404);
    assert.equal((await deploy('production')).status, 404);
    workerReport = { ...ids, state: 'removing' };
    assert.equal((await deploy('staging')).status, 409);
    workerReport = { ...ids, state: 'ready' };
    const deployed = await deploy('staging');
    assert.equal(deployed.status, 202);
    assert.deepEqual(await deployed.json(), { state: 'requested' });
    assert.deepEqual(last, { action: 'redeploy', body: ids });

    const identityIds = { projectId: randomUUID(), deploymentId: randomUUID() };
    const installedIdentity = await kernel.store.recordHostedStarter({
      ...identityIds, teamId, name: 'shared-identity', template: 'shared-identity', state: 'live',
      templateRef: { repo: 'platfolio-fixtures/shared-identity', commitSha: SHARED_IDENTITY_RELEASE.revision },
      origin: 'https://identity.example.test', observedAt: '2026-11-24T00:00:00.000Z',
    });
    assert.ok(installedIdentity.ok);
    assert.equal((await deploy('staging', 'member', installedIdentity.value.id)).status, 403);
    assert.equal((await deploy('staging', 'other', installedIdentity.value.id)).status, 404);
    assert.equal((await deploy('staging', 'owner', installedIdentity.value.id)).status, 409);
    workerReport = { ...identityIds, state: 'ready' };
    const redeployedIdentity = await deploy('staging', 'owner', installedIdentity.value.id);
    assert.equal(redeployedIdentity.status, 202);
    assert.deepEqual(await redeployedIdentity.json(), { state: 'requested' });
    assert.deepEqual(last, { action: 'template-redeploy', body: { template: 'shared-identity', ...identityIds } });
    workerReport = { ...identityIds, state: 'kept' };
    assert.equal((await deploy('staging', 'owner', installedIdentity.value.id)).status, 409);
    const restoredIdentity = await fetch(shared, { method: 'POST', headers: headers('owner') });
    assert.equal(restoredIdentity.status, 200);
    assert.deepEqual(last, { action: 'template-restore', body: { template: 'shared-identity' } });

    const at = '2026-11-24T00:00:00.000Z';
    const receipt = {
      state: 'wiped', template: FREE_STARTER_RELEASE.template, revision: FREE_STARTER_RELEASE.revision, retainedVolumes: [],
      events: [{ at, step: 'Remove and wipe data', state: 'WORKING', resourceId: ids.projectId },
        { at, step: 'Removal complete', state: 'READY' }],
    };
    const readLaunch = () => fetch(path, { headers: headers('owner') });
    workerReport = receipt;
    const removed = await readLaunch();
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { ...receipt, removedProjectId: ids.projectId });
    workerReport = { ...receipt, events: receipt.events.slice(0, 1), removedProjectId: ids.projectId };
    const unverified = await readLaunch();
    assert.equal(unverified.status, 200);
    assert.deepEqual(await unverified.json(), { ...receipt, events: receipt.events.slice(0, 1) });
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


test('a private worker can be recorded ready only with verified deployment coordinates and no public address', () => {
  const team = 'team-1';
  const projectId = randomUUID();
  const deploymentId = randomUUID();
  const report = {
    template: STARTER_WORKER_RELEASE.template, revision: STARTER_WORKER_RELEASE.revision,
    state: 'ready', projectId, deploymentId,
    events: [{ step: 'Worker is ready', state: 'READY', at: '2026-11-26T15:00:00Z' }],
  };
  const observed = hostedStarterObservation(team, report);
  assert.equal(observed?.state, 'live');
  assert.equal(observed?.projectId, projectId);
  assert.equal(observed?.state === 'live' && observed.deploymentId, deploymentId);
  assert.equal(hostedStarterObservation(team, { ...report, origin: 'https://worker.up.railway.app' }), undefined);
  assert.equal(hostedStarterObservation(team, { ...report, deploymentId: undefined }), undefined);
  assert.equal(hostedStarterObservation(team, { ...report, template: FREE_STARTER_RELEASE.template, revision: FREE_STARTER_RELEASE.revision }), undefined);
});
