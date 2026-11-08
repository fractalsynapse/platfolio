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
