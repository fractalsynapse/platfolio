# Maintaining Scaffold

This document governs development of this instruction package only. It is excluded
from the portable starter; target projects retain their own maintenance policies.

## Change workflow

- Track changes in an issue with observable acceptance. Read-only audits need no branch.
- Work on an issue-linked branch from fetched origin/staging; use the codex prefix.
  Preserve existing edits. Never commit directly to staging or main.
- Record changed intent before changing the package. Validate guidance as documentation
  and decision procedures; this repository has no application build or runtime suite.
- Commit coherent changes with a type, description and issue reference. Add a human-readable
  entry under Unreleased in CHANGELOG.md for user/developer-visible changes.
- Open a PR against staging with its problem, result, evidence, limitations and a
  non-closing issue reference. Keep acceptance accurate and link the PR from the issue.
- Agents may integrate into staging only when applicable checks, hosted CI and required
  review are satisfied. Missing CI or unknown review requirements are a disclosed blocker
  to automatic merge, not an invitation to add unrelated infrastructure. Agents do not
  approve PRs, merge main or publish releases under this policy.
- After an authorized merge, delete only the task-owned branch after verifying its
  merge commit, unchanged branch head, absence of other open PRs/retained work and worktree
  use. Preserve staging, main and unrelated branches. Verify remote/local deletion and prune
  stale references. Record any retention reason instead of discarding work.

Use the canonical HTTPS remote for this repository. The initial staging baseline was
created from the verified remote main commit before issue #1 development; that setup
does not authorize later protected-branch writes.

## Release policy

Integration into staging does not close implementation issues. When a release is
requested, derive its shipping changes from a pinned previous-release-to-candidate
range. Review each linked issue's actual acceptance; an empty checklist is not evidence.
An omitted closing reference does not remove partial implementation from the release.
Identify such content for a maintainer decision.

Prepare version/changelog updates through an issue branch and staging PR. Only the
maintainer may approve/merge the release PR to main and authorize publication. Refresh
candidate scope, acceptance and checks when its source changes. Retain published tag
identities; corrections use a new version. Follow the forge's verified closure behavior
and this release policy. Do not close issues solely because they are old.
