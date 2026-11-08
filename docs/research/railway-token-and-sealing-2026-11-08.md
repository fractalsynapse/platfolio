# Measured: Railway token behaviour and variable sealing (2026-11-08)

Live experiments E15, E18 and E21 against a development Railway workspace
(`82ba4aff-61f3-4b19-b863-8b650ebb66b2`, Pro plan, created empty for this purpose) using a workspace
token supplied through a gitignored file. **No credential value appears in this document, in git, or in
the conversation** — the token was written straight to `.secrets/` by the maintainer, which the new
credential-hygiene gate refuses to track.

Scratch resources were created and deleted in the same session: one project (`platfolio-scratch`,
`7019327e…`), two environments, one sourceless service (`e18-probe`), one variable, one project token.
`projectDelete` succeeded; the workspace is empty again. **Deployments consumed: 0** (verified:
`deployments.edges` length 0 in both environments) — creating a service without a source does not
deploy, so it does not draw on the 20-services-per-day limit.

## E15 — can one workspace grant do the provisioning chain? PASS, with three corrections

| Operation | Workspace token (`Authorization: Bearer`) | Env-scoped project token |
| --- | --- | --- |
| `projectCreate(workspaceId)` | **works** | n/a |
| `environmentCreate(projectId, name)` | **works** | n/a |
| `projectTokenCreate(projectId, environmentId, name)` | **works** (returns the token string directly; it is a `String!`, not an object) | n/a |
| `variableUpsert(...)` | works | works |
| `variables(projectId, environmentId, unrendered: true)` | works | works |
| `serviceCreate(...)` | **Not Authorized** | **works** |
| `serviceDelete(id)` | not tested | Not Authorized (project-level op, env-scoped token) |

1. **A project token only authenticates in the `Project-Access-Token` header.** With
   `Authorization: Bearer` the same token returns `Not Authorized` on every call. That distinction —
   plus `me` being account-scoped only — is almost certainly the "workspace and project tokens are
   finicky" experience: the token is fine, the header is wrong, and the error says nothing about that.
2. **A workspace token cannot create services.** Provisioning therefore needs *both* grants: the
   workspace grant creates the project and mints an environment-scoped token, and that token does the
   service-level work. This is a change to the custody design's flow, not just a detail.
3. `workspaceApiTokens(workspaceId)` returned Not Authorized for the workspace token, so token
   *listing/revocation* may need a different grant. Unverified.

## E18 — can platfolio write a secret and seal it? NO, and it cannot verify sealing either

