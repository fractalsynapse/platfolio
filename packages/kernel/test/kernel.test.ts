import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfraService, ProviderConfigSchema, createKernel, disposeKernel } from '../src/index.ts';
import { samplePlan, RailwayMock } from './test-helpers.ts';

test('capability resolves by name, not by import at the call site', async () => {
  const ctx = await createKernel({ provider: 'fake' });
  try {
    assert.ok(ctx.infra instanceof InfraService, 'ctx.infra must be the registered capability');
    assert.equal(ctx.infra.describe().provider, 'fake');
    const plan = samplePlan();
    assert.deepEqual(ctx.infra.validatePlan(plan), [], 'sample plan validates through the kernel');
    const applied = await ctx.infra.applyPlan(plan);
    assert.ok(applied.verified);
  } finally {
    await disposeKernel(ctx);
  }
});

test('the railway selection refuses to boot without wiring, then works with it', async () => {
  // Booting the real provider without a workspace and credential source must fail at composition,
  // not during a tenant's first apply.
  await assert.rejects(() => createKernel({ provider: 'railway' }), /requires options.railway/);

  const mock = new RailwayMock();
  const ctx = await createKernel({ provider: 'railway', railway: { workspaceId: 'ws-1', credentials: mock, transport: mock } });
  try {
    const info = ctx.infra.describe();
    assert.equal(info.provider, 'railway');
    assert.ok(info.operations.includes('applyPlan'), 'the wired provider does implement it now');
    // The wired provider reaches the real implementation: the reference plan needs databases and
    // buckets, which Railway's provider does not implement, so the apply must say so rather than pass.
    const applied = await ctx.infra.applyPlan(samplePlan());
    assert.equal(applied.verified, false, 'an instance missing its database is not verified');
    assert.ok(applied.failures.some((f) => f.code === 'unsupported-resource'), JSON.stringify(applied.failures.map((f) => f.code)));
  } finally {
    await disposeKernel(ctx);
  }
});

test('an unwired railway provider fails loudly rather than pretending', async () => {
  const ctx = await createKernel({ provider: 'fake' });
  await disposeKernel(ctx);
});

test('an unsatisfiable contract range refuses to boot', async () => {
  await assert.rejects(() => createKernel({ provider: 'fake', contract: '^9.0.0' }), /does not satisfy required range/);
});

test('a bad provider config is refused by the schema, not coerced', () => {
  assert.throws(() => ProviderConfigSchema.parse({ provider: 'heroku' }), /invalid|expected/i);
  assert.throws(() => ProviderConfigSchema.parse({ provider: 'fake', unexpected: 1 }), /unrecognized|unexpected/i);
});

test('disposal is complete: the capability is gone after teardown', async () => {
  const ctx = await createKernel({ provider: 'fake' });
  await disposeKernel(ctx);
  assert.throws(() => ctx.infra.describe(), /.*/, 'capability must be gone after teardown');
});

test('custody mode is configuration, and strict refuses to hold a grant', async () => {
  const strict = await createKernel({ custody: 'strict' });
  try {
    assert.equal(strict.custody.mode, 'strict');
    assert.equal(strict.custody.broker.audit('t1').length, 0);
    await assert.rejects(() => strict.custody.broker.grant({ tenantId: 't1', kind: 'oauth', workspaceId: 'w1', token: 'a-sentinel-value' }, 'tester'), /stores no provider credential/);
  } finally { await disposeKernel(strict); }

  const managed = await createKernel({ custody: 'managed' });
  try {
    assert.equal(managed.custody.mode, 'managed');
    const receipt = await managed.custody.broker.grant({ tenantId: 't1', kind: 'workspace-token', workspaceId: 'w1', token: 'a-sentinel-value' }, 'tester');
    assert.ok(!JSON.stringify(receipt).includes('a-sentinel-value'), 'the receipt must not echo the credential');
    await assert.rejects(() => managed.custody.broker.call('t1', 'variables', {}, 'tester'), /cannot read tenant secrets/);
  } finally { await disposeKernel(managed); }
});

test('delivery writes to the provider and nowhere else, through the kernel', async () => {
  const written: string[] = [];
  const logged: string[] = [];
  const ctx = await createKernel({
    custody: 'managed',
    ports: {
      variable: { supportsSealing: () => true, upsert: async (i) => { written.push(`${i.name}=${i.value}:sealed=${i.sealed}`); } },
      sinks: { log: (l) => logged.push(...l), record: () => {} },
    },
  });
  try {
    const receipt = await ctx.custody.deliverSecret(
      { instanceId: 'i1', tenantId: 't1', environment: 'production', service: 'api', name: 'OIDC_CLIENT_SECRET' },
      'sentinel-do-not-log');
    assert.equal(written.length, 1, 'exactly one provider write');
    assert.match(written[0]!, /sealed=true/);
    assert.ok(!JSON.stringify(receipt).includes('sentinel-do-not-log'), 'receipt clean');
    assert.ok(!logged.some((l) => l.includes('sentinel-do-not-log')), `log leaked: ${logged.join(' | ')}`);
  } finally { await disposeKernel(ctx); }
});

test('an unattached port degrades sealing visibly and fails loudly on a write', async () => {
  const ctx = await createKernel({ custody: 'managed' });
  const target = { instanceId: 'i1', tenantId: 't1', environment: 'production', service: 'api', name: 'OIDC_CLIENT_SECRET' };
  // relay-sealed cannot prove sealing, so it must refuse the write and say why -- not swallow it.
  const degraded = await ctx.custody.deliverSecret(target, 'v', 'relay-sealed');
  assert.equal(degraded.mode, 'tenant-side', JSON.stringify(degraded));
  assert.match(degraded.degraded ?? '', /refusing to write an unsealed secret/);
  // A mode that does write must hit the unattached port's loud error.
  await assert.rejects(() => ctx.custody.deliverSecret(target, 'v', 'relay-plain'), /no provider variable port/);
  await disposeKernel(ctx);
});
