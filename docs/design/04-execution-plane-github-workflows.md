# platfolio — execution plane: GitHub workflows

Implements decisions D2, D4 and D5. Status: proposed. Railway facts verified in
[feasibility](../platfolio-feasibility.md); GitHub facts verified against the REST docs on 2026-11-07.

## Why this plane exists

platfolio must not hold the customer's infrastructure credentials (D2) or their platform secrets
(D4), yet still needs to provision and operate their stacks (the product). Those requirements are
only satisfiable if the thing that holds the privileged credentials is **the customer's own CI**.
GitHub Actions is where the customer already works (D5, and their "hands-off management that
integrates into our development process"), and Railway's GA Infrastructure as Code gives the
execution side a declarative, plan/apply surface that a workflow can drive.

The result: platfolio sends **intent + a nonce**, the customer's runner applies it with the
customer's own per-environment token, and reports back a **structured attestation**. No secret value
and no long-lived credential ever transits platfolio.

## Supporting facts (verified)

- GitHub Actions secret **values are unreadable via the API**: "Get a repository secret Gets a single
  repository secret **without revealing its encrypted value**", list endpoints "without revealing
  their encrypted values", and the response schema is `{name, created_at, updated_at}`
  ([REST: secrets](https://docs.github.com/en/rest/actions/secrets)) — so platfolio can verify
  *presence by name* and never see content.
- Secrets can be created/updated with an **encrypted value** using the repository/organization
  **public-key** endpoint (`/actions/secrets/public-key` → `{key_id, key}`), so ciphertext can be
  produced client-side and relayed without plaintext ever existing on platfolio (relevant only if
  OD3 is ever enabled).
- `workflow_dispatch` is a documented REST trigger with a `ref` parameter (branch, tag or SHA); OAuth
  and classic-PAT clients need the `repo` scope for it
  ([REST: workflows](https://docs.github.com/en/rest/actions/workflows)). The REST page does **not**
  state a default-branch restriction, while GitHub's Actions event docs attach conditions to the
  "Run workflow" button — treat "which refs can be dispatched" as **U** and settle it in experiment E2
  before designing the trigger matrix.
- Railway has **no per-operation scopes** for tokens; a project token is environment-bound
  (`projectTokenCreate(projectId, environmentId)`, all plans, `Project-Access-Token` header) and OAuth
  consent is selective per project with `project:admin` available in the discovery document. So the
  *least-privilege credential shape* available is "one token per environment" or "OAuth into one
  project" — which is exactly what the runner holds, and what platfolio must not.
- Railway IaC `railway config init|pull|plan|apply|migrate|partials` (**V**) gives the runner a
  plan-first, confirmation-gated apply model — CI-appropriate and reviewable.

## Implementation status (M2 preparation, 2026-11-08)

Contracts exist and are tested; nothing here talks to GitHub or Railway yet.

| Piece | State | Where |
| --- | --- | --- |
| Dispatch intent, attestation payload, runner-claims schemas | **implemented**, `strict` so an unknown key (a smuggled secret) is refused outright | `packages/contracts/src/attestation.ts` |
| Attestation policy checks — audience, issuer, repository, dispatch/instance/action/plan-hash/nonce binding, expiry, replay, unknown environment, production environment gating, clock sanity | **implemented** as `verifyAttestation()`, with 17 tests covering each rejection plus "malformed payload must not burn the nonce" and "no value-shaped field in the payload" | same file; `test/attestation.test.ts` |
| Install pull request (workflow file + `PLATFOLIO.md`) | **generated and tested**: minimal `permissions:` exactly `{checks, contents:read, id-token, statuses}`, required dispatch inputs, push triggers limited to enabled environments, per-dispatch GitHub environment so production is reviewer-gated, action pinned by commit SHA, arm64-only platforms on an arm runner, no empty expression placeholder (the class of bug that took out our own workflow in #9), deterministic byte-for-byte, removal documented | `packages/manifest/src/render-install.ts` |
| Credential custody (D20) | **implemented**: `ManagedCredentialBroker` (one grant per tenant, refuses the five secret-reading operations before the transport, auditable, revocable) and `StrictCredentialBroker` (holds nothing). `runBrokerConformance()` holds both to one standard |
| Secret delivery (D21) | **implemented**: `RelaySecretDelivery` with the four modes; a relayed value reaches exactly one place — the provider port. Receipts, log sinks, recorded surfaces and error paths are asserted value-free, and refusing to write an unsealed secret is a visible degrade, not a silent fallback |
| SCM seam (D22) | **implemented for the credential-free half**: `GithubAppProvider` builds the manifest (permissions as a literal object so widening is a visible diff), the registration URL with an unguessable state, state-checked callback consumption and the install link; `GithubPatProvider` satisfies the same interface with fewer advertised operations. Network half not implemented |
| Environment placement (D23) | **implemented in the manifest layer**: `ownership` + `environments`, per-environment host-overlap validation, `ctx.isEnvironment(...)` guarded declarations, staging hosts derived by `dns.stagingPrefix` and never reused |
| Railway provider | **live-verified at reduced scope (E26, 2026-11-08)**: create project → environment → mint token → create service from `repo:tag@digest` → write configuration → deploy to `SUCCESS` → read back state including hostnames and certificate status → re-apply as a genuine no-op → delete with orphan reporting. Full-scope conformance still fails by design: databases and buckets are unimplemented (E28) |
| JWKS signature verification, live dispatch, live runner claims | **not implemented** | deliberately absent: signature verification belongs to the transport layer, which must pin the issuer; `verifyAttestation` accepts claims, not a raw JWT, so the boundary is explicit in the types |
| `actions/platfolio` composite action, GitHub App registration, tenant credential custody | **not implemented** | needs a real App installation and a tenant repository: see E2/E5 in the delivery plan |

Consequences of that last row: the "with platfolio stopped, `git push` still deploys" acceptance test
for M2 cannot pass yet, and nothing here proves a hosted runner behaves as the contract assumes. That
is the outstanding part of M2, not a detail to smooth over.

## Custody tiers, and what the runner is for (D24)

Two tiers, one codebase, decided by where the provider grant lives. The **managed** tier is the default.

| | **Managed (default)** | **Self-custody (option)** |
| --- | --- | --- |
| Grant holder | platfolio's `credential.broker`: one workspace grant per team, encrypted, refused `variables` reads, audited, revocable | The tenant: a workspace grant in a reviewer-gated `bootstrap` GitHub environment; platfolio holds nothing |
| Provisioning | synchronous: server calls `projectCreate` → `projectTokenCreate` per environment → writes the tokens into the tenant's environment secrets via the secrets API | asynchronous: a bootstrap workflow does the same inside the tenant's repo and reports names/ids back by attestation |
| Deploys | tenant's CI on push, and platfolio dispatches for managed operations | tenant's CI only; platfolio dispatches |
| Continuous state | server-side provider reads (build status, replicas, limits, drift, cost) plus our own HTTP health probes | **HTTP health probes plus scheduled in-CI attestations** — anything requiring a credential must come from their runner, so it arrives on a schedule, not instantly |
| What we may say | *"we will not read tenant secrets"* — enforced at one boundary, audited | *"we cannot read tenant secrets"* — architectural |

### The rule that came out of the runner question

**platfolio does not operate a fleet of runners on tenants' behalf.** A machine that executes a tenant's
job sees that tenant's credential, so a platfolio-run runner forfeits the only reason the self-custody tier
exists while losing the managed tier's advantage: one boundary you can harden and audit, rather than the
same exposure scattered across N ephemeral hosts. It also means executing tenant-controlled workflow code on
our infrastructure, which needs one-runner-per-tenant isolation and an estate that
[00](00-target-architecture.md) forbids.

**Paid *management* of tenant-owned runners** (their compute, their account, lifecycle assistance) stays on
the table as a later service — but it must be sold honestly: management access implies read access, so that
service is a *managed*-tier guarantee delivered on customer hardware, not a way to keep the "cannot" claim.

The mechanism that makes either tier possible was measured, not assumed: a workspace grant performs
`projectCreate`, `environmentCreate` and `projectTokenCreate`; the minted per-environment token performs
`serviceCreate` and `serviceInstanceDeploy` (reached SUCCESS). The account token is required only by the
Railway CLI, so rendered IaC is an ejection/handover artifact rather than a runtime dependency.
[Evidence](../research/railway-token-and-sealing-2026-11-08.md).

## The tenant's experience, counted

The design goal is **setup once, create cheaply**. A step that repeats per platform instance is a bug
in this design, not a detail.

| Stage | Who acts | Count | What platfolio does unattended |
| --- | --- | --- | --- |
| **platfolio deployment** (once per installation, not per tenant) | operator | one click | app-manifest wizard: generate manifest → operator approves in GitHub → redirect returns `code` → exchange for `id`/`pem`/`webhook_secret` → store in the deployment's own secret store; land back in platfolio's UI |
| **Tenant onboarding** (once per team) | tenant admin | 2 clicks + 1 choice | authorize Railway OAuth (or submit one workspace token in mode B); open the App install link and pick repositories; choose the workspace. platfolio creates GitHub environments, mints per-environment provider tokens, writes them as encrypted environment secrets |
| **New platform instance** | tenant admin | one short form | create provider project, open the install PR (workflow + desired-state file + `PLATFOLIO.md`), apply the plan, verify health, hand back a status page |
| **Day to day** | nobody | zero | deploys on push; monitoring, limits, rotation prompts, export |
| **Platform secrets** | tenant, once per instance | one field per secret, or zero | values are entered into platfolio's form and delivered sealed (D21); or `tenant-side`/`runner-side` delivery for mode A and security-sensitive tenants |

Things deliberately **not** asked of a tenant: creating tokens, creating GitHub environments, learning
the provider's UI, installing anything on a laptop, opening a tunnel, or repeating any of the above per
project.

## Components

```
GitHub App "platfolio"          app identity, repo selection, PR + dispatch + status
.github/workflows/platfolio-*.yml   lives in the CUSTOMER repo, pinned by commit SHA
actions/platfolio@vN            the reusable action: render inputs → railway plan → apply → attest
attestation contract            signed POST back to platfolio (GitHub OIDC id_token)
status publish                  commit statuses / check runs so results appear on their PRs
```

## Install flow

1. **Connect** — team admin installs the platfolio GitHub App on a chosen repository (or org with
   repository selection), and platfolio records the repo↔platform pairing.
2. **Install PR** — platfolio opens one PR adding:
   - `.github/workflows/platfolio-managed.yml` (dispatch + push triggers, minimal `permissions:`),
   - `.railway/railway.ts` rendered from the manifest,
   - `PLATFOLIO.md` (what the workflow does, which secrets must exist, how to remove platfolio).
   The customer reviews and merges. **Branch protection is a feature here**: a human approves what
   runs with their credentials.
3. **Connect the provider — one grant, and the tenant never handles a token.**
   *(Rewritten 2026-11-08; the previous text made per-environment token creation a customer task,
   which fails the "as few steps as possible" requirement and the one-time-setup requirement.)*
   - **mode B (default)**: the tenant authorizes Railway OAuth (`workspace:admin`) or submits one
     workspace token to the broker. platfolio then calls `projectCreate`, calls
     `projectTokenCreate(projectId, environmentId)` for each environment, and writes the resulting
     tokens into the tenant's GitHub environment secrets via the secrets API. GitHub environments
     themselves are created by platfolio (`PUT /repos/{owner}/{repo}/environments/{name}`), not by
     the tenant.
   - **mode A (strict)**: the tenant places one workspace token in their own CI secrets and platfolio
     holds nothing; token minting moves into the runner. Same product, one different custodian.
   **E15 result (2026-11-08, measured):** two corrections apply. A workspace grant performs
   `projectCreate`, `environmentCreate` and `projectTokenCreate` but **not** `serviceCreate` — service-level
   work needs the environment-scoped project token, so provisioning is a **two-grant sequence**. And a
   project token authenticates **only** in the `Project-Access-Token` header; presented as
   `Authorization: Bearer` it returns `Not Authorized` on every call, which is very likely the "tokens are
   finicky" experience that prompted the measurement. See
   [the research record](../research/railway-token-and-sealing-2026-11-08.md).

   Either way: **no personal account token, ever**, and per-project tokens are an implementation
   detail nobody sees.

   **Consistency fix, 2026-11-07 — why the obvious alternative is rejected.** An earlier draft of
   this step offered (b) "authorize platfolio's Railway OAuth app and store a refresh token that only
   the runner uses." That is not safe, and the reason is a verified provider fact: **Railway tokens
   have no operation-level scopes** — an environment- or project-scoped credential can still call
   `variables(...)` and read secret values, and OAuth consent grants a *role* (`project:admin` or
   `project:member`), not a capability subset. So "platfolio holds a Railway token but promises not to
   read variables" is a **policy**, not an architecture, and it contradicts decision D4. Under D4 the
   acceptable shapes are:
   - **token custody with the tenant's CI** (chosen for v1), or
   - a **credential broker** service that holds the provider token and exposes a narrower protocol
     which refuses secret-valued calls — future work, and necessarily out-of-process (Tier 2 in
     [10](10-cordis-kernel-and-extension-seams.md)), or
   - platfolio holding **read-only, non-secret** observability credentials, where such exist.

   Railway OAuth stays useful for **P0 login** ("Login with Railway" for platfolio's own users —
   a different concern from infrastructure access) and for a future broker, not for granting platfolio
   mutation rights.
4. **Set secrets** — platfolio shows the required-secret checklist from the manifest. The customer
   fills values in their Railway project (or as GitHub environment secrets that the runner writes
   with `variableUpsert`). platfolio observes only names and health.
5. **Verify** — platfolio dispatches a `check` job: `railway config plan` (no apply) + reachability
   probes; result recorded as an attestation. Only then is the instance `connected`.

## Workflow contract

Triggers, deliberately minimal (`permissions: { actions: read, contents: read, id-token: write,
statuses: write }` — nothing else):

| Trigger | Purpose | Notes |
| --- | --- | --- |
| `workflow_dispatch` (platfolio) | apply infra intent, migrate, rotate, scale, suspend, eject | inputs are **non-secret**: plan hash, instance id, nonce, target environment, action id |
| `push` to protected branches | normal deploy on their own cadence | same pinned action, so platfolio-managed and customer-initiated deploys cannot diverge |
| `schedule` | drift check via `railway config pull` + diff | returns structure only; safe because `pull` renders `preserve()` for imported secrets |
| `workflow_dispatch` (customer) | manual redeploy/rollback they choose | must be allowed to work with platfolio offline — the exit door |

The action is **pinned by commit SHA** in the customer's workflow file (GitHub's supply-chain
guidance), versioned on its own train (separate from the API per
[02](02-architecture.md)), and refuses to run when its manifest-rendered plan hash does not match
what platfolio dispatched (protects both sides from a stale or forged intent).

## Attestation

`POST /v1/instances/:id/attestations` authenticated by the runner's **GitHub OIDC `id_token`**
(audience pinned to platfolio, with `repository`, `environment`, `ref`, `run_id` claims verified
server-side), plus the per-dispatch nonce, plus the plan hash. Payload:

```
{ run_id, nonce, plan_hash, instance, environment, action,
  result: ok|failed|noop, error_code?,
  resources: [{kind, external_id, name}], domains: [{host, status, cert}],
  release: {version, git_sha, image_digest, migration?},
  health: {endpoint, http_status, latency_ms}, duration_ms }
```

Nothing that could carry a secret value. platfolio treats the attestation as a *claim*, then
verifies independently (read-back of deployment status, its own health probe, `domains` query).
Rules:

- **Never fetch Actions job logs** (`/repos/{o}/{r}/actions/runs/{id}/logs` exists and is a leak
  vector). Structured fields only.
- Reject missing/extra claims, expired nonce, unknown plan hash, or an attestation for an environment
  the dispatch didn't request.
- Idempotent by `(run_id, plan_hash)`; retries in the job runner do not create duplicate resources.
- Attestation retention short (e.g. 90 days), because it is customer-infrastructure metadata.

## Failure modes to design for (all observed in the Railway surface)

| Failure | Behavior | Design response |
| --- | --- | --- |
| Runner never starts (queued, quota, removed workflow) | no attestation | dispatch timeout state, customer-facing "your workflow did not run" with a link, no silent retry storm |
| `429` + `Retry-After` from Railway | partial apply | token bucket + exponential backoff inside the runner; plan is resumable because steps verify by read-back |
| Auth denial as **HTTP 200 with `errors[]`** | looks successful | the runner must check `errors` before declaring `ok`; controller cross-checks with read-back |
| `NEEDS_APPROVAL` deployment | waiting on a human | surfaced as an actionable state ("link a GitHub account with contributor access to this project") |
| Apply succeeds, domains don't verify | half-live stack | domain step is separate; TXT/CNAME status reported per record; never mark `live` on partial success |
| Certificate `FAILED` after 72 h | unreachable tenant domain | alert, retry via `customDomainIssueCertificate`, documented Cloudflare-proxy caveat |
| Customer edited the project by hand | drift | schedule job diffs pulled IaC vs intent; platfolio proposes a PR rather than force-reverting |
| Customer's `railway.json` still present | ignored after **2026-12-01** hard cutoff | install step detects and either migrates (`railway config migrate`) or fails connect with a clear reason |
| Repo/branch deleted, App uninstalled | execution plane gone | lifecycle state `execution-plane-missing`; suspend path becomes manual + emailed; export path must not depend on the runner |
| platfolio outage | dispatches queue | their own pushes still deploy — a selling point, and a reason the workflow must be self-sufficient |

## Bring-your-own CD (the "seamless integration" requirement)

Two supported modes, chosen per instance:

- **managed-cd** — platfolio owns the deploy trigger vocabulary; pushes to `main`/`staging` deploy via
  the installed workflow. Simplest hands-off story.
- **oversight-only** — the customer's existing pipeline deploys (Railway's own GitHub App integration
  with autodeploy, which requires "at least one project member has a connected GitHub account with
  contributor access"); platfolio installs only the `apply`/`check`/`drift` workflow and consumes
  release records from their webhooks or from `latestDeployment` reads. Lower platfolio control,
  higher adoption likelihood for teams with existing CI.

MVP ships `managed-cd` (fewer moving parts, one code path through the pinned action) with
`oversight-only` as the documented escape hatch for design review.

## Security review checklist for this plane

- [ ] App permissions are minimal and justified per endpoint; no org-wide admin tokens.
- [ ] Workflow files carry explicit `permissions:` and no `secrets.GITHUB_TOKEN` escalation.
- [ ] Action pinned by SHA; release tags protected; provenance/SBOM published.
- [ ] OIDC audience and claim validation on every attestation; nonce single-use.
- [ ] Zero plaintext-secret code paths (grep-enforced in CI, plus a schema test rejecting values).
- [ ] Rate limiting and queue depth limits on dispatch so a bug cannot hammer a customer's Actions.
- [ ] Uninstall path: one click removes platfolio's workflow PR and revokes app install, leaving the
      stack running and exportable.
