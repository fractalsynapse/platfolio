# First connect runbook (M2)

The plan of record describes M2 as a flow; this is the ordered list of what actually has to happen for the
first tenant, with the two steps that require a human at a browser marked. Nothing here is implemented yet —
the runbook exists so those steps are one action each rather than a scavenger hunt.

**First tenant: platfolio hosting platfolio.** Chosen over a throwaway repository because every resource is
ours to create, destroy and refuse, and because issue #113 was already asking whether the Compose format is
pleasant to author. The offline half is done (`selfhost/`); the live half is this list.

## Steps requiring a human

1. **Register the GitHub App locally.** `pnpm run app:local`, then open `http://localhost:8077` — the page
   POSTs platfolio's manifest to GitHub's own form (the flow requires a POST, not a link with the manifest
   encoded), GitHub redirects back to the laptop with a one-time code, and the script exchanges it for the
   app id, client id and private key into `.secrets/platfolio-app.json` at mode 0600. No tunnel, no public
   host, no webhook: localhost callbacks are what GitHub's own tutorial uses, and platfolio polls
   installations rather than receiving deliveries. Details and sources:
   [github-app-local-registration-2026-11-10.md](../research/github-app-local-registration-2026-11-10.md).
      No `repository_creation` permission is requested, because **that permission does not exist** on GitHub's
   published API surface — I asked for it once from a docs sentence about a feature-flagged "Repository
   creation", and an unknown manifest key is precisely what made GitHub reject the first registration. The
   consequence is #130, unresolved: the app can create an organization repository (201) and cannot see it
   afterwards (every follow-up 404). So either the installation's repository access is set to **All
   repositories**, or tenant repositories are created by the tenant and installed onto. There is no
   permission-shaped workaround.

   GitHub will not accept the registration from an API call; it is a consent screen by design, and all three
   legs of the handshake must finish within an hour.
2. **Register it under the organization, then install it.** A private app can only be installed on the
   account that *owns* it, so an app created through the personal `settings/apps/new` page cannot be
   installed on `fractalsynapse` repositories at all — the symptom is an install page listing only personal
   repos, with no error. `pnpm run app:local -- --org fractalsynapse` posts the same manifest to the
   organization's endpoint instead. (Note the bare `--`: `pnpm run` does not forward flags without it, and a
   dropped `--org` silently produces a personal-owned app.) Then install at
   `https://github.com/apps/<slug>/installations/new` and approve the permission set. The script is still listening and polls `GET /app/installations` with a
   short-lived app JWT, so it records the installation id by itself — this is the step where a too-broad
   grant becomes visible.

Everything after these is platfolio's work: environments on the tenant repository, the install pull request,
`workflow_dispatch`, the runner claim, attestation verification, then `applyPlan` with the tenant's own grant.

## Status of the first two steps

Step 1 is **done and verified live**: the app registered from a laptop with no tunnel, and `GET /app` under an
app JWT returned 200 as `platfolio-local` (app id 5693967) -- which is also the first live proof that
`createAppJwt` meets GitHub's expectations rather than only our own. `pnpm run app:check` re-verifies this at
any time and reports `/app` and `/app/installations` separately, because "app works" and "app is installed"
are different states and the second was `0 installations` when last checked.

Step 2 is **done and verified live**: app id 5694176, installation 180457153 on `fractalsynapse`,
`repository_selection: "selected"` yielding exactly `fractalsynapse/platfolio`, with an installation token
minted for the read and revoked immediately after. The next step is platfolio's own: environments on the
tenant repository and the install pull request.

## Step 3: the install pull request

**Done as a write, open as a review.** platfolio opened [#122](https://github.com/fractalsynapse/platfolio/pull/122)
against this repository — one commit, `.github/workflows/platfolio-managed.yml` + `PLATFOLIO.md`, no secret
values, installation token revoked afterwards. It is a **draft**, because the managed action it pins is not
implemented (#123), and merging it today would add a workflow that cannot run. Refusing or closing it is also
a valid result; that is why it is a pull request.

**Amended by D35, and measured since (#126):** platfolio creates environments *and attaches their required
reviewers* through the API — `PUT …/environments/{name}` accepts `reviewers: [{type: User|Team, id}]` and
refuses `type: App`, since an app must not approve its own deployments. So the production gate is configured by
platfolio and owned by the tenant, with no UI-only exception. One trap: `PUT` replaces, so omitting
`reviewers` keeps the gate while `reviewers: []` removes it, and both answer 200.

The other measured finding changes the template plan: **a repository platfolio creates is not visible to the
app** (`PATCH`, `generate` and `DELETE` on an app-created repo all answer 404, even with an unscoped token),
because the installation's selection never includes it. Repository creation therefore requires GitHub's
`repository_creation` permission, which grants access to repositories the app creates — #125 — and until that
lands, tenant repositories are created by the tenant and installed onto, not generated by platfolio.

Before D35, platfolio could not create environments at all: Granting it is a two-part change: widen the permission on the app registration, then have the
organization owner **approve the new permissions** — an installation keeps its old grant until that happens,
which `pnpm run app:check` now shows by printing what the installation actually has. Required reviewers may
still be a UI-only setting; `wait_timer` is confirmed settable, the reviewer gate is an open check.

Recorded with its experiments in
[github-install-write-path-2026-11-10.md](../research/github-install-write-path-2026-11-10.md): a tree
containing a `.github/workflows/` path needs `workflows: write`, and **platfolio does not create environments**
— creation requires `administration: write`, which we deliberately do not hold, so the tenant configures the
production gate or it appears on first run.

## What each step is meant to falsify

| Step | The assumption it tests |
| --- | --- |
| App creation | That the offline registration round trip matches what GitHub actually asks for |
| Install | That the permission set is sufficient *and* not more than D25 claims |
| Environments | That production/staging environments can be created before any secret is written (D24) |
| Install PR | That a tenant can refuse a curated workflow — the point of shipping it as a PR (D30) |
| Dispatch → runner | That the runner is the only holder of long-lived infra credentials, and the platform token only arrives on the job |
| Attestation | That platfolio can verify a claim from a build it did not perform (D16) — the one no fake has ever proven |
| applyPlan | That the provider works against a project the caller does not own, with a minted grant (#106/#107/#111's consequence for teardown) |

## Known open risk before step 5

`runState` has no caller. The trigger exists (#105) and the state vocabulary is right, but nothing polls it
inside a controller loop, so the first connect run will be the first time a dispatch outcome is actually
consumed. Expect that to be where the next bug is.
