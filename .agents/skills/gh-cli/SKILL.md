---
name: gh-cli
description: Use when an authorized GitHub operation needs the GitHub CLI or the user specifically asks about it.
---

# GitHub CLI fallback

This optional adapter supports [github-ops](../github-ops/SKILL.md). Follow the
[project instructions](../../../AGENTS.md) and canonical
[delivery procedure](../release-workflow/SKILL.md). Prefer suitable connected tools
unless the user selected the CLI or an existing operation requires it.

Check installed command help for exact current syntax and verify authentication
without printing tokens or secret values. Confirm the repository and actual operation
target; do not rely on an unrelated current directory or an inferred base branch.
If the CLI is unavailable, use another authorized method rather than installing it
solely to satisfy this reference.

Prefer structured output for inspection and structured tool arguments or body files
for multiline content. Treat command text as executable code: quote literals safely,
keep untrusted text out of shell interpolation and preserve intended newlines.
Review the resulting issue, review request or other external state after an authorized
write. Do not expose secrets through logs or diagnostic output.

A command being supported does not authorize its action. Avoid bulk operations when
only one object is in scope. Obtain the actual checks/review and applicable permission
before integration; approval, release, deletion and publication rules come from project
policy. Do not copy a generic command example into a live operation without verifying
its repository, flags, scope and authority.
