import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENIED_OPERATIONS, ManagedCredentialBroker, StrictCredentialBroker, RelaySecretDelivery, runBrokerConformance, runDeliveryConformance, type VariablePort, type RedactionSinks } from '../src/index.ts';

const SENTINEL = 'sup3r-s3cret-sentinel-value';

test('managed custody passes the conformance suite', async () => {
  const { checks, ok } = await runBrokerConformance(() => new ManagedCredentialBroker(), SENTINEL);
  assert.ok(ok, checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('\n'));
  assert.ok(checks.length >= 8, `expected a real suite, got ${checks.length} checks`);
});

test('strict custody holds nothing and is held to the same standard', async () => {
  const { checks, ok } = await runBrokerConformance(() => new StrictCredentialBroker(), SENTINEL);
  assert.ok(ok, checks.map((c) => `${c.name}: ${c.detail}`).join('\n'));
  assert.deepEqual(checks.map((c) => c.name), ['strict mode accepts no grant', 'strict mode audits nothing']);
});

test('every secret-reading operation is refused before the transport sees it', async () => {
  const reached: string[] = [];
  const broker = new ManagedCredentialBroker(async (_t, op) => { reached.push(op); return {}; });
  await broker.grant({ tenantId: 't1', kind: 'oauth', workspaceId: 'w1', token: SENTINEL }, 'tester');
  for (const op of DENIED_OPERATIONS) {
    await assert.rejects(() => broker.call('t1', op, {}, 'tester'), /denied/, `${op} should be denied`);
  }
  assert.deepEqual(reached, [], 'a denied operation must never reach the provider');
  assert.deepEqual(broker.audit('t1').filter((e) => e.outcome === 'refused').length, DENIED_OPERATIONS.length);
});

test('a grant that is revoked stops working, and the refusal is auditable', async () => {
  const broker = new ManagedCredentialBroker(async () => ({}));
  await broker.grant({ tenantId: 't1', kind: 'workspace-token', workspaceId: 'w1', token: SENTINEL }, 'tester');
  await broker.call('t1', 'projectDescribe', {}, 'tester');
  await broker.revoke('t1', 'tester');
  await assert.rejects(() => broker.call('t1', 'projectDescribe', {}, 'tester'), /no credential grant/);
  const outcomes = broker.audit('t1').map((e) => `${e.operation}:${e.outcome}`);
  assert.ok(outcomes.includes('revoke:ok'), outcomes.join(', '));
});

test('relay-sealed delivery passes the conformance suite', async () => {
  const { checks, ok } = await runDeliveryConformance((port, sinks) => new RelaySecretDelivery(port, sinks), SENTINEL);
  assert.ok(ok, checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('\n'));
  assert.ok(checks.length >= 10, `expected a real suite, got ${checks.length} checks`);
});

test('a real delivery leaves the value in exactly one place: the provider', async () => {
  const written: { name: string; value: string; sealed: boolean }[] = [];
  const log: string[] = [];
  const surfaces: Record<string, string[]> = {};
  const port: VariablePort = {
    upsert: async (i) => { written.push({ name: i.name, value: i.value, sealed: i.sealed }); },
    supportsSealing: () => true,
    entryLink: (i) => `https://provider.example/instances/${i.instanceId}/variables#${i.name}`,
  };
  const sinks: RedactionSinks = {
    log: (lines) => log.push(...lines),
    record: (surface, text) => { (surfaces[surface] ??= []).push(text); },
  };
  const receipt = await new RelaySecretDelivery(port, sinks).deliver(
    { instanceId: 'i1', tenantId: 't1', environment: 'production', service: 'api', name: 'OIDC_CLIENT_SECRET' },
    SENTINEL, 'relay-sealed');

  assert.equal(written.length, 1, 'one write');
  assert.equal(written[0]!.value, SENTINEL, 'the provider must receive the value');
  assert.equal(written[0]!.sealed, true, 'and it must be sealed');
  assert.equal(receipt.sealed, true);
  assert.ok(!JSON.stringify(receipt).includes(SENTINEL), 'receipt must not echo the value');
  assert.ok(!log.some((l) => l.includes(SENTINEL)), `log leaked: ${log.join(' | ')}`);
  for (const [surface, entries] of Object.entries(surfaces)) {
    assert.ok(!entries.some((e) => e.includes(SENTINEL)), `${surface} leaked`);
  }
});

test('an unsupported seal is a visible refusal, never a silent unsealed write', async () => {
  const written: string[] = [];
  const port: VariablePort = { upsert: async (i) => { written.push(i.value); }, supportsSealing: () => false, entryLink: () => 'https://provider.example/x' };
  const receipt = await new RelaySecretDelivery(port).deliver(
    { instanceId: 'i1', tenantId: 't1', environment: 'production', service: 'api', name: 'KC_BOOTSTRAP' }, SENTINEL, 'relay-sealed');
  assert.deepEqual(written, [], 'nothing may be written unsealed');
  assert.equal(receipt.mode, 'tenant-side');
  assert.match(receipt.degraded ?? '', /refusing to write an unsealed secret/);
});

test('a value-bearing error message cannot escape through the receipt', async () => {
  const port: VariablePort = {
    supportsSealing: () => true,
    upsert: async () => { throw new Error(`provider rejected value ${SENTINEL}`); },
  };
  const delivery = new RelaySecretDelivery(port, { log: () => {}, record: () => {} });
  // The provider's own message may contain the value; platfolio must not turn that into a receipt.
  await assert.rejects(() => delivery.deliver(
    { instanceId: 'i1', tenantId: 't1', environment: 'production', service: 'api', name: 'OIDC_CLIENT_SECRET' }, SENTINEL, 'relay-sealed'));
});
