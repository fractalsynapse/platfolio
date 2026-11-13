import { z } from 'zod';
import type { TeamRole, StoreError } from './persistence.ts';

/**
 * The authorization question, asked in exactly one place (#178).
 *
 * Before this, every handler asked the same question in its own words: "is this person a member of that
 * team?" That is *membership*, and it made `owner` and `member` identical in behaviour -- so D43's
 * owner-only `destroy` had nowhere to live, and adding a role meant auditing every handler and hoping.
 *
 * A table is the fix, and the shape of the answer matters as much as the rule:
 *
 * - **Not a member → 404.** Saying 403 confirms the resource exists, which is the same enumeration leak
 *   #173 closed for team boundaries.
 * - **Member with too low a role → 403.** They are already allowed to see the thing; refusing the action
 *   honestly is information they are entitled to, and it is the only way an error message can say "an owner
 *   can do this" instead of leaving them stuck.
 *
 * So the function takes a membership, not a subject: identity resolution happened at the boundary already
 * (#177), and re-deriving it here would be a second answer to "who is asking".
 */
export const PolicyActionSchema = z.enum([
  'instance.read',
  'instance.create',
  'instance.plan.write',
  'instance.artifact.write',
  'instance.secret.write',
  'instance.secret.read',
  'instance.dispatch',
  'instance.destroy',
  'capability.publish',
  'capability.share',
  'capability.bind',
  'audit.read',
  'team.member.manage',
  'team.invite',
  'invitation.list',
  'invitation.revoke',
]);
export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const ROLE_RANK: Record<TeamRole, number> = { member: 1, owner: 2 };

/**
 * The whole authorization model, as data. Reviewing it means reading this table, not grepping handlers --
 * which is the difference between a policy and a habit.
 */
export const POLICY: Record<PolicyAction, TeamRole> = {
  'instance.read': 'member',
  'instance.create': 'member',
  'instance.plan.write': 'member',
  // A release artifact is what a build says it published (D54). Members develop the platform, so members
  // report it -- and a false report is caught downstream rather than here: the plan hash moves, and a runner
  // attesting against a plan it never fetched is refused. Reporting a build is normal work, not an escalation.
  'instance.artifact.write': 'member',
  // Writing a credential into a running service is an owner decision, by D43's reasoning one layer down: a
  // member can deploy, but a member must not be able to substitute the value a service runs with.
  'instance.secret.write': 'owner',
  // Presence is not the value. A member needs it to tell "install incomplete" from "install working", and
  // seeing that grants nothing.
  'instance.secret.read': 'member',
  'instance.dispatch': 'member',
  // D43: destroying the managed service is an owner decision. Deliberately the only destructive verb here --
  // a repository or a workflow is never destroyed by platfolio (D36).
  'instance.destroy': 'owner',
  'capability.publish': 'member',
  // Sharing grants another team access to something that may include secrets-by-name and a URL their apps
  // will trust. That is an owner's call, not any member's.
  'capability.share': 'owner',
  'capability.bind': 'member',
  'audit.read': 'member',
  'team.member.manage': 'owner',
  // D44: an invitation is a membership in waiting, so it is the same authority as granting one. Listing and
  // revoking are here too because a pending invitation carries an email address -- handing that to every member
  // would be a people-directory nobody asked for.
  'team.invite': 'owner',
  'invitation.list': 'owner',
  'invitation.revoke': 'owner',
};

export interface PolicyInput {
  action: PolicyAction;
  /** The caller's membership in the team that owns the resource, or null when there is none. */
  membership: { role: TeamRole } | null;
}

export type PolicyDecision = { ok: true; role: TeamRole } | { ok: false; status: 403 | 404; error: StoreError };

export function decide(input: PolicyInput): PolicyDecision {
  const required = POLICY[input.action];
  if (!input.membership) {
    return { ok: false, status: 404, error: { code: 'not-found', what: 'resource', id: 'not-visible' } };
  }
  if (ROLE_RANK[input.membership.role] < ROLE_RANK[required]) {
    return {
      ok: false,
      status: 403,
      error: { code: 'conflict', reason: `${input.action} requires the ${required} role on this team` },
    };
  }
  return { ok: true, role: input.membership.role };
}

/** For tests and the route-table audit: every action must be covered by at least one case. */
export function uncoveredActions<T>(covered: Iterable<T>): PolicyAction[] {
  const seen = new Set(covered as Iterable<string>);
  return PolicyActionSchema.options.filter((action) => !seen.has(action));
}
