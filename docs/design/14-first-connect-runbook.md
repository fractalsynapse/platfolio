# First connect runbook (M2)

The plan of record describes M2 as a flow; this is the ordered list of what actually has to happen for the
first tenant, with the two steps that require a human at a browser marked. Nothing here is implemented yet —
the runbook exists so those steps are one action each rather than a scavenger hunt.

**First tenant: platfolio hosting platfolio.** Chosen over a throwaway repository because every resource is
ours to create, destroy and refuse, and because issue #113 was already asking whether the Compose format is
pleasant to author. The offline half is done (`platforms/platfolio/`); the live half is this list.

## Steps requiring a human

1. **Register the GitHub App locally.** `pnpm run app:local`, then open `http://localhost:8077` — the page
   POSTs platfolio's manifest to GitHub's own form (the flow requires a POST, not a link with the manifest
   encoded), GitHub redirects back to the laptop with a one-time code, and the script exchanges it for the
   app id, client id and private key into `.secrets/platfolio-app.json` at mode 0600. No tunnel, no public
   host, no webhook: localhost callbacks are what GitHub's own tutorial uses, and platfolio polls
   installations rather than receiving deliveries. Details and sources:
   [github-app-local-registration-2026-11-10.md](../research/github-app-local-registration-2026-11-10.md).
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

Step 2 -- installing on this repository -- is the remaining human action.

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
