import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken } from '@platfolio/contracts';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { OPERATOR_DISPLAY_NAME_ATTRIBUTE } from '../src/account-profile.ts';

test('profile edits use the caller’s own issuer credential and preserve their verified email', async () => {
  const fixture = createIdentityFixture();
  const bearer = signToken(fixture, { scope: 'platfolio.user', subject: 'account-owner' });
  const issuer = fixture.issuer;
  const previous = { username: 'owner', firstName: 'Given', lastName: 'Family', email: 'owner@example.test', emailVerified: true };
  let profile = { ...previous };
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    const endpoint = new URL(url as URL);
    assert.equal(endpoint.href.split('?')[0], issuer + '/account/');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${bearer}`);
    if (init?.method === 'GET') return Response.json(profile);
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.email, previous.email);
    assert.equal(body.firstName, previous.firstName);
    assert.deepEqual(body.attributes, { [OPERATOR_DISPLAY_NAME_ATTRIBUTE]: ['Operator'] });
    profile = { ...profile, ...body };
    return new Response(null, { status: 204 });
  };
  const context: KernelContext = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    requiredServices: ['identity', 'server', 'store', 'extensions'],
    extensions: buildCapabilities({
      build: { version: null, commit: 'a'.repeat(40), buildTime: '2026-11-24T00:00:00Z' },
      accountIssuer: { issuer, request },
    }),
  });
  try {
    const api = `http://127.0.0.1:${context.server.address.port}/api/v1/me/profile`;
    const headers = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' };
    assert.equal((await fetch(api)).status, 401);
    assert.equal((await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ username: 'updated', displayName: 'Operator', personId: 'other' }) })).status, 400);
    assert.equal(calls, 0);
    const result = await fetch(api, { method: 'PUT', headers, body: JSON.stringify({ username: 'updated', displayName: 'Operator' }) });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), { username: 'updated', displayName: 'Operator', email: previous.email, emailVerified: true });
    assert.equal(calls, 3);
  } finally {
    await disposeKernel(context);
  }
});
