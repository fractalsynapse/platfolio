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

### Deploy path measured (maintainer-approved): a project token deploys. No account token needed.

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
