import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { RailwayGrant, RailwayOAuthClient } from '../../../scripts/customer-openbao.ts';
import { customerRailwayOAuth } from '../../../scripts/customer-railway-oauth.ts';

const railway = 'https://backboard.railway.com';
const callback = 'https://private-api.example.test/api/v1/railway/callback';
const projectId = 'staging-project';
const workspaceId = 'staging-workspace';
const options = { callback, workspaceId, projectId };

test('a private installation registers its exact callback once, then validates and stores a project grant', async () => {
  let savedClient: RailwayOAuthClient | undefined;
  let savedGrant: RailwayGrant | undefined;
  let registrations = 0;
  let exchanges = 0;
  let challenge = '';
  const vault = {
    async readRailwayClient() { return { version: savedClient ? 1 : 0, grant: savedClient }; },
    async writeRailwayClient(value: RailwayOAuthClient, version: number) {
      assert.equal(version, 0);
      savedClient = value;
    },
    async readGrant() { return { version: savedGrant ? 1 : 0, grant: savedGrant }; },
    async writeGrant(value: RailwayGrant, version: number) {
      assert.equal(version, 0);
      savedGrant = value;
    },
  };
  const request: typeof fetch = async (url, init) => {
    assert.ok(init);
    if (url === railway + '/oauth/register') {
      assert.equal(init.redirect, 'error');
      registrations++;
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.redirect_uris, [callback]);
      assert.equal(body.token_endpoint_auth_method, 'none');
      assert.ok(body.scope.includes('project:admin'));
      assert.ok(!body.scope.includes('workspace:'));
      return Response.json({ client_id: 'new-client', registration_client_uri: railway + '/oauth/register/new-client',
        registration_access_token: 'local-management-token', redirect_uris: [callback], token_endpoint_auth_method: 'none' }, { status: 201 });
    }
    if (url === railway + '/oauth/token') {
      assert.equal(init.redirect, 'error');
      exchanges++;
      const body = new URLSearchParams(String(init.body));
      assert.equal(body.get('client_id'), 'new-client');
      assert.equal(body.get('redirect_uri'), callback);
      assert.equal(createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url'), challenge);
      return Response.json({ access_token: 'local-access', refresh_token: 'local-refresh', expires_in: 3600, scope: 'openid project:admin' });
    }
    assert.equal(url, railway + '/graphql/v2');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-access');
    const { query, variables } = JSON.parse(String(init.body));
    if (query.includes('project(id:')) {
      assert.equal(variables.id, projectId);
      return Response.json({ data: { project: { id: projectId, name: 'starter-web', workspaceId,
        description: 'Platfolio project role app/starter-web', environments: { edges: [{ node: { id: 'staging-id', name: 'staging' } }] } } } });
    }
    assert.deepEqual(variables, { projectId, environmentId: 'staging-id' });
    return Response.json({ data: { environment: { serviceInstances: { edges: [] } } } });
  };
  await customerRailwayOAuth(options, vault, request).begin();
  const restarted = customerRailwayOAuth(options, vault, request);
  const consent = new URL(await restarted.begin());
  assert.equal(consent.origin, railway);
  assert.equal(consent.searchParams.get('redirect_uri'), callback);
  assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(registrations, 1);
  assert.equal(savedClient?.managementToken, 'local-management-token');
  assert.ok(!consent.href.includes('local-management-token'));
  challenge = consent.searchParams.get('code_challenge') ?? '';
  const input = { code: 'one-use-code', state: consent.searchParams.get('state') ?? '', issuer: railway, error: '' };
  assert.equal(await restarted.complete({ ...input, state: 'wrong-state' }), false);
  assert.equal(exchanges, 0);
  assert.equal(await restarted.complete(input), true);
  assert.equal(await restarted.complete(input), false);
  assert.equal(exchanges, 1);
  assert.equal(savedGrant?.refresh, 'local-refresh');
  assert.deepEqual(await restarted.credential(), { token: 'local-access', projectId, workspaceId });
});

test('registration waits for the vault, retries a failed save, and leaves configured clients compatible', async () => {
  let open = false;
  let writes = 0;
  let registrations = 0;
  const vault = {
    async readRailwayClient() {
      if (!open) throw new Error('vault sealed');
      return { version: 0, grant: undefined };
    },
    async writeRailwayClient() { if (++writes === 1) throw new Error('temporary write failure'); },
    async readGrant() { return { version: 0, grant: undefined }; },
    async writeGrant() { throw new Error('unexpected provider grant write'); },
  };
  const request: typeof fetch = async () => {
    registrations++;
    return Response.json({ client_id: 'retry-client', registration_client_uri: railway + '/oauth/register/retry-client',
      registration_access_token: 'local-management-token', redirect_uris: [callback], token_endpoint_auth_method: 'none' }, { status: 201 });
  };
  const legacy = customerRailwayOAuth({ ...options, clientId: 'manual-client' }, vault, request);
  assert.equal(new URL(await legacy.begin()).searchParams.get('client_id'), 'manual-client');
  const oauth = customerRailwayOAuth(options, vault, request);
  await assert.rejects(oauth.begin(), /vault sealed/);
  assert.equal(registrations, 0);
  open = true;
  await assert.rejects(oauth.begin(), /temporary write failure/);
  assert.equal(new URL(await oauth.begin()).searchParams.get('client_id'), 'retry-client');
  assert.equal(registrations, 1);
  assert.equal(writes, 2);
  assert.throws(() => customerRailwayOAuth({ ...options, callback: callback + '?redirect=other' }, vault, request), /exact HTTPS/);
});
