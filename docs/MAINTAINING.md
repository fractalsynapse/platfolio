# Maintaining platfolio

This document governs development of the platfolio project: its design documents, contracts, tooling,
vendored code and — once it exists — its application code.

The workflow below is the one this repository already uses. It is carried over deliberately, so the
only substantive change from the starter's policy is scope: this is now an application project, and
`docs/MAINTAINING.md` no longer describes an instruction package.

## Onboarding a tenant now goes through the API (D48)

The two operations that replaced the shell step:

```
POST /api/v1/instances/{id}/plan/from-repository   # platfolio reads compose.yaml at the pinned commit
POST /api/v1/instances/{id}/dispatches/{dispatchId}/trigger   # GitHub runs the tenant's workflow
```

Both require `ctx.scm`, which requires three variables in the deployment's own provider project:
`PLATFOLIO_GITHUB_APP_ID`, `PLATFOLIO_GITHUB_INSTALLATION_ID`, `PLATFOLIO_GITHUB_PRIVATE_KEY`. The composition
declares them by name (D4), so `platform:apply` fails until they are set -- and an unset platfolio answers
**503 source-control-not-configured** rather than inventing an empty plan.

Failures worth knowing by their codes: `repository-not-installed` (403) means the App installation cannot see
the repository -- #130, and the fix is the installation selection, not the path; `source-unreadable` (400) means
the path or ref is wrong; `manifest-invalid` (400) quotes the renderer, usually #84's unpinned image;
`workflow-not-found` (502 via the trigger) means the install PR was never merged, because GitHub enumerates
workflows from the default branch only (#149).

`open-install-pr.ts` still renders and opens the PR itself and still defaults `--platform .`. That
remaining local-filesystem logic is the next thing to move behind an operation, not a design decision.

## Repository history: the snapshot orphan, and what was restored

`origin/staging` used to begin at a root commit `d4a2dc8` ("Merge of PR #214") **with no parents**: the
integration line had been recreated from a working-tree snapshot on 2026-11-13. That snapshot's tree is
byte-identical to PR #214's head commit `7a9aa029`, which is how the source of the snapshot was identified.

**It is now repaired** (`c529012`, `0e0f711`): both `7a9aa029` and `main`'s three integration merges are
ancestors of staging, merged with `git merge -s ours` -- a strategy that records the other side as history and
leaves the tree exactly as it was. Verified by comparing the tree object before and after each merge: identical,
and `git diff --stat` against the previous tip is empty. Staging now reaches **346 commits** back to
`50fe8c2 Initial commit` (2026-10-23), and `git merge-base --is-ancestor` answers YES for pre-snapshot work
such as PR #171's `02df442`.

One artifact remains, deliberately: `d4a2dc8` is still a second root, because a commit's parents cannot be
changed without rewriting it. Removing that wart means rebuilding the ~20 snapshot commits so the orphan gains
a parent and force-pushing `staging` -- which would give every commit from PR #215 onward a new SHA and break
the association GitHub holds between each PR page and the commit that was actually merged. That trade is not
mine to make silently, so the duplicate line stays and is documented here.

**Why `git log` was never the right record anyway:** the narrative lives in `CHANGELOG.md` and the decision
register. The orphan proved that -- a repository whose history could be replaced by a snapshot without anything
breaking is a repository that was relying on its files, not its VCS, for institutional memory.

**How to judge "is this branch merged", measured the hard way (four wrong answers in one session):**

| Tool | What it said | Why it mislead |
| --- | --- | --- |
| `merge-base --is-ancestor` | "not contained" | true of every pre-snapshot branch while the orphan line existed |
| `git cherry -q … \| grep -c '^+'` | `0 unapplied` | `-q` prints nothing; the grep counted an empty stream |
| `git cherry -v` | 122–312 unapplied | measures against the orphan line, so the number is history length, not work |
| `git apply --reverse --check` | "not provable" | correct but too strict: later edits to the same files defeat a byte-level reverse patch |

The signals that actually work: the merged-PR record (`gh pr list --state merged --head <branch>`) and the
tree. Branches were pruned only after each was shown contained by one of those, and all 145 refs / 340 commits
were bundled first to `.archive/platfolio-all-refs-20261113.bundle` (gitignored: a bundle is backup, not
source). Recover with `git bundle unbundle .archive/<file>.bundle`, or per-PR with
`gh pr view <N> --json headRefOid` -- GitHub retains `refs/pull/<N>/head` for every merged PR.

## Delivering our own credentials (`--deliver-secrets`)

The first-party stack declares three shared-variable secrets on its `api` service -- the GitHub App identity.
They arrive through the provider seam, the same implementation a tenant's delivery uses:

```sh
PLATFOLIO_GITHUB_APP_ID=... PLATFOLIO_GITHUB_INSTALLATION_ID=... PLATFOLIO_GITHUB_PRIVATE_KEY=... \
  npx -y tsx scripts/platform-deploy.ts --deliver-secrets
```

Read it as a list, not a guess:

- the names and their **location** come from the registered composition, so a credential the platform never
  declared is refused rather than parked somewhere plausible;
- values are read from the local environment, written once, and **never logged, stored or echoed** -- the output
  is names, environment, service, source and the provider's presence read-back (D4);
- anything not supplied locally is listed as left alone, because inventing a value would be worse than an
  incomplete install;
- `verified: false` in that output is real information: the write was accepted but the name was not readable
  back for that service -- which for `source: shared-variable` usually means the attachment is missing, and
  attachment is the second of the two calls.

`--bootstrap-vars` still exists for the two Keycloak bootstrap names, but it is the older shape of this
problem: it talks to the provider's GraphQL endpoint with a hand-written query, knew only two variable names,
and could only reach `production`. When staging was created those three App credentials did not exist in it, and
the plan check correctly reported `secret-unavailable` for both environments -- the honest failure that produced
`--deliver-secrets`. Retiring the raw-GraphQL blocks is #213.

## Two realms, one Keycloak (D56)

platfolio's production and staging control planes share the hosted identity service -- one container, one
database, one certificate, `auth.platfolio.dev` -- and are separated by **realm**:

| Environment | Realm | Seeded with |
| --- | --- | --- |
| production | `platfolio` | `pnpm run identity:seed` (default) |
| staging | `platfolio-staging` | `pnpm run identity:seed --realm=platfolio-staging` |

The issuer and JWKS URIs that express this are **per-environment values** in `compose.yaml`
(`x-platfolio.services.api.environmentValues.staging`), so the difference is declared in the platform
description and lands in the plan hash -- not patched in by a deploy script, and not silently identical.

Deliberately **not** duplicated: a second Keycloak for staging. The identity provider does not need a
development instance (`mode: hosted` says so, D51), so staging borrows the production deployment and gets its
own realm, its own clients, its own users and its own credentials. What a staging token asserts is scoped to
`platfolio-staging`, and production refuses it on audience *and* issuer -- the reverse holds too, which is the
isolation the shared host does not have to provide.

The local development stack keeps its own Keycloak container, and that is not a contradiction: it is the offline
test double (D49), not a deployed environment.

## Releases and credentials are operations, not console work

A platform's build reports its own artifact; nobody types a digest, and nobody types a credential:

```
POST /api/v1/instances/{id}/artifacts       { service, image, digest }   -> 201   (D54)
PUT  /api/v1/instances/{id}/secrets/{NAME}  { service, environment, value } -> 204 (D53)
GET  /api/v1/instances/{id}/secrets?environment=production&service=api    -> presence (D53)
```

Three things an operator should expect from these:

- **A build with no artifact is a pipeline that has not run.** `platform:plan` / `plan/from-repository` refuses
  with the service named and the operation to call. It is not a schema error and will not be reported as one.
  Third-party images (`image:` without `build:`) still require a digest in the document -- nobody's pipeline
  compiles them, so there is nothing to report.
- **A secret read cannot return a secret.** `GET …/secrets` answers `set | missing | unverifiable`. The provider
  redacts values on read (measured: `{ value: null }` even moments after a write), so presence is the strongest
  available claim; `unverifiable` is returned rather than `missing` when the instance has not been applied,
  because "absent" about a project we never touched is a guess.
- **Platfolio's own credentials go through the same door.** `PLATFOLIO_GITHUB_APP_ID`,
  `PLATFOLIO_GITHUB_INSTALLATION_ID` and `PLATFOLIO_GITHUB_PRIVATE_KEY` are declared *by name* in
  `compose.yaml` and delivered via `PUT …/secrets/{name}` into our own Railway project -- the composition
  refuses to apply while they are absent, which is the design working, not a blocker to route around.

`environment.yaml` is the authoritative list of variable names and their custody class (D52); `pnpm run
environment:registry` fails if code reads a variable the registry does not declare, or the registry declares
one nothing reads.

## Publishing the templates, and proving the published thing is the source thing

`templates/` is bundled in this repository, but tenants consume it from three separate GitHub repositories. That
split has no gate in the normal path: every check in `verify` runs offline, so a change under `templates/` is
green the moment it merges while the published template -- the thing someone actually forks -- keeps the old
files. It happened the day the registry was consolidated (D58): `.platfolio/environment.yaml` was deleted here and
remained live in all three published repositories, where `applyInventory` still merges it into the plan. Two
registries per platform, surviving in exactly the place users touch.

| Command | What it does | Needs |
| --- | --- | --- |
| `pnpm run templates:publish` | Dry run: the file list per repository, plus the paths being retired | credentials |
| `pnpm run templates:publish -- --apply` | Publishes. A repository whose whole history is `chore(platfolio)` is updated on its default branch; one carrying someone else's history gets a branch and a pull request | credentials |
| `pnpm run templates:publish -- --apply --template starter-web` | One repository. The first run of any new write mechanism goes here, gets read back, and only then touches the other two | credentials |
| `pnpm run templates:check` | **Parity**, per file, by blob SHA: `STALE` (published content differs), `MISSING` (we ship it, they don't), `ORPHAN` (they ship it, we don't, and it is not a declared retirement) | credentials, read-only |

Three rules that are not obvious and are easy to break again:

- **Retirement is declared, never derived.** The publisher adds and replaces; it does not delete anything absent
  from the source, because a fork adds files (its own Dockerfile, CI, README) and mirror-deleting would eat a
  tenant's work on the next publish. So removing a published path is an explicit entry in `RETIRED_PATHS`
  (`scripts/template-manifest.ts`), and `templates:check` reports any published file that is neither in the source
  nor in that list. The list is therefore not trusted -- an incomplete list shows up as an ORPHAN.
- **A tree built on `base_tree` only adds and replaces.** Deleting a path means a `sha: null` entry for it. And
  the entry must be for a path that exists on the base commit: republishing a repository that already retired the
  path failed with `GitRPC::BadObjectState` (HTTP 422), which is why the writer reads the base tree first and
  reports both halves -- `retired` and `alreadyAbsent`. "Retired X" and "X was already gone" are different facts,
  and conflating them is how a check starts lying quietly.
- **Publisher and checker share one manifest.** `scripts/template-manifest.ts` holds the template list and the
  retirement list precisely so the two programs cannot disagree about what should be published. A checker reading
  a different set than the publisher writes is the least useful kind of gate.

`check-project.ts` carries the offline half -- every platform directory has its registry at its root, no shipped
path is under the retired `.platfolio/` prefix, and no shipped path is declared retired -- because
`templates:check` needs credentials and network, and a check that silently cannot run is not a check. It is
verified by falsification, not by hope: recreating `.platfolio/environment.yaml` in a template, and deleting a
template's `environment.yaml`, each fail the build.

## The environment registry: one file per platform, at its root

`environment.yaml` is both the **central registry** (D52) and, for a platform, its **obligations** (D33): custody,
environments, defaults, and the wiring a deploy resolves. There used to be a second file —
`.platfolio/environment.yaml` — with its own schema describing the same variables. It is gone, because two
documents describing one fact drift, and because the registry used to *scan* the inventory for names: excluding
it and re-running lost nothing, which meant the "source" was a copy.

| Field | Meaning |
| --- | --- |
| `name` | the variable. **One row per name** — a second definition is a second custody claim, and parse order decides which wins |
| `kind` | `value` / `secret` are obligations an operator supplies or defaults; `reference` / `output` are wiring the platform resolves and **must never appear on a panel asking a tenant to type** (D33) |
| `secret` | the custody claim, not a guess: a name shaped like a credential is not proof, and `PLATFOLIO_DB_URL` carries a password in its userinfo (D4) |
| `environments` | `all` — the only legal spelling of the full set — or a subset of `development \| staging \| production` |
| `service` | which service reads it |
| `required` / `default` / `enum` / `rotate` | the obligation's shape. Wiring cannot be `required`, and a secret cannot carry a `default` |
| `database` / `output` / `from` | wiring targets: `database: app-db, output: DATABASE_URL`, or `from: identity#jwks` (D34) |
| `deployedTo` | where the value lives: `railway:shared-variable`, `railway:reference`, `ci:secret`, `local:compose-overlay`, `host:shell` … |
| `note` | provenance, or the judgement behind the row |

Each platform carries its own at its root: `templates/starter-web/environment.yaml` and so on, plus ours. A
platform's registry is authoritative **for that platform** — shared-identity's `KC_DB_URL` is not a variable this
control plane reads, and forcing it into our registry would recreate the duplication this rule exists to prevent.

`pnpm run environment:registry` (in `check`, so in `verify`) fails on:

- a variable referenced in configuration and **not declared**, and a declaration **nothing references**;
- a **duplicate name**, or the full environment set written any way but `all`;
- an obligation that contradicts itself: `kind: secret` with `secret: false`, a secret with a `default`, a
  `reference` with no `database`, wiring marked `required`, a `kind` outside the four;
- a platform registry that yields **no rows at all** — the vacuity guard. Three separate times this session a
  check passed because it was parsing nothing (`git cherry -q` printing nothing; a malformed appended inventory
  line producing zero entries; this function reading an old envelope name). A check that can pass by checking
  nothing is worse than none, because it advertises coverage;
- a secret with a **literal value** in a production-bearing file. A development overlay may hold a stand-in, and
  the test is structural — URL userinfo must be dev-shaped — because a whitelist of "obviously fake" strings is
  how a leak gets blessed.

Judgements live in the `HUMAN` table inside the script, not in the generated file: hand-edit the output and the
next `--emit` silently loses it. That is also where the 16 obligations moved with their notes, which is why they
survive regeneration.

Scope is deliberate. Prose, fixtures and spikes are excluded — an early pass applied a YAML-key regex to
TypeScript and filled the registry with the provider's deployment-status vocabulary (`PENDING`, `NEEDS_APPROVAL`).
And **no registry file is ever a discovery source**: a registry that feeds the derivation that produces it is a
loop, not a check.

## The environment registry (D52)

`environment.yaml` at the repository root is the authoritative list of every variable platfolio reads or
deploys:

```yaml
  - name: PLATFOLIO_GITHUB_PRIVATE_KEY
    secret: true                          # a custody claim, not a guess
    environments: [staging, production]   # development | staging | production, or all
    deployedTo: railway:shared-variable   # where the value actually lives
    note: "referenced by compose.yaml:69, apps/control-plane/src/index.ts:79"
```

`pnpm run environment:registry` (inside `pnpm run check`, so inside `verify`) fails on:

- a variable referenced in configuration and **not declared** -- including the ones that look harmless but carry
  credentials, which is why `DATABASE_URL` and `PLATFOLIO_DB_URL` are marked secret;
- a declaration **nothing references** any more, because a registry that accretes memorials stops being trusted;
- a variable **defined twice**, and the full environment set written any way except `environments: all` --
  `appliesTo` is retired, and so are `ci`, `test` and `local` as environment names. Those three were never
  environments: a laptop and a runner are both the development environment, and where a value lives is
  `deployedTo`'s claim (`ci:secret`, `local:compose-overlay`, `host:shell`). The old file spelled one meaning
  four ways, which is how a registry stops being searchable;
- a secret with a **literal value** in a production-bearing file (D4: commit the name, let the provider hold the
  value). A development overlay may hold a stand-in, and the rule is structural rather than a whitelist of
  friendly strings: any URL userinfo must be dev-shaped, because a whitelist is how a leak gets blessed;
- a secret whose `deployedTo` names no location that could hold it.

Regenerating the skeleton (`tsx scripts/check-environment-registry.ts --emit`) is safe only because the
judgement calls live in that script's `HUMAN` table, not in the file: hand-edit the output and the next
`--emit` silently loses it.

Scope is deliberate. Prose, fixtures and spikes are excluded -- an early pass scanned TypeScript for YAML keys
and filled the registry with the provider's deployment-status vocabulary (`PENDING`, `NEEDS_APPROVAL`). A
registry that invents variables nobody can set is worse than none, because people stop reading it.

## Setting the control-plane endpoint (D47)

Two places ask where the control plane lives, and neither has a default any more:

- **`.github/workflows/platfolio-managed.yml`** reads `vars.PLATFOLIO_URL`. Set it per repository under
  Settings → Secrets and variables → Actions → Variables, value like `https://api.example.com`. A guard step
  fails the run naming that variable when it is unset, because an empty URL failing inside the action is a worse
  first error than a missing-configuration message.
- **`scripts/open-install-pr.ts`** takes `--url=` or `PLATFOLIO_URL`. No default: a committed one points every
  install PR at whoever wrote it.

`pnpm run check` rejects a generated Railway hostname anywhere in tracked files (`checkCommittedEndpoints`), so
the endpoint cannot return as source. Synthetic sentinels and the provider's `.up.railway.app` suffix logic are
allowed on purpose: the rule is about naming a deployment, not about the platform's vocabulary.

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
- Agents **may** integrate a change into `staging` when every applicable check passes and the review
  the change warrants has happened. `staging` is integration work, not a production boundary: merging a
  green, reviewed change there is part of doing the work, and does not need the maintainer's signature.
- Agents **may not** merge to `main`. `main` is the production boundary: a human performs that merge,
  unless the agent has been granted **express permission for that specific production release** — a
  standing instruction to keep working, a green pipeline, or a prior approval for a different release
  does not add up to that permission. Ask, and wait for an unambiguous yes.
- Agents do not publish: creating a GitHub Release, uploading installer or package artifacts, and any
  announcement are separate authorized actions reserved to the maintainer. The production workflow
  prepares and proves a release identity and deliberately stops short of publishing one.
- **Release tags are bare `<major>.<minor>.<patch>`** — `0.1.0`, `1.2.3-rc.1` (D19). The `v` prefix is
  retired: `production.yml` classifies every tag push and **fails** a `v1.2.3`-style attempt rather
  than quietly skipping it, so a mistyped release cannot look like a successful release.
- A tag may be cut **only** on a commit whose Production workflow run on `main` has already passed for
  that exact commit. `production.yml` enforces this on tag pushes, alongside a license check that now
  passes: the root `LICENSE` (Apache-2.0, decision D18) must be present in the tagged tree — note it
  reaches `main` only with the next production integration.
- After an authorized merge, delete only the task-owned branch after verifying its merge commit,
  unchanged branch head, absence of other open PRs or retained work, and worktree use. Preserve
  `staging`, `main` and unrelated branches. Record any retention reason instead of discarding work.

## Branching and gating

Every tier also runs `graphql:check`: each GraphQL document in the provider and the live-runner script
is validated against a committed introspection snapshot (`packages/contracts/railway-graphql-schema.json`, refreshable with
`scripts/refresh-railway-schema.ts`). This exists because Railway's API answers *unknown fields* with a
validation error at runtime and *unknown payloads* with `status: applied` — so both classes of mistake are
invisible until a tenant's apply fails or silently succeeds. The check is negative-tested against the four
bugs it was written for (invented root field, guessed input type name, missing sub-selection, wrong argument
name).

`staging` accumulates integrated work; `main` carries what has been released. Each kind of change is
gated by a workflow under `.github/workflows/`, and all three run the same shared checks from
`scripts/check-project.ts` rather than three private copies of the logic:

| Workflow | Triggers | Adds beyond the tier below it |
| --- | --- | --- |
| **Development** | pushes to feature branches; PRs targeting `staging` | documentation links/anchors and skill metadata; vendored-tree `verify`; type-check of repo tooling; upstream drift reported as a notice, never a failure |
| **Integration** | pushes to `staging`; PRs targeting `main` | the E9 kernel experiment with its locked dependencies, plus an assertion that CI ran without `--expose-internals` |
| **Production** | pushes to `main`; every tag push, classified — release jobs run only for bare semver tags (D19) | on tags: the prior-passing-production-run requirement and the license requirement, then release-notes and checksum provenance as an artifact — and no publication |

Hosted results are the evidence for integration and release decisions. A check that has never run on
the hosted runner is reported as unverified rather than assumed to work, and no tier's green status
substitutes for the review a change actually needs.

Authority to merge is defined by this file. The inherited
[release-workflow skill](../.agents/skills/release-workflow/SKILL.md) deliberately carries no branch,
approval or publication policy of its own — it reads the project's policy first — so these rules belong
here and that skill stays byte-identical to the starter it came from.

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
| `.github/workflows/**` or `scripts/check-project.ts` | Local run of every command the workflow invokes **and** the resulting hosted run on the PR and on `staging`; the workflow YAML parses; permissions blocks are the narrowest that work. Syntax alone is not evidence a workflow runs |

Environment notes for the current machine, not project requirements: Node is built without TypeScript
support so `.ts` tooling runs via `tsx`; `npm` needs `npm_config_cache` pointed inside the workspace.

## Experimental work

An authorized experiment answers a bounded question in isolated state — `spikes/` for code,
`.research/` (gitignored) for retrieved evidence. Record configuration, versions and limits so the
result is reproducible or falsifiable. Retaining experimental work as product requires the applicable
acceptance and review above; a green spike does not establish delivery.

## If `pnpm run <script>` fails before running anything

A sandboxed or shared home can make pnpm's own version manager unwritable, and every wrapped command then
dies with the same message regardless of which script you asked for:

> `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK: lock the package-manager engine store … Read-only file system`

That is not a failing gate. Each check is a plain `tsx` script and runs directly, which is what `verify`
sequences:

```
npx -y tsx scripts/check-lockfile.ts          # lock:check
npx -y tsx scripts/check-project.ts           # check
npx -y tsx scripts/vendor-cordis.ts verify    # vendor:verify   (note: vendor-cordis, not check-vendor)
npx -y tsx scripts/check-graphql-schema.ts    # graphql:check
npx -y tsx scripts/check-api.ts               # api:check
npx -y tsx scripts/bundle-action.ts --check   # action:check
npx -y tsc --noEmit -p tsconfig.json          # typecheck
npx -y tsx --test packages/*/test/*.test.ts apps/*/test/*.test.ts
npx -y tsx scripts/check-contracts.ts         # contracts:check
```

CI installs its own pnpm and is unaffected, so a locally unverifiable wrapper never excuses a merge: run the
scripts directly, or don't merge. Record which you did.

Two corrections to that, learned the hard way:

- **pnpm can work here** when all of its writable state is inside the workspace, which is what a lockfile update
  needs: `TMPDIR="$PWD/.tmp" npm_config_cache="$PWD/.cache/npm" npx -y pnpm@12.4.2 install --lockfile-only
  --store-dir "$PWD/.cache/pnpm-store"`. The failures were the read-only default store *and* my own wrong flag —
  `--lock-only` is not `--lockfile-only`, and pnpm's "did not run" is not a store problem.
- **Dead code cannot come back**: `noUnusedLocals` and `noUnusedParameters` are on in the root `tsconfig.json`,
  found after the sweep listed 29 dead declarations. An intentionally unused parameter is prefixed `_` — the
  convention the compiler honours, rather than a comment claiming the value is deliberate.

## Release policy

Integration into `staging` does not close an implementation issue. When a release is requested:

- Derive shipping changes from a pinned previous-release-to-candidate range; review each linked
  issue's **actual** acceptance — an empty checklist is not evidence — and flag partial
  implementations for maintainer decision rather than assuming they shipped.
- Prepare version and changelog updates on an issue branch with a `staging` PR. Only the maintainer
  approves and merges the release PR to `main`, and only they authorize publication. An agent may do
  that specific production merge only on express permission for that release.
  - **Review gates are waived for the agent's own PRs while the first implementation is being built**
    (D39). The agent merges to `staging` on green tests without waiting for a human and does not stop to
    ask. This is process easing for a platform with no tenants, not an architecture change: the install PR
    keeps its review shape because that is what a tenant will meet, and the two rules above still hold --
    a Production run gates a tag, and a release to `main` needs the maintainer's permission for that
    release. Revisit when the first real platform is hosted.
- **Cut no tag on a commit that has not passed the Production workflow on `main`.** `production.yml`
  enforces this and also requires a root license file (D18: present on `staging`, reaches `main` with
  the next production integration).
- **A release merge never deletes a branch.** On a `staging → main` PR the head branch *is* `staging`, so
  merging with branch deletion removes the long-lived integration branch — which happened while cutting
  `0.3.0` and had to be repaired by pushing the pre-merge head back. Delete task branches only, on PRs whose
  head is a task branch.
- Published tag identities are retained; corrections ship as a new version. Refresh candidate scope and
  checks when its sources change.
- Licences are already on `main` as of `0.2.0` (`LICENSE` Apache-2.0 and `vendor/cordis/LICENSE` MIT), so `production.yml`'s licence requirement is satisfied on both branches; nothing in a release is expected to touch either file.

A release that includes a new platform catalog entry must satisfy that platform's manifest CI gates;
  a release that changes a capability contract states the derived bump and why.
- `check-contracts.ts --update` **classifies** before writing: removals or renames are refused unless passed
  `--ack-breaking="<reason>"`, and the run prints the derived bump (`MAJOR` when anything was removed, `MINOR`
  when only added). Before this, `--update` wrote whatever the diff contained and exited 0, so a breaking
  removal and an additive line were indistinguishable in the log.
- platfolio code and documents are **licensed under Apache-2.0** (D18). `LICENSE` at the root is that
  grant: never edit, move, or replace it as a side effect of tooling work, and treat any change to it
  as a maintainer decision. `vendor/cordis/LICENSE` (MIT, © 2021–present Shigma) is a third party's
  notice and must travel unmodified with the vendored source.
- Because the grant is Apache-2.0 while the vendored tree is MIT, keep both files distinct and do not
  relicense `vendor/cordis` content — including in patches — and confirm the inherited scaffold skills
  need no attribution file: `fractalsynapse/scaffold` publishes no LICENSE of its own (verified 404 on
  2026-11-08), so no notice is owed for those files.

## Documentation currency

When a claim is superseded, mark it superseded with the date and reason instead of silently rewriting
history — that is how [platfolio-feasibility.md](platfolio-feasibility.md) records what E9 changed. If
a document starts describing the starter package again, it belongs in
[scaffold](https://github.com/fractalsynapse/scaffold), not here.
