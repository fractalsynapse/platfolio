import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentityFixture, defaultIdentityConfig, signToken, type StoreResult } from '@platfolio/contracts';
import { createKernel, disposeKernel } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { keycloakNotificationDirectory } from '../src/notification-directory.ts';
import { deliverNotificationEmails } from '../src/notification-email.ts';

test('the Keycloak directory reads only enabled, verified addresses for the exact identity', async () => {
  const issuer = 'https://identity.example.test/realms/tenant';
  const calls: string[] = [];
  let verified = true;
  let enabled = true;
  const directory = keycloakNotificationDirectory(issuer, 'mailreader', 'test-only', async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, 'error');
    if (new URL(String(url)).pathname.endsWith('/token')) return Response.json({ access_token: 'fixture', expires_in: 300 });
    return Response.json({ id: 'user-a', emailVerified: verified, enabled, email: 'sample@example.test' });
  });
  assert.equal(await directory.verifiedPrimary('user-a'), 'sample@example.test');
  verified = false;
  assert.equal(await directory.verifiedPrimary('user-a'), undefined);
  verified = true;
  enabled = false;
  assert.equal(await directory.verifiedPrimary('user-a'), undefined);
  assert.equal(await directory.verifiedPrimary('../admin'), undefined);
  assert.equal(calls.length, 4);
  assert.equal(calls[0], issuer + '/protocol/openid-connect/token');
  assert.ok(calls.slice(1).every((value) => value === 'https://identity.example.test/admin/realms/tenant/users/user-a'));
});

test('signed-in people opt in themselves and only receive future matching events at a current verified address', async () => {
  const fixture = createIdentityFixture();
  const subject = 'notification-subscriber';
  const inbox = 'verified@example.test';
  let activeAddress: string | undefined;
  const directory = { issuer: fixture.issuer, verifiedPrimary: async (forSubject: string) => forSubject === subject ? activeAddress : undefined };
  const ctx = await createKernel({
    identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk], provider: 'fake', custody: 'strict',
    server: { port: 0 }, store: { driver: 'memory' }, email: { driver: 'memory', from: 'sender@example.test' },
    extensions: buildCapabilities({ notificationDirectory: directory, invitationOrigin: 'https://private.example.test',
      build: { commit: 'a'.repeat(40), version: null, buildTime: '2026-11-24T00:00:00Z' } }),
    requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const value = <T>(result: StoreResult<T>) => { assert.ok(result.ok); return result.value; };
  try {
    const path = `http://127.0.0.1:${ctx.server.address.port}/api/v1/me/notification-email`;
    const headers = { authorization: 'Bearer ' + signToken(fixture, { subject, scope: 'platfolio.user' }), 'content-type': 'application/json' };
    const toggle = (enabled: boolean) => fetch(path, { headers, method: 'PUT', body: JSON.stringify({ enabled }) });
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await toggle(true)).status, 400);
    activeAddress = inbox;
    assert.equal((await toggle(true)).status, 200);
    const { person } = value(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject }));
    const team = value(await ctx.store.createTeam({ name: 'notification-proof' }));
    value(await ctx.store.putTeamMember({ teamId: team.id, personId: person.id, role: 'owner' }));
    const app = value(await ctx.store.createInstance({ teamId: team.id, name: 'web', template: 'starter-web' }));
    value(await ctx.store.saveNotificationRule(person.id, { instanceId: app.id, event: 'app-outage', enabled: true }));
    const now = new Date(Date.now() + 1000);
    const emit = (action: string, at: Date) => ctx.store.appendAudit({
      actorKind: 'controller', actorRef: 'test', action, target: app.id, detail: { environment: 'staging' }, at: at.toISOString(),
    });
    value(await emit('availability.down', new Date(Date.now() - 1000)));
    value(await emit('availability.up', now));
    value(await emit('availability.down', now));
    await deliverNotificationEmails(ctx, directory, now, 'https://private.example.test');
    await deliverNotificationEmails(ctx, directory, now);
    const mail = await ctx.email.listMessages(inbox);
    assert.equal(mail.length, 1);
    assert.equal(mail[0]?.subject, 'Platfolio: An app is unavailable');
    assert.match(mail[0]?.text ?? '', /https:\/\/private\.example\.test\/dashboard\/notifications/);
    activeAddress = undefined;
    value(await emit('availability.down', now));
    await deliverNotificationEmails(ctx, directory, now);
    assert.equal((await ctx.email.listMessages(inbox)).length, 1);
    assert.equal((await toggle(false)).status, 200);
    assert.equal((await ctx.store.listNotificationRules(person.id)).length, 1);
  } finally { await disposeKernel(ctx); }
});
