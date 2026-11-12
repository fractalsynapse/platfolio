import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createKernel, disposeKernel, type KernelContext } from '@platfolio/kernel';
import { buildCapabilities } from '../src/capabilities.ts';
import { createIdentityFixture, defaultIdentityConfig, reasonOf, signToken, type StoreResult } from '@platfolio/contracts';
import { loadSpec, validateResponse, type SpecDocument } from '@platfolio/api-contract';

const spec: SpecDocument = loadSpec(fs.readFileSync(path.resolve(import.meta.dirname, '../openapi.yaml'), 'utf8'));
const fixture = createIdentityFixture();
const build = { version: '9.9.9', commit: 'a'.repeat(40), buildTime: '2026-11-11T00:00:00.000Z' };

function must<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

/** A caller whose token asserts a verified address -- the only kind that can claim an invitation. */
const invited = (subject: string, email: string, verified = true) =>
  signToken(fixture, { scope: 'platfolio.user', subject, email, ...(verified ? { emailVerified: true } : {}) });

async function start(options: { email?: boolean } = {}) {
  const ctx: KernelContext = await createKernel({
    provider: 'fake', custody: 'strict', identity: defaultIdentityConfig(fixture), identityKeys: [fixture.jwk],
    store: { driver: 'memory' }, server: { port: 0 },
    ...(options.email === true ? { email: { driver: 'memory' as const, from: 'platfolio@platfolio.test' } } : {}),
    extensions: buildCapabilities({ build }), requiredServices: ['identity', 'server', 'store', 'extensions'],
  });
  const base = `http://127.0.0.1:${String(ctx.server.address.port)}`;
  const call = async (p: string, init: RequestInit, token: string) => {
    const response = await fetch(base + p, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    const text = await response.text();
    let body: unknown;
    try { body = response.status === 204 ? undefined : JSON.parse(text) as unknown; } catch { body = text; }
    return { status: response.status, body, text };
  };
  const against = (operationId: string, status: number, body: unknown) => {
    const check = validateResponse(spec, operationId, status, body);
    assert.ok(check.ok, `${operationId} ${String(status)} violates the spec: ${check.errors.join('; ')}\n  body: ${JSON.stringify(body).slice(0, 220)}`);
  };
  /** A team with one owner, whose token asserts owner@example.test. */
  const teamWithOwner = async () => {
    const team = must(await ctx.store.createTeam({ name: 'work' }), 'createTeam');
    const person = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'owner-subject' }), 'resolve owner');
    must(await ctx.store.putTeamMember({ teamId: team.id, personId: person.person.id, role: 'owner' }), 'member');
    const plainPerson = must(await ctx.store.resolvePerson({ issuer: fixture.issuer, subject: 'member-subject' }), 'resolve member');
    must(await ctx.store.putTeamMember({ teamId: team.id, personId: plainPerson.person.id, role: 'member' }), 'second member');
    const token = signToken(fixture, { scope: 'platfolio.user', subject: 'owner-subject', email: 'owner@example.test', emailVerified: true });
    const memberToken = signToken(fixture, { scope: 'platfolio.user', subject: 'member-subject', email: 'member@example.test', emailVerified: true });
    return { team, token, memberToken, personId: person.person.id };
  };
  return { ctx, call, against, teamWithOwner };
}

const post = { method: 'POST' } as const;

