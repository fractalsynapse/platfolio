import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InfraService, ProviderConfigSchema, createKernel, disposeKernel } from '../src/index.ts';
import { samplePlan } from '@platfolio/contracts';

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

test('the railway selection yields the incomplete implementation, visibly', async () => {
  const ctx = await createKernel({ provider: 'railway' });
  try {
    const info = ctx.infra.describe();
    assert.equal(info.provider, 'railway');
    assert.ok(!info.operations.includes('applyPlan'), 'must not advertise an unimplemented operation');
    await assert.rejects(() => ctx.infra.applyPlan(samplePlan()), /not implemented/);
  } finally {
    await disposeKernel(ctx);
  }
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
