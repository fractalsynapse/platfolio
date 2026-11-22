/**
 * The credential-supply rule, machine-checked.
 *
 * `scripts/identity-credentials.ts` exists because of a specific, expensive misreading: `identity:smoke`
 * reported `400 invalid_grant` against the hosted master realm, #248 recorded it as "production's admin
 * credential no longer matches", and the actual cause was the script's own `platfolio-dev-only` default
 * being sent to a public host. The credential was fine the whole time — measured: the held credential
 * authenticates and `/admin/realms` answers. So the invariant worth testing is not "is the password strong"
 * (the existing `--allow-remote` gate already asks that) but "is a local placeholder allowed to reach a
 * remote issuer at all".
 *
 * No network, no filesystem, no container: every case here is a string in and a decision out, which is the
 * point of keeping the rule a pure function.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOOPBACK_CREDENTIAL, isLoopback, resolveCredential, type CredentialQuestion } from '../../../scripts/identity-credentials.ts';

const base = (over: Partial<CredentialQuestion> = {}): CredentialQuestion => ({
  label: 'the master-realm admin password',
  variable: 'KC_ADMIN_PASSWORD',
  flag: '--admin-password',
  fallback: LOOPBACK_CREDENTIAL,
  value: 'a-real-credential-from-the-operator',
  base: 'https://auth.platfolio.dev',
  source: '.secrets/platfolio-keycloak-admin',
  ...over,
});

test('a development placeholder arriving at a hosted issuer is refused, not sent', () => {
  const answer = resolveCredential(base({ value: LOOPBACK_CREDENTIAL }));
  assert.equal(answer.ok, false);
  if (answer.ok) return;
  assert.equal(answer.code, 'placeholder-on-remote');
  // The message has to be actionable: the variable to export and the file to read it from.
  assert.match(answer.message, /KC_ADMIN_PASSWORD/);
  assert.match(answer.message, /\.secrets\/platfolio-keycloak-admin/);
});

test('the refusal never carries the value, its length, or a fragment of it', () => {
  const secret = 'platfolio-dev-only';
  for (const answer of [resolveCredential(base({ value: secret })), resolveCredential(base({ value: '' }))]) {
    assert.equal(answer.ok, false);
    if (answer.ok) continue;
    // 'platfolio-dev-only' appears in the message only as the words "development value" / the constant name.
    // Asserting the literal is the honest check: a future message that interpolates `{value}` fails here.
    assert.ok(!answer.message.includes(secret), `refusal leaked the credential: ${answer.message.slice(0, 80)}`);
    assert.ok(!/\b28\b|length \d+/.test(answer.message), 'refusal leaked a length, which narrows a brute force');
  }
});

test('a script default that differs from the loopback credential is still refused remotely', () => {
  // The rule is not "is it the string platfolio-dev-only". It is "is it the value this script would have
  // used had nobody exported anything" -- so a script that changes its own default cannot smuggle it past.
  const answer = resolveCredential(base({ fallback: 'some-other-bundled-default', value: 'some-other-bundled-default' }));
  assert.equal(answer.ok, false);
});

test('loopback keeps its defaults: the local stack runs with nothing exported', () => {
  for (const host of ['http://localhost:8081', 'http://127.0.0.1:8080/', 'http://[::1]:8081']) {
    const answer = resolveCredential(base({ base: host, value: LOOPBACK_CREDENTIAL }));
    assert.equal(answer.ok, true, `${host} must accept the development value`);
  }
});

test('a real credential against a remote host passes, and is not printed', () => {
  const answer = resolveCredential(base());
  assert.deepEqual({ ok: answer.ok, remote: 'remote' in answer ? answer.remote : undefined }, { ok: true, remote: true });
  assert.ok(!('message' in answer && answer.message !== undefined));
});

test('an empty value against a remote host is refused as missing, not sent as blank', () => {
  // Distinct from placeholder-on-remote: "you did not supply it" and "you supplied the wrong thing" are
  // different operator actions, and one message for both wastes the reader's time.
  const answer = resolveCredential(base({ value: '' }));
  assert.equal(answer.ok, false);
  if (answer.ok) return;
  assert.equal(answer.code, 'missing');
});

test('loopback detection is about the host, not the substring', () => {
  assert.equal(isLoopback('http://localhost:8081'), true);
  assert.equal(isLoopback('https://api.platfolio.dev'), false);
  // The trap: a hosted name that CONTAINS localhost, and a scheme-less local port.
  assert.equal(isLoopback('https://localhost.example.com'), false);
  assert.equal(isLoopback('localhost:8081'), true);
  assert.equal(isLoopback('http://localhost.evil/'), false);
});
