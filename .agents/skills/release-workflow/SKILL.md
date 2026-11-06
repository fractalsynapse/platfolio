---
name: release-workflow
description: Use when preparing project changes for review, integration or release under the project's delivery policy.
---

# Apply the project's delivery policy

Read the [project instructions](../../../AGENTS.md) and actual maintenance policy first.
Discover whether version control, a tracker, reviews, builds, hosted checks and releases
apply. Use their configured conventions and authority. This skill chooses no forge,
branch model, version scheme, merge strategy or issue-closing milestone. Read-only work
requires no mutation; projects without a tracker or release process do not need one
introduced merely to use this skill.

## Prepare a change

Confirm repository identity, current state and writable scope. Preserve unrelated work.
Create or adopt the required work record and isolated work branch when project policy
requires them, starting from its verified current base. Never treat a protected/default
branch or an unknown setting as permission to write directly. Record changed intent before
behavior changes, establish applicable acceptance/tests and make coherent increments.
Use actual project commands; documentation-only work uses document validation.

Before review, inspect the full diff and apply
[verification](../verification-before-completion/SKILL.md). Include applicable changelog,
version and documentation updates under project conventions. Release preparation uses
the same review protections unless an authorized project exception explicitly applies.
Describe the problem, resulting behavior, acceptance evidence, limitations and relevant
work references. An unavailable required check remains outstanding.

## Integrate within authority

Verify the exact candidate head, current base, required checks, review and merge authority.
Refresh affected evidence if the candidate or integration result changes. Opening a review,
merging, approving, publishing and communicating are distinct actions; perform only those
authorized by the request or applicable standing policy. No tool capability grants approval
rights, and passing checks alone does not authorize integration or production publication.

After an authorized merge, clean up only task-owned resources covered by policy. Before
branch deletion, verify repository identity, merged commit on the intended base, no later
unlanded work, no other open review, worktree use or retention instruction. Squash integration
requires recorded merge evidence rather than ancestry alone. Preserve long-lived branches
and unrelated work, verify deletion against current remote/local state and prune stale refs
when appropriate. If uncertain, retain the resource and report why.

## Prepare a release only when requested

Identify the actual previous-release-to-candidate range and pin candidate/artifact identity.
Derive shipping work from that range, not all historical merged requests. Verify acceptance
individually; an empty checklist proves nothing. Apply the project's closure milestone and
verified forge behavior. Omitting a closing reference does not remove partial work from
the candidate; identify included deficits for the authorized release decision.

Refresh scope, notes, closure references, checks and review if the candidate advances.
Preserve published identities; correct a published artifact through the project's new-version
or recovery procedure rather than silently replacing bytes. Report integration, publication
and verified availability separately. Urgency or plan completion does not lift authority.
