import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeBootFailure } from '../src/index.ts';
import { redactCredentialShaped } from '@platfolio/contracts';

/**
 * The control plane's fail-closed path has to be readable. On staging's first boot the container logged
 * `control-plane: cannot start: ` and stopped -- an empty message, because the printer only looked at
 * `.message`. A machine that refuses must also say why, or the operator is guessing between a missing config
 * value and a dependency that threw, and the guessing happens in front of a provider log window.
 *
 * The redaction cases are the point of the file. Boot failures quote DSNs, and a DSN is the one string this
 * project has promised never to persist: a stack frame that survives into Railway's log stream is platfolio
 * reading a credential it was handed, in the component whose whole claim is that it does not (D4).
 */
test('an error with no message still says something', () => {
  const line = describeBootFailure(new Error(''));
  assert.match(line, /Error/, 'a name is always printed');
  assert.match(line, /\(no message\)/, 'and the emptiness is stated rather than left blank');
  assert.ok(line.length > 'Error: (no message)'.length, 'frames make the line useful even with nothing else');
});

test('the cause chain survives, one level, because that is where the reason lives', () => {
  const err = Object.assign(new Error('database migration failed'), { cause: new Error('schema "platfolio" does not exist') });
  const line = describeBootFailure(err);
  assert.match(line, /database migration failed/);
  assert.match(line, /caused by Error: schema "platfolio" does not exist/, line);
});

test('a DSN with a password is redacted in the message, the cause and the frames', () => {
  const message = describeBootFailure(new Error('cannot connect to postgresql://platfolio:sup3rs3cret@db.internal:5432/app'));
  assert.equal(message.includes('sup3rs3cret'), false, message);
  assert.match(message, /postgresql:\/\/platfolio:\[redacted\]@db\.internal/);

  const wrapped = Object.assign(new Error('migration failed'), { cause: new Error('auth failed for postgresql://u:hunter2@h/d') });
  assert.equal(describeBootFailure(wrapped).includes('hunter2'), false, 'the cause is a leak surface too');

  const withStack = new Error('boom');
  withStack.stack = 'Error: boom\n    at connect (dsn=postgresql://svc:t0tp4ssw0rd@pg.railway:5432/db)\n    at boot';
  assert.equal(describeBootFailure(withStack).includes('t0tp4ssw0rd'), false, 'stack frames quote the strings that failed');
});

test('userinfo without a password is left alone, because redacting noise teaches people to distrust redaction', () => {
  assert.equal(redactCredentialShaped('https://user@example.com/path'), 'https://user@example.com/path');
  assert.equal(redactCredentialShaped('jdbc:postgresql://host:5432/db').includes('[redacted]'), false);
});

test('a thrown non-Error is reported as what it is, not as an empty Error', () => {
  assert.match(describeBootFailure('disk quota exceeded'), /thrown value \(string\): disk quota exceeded/);
  assert.match(describeBootFailure(undefined), /Error: \(no message\)/);
});

test('an AggregateError reports what it aggregated, because that is where a pool puts the reason', () => {
  // pg-pool throws this shape when several connection attempts fail: `message` is empty, the causes live in
  // `.errors`. Without the branch this line was `AggregateError: (no message)` and nothing else -- the exact
  // log staging produced, which is why the describer had to grow.
  const agg = Object.assign(new AggregateError([
    Object.assign(new Error('connection refused'), { name: 'ECONNREFUSED' }),
    new Error('password authentication failed for user "railway"'),
  ], ''));
  const line = describeBootFailure(agg);
  assert.match(line, /aggregated 2 error\(s\)/, line);
  assert.match(line, /ECONNREFUSED: connection refused/, line);
  assert.match(line, /password authentication failed/, line);

  // And the credential-bearing case: a pooled failure quoting a DSN must not launder the password through the
  // aggregate branch, which is new code and therefore exactly where a leak would hide.
  const withDsn = Object.assign(new AggregateError([new Error('no connect postgresql://app:s3cr3t@pg.internal:5432/db')], ''));
  assert.equal(describeBootFailure(withDsn).includes('s3cr3t'), false, 'the aggregate path redacts like the others');

  const many = Object.assign(new AggregateError(Array.from({ length: 6 }, (_, k) => new Error(`attempt ${String(k)}`)), ''));
  assert.match(describeBootFailure(many), /\(\+2 more\)/, 'capped but honest about the cap');
});