test('an invitation is created, mailed, and visible as a record -- without becoming a membership', async () => {
  const app = await start({ email: true });
  try {
    const { team, token } = await app.teamWithOwner();
    const created = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'New-Hire@Example.com', role: 'member' }) }, token);
    assert.equal(created.status, 201, created.text);
    app.against('createInvitation', 201, created.body);
    const payload = created.body as { invitation: { email: string; state: string }; delivery: { sent: boolean } };
    assert.equal(payload.invitation.email, 'new-hire@example.com', 'the address is normalised on write, not at read time');
    assert.equal(payload.invitation.state, 'pending');
    assert.equal(payload.delivery.sent, true, 'with a transport configured, delivery is reported as done');

    const listed = await app.call(`/api/v1/teams/${team.id}/invitations`, {}, token);
    app.against('listInvitations', 200, listed.body);
    assert.equal((listed.body as unknown[]).length, 1);

    const members = await app.ctx.store.listTeamMembers(team.id);
    assert.equal(members.length, 2, 'an invited person must not appear as a member before they have proven anything');
    const dupe = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'new-hire@example.com' }) }, token);
    assert.equal(dupe.status, 409, 'a second pending invitation for the same address is a resend, not a new row');
  } finally { await disposeKernel(app.ctx); }
});

test('the invited person claims it with their own verified address, and that is what grants the role', async () => {
  const app = await start({ email: true });
  try {
    const { team, token } = await app.teamWithOwner();
    const created = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'hire@example.test', role: 'member' }) }, token);
    assert.equal(created.status, 201, created.text);
    const invitationId = (created.body as { invitation: { id: string } }).invitation.id;

    const hire = invited('hire-subject', 'hire@example.test');
    const mine = await app.call('/api/v1/me/invitations', {}, hire);
    app.against('listMyInvitations', 200, mine.body);
    assert.equal((mine.body as Array<{ id: string }>).length, 1, 'the invitation should be discoverable by the person it addresses');
    assert.equal((mine.body as Array<{ id: string }>)[0]?.id, invitationId);

    const accepted = await app.call(`/api/v1/me/invitations/${invitationId}/accept`, post, hire);
    assert.equal(accepted.status, 200, accepted.text);
    app.against('acceptInvitation', 200, accepted.body);
    assert.equal((accepted.body as { role: string }).role, 'member');
    assert.equal((accepted.body as { teamId: string }).teamId, team.id);

    // The proof that the claim worked: they can now read the team's own records, which they could not before.
    const before = await app.call('/api/v1/instances', { ...post }, invited('other-subject', 'other@example.test'));
    void before;
    const asMember = await app.call('/api/v1/me/invitations', {}, hire);
    assert.equal((asMember.body as unknown[]).length, 0, 'an accepted invitation leaves the pending list');

    const repeat = await app.call(`/api/v1/me/invitations/${invitationId}/accept`, post, hire);
    assert.equal(repeat.status, 409, 'the same invitation cannot be accepted twice');
  } finally { await disposeKernel(app.ctx); }
});

test('forwarding the invitation email grants the forwarder nothing (D46)', async () => {
  const app = await start({ email: true });
  try {
    const { team, token } = await app.teamWithOwner();
    const created = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'secret-hire@example.test' }) }, token);
    const invitationId = (created.body as { invitation: { id: string } }).invitation.id;

    // Someone who learned the invitation id but asserts a DIFFERENT address -- the forwarded-email attacker.
    const thief = invited('thief-subject', 'thief@example.test');
    const stolen = await app.call(`/api/v1/me/invitations/${invitationId}/accept`, post, thief);
    assert.equal(stolen.status, 404, `a mismatched address must be indistinguishable from no such invitation, got ${String(stolen.status)}`);
    assert.ok(!JSON.stringify(stolen.body).includes('secret-hire'), `the refusal leaked the invited address: ${stolen.text}`);
    app.against('acceptInvitation', 404, stolen.body);

    const look = await app.call('/api/v1/me/invitations', {}, thief);
    assert.equal((look.body as unknown[]).length, 0, 'discovery is by asserted address, not by guessing ids');
  } finally { await disposeKernel(app.ctx); }
});

