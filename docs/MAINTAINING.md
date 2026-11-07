# Maintaining platfolio

This document governs development of the platfolio project: its design documents, contracts, tooling,
vendored code and — once it exists — its application code.

The workflow below is the one this repository already uses. It is carried over deliberately, so the
only substantive change from the starter's policy is scope: this is now an application project, and
`docs/MAINTAINING.md` no longer describes an instruction package.

## Change workflow

- Track changes in an issue with **observable acceptance**. Read-only analysis or a documentation
  correction needs no branch.
- Work on an issue-linked branch fetched from `origin/staging`. Preserve existing edits. Never commit
  directly to `staging` or `main`.
- Record changed intent **before** changing behavior, in the canonical place for that kind of decision:
  accepted decisions go in [design/01 § Decision register](design/01-product-and-decisions.md);
  verified provider constraints go in
  [platfolio-feasibility.md](platfolio-feasibility.md); vendored-tree facts go in
  [vendor/CORDIS.md](../vendor/CORDIS.md). Link rather than duplicate.
- Commit coherent changes with a type, description and issue reference. Add a human-readable entry
  under `Unreleased` in [CHANGELOG.md](../CHANGELOG.md) for user- or developer-visible changes.
- Open a PR against `staging` stating problem, result, **evidence**, limitations, and a non-closing
  issue reference. Keep acceptance accurate and link the PR from the issue.
- Agents may integrate into `staging` only when the applicable checks below, hosted CI where it
  exists, and required review are all satisfied. Missing CI or unknown review requirements are a
  disclosed blocker to automatic merge — not an invitation to invent infrastructure. Agents do not
  approve PRs, merge to `main`, or publish releases.
- After an authorized merge, delete only the task-owned branch after verifying its merge commit,
  unchanged branch head, absence of other open PRs or retained work, and worktree use. Preserve
  `staging`, `main` and unrelated branches. Record any retention reason instead of discarding work.

## Checks by kind of change

Use the narrowest set that actually covers the claim, and report each as passed, failed, skipped,
unavailable or not applicable. Do not infer acceptance from a check that does not cover it.

| Change touches | Required evidence |
| --- | --- |
| Design documents only | Prose and reference review; every local link and anchor resolves; claims distinguish verified / unverified / proposed |
| Anything under `vendor/` | `npx -y tsx scripts/vendor-cordis.ts verify` must pass, and `check` must be reported. Local edits exist only as `vendor/patches/*.patch` |
| Capability seams / `packages/contracts` (once created) | The seam's **conformance suite** against every implementation plus the test double; contracts-diff gate classifies the version bump; no framework import outside `packages/kernel` |
| Manifest schema or renderers | Schema validation, secret-name lint, domain-conflict check, `railway config plan` against a scratch project, compose bring-up smoke test ([platform-manifest skill](../.agents/skills/platform-manifest/SKILL.md)) |
| Control-plane, provisioning, identity, billing or execution-plane behavior | [tenant-safety-check skill](../.agents/skills/tenant-safety-check/SKILL.md) run and reported; cross-tenant authorization tests; zero-secret path audit including logs and error payloads |
| Database schema | Forward-only migration test from the previous revision, plus the documented rollback story |
| Milestone 0 experiments | A record under `spikes/` with configuration, observed results, limits, and how to re-run it; a spike is not acceptance for a product capability |
| Vendored framework upgrade | `plan --to <ref>` report reviewed (especially boundary files), then `apply`, `verify`, and the conformance suites |

Environment notes for the current machine, not project requirements: Node is built without TypeScript
support so `.ts` tooling runs via `tsx`; `npm` needs `npm_config_cache` pointed inside the workspace.

## Experimental work

An authorized experiment answers a bounded question in isolated state — `spikes/` for code,
`.research/` (gitignored) for retrieved evidence. Record configuration, versions and limits so the
result is reproducible or falsifiable. Retaining experimental work as product requires the applicable
acceptance and review above; a green spike does not establish delivery.

## Release policy

Integration into `staging` does not close an implementation issue. When a release is requested:

- Derive shipping changes from a pinned previous-release-to-candidate range; review each linked
  issue's **actual** acceptance — an empty checklist is not evidence — and flag partial
  implementations for maintainer decision rather than assuming they shipped.
- Prepare version and changelog updates on an issue branch with a `staging` PR. Only the maintainer
  approves and merges the release PR to `main` and authorizes publication.
- Published tag identities are retained; corrections ship as a new version. Refresh candidate scope and
  checks when its sources change.
- A release that includes a new platform catalog entry must satisfy that platform's manifest CI gates;
  a release that changes a capability contract states the derived bump and why.
- No public license is granted for platfolio code until decision **OD2** is made
  ([design/01](design/01-product-and-decisions.md)); do not add a `LICENSE` file as a side effect of
  tooling work, and do not disturb `vendor/cordis/LICENSE`, which must travel with the vendored source.

## Documentation currency

When a claim is superseded, mark it superseded with the date and reason instead of silently rewriting
history — that is how [platfolio-feasibility.md](platfolio-feasibility.md) records what E9 changed. If
a document starts describing the starter package again, it belongs in
[scaffold](https://github.com/fractalsynapse/scaffold), not here.
