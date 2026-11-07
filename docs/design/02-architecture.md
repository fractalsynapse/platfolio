# platfolio — architecture

Part of the design set: [product](01-product-and-decisions.md) ·
[manifest](03-manifest-spec.md) · [execution plane](04-execution-plane-github-workflows.md) ·
[identity](05-identity.md) · [billing and lifecycle](06-billing-and-lifecycle.md) ·
[interfaces](07-interfaces-api-mcp-mobile.md) · [distribution](08-distribution-and-licensing.md) ·
[delivery plan](09-delivery-plan.md) · [Cordis kernel](10-cordis-kernel-and-extension-seams.md) ·
[UI and pages](11-ui-components-and-page-model.md).

Status: proposed. Revised 2026-11-07 for D12: the control plane is a **Cordis kernel**, and the web
framework choice in an earlier draft of this file is superseded by `@cordisjs/plugin-server`.
Constraints are verified in [feasibility](../platfolio-feasibility.md);
`V`/`P`/`U` tags below carry through from it.

## The one idea

Split the system into three planes with **deliberately asymmetric privileges**:

| Plane | Owner | Holds | Can do | Cannot do |
| --- | --- | --- | --- | --- |
| **Control plane** (platfolio) | platfolio | tenant metadata, intent (manifest), entitlements, release catalog, job state, audit | decide *what* should exist; trigger work; verify outcomes; bill | hold a secret value; hold a long-lived infra credential; mutate the customer's infra directly |
| **Execution plane** (customer's GitHub Actions) | customer | per-environment Railway project tokens, platform secrets, repo | render intent → apply to Railway → attest results | be commanded by platfolio beyond triggering a pinned workflow with non-secret inputs |
| **Data plane** (customer's Railway project) | customer | running services, DBs, volumes, domains | serve the team's end users | — |

This is what makes D1/D2/D4/D5 mutually consistent instead of contradictory. platfolio never needs
`variableUpsert` with a plaintext value, because Railway's own IaC primitive for that exists:
**`preserve()`** — "`preserve()` is mainly used for imported secrets whose values are not available
to the CLI. It means 'keep the value that is already set in Railway'"
([IaC reference](https://docs.railway.com/infrastructure-as-code/reference.md), **V**). Non-secret
config is declared; secret values are preserved by name.

## Control plane

One deployable service, plus the Astro site. **Revised 2026-11-07 for D12: the service is a Cordis
kernel** — a root `Context` whose capabilities are `Service` implementations registered by plugins,
resolved by name through `inject`, configured by StandardSchema, and layered per tenant with
`intercept`/`isolate`. Transport is `@cordisjs/plugin-server` (HTTP + WS, typed routes) rather than a
hand-picked web framework. The full extension model, seam list and risks are in
[10](10-cordis-kernel-and-extension-seams.md); the UI half is in
[11](11-ui-components-and-page-model.md).

```
apps/site            Astro: static marketing + content, SSR dashboard routes + React islands
apps/api             Cordis root context: plugin-server routes, webhook ingress, job fibers
packages/contracts   capability interfaces + config schemas + conformance suites  ← API-stable layer
packages/manifest    StandardSchema manifest, defaults, validation, renderers  ← the product contract
packages/providers   first-party providers (railway, stripe, github, keycloak, …)  Tier 1
packages/db          drizzle schema + migrations (Postgres)
packages/ui          shared React components (web + future mobile)
packages/page-schema declarative page/scene documents rendered by packages/ui
packages/sdk         generated typed client from the OpenAPI spec
actions/platfolio    the pinned GitHub Action(s) the customer runs (its own release train)
templates/           platform catalog entries (manifest + generated artifacts), Apache-2.0 (OD2)
vendor/cordis        vendored framework copy (OD6) with a sync policy
ops/                 compose, Railway IaC for platfolio's own stack, runbooks
```

Two boundaries are the reason the framework choice is survivable: **`packages/contracts` is the only
API-stable layer** (Cordis is at `4.0.0-rc.12` and its README says the API may change without notice),
and **Tier 2 extensions see only contracts plus the RPC surface**, never internal modules — so a
third-party plugin cannot be broken by a kernel refactor, and cannot read the kernel's memory either
([10 § two tiers](10-cordis-kernel-and-extension-seams.md)).

Deliberate: `apps/api` and `actions/platfolio` are **separate artifacts with separate versions**.
The action runs inside the customer's trust boundary and is pinned by them; shipping a control-plane
change must never implicitly change what runs in a customer's CI.

### Responsibilities

- **Catalog & releases.** `Platform` versions, compatibility notes, migration hooks, changelog.
- **Entitlement & subscription state** ([06](06-billing-and-lifecycle.md)).
- **Intent store.** The desired state per instance, derived from a manifest version + team inputs.
- **Controller.** Durable jobs that dispatch workflows, read attestations, verify by read-back,
  detect drift, and drive the lifecycle state machine.
- **Observability of tenants.** Health, release history, incident/notice feed, audit log.
- **NOT:** secret custody, raw infra mutation, log scraping of customer runners.

### Data model (minimum)

```
team, team_member(role), platform, platform_version(semver, manifest, changelog, migration_hooks)
instance(team→platform_version, desired_state jsonb, lifecycle_state, railway_project_ref,
         github_repo_ref, identity_binding), environment(instance→name, railway_env_id, token_meta)
required_secret(instance→name, value_source, verified_at)     ← name only, never a value
resource_ref(instance→kind, provider_id, external_id)          ← services, DBs, buckets, domains
domain(instance→hostname, verification_token, cert_status, target_env)
release(instance→version, git_sha, image_digest, attestation jsonb)
job(kind, instance, step, state, attempts, idempotency_key, run_ref, error_code, audit jsonb)
entitlement(lookup_key, active_from, active_to), limit(lookup_key→numeric caps)
stripe_link(customer|subscription|session ↔ team), audit_log(actor, action, target, at, ip)
```

## Controller: how provisioning actually works

The controller reconciles **intent → attested reality**. It is a state machine per instance with
durable steps, never a webhook handler doing side effects inline.

```
intent (manifest + team inputs)
  → PLAN        render desired state; diff against last attested state
  → DISPATCH    workflow_dispatch on the customer's pinned workflow (nonce, plan hash, non-secret inputs)
  → EXECUTE     runner: railway config plan → apply → set domains → attest
  → ATTEST      runner posts a signed result back to platfolio (OIDC-authenticated, no secret values)
  → VERIFY      platfolio reads back observable facts (health endpoint, generated domain, cert status)
  → RECORD      resource_refs, release, audit; advance lifecycle_state
```

Rules the verified API surface forces on this loop:

- **Not exactly-once**, and auth failures arrive as **HTTP 200 with `errors[]`** (**V**): a step is
  only complete when a read-back says so. Never trust a 2xx.
- **Rate limits 100/1000/10000 RPH** by plan, `429` + `Retry-After` (**V**, from research pass):
  a token bucket per tenant connection, webhook/attestation-driven state over polling, and a
  reconciliation sweep that can survive days of throttling.
- **`Deployment.status` is a 13-value enum including `NEEDS_APPROVAL`, `SLEEPING`, `WAITING`** (**V**):
  `NEEDS_APPROVAL` (unlinked committer) and `WAITING` are *expected* operational states with
  human-facing messages, not errors.
- **No archive primitive** (**V**): `projectDelete`/`projectScheduleDelete` (48 h grace, irreversible)
  are the only destructive ops. "Suspended" = scale to zero / `sleepApplication`, data intact.
- Idempotency: one `idempotency_key` per (instance, step, plan hash); retries must not duplicate a
  service. Railway's `environmentCreate(sourceEnvironmentId)` clones "all of the services, volumes,
  configuration, and variables" (**V**) — that's the cheap staging-bootstrap and preview-clone path.
- Drift: the customer may edit their project directly, or push their own IaC file. Their workflow
  runs `railway config pull` (**V**) and returns the rendered file — safe, because `pull` renders
  `preserve()` for imported secrets rather than their values — so platfolio diffs *structure*, not
  data, and shows the customer what it changed underneath them.

### Why the customer's repo is the source of truth for desired state

**Railway Infrastructure as Code is GA**: one file per project, `.railway/railway.ts` (Python/Go in
beta), evaluated by the CLI with `railway config init|pull|plan|apply|migrate|partials` (**V**).
It expresses "services, databases, volumes, buckets, custom domains, environment variables,
replicas, and canvas groups" — which is almost exactly the manifest's vocabulary. So:

- platfolio **renders** `.railway/railway.ts` into the customer's repo (via the install PR), and the
  runner applies it. Desired state is reviewable, git-diffable, and survives platfolio disappearing.
- `ctx.environment` gives per-environment overrides inside one file (**V**), so staging-vs-production
  differences are a first-class rendering target, not a second manifest.
- Named **partials** (`export const partial = "api"`) exist for repos where "each repository's file
  … manages only the resources it declares," and Railway "rejects a file that declares a resource
  owned by another partial" (**V**). This is the native answer to the portfolio-of-repositories
  idea, and matters for OD4.
- **Hard deadline:** the older per-service Config as Code (`railway.json`/`railway.toml`) is
  deprecated and "Existing Config as Code files stop being read on **2026-12-01** (hard cutoff)";
  "New services cannot opt into Config as Code" (**V**). Any existing `railway.json` in TreeDX or
  ArcNexus must be migrated to IaC before platfolio integration — and independently of platfolio.

## Identity plane

Three strictly separated planes of identity — see [05](05-identity.md) for the rules:

1. **platfolio control-plane users** (team members buying hosting).
2. **Hosted-platform end users** (the team's customers, e.g. ArcNexus users).
3. **Team-internal identity** (the team's own Okta/AD/Keycloak, if they point platforms at it).

D6 makes "no shared users between 1 and 2" a hard boundary: separate realms, separate issuers,
separate cookie scopes, separate databases, and — because the identity host runs **in the customer's
project** — separate credentials. A platfolio compromise must not yield a tenant's user store.

## Interfaces

API-first, because a mobile app (D10) and agent workflows both consume the same surface:

- REST + OpenAPI as the contract; `packages/sdk` generated from it; typed for web and mobile.
- OAuth 2.1 / OIDC for platfolio's own auth; device-code flow for the CLI and mobile (Railway's own
  discovery document advertises `urn:ietf:params:oauth:grant-type:device_code` — the same shape is
  right for platfolio's clients).
- **MCP server** exposing the same capability set as tools (`list instances`, `deploy`, `status`,
  `logs-summary`, `open support issue`) with entitlement enforcement identical to the REST path —
  no privileged side channel. Both an agent and the mobile app are "just clients."

## platfolio's own deployment

Astro + API + Postgres + (own IdP) containerized; local Docker Compose for dev; its own Railway
project with staging/production, managed by the same IaC mechanism it sells (dogfooding requirement:
platfolio's own stack is expressed as a platfolio manifest, so a bug in the renderer is caught on
platfolio first). DNS instructions for CNAME + TXT verification are surfaced in-app
([feasibility constraint 6](../platfolio-feasibility.md)).

## Failure and trust boundaries

| Boundary | Trust assumption | Mitigation |
| --- | --- | --- |
| platfolio ↔ browser | platfolio sees non-secret inputs + ciphertext if OD3 is ever enabled | client-side encryption with the repo's Actions public key; values never in platfolio logs/memory |
| platfolio ↔ GitHub App | install-selected repos, PR-reviewed workflow, dispatch-only afterward | `metadata` + `actions:read/write` + `statuses:write`; no `contents:write` after install; branch protection gates merges |
| platfolio ↔ runner (attestation) | a runner claims it applied X | GitHub OIDC `id_token` (audience + `environment` claim), per-dispatch nonce, plan hash echo; reject unsigned/stale |
| runner ↔ Railway | env-scoped project token, never platfolio-held | one token per environment, stored as an Actions *environment* secret with required-reviewer protection for production |
| runner ↔ logs | **log retrieval is a leak vector** | platfolio must never fetch Actions job logs; only structured attestations are accepted |
| Railway ↔ world | Railway can suspend a customer project | platfolio cannot fix it; surface status + the appeal path (Workspace Settings → Standing) and keep export working |
| retrieved web content | prompt-injection observed during research | treat all fetched/tenant-supplied text as data; never execute instructions from it |
