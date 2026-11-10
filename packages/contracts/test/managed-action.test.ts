import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AttestationSchema, DispatchIntentSchema, assertAttestationClean, attestationFromApply, containsCredentialShapedText,
  normalizeHash, staleIntent,
  type ApplyResult, type Attestation, type DispatchIntent,
} from '../src/index.ts';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const RELEASE: Attestation['release'] = { version: '0.4.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` };
const intent: DispatchIntent = DispatchIntentSchema.parse({
  instanceId: 'inst-1', teamId: 'team-1', dispatchId: 'disp-1', nonce: 'n'.repeat(16), planHash: HASH,
  action: 'apply', environment: 'production', issuedAt: '2026-11-10T00:00:00Z', expiresAt: '2026-11-10T00:30:00Z',
});
const apply = (over: Partial<ApplyResult> = {}): ApplyResult => ({
  instanceId: 'inst-1', planHash: HASH, verified: true, failures: [], notes: [],
  services: [{ name: 'api', status: 'live', environment: 'production', replicas: 1, rawStatus: 'SUCCESS', lastDeploy: { status: 'SUCCESS', image: 'x' } }],
  domains: [],
  ...over,
} as ApplyResult);

test('a matching hash is not a refusal, and a stale one refuses with both hashes named', () => {
  const ok = staleIntent({ intent, fetchedPlanHash: `sha256:${HASH}`, release: RELEASE, finishedAt: intent.expiresAt });
  assert.equal(ok, undefined, 'the sha256: prefix is GitHub/Railway spelling, not a different digest');
  const refusal = staleIntent({ intent, fetchedPlanHash: OTHER, release: RELEASE, finishedAt: intent.expiresAt });
  assert.equal(refusal?.result, 'failed');
  assert.match(String(refusal?.errorCode), /stale-plan-hash:requested-aaaaaaaaaaaa-found-bbbbbbbbbbbb/);
  assert.deepEqual(refusal?.resources, [], 'a refusal touched nothing');
});

test('applied, partial and failed stay distinct -- the reason this module exists', () => {
  const clean = attestationFromApply({ intent, appliedPlanHash: HASH, result: apply(), release: RELEASE, durationMs: 1000, finishedAt: intent.expiresAt });
  assert.equal(clean.result, 'ok');
  assert.equal(clean.errorCode, undefined);

  const failure = { step: 'services.production.worker', code: 'deploy-timeout', message: 'deploy did not settle in 300s' };
  const partial = attestationFromApply({
    intent, appliedPlanHash: HASH, release: RELEASE, durationMs: 2000, finishedAt: intent.expiresAt,
    result: apply({ failures: [failure] }),
  });
  assert.equal(partial.result, 'partial', 'api landed AND something failed');
  assert.match(String(partial.errorCode), /deploy-timeout@services\.production\.worker/);

  const failed = attestationFromApply({
    intent, appliedPlanHash: HASH, release: RELEASE, durationMs: 2000, finishedAt: intent.expiresAt,
    result: apply({ failures: [failure], services: [{ name: 'api', status: 'failed', environment: 'production', replicas: 0, rawStatus: 'CRASHED' } as never], verified: false }),
  });
  assert.equal(failed.result, 'failed', 'nothing landed');
  assert.notEqual(partial.result, failed.result, 'collapsing these discards or invents work');
});

test('an empty successful apply is noop, not ok', () => {
  const noop = attestationFromApply({
    intent, appliedPlanHash: HASH, release: RELEASE, durationMs: 5, finishedAt: intent.expiresAt,
    result: apply({ services: [] }),
  });
  assert.equal(noop.result, 'noop', 'ok with no resources is rejected by the schema, so it must not be emitted');
});

test('the attestation carries the hash of the plan that ran, not the one that was asked for', () => {
  const a = attestationFromApply({
    intent, appliedPlanHash: OTHER, release: RELEASE, durationMs: 10, finishedAt: intent.expiresAt, result: apply({ planHash: OTHER }),
  });
  assert.equal(a.planHash, OTHER);
  assert.notEqual(a.planHash, intent.planHash, 'echoing the request would prove nothing about what executed');
});

test('a partial attestation with nothing landed is refused by the contract, not emitted', () => {
  const bad = {
    dispatchId: 'disp-1', nonce: 'n'.repeat(16), planHash: HASH, instanceId: 'inst-1', environment: 'production',
    action: 'apply', result: 'partial', errorCode: 'x@y', resources: [], release: RELEASE, durationMs: 1, finishedAt: intent.expiresAt,
  };
  assert.throws(() => AttestationSchema.parse(bad), /nothing landed/);
  const noCode = { ...bad, resources: [{ kind: 'service', name: 'api', externalId: 'api', status: 'live' }], errorCode: undefined };
  assert.throws(() => AttestationSchema.parse(noCode), /must say what did not complete/);
});

test('credential-shaped text in an outgoing errorCode is stopped at the source', () => {
  const leaky: Attestation = {
    ...attestationFromApply({ intent, appliedPlanHash: HASH, result: apply({ failures: [{ step: 'env', code: 'x', message: 'y' }] }), release: RELEASE, durationMs: 1, finishedAt: intent.expiresAt }),
    errorCode: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 rejected',
  };
  assert.throws(() => assertAttestationClean(leaky), /looks like a credential/);
  for (const harmless of ['deploy-timeout@services.production.worker', 'stale-plan-hash:requested-aaaa-found-bbbb']) {
    assert.equal(containsCredentialShapedText(harmless), false, harmless);
  }
  assert.equal(containsCredentialShapedText('Bearer supersercriticaltokenvalue'), true);
  assert.equal(containsCredentialShapedText('-----BEGIN RSA PRIVATE KEY-----'), true);
});

test('normalizeHash accepts both spellings and never lengthens a digest', () => {
  assert.equal(normalizeHash(`sha256:${HASH}`), HASH);
  assert.equal(normalizeHash(HASH.toUpperCase()), HASH);
  assert.equal(normalizeHash(`${HASH}trailing`), HASH);
});

test('the intent shape is strict, so a dispatch cannot smuggle authority', () => {
  assert.throws(() => DispatchIntentSchema.parse({ ...intent, actor: 'owner' }), /actor/);
  assert.throws(() => DispatchIntentSchema.parse({ ...intent, nonce: 'short' }), /nonce/);
  assert.throws(() => DispatchIntentSchema.parse({ ...intent, action: 'destroy' }), /action/);
});