Full introspection of the live v2 schema (256 mutations, every type's fields and input fields):

- `variableUpsert` input is `environmentId, name, projectId, serviceId, skipDeploys, value`. There is
  **no seal flag**. `variableCollectionUpsert` is the same shape. `sharedVariableConfigure` does not
  seal either.
- The string `isSealed` occurs **exactly once** in the whole schema: as `Variable.isSealed`, a readable
  field. **No input anywhere accepts it.**
- Worse for the fallback idea: no query field in the schema returns a `Variable` object, so
  `Variable.isSealed` is not reachable through this API at all. platfolio cannot confirm that a
  tenant sealed a secret.
- Read-back measured directly: after `variableUpsert` with a sentinel, `variables(..., unrendered: true)`
  returned the sentinel to **both** the workspace token and the project token.

Consequences, stated plainly:

- **D21's `relay-sealed` is not implementable on Railway.** Write-then-seal, and write-then-verify-sealed,
  both require an API that does not exist. Dashboard-only, per Railway's own docs (3-dot menu → Seal).
- **The managed-mode property is "will not read", never "cannot read".** Invariant 1 in
  [00](../design/00-target-architecture.md) claimed sealing made it architectural in managed mode; that is
  withdrawn. The honest statement for mode B: platfolio holds a grant that can read variables, refuses
  those calls in code at one boundary, and audits them.
- Default delivery stays `tenant-side`. The panel gating built in #33 — render no input fields unless the
  provider reports `sealedVariables` — is now driven by a measured `false` rather than a guess, and it did
  its job: had we shipped relay-sealed, we would have written production secrets that we could read back
  while telling users we could not.

## E21 — can the tenant runner apply Railway IaC without an account token? BLOCKED on the CLI, open on the API

`railway` CLI `5.71.0` (installed into a gitignored scratch dir, deliberately not a repo dependency):

- `railway whoami`, `railway link`, `railway config plan` all reject **both** the workspace token and the
  project token: `Invalid RAILWAY_TOKEN` / `Unauthorized`. Consistent with the CLI validating through an
  account-scoped path (`me` also fails for these tokens, as the docs say).
- So **`railway config plan/apply` is not available to a runner holding an environment-scoped project
  token** — and demanding an account token would break D20's least-privilege rule outright.

But the underlying surface exists and is worth measuring next (**E22**):
`environmentApplyChangeSet(baseConfigEtag, commitMessage, environmentId, input, waitForCompletion)`,
plus `Environment.configEtag`, `Environment.iacPartials`, `environmentIacPartialRelease/Transfer` and
`environmentConfigPlanCommentUpsert`. If a project token can drive the change-set API, config-as-code
works through our own provider implementation — no CLI, no account token, no interactive login in the
tenant's runner. That is the experiment that decides M2's execution-plane shape, and it is the reason
`railway config plan` stays listed as an *outstanding* M1 gate rather than a passed one.

## Reproducing this

Queries used the raw GraphQL endpoint with `Authorization: Bearer` (workspace) or
`Project-Access-Token` (project). Introspection dumps were kept in gitignored `.research/`. Sentinel
values were generated per run and are not recorded here.

#### Self-hosted runner cost — maintainer-attested, not source-verified

The decision on custody tiers turned partly on runner cost, so the facts here are recorded with their
confidence level. GitHub's [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
lists hosted Linux at $0.002/min (1-core) and $0.006/min (2-core), and its billing page lists self-hosted
runners among usage that "remains free independently". Third-party sources reported a $0.002/min platform
charge for self-hosted runners on private repos starting 2026-03-01; the **maintainer states that charge was
announced and then cancelled after customer backlash, and runs three self-hosted runners on private
repositories without it.** That is treated as authoritative for current behaviour and *not* as a durable
assumption: a pricing policy that reversed once can reverse again, so no design may depend on self-hosted
runner minutes remaining free. Marked unverified at source because I could not resolve the contradiction
from the documentation alone.

## Deploy path measured (maintainer-approved): a project token deploys. No account token needed.

With a real service and explicit approval to consume one deploy of the 20/day ceiling:

| Step | Grant | Result |
| --- | --- | --- |
| `serviceCreate(source:{image:"docker.io/library/nginx:alpine"})` | env-scoped project token (`Project-Access-Token`) | created |
| `serviceInstanceDeploy(environmentId, serviceId, latestCommit: true)` | env-scoped project token | `true` → deployment reached **`SUCCESS`** |
| same deploy mutation | workspace token | `true` as well |

**Consequences for OD10, in order of importance:**

1. **An account token is not required to provision or deploy.** The full chain — create project, create
   environment, mint environment-scoped tokens, create services, write variables, deploy — works with a
   workspace grant plus minted project tokens. The only thing measured today that still demands an account
   token is the **Railway CLI**, and the CLI is now an implementation choice rather than a dependency.
2. **Config-as-code as the execution mechanism is therefore optional.** `environmentApplyChangeSet` remains
   unproven (accepted, no observable effect), but deploys do not need it. Rendered
   `.railway/railway.ts` becomes what it should have been all along for a control plane: an **ejection and
   handover artifact** the tenant can apply themselves, not the thing our runner must invoke.
3. **Least privilege is available on the deploy path**: a per-environment project token can be scoped to one
   instance, so a leaked runner credential exposes one environment of one project rather than a workspace or
   an account. That materially strengthens option B in OD10.
4. The earlier `Not Authorized` for `serviceInstanceDeploy` was resource-scoping against a nonexistent
   service id, exactly as suspected — recorded so the negative is not mistaken for a provider limit.

Cleanup: the nginx probe service was deleted immediately after measurement. Remaining in the dev workspace:
one project (`platfolio-e22`), one sourceless service (`e22-probe`) and one variable, kept only so E22b —
what a human-set seal looks like from the API — can still be observed. **Deploys consumed: 1.**

## Deploy-path probe (same session) — inconclusive, and why

`serviceInstanceDeploy(environmentId, serviceId, latestCommit: true)` returned `Not Authorized` for **both**
the workspace token and the env-scoped project token — but with a deliberately nonexistent `serviceId`, so
authorization may simply be resource-scoped and the answer proves nothing. Settling it takes one real deploy
(1 of the daily ceiling), which is why it is left open instead of recorded as a provider limit.

Two earlier probes of mine looked like denials and were not, and are logged so nobody mistakes my mistakes
for constraints: `latest:` is the wrong argument name (`latestCommit:`), and `variables(projectId,
environmentId)` returns `{}` for service variables unless `serviceId` is supplied. Validation and scope are
not authority.

## E22 — follow-up session (same day): can the seal be set or verified by another route?

Prompted by a better proposal from the maintainer: create the secrets for the tenant, tell them to seal
in the dashboard, and *verify* afterwards. That turns on one question — can we read seal state at all?
Two routes were tested against a live project (`platfolio-e22`, `52cb5333…`, one sourceless service,
**0 deploys consumed**, still present so the remaining observation below can be made):

1. **`Environment.config` is a real read surface and is *not* a leak.** `config.services.<uuid>.variables`
   returns `{ "E22_SECRET": { "value": null, "generator": null } }` — the value is withheld even from a
   token that can read the same variable through `variables()`. So config-as-code state is inspectable
   without exposing secrets, which is useful for drift detection. But **no seal flag appears in it.**
2. **The change-set route accepts a versioned graph but the seal flag has no effect.** `railway/iac`'s own
   `defineRailway` serialises a variable as
   `{ "type": "raw", "value": { "value": "…", "isSealed": true } }` — so the *format* carries `isSealed`.
   Submitting that through `environmentApplyChangeSet(input: JSON)` (the `input` must be passed as a
   GraphQL `JSON` variable, since service UUID keys cannot be GraphQL literals; `version: 1`, `edges: []`)
   returned `status: "applying"` with a change-set id. Afterwards: the config etag was unchanged, `config`
   showed no seal state, and **`variables(..., unrendered: true)` still returned the sentinel value.**
   So either the flag is ignored or the apply was a no-op on shape.
3. **Correction to this document's earlier note:** `variables(projectId, environmentId)` returns `{}` —
   the map is **service-scoped**. Reading a service variable requires `serviceId`. My first E18 read used a
   project-level variable, which is why it returned the value without that argument; service-level reads
   behave the same once `serviceId` is supplied.

### Where this leaves the proposal

*Create, instruct, then verify the seal* is not implementable today, because nothing readable distinguishes
a sealed variable from an unsealed one: the flag is absent from `config`, unreadable from `Variable`, and
unaffected by the change-set. **One observation is still missing** and cannot be made from the API side: what
a human-set seal looks like. If `variables(..., unrendered: true)` starts returning nothing for a variable
sealed in the dashboard, then *absence of a readable value* is the verification signal — good enough to
implement the maintainer's flow, with the caveat that a sealed value then also becomes unrecoverable to us
(which is the point).

**Open question handed to the CLI:** whether `environmentApplyChangeSet` applies our rendered IaC at all was
not resolved. The reliable way to learn the exact payload is `railway config plan --json` (which redacts
values unless `--show-values` is passed — never pass it), and that requires an account token, so it must be
run by the maintainer locally rather than by the control plane.

## E26 — the conformance suite against the live API: what it broke, what it proved

Run with `scripts/railway-live-conformance.ts` (one project, `docker.io/library/nginx` pinned by digest,
one service per environment, everything deleted afterwards; the dev workspace is empty again and the
minted project token died with the project). Approximate deploy accounting for the session: **~8 of the
20/day ceiling** — the Railway dashboard is authoritative, not this estimate.

Five findings, all of which the mock either missed or actively contradicted:

1. **`repo@sha256:…` is accepted and never deploys.** A tagless digest reference left a deployment in
   `DEPLOYING` for 20+ minutes; `repo:tag@sha256:…` reached `SUCCESS` in ~20 seconds, and Railway stores
   the string verbatim. Digest pinning is a platfolio invariant, so the tag has to travel with it:
   validation now rejects an untagged image in both the manifest (`image-tag-missing`) and the provider's
   `validatePlan`. **This was invisible offline** — a mock happily deploys whatever string it is given.
2. **`CustomDomain.status` is an object**, not a string: `{ verified, certificateStatus, dnsRecords, … }`
   with `certificateStatus` an enum (`…_VALID`, `…_ISSUING`, `…_VALIDATING_OWNERSHIP`,
   `…_ISSUE_FAILED`). My query asked for a scalar and the API rejected the whole selection set, which is
   how a provider "passes" against a fake and fails on contact.
3. **There is no root `serviceInstances` query.** Instances hang off `Environment`; a field I had
   invented was being answered by my own mock.
4. **A workspace allows one project creation per 30 seconds** (`You are creating projects too quickly`).
   That is a provisioning-queue constraint, not a detail: it bounds how fast a tenant can be onboarded
   and how the conformance suite has to be sequenced.
5. **No per-request deadline can hang an apply indefinitely.** One run sat on an unanswered call for
   20+ minutes while the deployment it was polling had already finished. `HttpRailwayTransport` now
   aborts at 25s by default and the runner has a wall-clock cap; a timeout is an error the controller can
   retry, whereas a hang is a silent stall.

`DeploymentStatus` in full, from introspection: `BUILDING, CRASHED, DEPLOYING, FAILED, INITIALIZING,
NEEDS_APPROVAL, QUEUED, REMOVED, REMOVING, SKIPPED, SLEEPING, SUCCESS, WAITING`. The provider's map was
missing `NEEDS_APPROVAL` — the one state that must reach the tenant as an action rather than look like a
slow deploy — plus `WAITING`, `REMOVING` and `SKIPPED`; unknown values now produce an
`unknown-deployment-status` note instead of being flattened.

**Unresolved, and deliberately not chased further today.** The suite reached the apply stage and then
produced two `FAILED` deployments with `diagnosis: null` alongside a `SUCCESS`, from repeated
`serviceInstanceDeploy(latestCommit: true)` calls on the same image service across cases. The likely
cause is overlapping deploys — the suite re-applies, and the plan marker that makes a re-apply a no-op is
written at the *end* of a successful apply, so a case that failed mid-way leaves no marker and the next
case deploys again. That is a plausible mechanism, not a measured one: the focused probe is whether a
second `serviceInstanceDeploy` while one is in flight is inherently `FAILED` or merely discouraged, and
whether `deploymentCancel` should precede it. It also exposed a design point worth recording: **idempotency
must be established before the mutating call, not after**, or a partial apply makes the retry destructive.

Until that is settled, the honest status of the Railway provider is: transport and read paths verified
against the live API, mutation paths partly verified (create project/environment/service, variable upsert,
single deploy to SUCCESS, project delete, token mint/revoke), and **repeated-deploy behaviour unresolved**.
Full-scope conformance still fails, by design, because databases and buckets are unimplemented.

## E27 — overlapping deploys: my hypothesis was wrong, and the real cause was one missing `{ id }`

**Test A** — two `serviceInstanceDeploy` calls fired back to back on one image service produced **a single
deployment**, which reached `SUCCESS`. Railway coalesces immediate duplicates, so "overlapping deploys fail"
is false as stated. **Test B** — one deploy after the previous settled: also `SUCCESS`. Two deploys
consumed, project deleted, token revoked.

**The actual cause, found by re-running the suite with attribution:**

```
railway projectUpdate: Field "projectUpdate" of type "Project!" must have a selection of subfields.
```

`projectUpdate` returns an object, and my marker write asked for nothing — so the call was rejected at
validation. It sat at the **end** of `applyPlan`, which meant the marker was never stored, so every
subsequent apply re-deployed everything. The grouped attribution the runner printed after the fix made it
obvious at a glance: `platfolio-e26/production/web: DEPLOYING, FAILED, FAILED, SUCCESS` — one service, four
deployments, all of them mine. The same run also showed **two service domains** on one service, because
`serviceDomainCreate` is not idempotent and nothing checked for an existing hostname.

Three changes came out of it:

1. `projectUpdate(id, input) { id }` — the missing selection.
2. **The idempotency marker is written before any mutating call.** Not a performance tweak: with the
   marker written last, a partially-applied plan made its own retry destructive, which is the exact failure
   mode the controller loop exists to avoid.
3. Domains are checked for an existing hostname before `serviceDomainCreate`.

And one tooling fix, because the mock had agreed with the bug: `railway-mock` now rejects any mutation whose
object-returning field lacks a sub-selection. The first version of that guard matched the *mutation's* own
parentheses (`mutation (…) {`), so it could never fail — caught by breaking a query on purpose and watching
the suite stay green. It now reports 2 failures when a selection is removed, and 101/101 when restored.

**Status of E26 after these fixes: unverified live.** The suite has not been re-run against Railway since
the marker fix; ~14 of the tenant's 20 daily deploys are accounted for, so the confirming run (≈3 deploys)
is waiting on the maintainer's go-ahead rather than being spent unilaterally.
