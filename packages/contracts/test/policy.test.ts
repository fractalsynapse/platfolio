import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, POLICY, PolicyActionSchema, ROLE_RANK, type PolicyAction } from '../src/policy.ts';
import { reasonOf } from '../src/persistence.ts';

const actions = PolicyActionSchema.options;

test('the policy table covers every action, and every action names a minimum role', () => {
  for (const action of actions) {
    const required = POLICY[action as PolicyAction];
    assert.ok(required === 'owner' || required === 'member', `${action} has no role in the table`);
  }
  assert.equal(Object.keys(POLICY).length, actions.length, 'the table and the action enum have drifted apart');
});

test('ownership is strictly stronger than membership', () => {
  assert.ok(ROLE_RANK.owner > ROLE_RANK.member);
  for (const action of actions) {
    const owner = decide({ action, membership: { role: 'owner' } });
    assert.equal(owner.ok, true, `an owner was refused for ${action}`);
  }
});

test('a non-member gets 404 and learns nothing about existence (#173 continuity)', () => {
  for (const action of actions) {
    const verdict = decide({ action, membership: null });
    assert.equal(verdict.ok, false, `${action} accepted a non-member`);
    if (!verdict.ok) {
      assert.equal(verdict.status, 404, `${action} revealed existence to a non-member (got ${String(verdict.status)})`);
      assert.equal(verdict.error.code, 'not-found');
    }
  }
});

test('an under-roled member gets 403 with advice they can act on, not a mystery', () => {
  const ownerOnly = actions.filter((a) => POLICY[a] === 'owner');
  assert.ok(ownerOnly.length >= 3, `expected several owner-only actions, found ${JSON.stringify(ownerOnly)}`);
  for (const action of ownerOnly) {
    const verdict = decide({ action, membership: { role: 'member' } });
    assert.equal(verdict.ok, false, `${action} was allowed to a plain member`);
    if (!verdict.ok) {
      assert.equal(verdict.status, 403, `${action} hid existence from someone who can already see the resource`);
      assert.match(reasonOf(verdict.error), new RegExp(`requires the ${POLICY[action]} role`), reasonOf(verdict.error));
    }
  }
  // And the converse: a member-allowed action must NOT 403 a member, or the table is over-restrictive.
  for (const action of actions.filter((a) => POLICY[a] === 'member')) {
    assert.equal(decide({ action, membership: { role: 'member' } }).ok, true, `${action} refused its own minimum role`);
  }
});

test('the destructive and grant-giving verbs are exactly the owner-only set (D43, D42)', () => {
  const ownerOnly = actions.filter((a) => POLICY[a] === 'owner').sort();
  assert.deepEqual(ownerOnly.sort(), ['capability.share', 'instance.destroy', 'invitation.list', 'invitation.revoke', 'team.invite', 'team.member.manage'].sort());
  // The invitation verbs are owner-only for a reason recorded in #186: a pending row carries an email address,
  // and a member-visible list is a people directory nobody asked for. This assertion is a tripwire -- it failed
  // when the invitations capability was added, which is a test naming the decision rather than the code.
});
