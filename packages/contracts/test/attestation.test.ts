import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttestationSchema, deriveNonce, verifyAttestation, type Attestation, type DispatchIntent, type RunnerClaims, type VerificationContext } from '../src/attestation.ts';

const NOW = Date.parse('2026-11-08T12:00:00.000Z');

function base(over: { dispatch?: Partial<DispatchIntent>; attestation?: Partial<Attestation>; claims?: Partial<RunnerClaims>; instance?: Partial<VerificationContext['instance']>; usedNonces?: VerificationContext['usedNonces'] } = {}) {
  const dispatch: DispatchIntent = {
    instanceId: 'inst-01', teamId: 'team-01', dispatchId: 'disp-01',
    nonce: deriveNonce('disp-01', 'server-secret'), planHash: 'a'.repeat(16),
    action: 'apply', environment: 'staging',
    issuedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 600_000).toISOString(),
    ...over.dispatch,
  };
  const attestation: Attestation = {
    dispatchId: 'disp-01', nonce: dispatch.nonce, planHash: dispatch.planHash, instanceId: 'inst-01',
    environment: 'staging', action: 'apply', result: 'ok',
    resources: [{ kind: 'service', name: 'api', externalId: 'svc-1', status: 'live' }],
    durationMs: 1200, finishedAt: new Date(NOW).toISOString(),
    ...over.attestation,
  };
  const claims: RunnerClaims = {
    iss: 'https://token.actions.githubusercontent.com', aud: 'https://platfolio.example', sub: 'repo:acme/web:environment:staging',
    repository: 'acme/web', repository_owner: 'acme', run_id: '1', ref: 'refs/heads/staging', environment: 'staging',
    ...over.claims,
  };
  const store = new Set<string>();
  const ctx: VerificationContext = {
    expectedAudience: 'https://platfolio.example', expectedIssuer: 'https://token.actions.githubusercontent.com',
    expectedRepository: 'acme/web',
    instance: { teamId: 'team-01', repoFullName: 'acme/web', environments: ['production', 'staging'] },
    dispatch, usedNonces: over.usedNonces ?? { has: (n) => store.has(n), add: (n) => store.add(n) },
    nowMs: NOW,
  };
  return { dispatch, attestation, claims, ctx };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

test('a well-formed attestation from the right runner is accepted', () => {
  const { attestation, claims, ctx } = base();
  assert.deepEqual(verifyAttestation(attestation, claims, ctx), []);
});

test('a replayed nonce is rejected', () => {
  const { attestation, claims, ctx } = base();
  assert.deepEqual(verifyAttestation(attestation, claims, ctx), []);
  const second = verifyAttestation({ ...attestation }, { ...claims }, ctx);
  assert.ok(codes(second).includes('nonce-replayed'), JSON.stringify(second));
});

test('a malformed payload does not burn the nonce', () => {
  const { attestation, claims, ctx } = base();
  const bad = { ...attestation, finishedAt: undefined };
  assert.ok(codes(verifyAttestation(bad, claims, ctx)).includes('attestation-schema'));
  assert.deepEqual(verifyAttestation({ ...attestation }, { ...claims }, ctx), [], 'the legitimate attempt must still succeed');
});

for (const [name, patch, code] of [
  ['wrong audience', { claims: { aud: 'https://somewhere-else' } }, 'audience'],
  ['wrong issuer', { claims: { iss: 'https://evil' } }, 'issuer'],
  ['another repository', { claims: { repository: 'victim/app' } }, 'repository'],
  ['unknown dispatch', { attestation: { dispatchId: 'disp-99' } }, 'dispatch-unknown'],
  ['other instance', { attestation: { instanceId: 'inst-99' } }, 'instance-mismatch'],
  ['action substitution', { attestation: { action: 'suspend' } }, 'action-mismatch'],
  ['stale plan hash', { attestation: { planHash: 'b'.repeat(16) } }, 'plan-hash-mismatch'],
  ['nonce substitution', { attestation: { nonce: 'f'.repeat(32) } }, 'nonce-mismatch'],
  ['environment not on the instance', { attestation: { environment: 'qa' } }, 'unknown-environment'],
  ['environment differs from dispatch', { attestation: { environment: 'production', dispatchId: 'disp-01' } }, 'environment-mismatch'],
  ['unexpired dispatch window', { dispatch: { expiresAt: new Date(NOW - 1).toISOString() } }, 'dispatch-expired'],
  ['time travel', { attestation: { finishedAt: new Date(NOW - 99_000_000).toISOString() } }, 'time-travel'],
  ['failed without error code', { attestation: { result: 'failed' } }, 'attestation-schema'],
  ['ok apply with no resources', { attestation: { resources: [] } }, 'attestation-schema'],
] as const) {
  test(`rejects: ${name}`, () => {
    const { attestation, claims, ctx } = base(patch as never);
    const issues = verifyAttestation(attestation, claims, ctx);
    assert.ok(codes(issues).includes(code), `expected ${code}, got ${JSON.stringify(codes(issues))}`);
  });
}

test('a production attestation must come from the protected environment', () => {
  const { attestation, claims, ctx } = base({
    dispatch: { environment: 'production' },
    attestation: { environment: 'production' },
    claims: { environment: undefined, sub: 'repo:acme/web:ref:refs/heads/main' },
  });
  assert.ok(codes(verifyAttestation(attestation, claims, ctx)).includes('production-ungated'));

  const ok = base({ dispatch: { environment: 'production' }, attestation: { environment: 'production' }, claims: { environment: 'production' } });
  assert.deepEqual(verifyAttestation(ok.attestation, ok.claims, ok.ctx), []);
});

test('an unknown key is refused outright, so no secret value can ride along', () => {
  const { attestation, claims, ctx } = base();
  const smuggled = { ...attestation, clientSecret: 'super-secret-value' };
  const issues = verifyAttestation(smuggled, claims, ctx);
  assert.ok(codes(issues).includes('attestation-schema'), JSON.stringify(issues));
  assert.ok(issues.some((i) => 'message' in i && String(i.message).includes('clientSecret')), 'the report should name the offending key');
});

test('no loggable field of a valid attestation contains a value-shaped secret', () => {
  const { attestation } = base();
  const text = JSON.stringify(attestation);
  assert.ok(!/(secret|token|password|key)"\s*:\s*"/i.test(text), text);
  assert.ok(AttestationSchema.safeParse(attestation).success);
});

test('derived nonces are stable, long, and dispatch-specific', () => {
  const a = deriveNonce('disp-01', 'server-secret');
  assert.equal(a, deriveNonce('disp-01', 'server-secret'));
  assert.notEqual(a, deriveNonce('disp-02', 'server-secret'));
  assert.notEqual(a, deriveNonce('disp-01', 'other-secret'));
  assert.equal(a.length, 32);
});
