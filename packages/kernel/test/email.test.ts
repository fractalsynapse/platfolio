import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKernel, disposeKernel } from '../src/app.ts';

/** The email capability as `ctx.email`: chosen by configuration, disposed with the kernel, honest about what it can read. */
test('the email service is installed from configuration and answers through the context', async () => {
  const ctx = await createKernel({ email: { driver: 'memory', from: 'platfolio@test.local' }, requiredServices: ['email'] });
  const receipt = await ctx.email.send({ to: ['someone@example.test'], subject: 'Invitation', text: 'Click to accept', correlationId: 'invite-1' });
  assert.equal(receipt.accepted, true, JSON.stringify(receipt));
  const stored = await ctx.email.listMessages('someone@example.test');
  assert.equal(stored.length, 1, 'the memory driver is readable, which is what makes local assertions possible');
  assert.equal(stored[0]?.correlationId, 'invite-1');
  await disposeKernel(ctx);
});

test('reading is reported as unavailable rather than faked for a relay that cannot be read', async () => {
  const ctx = await createKernel({ email: { driver: 'smtp', from: 'p@t.test', host: '127.0.0.1', port: 1, startTls: 'off', timeoutMs: 1200 }, requiredServices: ['email'] });
  assert.equal(ctx.email.readable, false, 'an SMTP relay is not a mailbox: claiming otherwise would be a custody leak');
  assert.deepEqual(await ctx.email.listMessages('x@y.test'), [], 'absence of power answers empty, not an exception');
  const result = await ctx.email.send({ to: ['someone@example.test'], subject: 's', text: 't' });
  assert.equal(result.accepted, false, 'a dead relay must not look like a send');
  await disposeKernel(ctx);
});

test('a driver that needs configuration says which piece is missing', async () => {
  for (const [config, needle] of [
    [{ driver: 'smtp', from: 'p@t.test' }, 'requires a host'],
    [{ driver: 'mailpit', from: 'p@t.test' }, 'requires a baseUrl'],
  ] as const) {
    await assert.rejects(() => createKernel({ email: config, requiredServices: ['email'] }), (error: Error) => {
      assert.match(error.message, new RegExp(needle), `expected "${needle}", got ${error.message}`);
      return true;
    });
  }
  // A password with no user is a misconfiguration that would silently skip authentication -- refuse it.
  await assert.rejects(() => createKernel({ email: { driver: 'smtp', from: 'p@t.test', host: '127.0.0.1', password: 'x' }, requiredServices: ['email'] }), /password with no user/);
});

test('an unknown driver is refused by the schema, not defaulted', async () => {
  await assert.rejects(() => createKernel({ email: { driver: 'sendgrid', from: 'p@t.test' } as never, requiredServices: ['email'] }), /Invalid enum|driver/);
});

test('no email config means no email capability at all', async () => {
  const ctx = await createKernel({ requiredServices: [] });
  assert.equal(ctx.email, undefined, 'an unconfigured control plane must not gain a sender by accident');
  await disposeKernel(ctx);
});
