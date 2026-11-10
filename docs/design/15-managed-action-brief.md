# The managed action — a brief for whoever builds it next (#123)

This file exists because the session that got platfolio to this point ran out of context before writing the
action. Everything below was true at `staging = e059bef`; verify it rather than trusting it — that is the
habit this project has been paying to build.

## State to know before touching anything

| Fact | Where to confirm |
| --- | --- |
| Org-owned app `platfolio-local` (5694176), installation 180457153, `administration=write` **granted** | `pnpm run app:check` — it prints what the installation actually has, not what we asked for |
| platfolio's first install PR is open and **must stay a draft** | draft PR #122 on this repo; the pin inside it points at an action that does not exist |
| Re-running the install is safe and updates #122 rather than duplicating it | `pnpm run install:pr -- --apply --draft` (verified live) |
| Environments `production` and `staging` exist on the tenant repo | `GET /repos/fractalsynapse/platfolio/environments` |
| A repository platfolio creates is **invisible to platfolio** | #130 — measured 201 then 404 on every follow-up, unscoped token included |
| Required reviewers **are** settable by API (`User`/`Team`; `App` refused) | #126, `ensureEnvironment` |
| Open debt, needs the maintainer | `fractalsynapse/platfolio-probe-template` is a leftover probe repo; neither the app (out of selection) nor `gh` (no `delete_repo` scope) can remove it |

Read first: `packages/manifest/src/render-install.ts` — that workflow *is* the specification. Then
`workflow-runner.ts` (dispatch, `runState` — still has no caller; this action is its first consumer),
`github-writes.ts`, `secret-writer.ts`, `binding.ts`, `railway-provider.ts`.

## The sequence the action must implement

1. Read the dispatch inputs: `instance_id`, `dispatch_id`, `nonce`, `plan_hash`, `action`, `environment`.
2. Authenticate the job to platfolio with its **OIDC id-token** — `id-token: write` is in the workflow's
   permissions block precisely so the job can prove who it is without any stored credential.
3. Fetch the plan for that instance.
4. Verify `nonce` is single-use and `plan_hash` matches what platfolio issued. Without both, a re-run of an
   old workflow run re-applies an old plan — the failure mode where infrastructure drifts backward while every
   check is green.
5. Mint a provider token for **this job only** (Railway project token, least privilege, held for the run).
6. Call the provider: `applyPlan` / `readState` / `deleteInstance`.
7. Emit a **structured outcome** — status, changed resources, partial-apply detail. `runState` consumes that,
   never a log transcript: workflow logs routinely contain resolved environment values, which is why D30 law 2
   forbids reading them and why this action must not "helpfully" print a diagnosis.
8. platfolio verifies the attestation (D16). **This is the assumption no fake has ever falsified** — until a
   real run exists, "attestation verification works" is unproven, and it should be reported that way.

## Design questions to settle in #123 before writing code

- **Packaging (settled, D37)**: composite action in this repository, pinned by commit SHA. #130 matters
  here -- and in-repo packaging sidesteps it, because this repository already exists and is installed onto.
  here: if platfolio cannot operate on a repository it creates, it cannot own a published action repo either.
- Where the control-plane URL comes from (per-tenant? in the workflow? in the plan?).
- **D36 is settled while this is written**: platfolio creates and updates tenant repositories and does not
  delete them. Eject and suspend remove platfolio's management records and leave the repository to its owner,
  so the action must never issue a repository delete, and no design here should reintroduce that capability.
  The one that removes infrastructure -- `deleteInstance` -- deletes provider resources (services, volumes,
  databases, the project), never source.
- Behaviour when `plan_hash` is stale (settled, D37): **refuse and report**. Applying the current plan would
  let a queued dispatch move infrastructure to a state an operator has since superseded.
- How a **partial** apply is distinguished from a total failure in the outcome — otherwise the controller
  collapses two different states, which is the recurring sin in this codebase.

## Constraints that do not bend

- A secret is written once and never read back (D32). No log access at any layer — asserted in tests
  structurally *and* behaviourally, so keep both checks when restructuring.
- A pinned ref must be a commit the release job built (D30 law 3). A tag is not a trust anchor.
- Curated workflows ship as pull requests the tenant can refuse (D30 law 4). Nothing about this action changes
  that; PR #122 is the demonstration.
- Releases: merge to `staging` on green tests; `main` only with the maintainer's express permission; bare
  semver tags, never without a passing Production run; **never** `--delete-branch` on a release merge (that
  deleted `staging` once).

## How this project prefers to work, learned the expensive way

Assertions that cannot fail are decoration; prove gates in the failing direction. Fakes more forgiving than the
real API document a fictional API — pin exact URLs and methods, and make the double disagree with a wrong
implementation. A documented response description is evidence about a shape, not the shape (that cost a lost app
registration). Never print a success body from a probe — one leaked a live installation token. `pnpm run`
drops flags without a bare `--`. And when something is unverified, say so in the same sentence as the success.