test('an identity that asserts no address is told so, rather than shown an empty list', async () => {
  const app = await start({ email: true });
  try {
    const noAddress = signToken(fixture, { scope: 'platfolio.user', subject: 'anonymous-subject' });
    const r = await app.call('/api/v1/me/invitations', {}, noAddress);
    assert.equal(r.status, 409, `"no invitations" and "nothing can match you" are different answers: ${r.text}`);
    app.against('listMyInvitations', 409, r.body);
    // And an address asserted but NOT verified is the same refusal: not asserted is not true (D46).
    const unverified = invited('unverified-subject', 'unverified@example.test', false);
    const u = await app.call('/api/v1/me/invitations', {}, unverified);
    assert.equal(u.status, 409, 'an unverified address must not be treated as a claim');
  } finally { await disposeKernel(app.ctx); }
});

test('invitation routes honour the role table and team boundaries (#178, #173)', async () => {
  const app = await start({ email: true });
  try {
    const { team, memberToken } = await app.teamWithOwner();
    const byMember = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'x@example.test' }) }, memberToken);
    assert.equal(byMember.status, 403, 'inviting is an owner action (D44: a membership in waiting is a role grant)');
    const listByMember = await app.call(`/api/v1/teams/${team.id}/invitations`, {}, memberToken);
    assert.equal(listByMember.status, 403, 'the pending list carries addresses; members do not need a directory');

    const outsider = signToken(fixture, { scope: 'platfolio.user', subject: 'nobody-subject', email: 'nobody@example.test', emailVerified: true });
    const byOutsider = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'y@example.test' }) }, outsider);
    assert.equal(byOutsider.status, 404, 'a caller with no membership must not learn the team exists');
    assert.ok(!JSON.stringify(byOutsider.body).includes(team.id), 'the 404 must not echo the team id');

    const unauthed = await fetch(`http://127.0.0.1:${String(app.ctx.server.address.port)}/api/v1/teams/${team.id}/invitations`);
    assert.equal(unauthed.status, 401, 'no credentials is 401, not 404');
  } finally { await disposeKernel(app.ctx); }
});

test('revocation withdraws a pending invitation and answers 204 with no body', async () => {
  const app = await start({ email: true });
  try {
    const { team, token } = await app.teamWithOwner();
    const created = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'gone@example.test' }) }, token);
    const invitationId = (created.body as { invitation: { id: string } }).invitation.id;
    const revoked = await app.call(`/api/v1/teams/${team.id}/invitations/${invitationId}`, { method: 'DELETE' }, token);
    assert.equal(revoked.status, 204, revoked.text.slice(0, 80));
    assert.equal(revoked.text, '', 'a 204 with a body is a claim clients have to special-case');
    const accept = await app.call(`/api/v1/me/invitations/${invitationId}/accept`, post, invited('gone-subject', 'gone@example.test'));
    // 409 with a reason, not 404: this caller IS the addressee, and "it was withdrawn -- ask for another" is
    // advice they can act on. 404 is reserved for a mismatched address, where confirming existence would be
    // the leak. Same distinction as #173, applied from the other side of the boundary.
    assert.equal(accept.status, 409, accept.text);
    assert.match(JSON.stringify(accept.body), /withdrawn/, `reason should say withdrawn: ${accept.text}`);
  } finally { await disposeKernel(app.ctx); }
});

test('with no transport configured the invitation still exists and says the mail did not go out', async () => {
  const app = await start({ email: false });
  try {
    const { team, token } = await app.teamWithOwner();
    const created = await app.call(`/api/v1/teams/${team.id}/invitations`, { ...post, body: JSON.stringify({ email: 'silent@example.test' }) }, token);
    assert.equal(created.status, 201, 'a missing transport is not a reason to refuse the record');
    const payload = created.body as { invitation: { emailError?: string }; delivery: { sent: boolean; reason?: string } };
    assert.equal(payload.delivery.sent, false);
    assert.match(String(payload.delivery.reason), /no email transport/, `reason: ${JSON.stringify(payload.delivery)}`);
    assert.match(String(payload.invitation.emailError), /no email transport/, 'the row carries it too, so "we never got it" is answerable later');
  } finally { await disposeKernel(app.ctx); }
});
