import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { FREE_STARTER_RELEASE, templateCatalogEntry } from '@platfolio/manifest';
import { customerMarketplaceConnection, privateMarketplaceOrigin } from '../../../scripts/customer-marketplace-connection.ts';
import type { MarketplaceGrant } from '../../../scripts/customer-openbao.ts';

test('the worker keeps a scoped registry credential in its vault and retains the claimed release after revocation', async () => {
  const hub = 'https://registry.example.test';
  const installationId = randomUUID();
  const code = randomBytes(32).toString('base64url');
  let digest = '';
  let sealed = true;
  let incompleteResponse = true;
  let grant: MarketplaceGrant | undefined;
  let version = 0;
  const bao = {
    status: async () => sealed ? 'sealed' as const : 'ready' as const,
    readMarketplaceGrant: async () => ({ grant, version }),
    writeMarketplaceGrant: async (next: MarketplaceGrant, expectedVersion: number) => {
      assert.equal(expectedVersion, version);
      grant = next;
      version += 1;
    },
  };
  const request: typeof fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(target.origin, hub);
    assert.equal(init?.redirect, 'error');
    const authorization = new Headers(init?.headers).get('authorization');
    if (target.pathname === `/api/v1/marketplace/installations/${installationId}/enrollment`) {
      assert.equal(authorization, 'Bearer ' + code);
      assert.ok(grant);
      digest = createHash('sha256').update(grant.credential).digest('hex');
      assert.deepEqual(JSON.parse(String(init?.body)), { registryDigest: digest });
      if (incompleteResponse) {
        incompleteResponse = false;
        throw new Error('Connection interrupted after enrollment');
      }
      assert.fail('The worker should recover using its saved registry credential');
    }
    assert.equal(target.pathname, `/api/v1/marketplace/installations/${installationId}/claim`);
    assert.equal(authorization, 'Bearer ' + grant?.credential);
    if (!digest) return new Response(null, { status: 404 });
    return Response.json({ ...FREE_STARTER_RELEASE, installationId, repo: templateCatalogEntry(FREE_STARTER_RELEASE.template).repo });
  };
  const handoff = installationId + ':' + code;
  const first = customerMarketplaceConnection(hub, bao, request);
  assert.deepEqual(await first.connection(), { state: 'openbao-required' });
  assert.equal(await first.enroll(handoff), 'unavailable');
  sealed = false;
  assert.deepEqual(await first.connection(), { state: 'disconnected' });
  assert.equal(await first.enroll(handoff), 'unavailable');
  const restarted = customerMarketplaceConnection(hub, bao, request);
  assert.equal(await restarted.enroll(handoff), 'enrolled');
  assert.equal(grant?.claimed, true);
  const { template, revision, version: releaseVersion } = FREE_STARTER_RELEASE;
  const release = { template, revision, version: releaseVersion };
  assert.deepEqual(await restarted.connection(), { state: 'connected', release });
  assert.equal(await restarted.enroll(randomUUID() + ':' + code), 'refused');
  const unavailable = customerMarketplaceConnection(hub, bao, async () => { throw new Error('Hub offline'); });
  assert.deepEqual(await unavailable.connection(), { state: 'unavailable', release });
  assert.deepEqual(await customerMarketplaceConnection('https://different.example.test', bao, request).connection(), { state: 'unavailable', release });
  digest = '';
  assert.deepEqual(await restarted.connection(), { state: 'disconnected', release });
  assert.throws(() => privateMarketplaceOrigin('http://registry.example.test'), /HTTPS/);
  assert.throws(() => privateMarketplaceOrigin(hub + '/handoff'), /HTTPS/);
});
