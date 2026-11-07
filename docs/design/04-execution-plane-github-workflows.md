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
3. **Connect Railway** — the customer either (a) creates a **project token per environment** in
   their Railway project and stores each as a GitHub **environment secret** (`RAILWAY_TOKEN_STAGING`,
   `RAILWAY_TOKEN_PRODUCTION`) with required-reviewer protection on the production environment, or
   (b) authorizes platfolio's Railway OAuth app to one project, and platfolio stores only a refresh
   token — used solely by *the customer's runner* via a short-lived exchange, never for
   platfolio-initiated mutations. Option (a) is v1 (D2).
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
