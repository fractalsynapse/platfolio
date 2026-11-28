import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';
import { installationBootstrap } from '../src/installation-bootstrap.ts';
import { installationOwnerHash } from '../../../packages/ui/src/web/installation-owner-policy.ts';

test('a hub owner can recover a distinct Keycloak-compatible temporary password for each environment', async () => {
  const key = 'test-key-'.repeat(5);
  const installation = { id: '9a6ed315-b24e-4204-bdb5-e89fe355933e', teamId: 'team-private', personId: 'person-owner' };
  const hub = installationBootstrap(key);
  const staging = hub.password(installation, 'staging');
  assert.match(staging, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(installationBootstrap(key).password(installation, 'staging'), staging);
  assert.notEqual(hub.password(installation, 'production'), staging);
  assert.notEqual(hub.password({ ...installation, personId: 'person-another' }, 'staging'), staging);
  const { verifier, salt } = await hub.verifier(installation, 'staging');
  assert.equal(verifier, pbkdf2Sync(staging, Buffer.from(salt, 'base64'), installationOwnerHash.iterations,
    installationOwnerHash.bits / 8, 'sha256').toString('base64'));
});
