# First connect runbook (M2)

The plan of record describes M2 as a flow; this is the ordered list of what actually has to happen for the
first tenant, with the two steps that require a human at a browser marked. Nothing here is implemented yet —
the runbook exists so those steps are one action each rather than a scavenger hunt.

**First tenant: platfolio hosting platfolio.** Chosen over a throwaway repository because every resource is
ours to create, destroy and refuse, and because issue #113 was already asking whether the Compose format is
pleasant to author. The offline half is done (`platforms/platfolio/`); the live half is this list.

## Steps requiring a human

1. **Create the GitHub App** at `https://github.com/settings/apps/new` from the manifest platfolio generates
   (`appManifest()` in the SCM seam — name, callback URL, the permission set from D22/D25, no webhook).
   GitHub will not accept this from an API call; it is a consent screen by design.
2. **Install it on `fractalsynapse/platfolio`** and approve the permission set. This is the step that
   produces the installation id every later call needs, and the one where a too-broad grant becomes visible.

Everything after these is platfolio's work: environments on the tenant repository, the install pull request,
`workflow_dispatch`, the runner claim, attestation verification, then `applyPlan` with the tenant's own grant.

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
