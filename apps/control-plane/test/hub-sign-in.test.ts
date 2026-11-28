import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken, type StoreResult } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { customerLaunch } from '../src/customer-launch.ts';
import { hubProofHeader } from '../src/hub-sign-in.ts';

function value<T>(result: StoreResult<T>): T {
  assert.ok(result.ok);
  return result.value;
}

test('hub sign-in uses explicit trust and links, and a hub outage leaves local owner sign-in independent', async (t) => {
  const local = createIdentityFixture({ kid: 'private-test' });
  const hub = createIdentityFixture({ kid: 'hub-test' });
  const trust = { issuer: 'https://hub-id.example.test/realms/marketplace', clientId: 'private-workspace-fixture' };
  const teamId = 'team-private-fixture';
  let keyRequests = 0;
  let unreachable = false;
  const kernel = await createKernel({
    identity: defaultIdentityConfig(local), identityKeys: [local.jwk], provider: 'fake', store: { driver: 'memory' }, server: { port: 0 },
    extensions: buildCapabilities({
      build: { version: null, commit: '0'.repeat(40), buildTime: new Date(0).toISOString() },
      customerLaunch: customerLaunch({ teamId, siteOrigin: 'https://private.example.test', workerUrl: 'http://127.0.0.1:1',
        workerKey: 'fixture-key-fixture-key-fixture-key' }, fetch),
      hubIdentity: trust,
      hubIdentityFetch: async (input, init) => {
        assert.equal(input, trust.issuer + '/protocol/openid-connect/certs');
        assert.equal(init?.redirect, 'error');
        keyRequests++;
        if (unreachable) throw new Error('isolated upstream outage');
        return Response.json({ keys: [hub.jwk] });
      },
    }),
  });
  t.after(() => disposeKernel(kernel));
  const create = (subject: string) => kernel.store.resolvePerson({ issuer: local.issuer, subject }).then(value);
  const owner = (await create('owner')).person;
  const member = (await create('member')).person;
  const other = (await create('outside')).person;
  value(await kernel.store.seedInstallationTeam({ id: teamId, name: 'workspace', personId: owner.id }));
  value(await kernel.store.putTeamMember({ teamId, personId: member.id, role: 'member' }));
  const localToken = (subject: string) => signToken(local, { subject, scope: 'platfolio.user', email: 'owner@example.test', emailVerified: true });
  const hubToken = (subject: string, audience = trust.clientId, azp = trust.clientId, scope = 'openid platfolio.hub-sign-in') =>
    signToken(hub, { issuer: trust.issuer, audience, subject, scope, email: 'owner@example.test', emailVerified: true, extra: { azp } });
  const call = (path: string, token?: string, method = 'GET', body?: object, proof?: string) =>
    fetch('http://127.0.0.1:' + kernel.server.address.port + '/api/v1' + path, {
      method,
      headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(proof ? { [hubProofHeader]: 'Bearer ' + proof } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const toggle = (token: string, enabled: boolean) => call('/teams/' + teamId + '/hub-sign-in', token, 'PUT', { enabled });
  const subjectLink = '/me/hub-identity';
  const hubMember = hubToken('owner');
  assert.deepEqual(await (await call('/auth/hub')).json(), { enabled: false });
  assert.equal((await call('/me', hubMember)).status, 401);
  assert.equal((await call(subjectLink, localToken('member'), 'PUT', undefined, hubMember)).status, 409);
  assert.equal(keyRequests, 0);
  assert.equal((await toggle(localToken('member'), true)).status, 403);
  assert.equal((await toggle(localToken('owner'), true)).status, 204);
  assert.deepEqual(await (await call('/auth/hub')).json(), { enabled: true, ...trust, scope: 'openid platfolio.hub-sign-in' });

  // Valid dedicated JWT, matching private subject and email, and no link. None creates a person or role.
  assert.equal((await call('/me', hubMember)).status, 401);
  assert.equal((await call('/teams', hubMember, 'POST', { name: 'unapproved' })).status, 401);
  assert.equal((await call(subjectLink, hubMember, 'PUT', undefined, hubMember)).status, 401);
  assert.equal((await call(subjectLink, localToken('outside'), 'PUT', undefined, hubMember)).status, 404);
  assert.equal((await kernel.store.listPersons()).length, 3);
  assert.equal((await kernel.store.getPersonByIdentity(trust.issuer, 'owner')).ok, false);
  for (const wrong of [
    hubToken('owner', 'other-installation'), hubToken('owner', trust.clientId, 'another-client'),
    hubToken('owner', trust.clientId, trust.clientId, 'openid platfolio.user'),
  ]) assert.equal((await call(subjectLink, localToken('member'), 'PUT', undefined, wrong)).status, 403);
  assert.equal((await call(subjectLink, localToken('member'), 'PUT', undefined, hubMember)).status, 204);
  assert.equal((await call(subjectLink, localToken('owner'), 'PUT', undefined, hubMember)).status, 409);
  const account = await call('/me', hubMember);
  assert.equal(account.status, 200);
  assert.equal((await account.json() as { personId: string }).personId, member.id);
  const teams = await (await call('/teams', hubMember)).json() as { teamId: string; role: string }[];
  assert.deepEqual(teams.map(({ teamId: id, role }) => [id, role]), [[teamId, 'member']]);
  assert.equal((await kernel.store.teamsForPerson(other.id)).length, 0);
  assert.equal((await call(subjectLink + '/owner', localToken('owner'), 'DELETE')).status, 204);
  assert.equal((await call('/me', hubMember)).status, 200);

  unreachable = true;
  const observed = keyRequests;
  const localOwner = await call('/me', localToken('owner'));
  assert.equal(localOwner.status, 200);
  assert.equal((await localOwner.json() as { personId: string }).personId, owner.id);
  assert.equal((await toggle(localToken('owner'), false)).status, 204);
  assert.equal((await call('/me', hubMember)).status, 401);
  assert.equal((await call(subjectLink + '/owner', localToken('member'), 'DELETE')).status, 204);
  assert.equal(keyRequests, observed, 'local owner authentication, disabling hub sign-in, and unlinking never request hub keys');
  assert.equal((await toggle(localToken('owner'), true)).status, 204);
  assert.equal((await call('/me', hubMember)).status, 401);
});
