import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rollupState, InstanceSchema, type InstanceEnvironmentState } from '../src/persistence.ts';

const row = (environment: string, state: InstanceEnvironmentState['state']): InstanceEnvironmentState =>
  ({ instanceId: 'inst-1', environment, state, updatedAt: '2026-11-11T00:00:00.000Z' });

test('the rollup follows production, because that is what the tenant is measured on', () => {
  assert.equal(rollupState([row('production', 'live'), row('staging', 'degraded')]), 'live');
  assert.equal(rollupState([row('production', 'failed'), row('staging', 'live')]), 'failed');
  assert.equal(rollupState([row('staging', 'degraded'), row('production', 'live')]), 'live', 'order of rows must not change the answer');
});

test('without production, the worst environment wins -- absence is not health', () => {
  assert.equal(rollupState([row('preview', 'live'), row('staging', 'degraded')]), 'degraded');
  assert.equal(rollupState([row('staging', 'pending'), row('preview', 'live')]), 'pending', 'a pending environment outranks a live one');
  assert.equal(rollupState([]), 'pending', 'no rows is pending, never live');
  assert.equal(rollupState([row('staging', 'live'), row('preview', 'live')]), 'live');
  assert.equal(rollupState([row('production', 'removed')]), 'removed', 'a terminal state is reported, not softened');
});

test('the instance name is a slug, and a name that would break downstream is refused at the schema (D45)', () => {
  const base = { id: 'inst-1', teamId: 'team-1', state: 'pending', provider: 'railway', createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z' };
  for (const bad of ['Marketing', 'mar_keting', '-lead', 'trail-', 'has space', 'a'.repeat(81), 'with/slash']) {
    const result = InstanceSchema.safeParse({ ...base, name: bad, template: 'starter-web' });
    assert.equal(result.success, false, `accepted the name "${bad}" -- it would need escaping in a URL, a CLI argument, or a shell`);
  }
  for (const good of ['marketing', 'marketing-2', 'a', 'starter-web-01']) {
    assert.equal(InstanceSchema.safeParse({ ...base, name: good, template: 'starter-web' }).success, true, `refused the valid slug "${good}"`);
  }
});

test('the template origin is pinned by full commit, and the old field name is gone (#180)', () => {
  const valid = { id: 'i', teamId: 't', name: 'svc', template: 'starter-web', templateRef: { repo: 'fractalsynapse/platfolio-starter-web', commitSha: 'a'.repeat(40) }, state: 'pending', provider: 'railway', createdAt: 'x', updatedAt: 'y' };
  assert.equal(InstanceSchema.safeParse(valid).success, true);
  // A tag or branch is not a trust anchor (D30 law 3), so the only accepted shape is a full hex commit.
  for (const sha of ['main', 'v1.2.3', 'a'.repeat(39), 'A'.repeat(40), 'sha256:' + 'a'.repeat(64)]) {
    assert.equal(InstanceSchema.safeParse({ ...valid, templateRef: { repo: 'x/y', commitSha: sha } }).success, false, `accepted templateRef.commitSha="${sha}"`);
  }
  const parsed = InstanceSchema.safeParse({ ...valid, platform: 'legacy-name' });
  assert.equal(parsed.success, false, 'a payload with the old `platform` field must be refused, not silently ignored');
});
