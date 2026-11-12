# platfolio — delivery plan: Milestone 0 through MVP

Plan for the outcome accepted in [01](01-product-and-decisions.md). Ordered so that each milestone
can be accepted independently and so the cheapest possible failure happens first. Status: **proposed;
execution not yet authorized.** Estimates are planning bands, not commitments.

## Goal and observable acceptance

**Goal:** a team can subscribe to platfolio, connect a repository and their own Railway project, and
get a hands-off managed deployment of a platfolio platform (TreeDX first) with staging and production
environments, their own domain, and no platfolio-held credentials or secrets — and can leave with a
working, exported stack.

Observable acceptance for MVP = the ten items in
[01 § MVP scope](01-product-and-decisions.md), each demonstrated on a real tenant stack (not a mock),
plus these three non-functional proofs:

1. **Zero-secret proof** — a code-and-log audit shows no plaintext secret path exists: no value is
   accepted, stored, rendered or logged by the control plane, and an instance reaches `active` with
   every required secret set out-of-band and verified only behaviorally.
2. **Leaving proof** — export produces a stack that runs in plain Docker Compose with no platfolio
   binaries, tokens or workflows present.
3. **platfolio-down proof** — the tenant's own `git push` still deploys while platfolio is
   unreachable, because the execution plane lives in their repo.

## Exclusions (do not slip these in)

Arbitrary-app hosting; in-browser code editing; billing of Railway usage; multi-cloud; a page builder;
Kubernetes/Helm; a control-plane single binary; Stripe Connect; metered billing; per-customer IdP run
by platfolio; SOC 2 evidence work (controls start, attestation does not).

## Source decisions this plan relies on

D1–D11 in [01](01-product-and-decisions.md); constraints 1–9 in
[feasibility](../platfolio-feasibility.md); contracts in [03](03-manifest-spec.md),
[04](04-execution-plane-github-workflows.md), [06](06-billing-and-lifecycle.md).

## Prerequisites and external dependencies

| # | Dependency | Owner | Blocks |
| --- | --- | --- | --- |
| P1 | Written answer from Railway on platfolio's model under the AUP ("ask us **before deploying**"; `abuse@railway.com`), plus whether OAuth consent by an outside account is intended, and whether hidden-template deploys by another account work | maintainer, via email | M2 design confirmation (not M0/M1 work) |
| P2 | Written answer from Stripe on Agentic Provisioning Protocol multi-tenant orchestration + MoR for the Railway line item, and OD1 direction | maintainer | M4 shape |
| P3 | Migrate any existing `railway.json`/`railway.toml` in TreeDX and ArcNexus to Railway IaC — **Config as Code stops being read on 2026-12-01 (hard cutoff)** and new services cannot opt in | platform authors | everything after M0; independent of platfolio |
| P4 | **Resolved 2026-11-07:** this repository became the platfolio project — remote rewired to `fractalsynapse/platfolio`, `main` pushed, `staging` created, `README.md` and [docs/MAINTAINING.md](../MAINTAINING.md) rewritten as an application change/test/release policy, starter documents removed (maintained in the scaffold repo) | maintainer | — |
| P5 | Test resources: a throwaway Railway project, a scratch GitHub repo/org, Stripe test mode, an Apple Developer + Windows signing decision if an installer ships | maintainer | M0, M6 |
| P6 | **Resolved 2026-11-07:** OD6 and OD7 decided — Cordis vendored at `vendor/cordis` and managed by `scripts/vendor-cordis.ts`; platfolio meets the framework only at `packages/contracts`, with a kernel shell if its surface proves unstable | maintainer | — |
| P7 | Node version pinned in the image and in CI. Cordis loader internals are gated on Node ≥ 22 with a shape difference at 24.12.0, and HMR wants `--expose-internals` or `node-addon-require-builtin`; production must run **without** that flag ([10 R3](10-cordis-kernel-and-extension-seams.md)) | platfolio | M1 onward |
| P8 | **Done 2026-11-07:** `vendor/cordis` at `v4.0.0-rc.12` with license preserved, `vendor/cordis.lock.json`, and `scripts/vendor-cordis.ts` (`verify` is the CI gate). See [vendor/CORDIS.md](../../vendor/CORDIS.md) | platfolio | — |

## Milestone 0 — provider facts and falsifiable experiments (3–5 days)

Purpose: let the plan be wrong cheaply. Deliverable is an evidence file, not features.

| Experiment | Checkable result |
| --- | --- |
| E1 OAuth third-party consent | A Railway account **not** in platfolio's workspace consents platfolio's OAuth app to one project (`project:admin` from the discovery document); the resulting token creates a service; revocation works; dynamic registration at `/oauth/register` either usable or not (documented either way) |
| E2 IaC apply from CI | In a scratch repo, a workflow runs `railway config plan` then `apply` using a **project token** for one environment; plan output captured; confirmation flag identified; secrets survive an apply from a fresh clone (`preserve()` behavior proven, not assumed). Also settle three `U` items here: whether the CLI accepts an environment-scoped project token as its credential (the API path uses the `Project-Access-Token` header), which **refs** are dispatchable via `workflow_dispatch`, and whether `apply` can create the resources a manifest declares (database, bucket, custom domain) or only service configuration |
| E3 Full lifecycle on one stack | `projectCreate`→`serviceCreate`→`variableUpsert`→deploy→`customDomainAvailable`/`Create` with the required TXT→certificate `ISSUED`→`customDomainUpdate` retarget staging→production→`deploymentRollback`→`projectScheduleDelete`; **zero leftover resources** verified by listing |
| E4 Interrupt-and-retry | Kill the controller mid-E3 and restart: no duplicate service, no orphaned domain, no stuck state; auth-denied-as-HTTP-200 and a `429` are each handled with a named error code |
| E5 Attestation trust | A runner posts an attestation authenticated by GitHub OIDC `id_token` with audience/`environment`/nonce/plan-hash validated; forged and stale submissions rejected by test |
| E6 Template handover | A platfolio template deploy lands a working stack in the *clicking* account, `manifest.json`'s `required_inputs` renders a connect form, and a HIDDEN template's cross-account behavior is recorded as fact |
| E7 Stripe lifecycle in test mode | Checkout → `client_reference_id` → entitlement event → provisioning; duplicate, out-of-order and failed webhooks delivered on purpose; `invoice.payment_failed` → past-due → unpaid observed; `automatic_tax` location failure observed as a provisioning gate |
| E8 Fake provider | A stub built from the introspected schema (256 mutations/164 queries, available without a token) runs the controller offline; contract tests against real Railway kept separate and clearly labeled |
| E9 Kernel fit | **DONE 2026-11-07 — passed.** The vendored core + `plugin-loader` + `plugin-include` boot a control plane on Node 22.22.1 **without** `--expose-internals`; provider swap demonstrated by configuration alone (two profiles, `disabled` toggling the entry, identical code), `intercept()` per-scope config layering and clean `fiber.dispose()` both confirmed. Produced two new items: **E13** (published `@cordisjs/plugin-server@1.7.0` is built against the fork `@deepseek-ai/cordis@4.1.0`, not the core we vendored) and **E14** (a malformed profile boots without error). Evidence: [spikes/e9-cordis-kernel](../../spikes/e9-cordis-kernel/README.md) |
| E10 Contract versioning | `packages/contracts` type surface diffed in CI, with the bump classification (additive → minor, tightening/removal → major) shown on a deliberately broken example; a provider that declares an unsatisfiable range prevents startup |
| E11 Tier-2 boundary | A capability implemented as an out-of-process worker reaches the same contract over RPC, cannot read control-plane env or DB (asserted by test), and is pinned by image digest |
| E12 Hot-swap safety | Under `plugin-hmr` in **dev only**: dispose/re-register a provider mid-job and confirm no leaked listener or half-applied step (relies on `ctx.effect()` reversal); document that production uses blue/green, not swap |
| **E13 Core lineage — NEW, created by E9** | Decide deliberately whether platfolio tracks upstream `cordiverse/cordis` (what is vendored, `v4.0.0-rc.12`) or the fork `@deepseek-ai/cordis@4.1.0` (which the published `@cordisjs/*` plugins are built against). Verify the fork's license, provenance and relationship to upstream before any vendoring; then either (a) stay on upstream and author our own transport/provider adapters, or (b) re-vendor to the fork via `scripts/vendor-cordis.ts`. E9 evidence: `@cordisjs/plugin-server@1.7.0` fails route definition against upstream. Blocks M1 kernel wiring |
| **E21 Per-environment resource scoping — NEW, created by D23** | Does `railway config plan` honour a service declared but attached only under `ctx.isEnvironment("production")` — i.e. staging genuinely does not get it, and removal from a later plan does not delete the production one? The generated file type-checks; whether the provider compiles it as intended is a live question |
| **E18 Sealed-variable behaviour — NEW, created by D21** | Does `variableUpsert` honour `isSealed` (present in the introspected schema and the IaC SDK's `VariableConfig`), and is a sealed value then really unretrievable through our own granted credential? Confirm the documented non-copying on environment duplication by cloning a staging environment and observing which values arrive. **Blocks shipping `relay-sealed` as the default** — until then the mode is `tenant-side` |
| **E19 Manifest-flow round trip — NEW, created by D22** | Register a throwaway App through the wizard: browser approval → redirect with `code` → conversion returns `id`/`pem`/`webhook_secret` → stored without a single copy-paste, and the UI returns to the right page. Verify install-link round trip and `GET /app/installations` reconciliation with **no webhook receiver running** |
| **E20 Relay redaction proof — NEW, created by D21** | Post a sentinel value through the delivery path, then grep structured logs, error payloads, crash dumps, queue records, DB rows and APM breadcrumbs for it. The test must be part of CI, because the property is "never persisted or logged" and one future debug statement breaks it silently |
| **E15 — PASS (measured 2026-11-08)** | Workspace grant performs `projectCreate`, `environmentCreate`, `projectTokenCreate`, `variableUpsert` and variable reads; **not** `serviceCreate`. Project tokens authenticate only via `Project-Access-Token`. Sourceless `serviceCreate` consumed **0 deploys**. [Record](../research/railway-token-and-sealing-2026-11-08.md) |
| **E18 — NEGATIVE (measured 2026-11-08)** | No seal setter exists anywhere in the v2 API and `Variable.isSealed` is unreachable, so `relay-sealed` is unimplementable on Railway and sealing cannot be verified. Both grants read values back. Default delivery stays `tenant-side`; D21 and invariant 1 corrected the same day |
| **E21 — BLOCKED (measured 2026-11-08)** | `railway` CLI 5.71.0 rejects workspace and project tokens outright (`Invalid RAILWAY_TOKEN`), consistent with its account-scoped validation — so the runner cannot use `railway config plan/apply` without violating D20. The API surface exists (`environmentApplyChangeSet`, `Environment.configEtag`, `iacPartials`, partial release/transfer) and becomes **E22** |
| **E25 Multi-environment service placement — RESOLVED: duplication only** | `environmentCreate(sourceEnvironmentId)` is the sole placement primitive and it is a **snapshot**; `serviceInstanceUpdate` on an unplaced environment returns `true` and does nothing. Provider now verifies placement and reports `instance-missing-in-environment`. Also measured: **1 environment per 30s** per workspace, on top of 1 project per 30s | | `serviceInstanceUpdate(environmentId, serviceId, …)` is what the provider calls per environment, but the mock was built to answer `NOT_FOUND` for an environment the service was not created in, so the provider's fallback (`serviceCreate` in that environment) is what currently runs in tests. Which of the two the real API expects — and whether a service created in `production` is automatically present in `staging` — must be settled on a live project before the deploy path is trusted. **E26** covers it with the conformance suite |
| **E27 Overlapping deploys — RESOLVED, the cause was ours** | Immediate duplicate `serviceInstanceDeploy` calls **coalesce into one deployment** (measured), so overlap was never the problem: my `projectUpdate` lacked a `{ id }` selection, the plan marker was never written, and every apply re-deployed everything. Fixed, with the marker written *before* mutating calls and hostnames checked before `serviceDomainCreate`. **The confirming E26 re-run is still outstanding** — see [the record](../research/railway-token-and-sealing-2026-11-08.md) |
| **E26 Railway conformance against the live API — REDUCED SCOPE PASSES LIVE** | 9/9 in 95 seconds with ≤3 deploys, workspace cleaned and tokens revoked. Includes a re-apply that is a genuine no-op (no second deployment, no second hostname) and a delete that reports orphans honestly. **Full scope still fails on purpose** until E28 delivers databases and buckets, and this run was single-environment, so **E25 (multi-environment placement) remains open**. [Record](../research/railway-token-and-sealing-2026-11-08.md) |
| **Manifest→plan translation exists (#84)** | `buildPlan(manifest, { instanceId, teamId, images })` in `packages/manifest`: per-environment placement, staging as `cloneFrom` with replicas pinned to 1, databases/buckets/volumes (`sizeGB`→`sizeMB`), public-only domains with staging derivation, secret **names** only, and `references`. It refuses a **placeholder digest** outright — templates ship `sha256:1111…` as documentation and the plan schema accepts that shape, so only an explicit check stops an example image becoming a tenant's broken deploy. 8 tests including the refusal and the undeclared-database case |
| **OD13 databases — PROVISIONED AND DELETED BY THE PROVIDER, LIVE** | Clean pass (`pclean`, 2 deploys): `applyPlan` created the template database, waited out the async deploy, and `readState` returned both `clean-db` and `api` at `live` (45s). `deleteInstance` removed the database, the app service, **both** volumes and the project with `orphans=[]` (#82 retry + volumes-first). Volumes: created and attached live, mount state unobservable on this grant (stated as a note). Volumes claim is create-only: no platform uses one yet. | `templateDeployV2(input:{ templateId, serializedConfig(read from the Template), projectId, environmentId })` created and **deployed a private PostgreSQL to `SUCCESS`** (`ghcr.io/ncontiero/postgres-ssl:18.6`) with no dashboard step. The input type is `TemplateDeployV2Input`; `serializedConfig` is caller-supplied, and wrong shapes produce the same opaque "Problem processing request" as change sets. Open: plan-controlled naming (it arrived as `Postgres`), password seeding, `${{Service.VAR}}` wiring, and treating deploy as an async workflow (`operationId`/`workflowId`) | Correction of a correction: `serviceCreate(input:{ projectId, environmentId, name, templateId })` created a PostgreSQL service from Railway's template (`treedx-db`, id `e76c0140-…`). My earlier "not reachable" finding came from probing `templateDeployV2` and the change-set endpoint -- neither is how a database is made. Open work is implementation, not capability: the created service did not deploy (`serviceInstanceDeploy` → "Problem processing request"), candidates being `serviceConnect`, `serviceInstanceDeployV2`, or seeding variables first. Wiring may need no secret at all: templates use `${{RAILWAY_PRIVATE_DOMAIN}}` and `Service.connectionString` exists. | `bucketCreate` succeeds with the workspace grant (project token: "Bad Access") and takes no region. For databases the mechanism is identified — config-as-code change sets, first-class `type: "database", engine: "postgres"` resource, `CompileResult.desiredConfig: EnvironmentConfig` — but every payload shape tried is answered `applied, changes: []`, *including a nonsense resource type*, so the server validates `version` and silently ignores the rest. Needs `railway config plan --json` (E24) as the authoritative sample. [Evidence](../research/railway-token-and-sealing-2026-11-08.md) |
| **E24d change-set *request* format — OPEN, provider must not call it** | `environmentApplyChangeSet` accepts any JSON, stores it, and returns `applied` with `changes: []` — including our echo of the CLI's own `desiredGraph`, plus `variablePolicy`, and a hand-written `changes` array. Nothing was ever created. The CLI computes the diff locally, so the captured graph documents Railway's state model but is not a request format. Obtaining it requires observing the CLI's outgoing HTTP body. Until then the provider uses per-resource mutations, which are proven end to end |
| **E24 CLI-less config-as-code — PAYLOAD CAPTURED** | `railway config plan --json` gave the authoritative envelope: `{ project:{name}, resources:[…] }` with a fixed 15-key node shape; managed databases are Railway template images; variables are `literal` / `preserve` / `reference`; **custom domains are not IaC at all**. Fixture plus shape tests committed; live apply still pending. `environmentPreviewChangeSet` is the side-effect-free loop from here on |
| **E24b RESOLVED** | The renderer no longer emits `domains:` into `.railway/railway.ts` — hosts are recorded as a placement-aware comment and applied through the API. A test asserts no `domains:` key survives in generated IaC |
| **E24c RESOLVED** | `ServicePlanSchema.references` and `EnvironmentPlan.volumes` added (optional, so existing plans stay valid), with cross-field validation (`unknown-database`, volume→service) and builder emission of reference variables, volume nodes and `volumeAttachments`. A reference to an undeclared database throws rather than emitting a dangling link | | `environmentApplyChangeSet` accepts a versioned graph and returns a change-set id but produced no observable effect (etag unchanged). Whether our rendered IaC can be applied through the API at all — and if not, whether the runner should use per-service mutations instead, with IaC kept purely as an ejection artifact (the current D24 assumption) |
| **E23 Cross-project reachability — NEW, created by OD11** | When a provider instance (Keycloak, OpenBao, Loki) lives in a different Railway project from its consumers, is it reachable over private networking or only via a public TLS endpoint? Decide the answer per consumption mode (deploy-time vs runtime), because it changes what a team service may be used for |
| **E22b Seal verification by differential — NEW, needs one dashboard click** | Seal `E22_SECRET` on service `e22-probe` in project `platfolio-e22` by hand, then re-read `variables(..., unrendered: true, serviceId)`. If the value disappears, absence is the verification signal the maintainer's create-then-instruct-then-verify flow needs; if it does not, sealing is unverifiable by us and the flow cannot be built honestly |
| **E22 Config-as-code without the CLI — PARTIAL** | Can an environment-scoped project token drive `environmentApplyChangeSet` for our rendered `.railway/railway.ts` (compiled client-side via the `railway/iac` SDK), and does per-environment resource scoping survive that path? This decides M2's execution plane: CLI + account token is unacceptable, an API-driven apply with a project token is. Also re-measure per-environment placement here, since E21 could not |
| **E14 Profile validation — NEW, created by E9** | Boot with a deliberately malformed profile and confirm platfolio's own validator rejects it **before** any provider is dispatched (the framework tolerated it). Add the check to the control-plane boot sequence and to CI as a fixture |

**Go/no-go:** **E9 is satisfied** (kernel boots, provider swapped by configuration, no
`--expose-internals`), so the remaining gate for M1 is **E1 or E6** — a viable "tenant-owned project
that platfolio can provision" path. If both fail, the product becomes "software the tenant installs
plus a support subscription" — a smaller, still-valid product, and this is the moment that answer
costs one week instead of one quarter.

**Added by E9:** M1 kernel wiring is also gated on **E13** (which core lineage we track — upstream vs
the fork the published plugins expect) because it determines whether `@cordisjs/*` packages are usable
at all. HTTP transport is not blocked: it moves to a kernel-owned `node:http` adapter either way.
E14 lands as part of M1 step 1, since "it started" is not evidence that a profile is valid.

## Milestone 1 — contracts and the manifest are real (2–3 weeks)

> **Status 2026-11-08, steps 1–3 and 6 delivered; 5 partly.** `packages/contracts` (capability
> interface, conformance suite, in-memory double, visibly-incomplete Railway implementation),
> `packages/manifest` (schema, validation, Compose + Railway IaC renderers, 2 valid and 5 invalid
> fixtures), and `packages/kernel` (Cordis service resolving `ctx.infra` by name with
> StandardSchema config and contract-range refusal) are in the tree; `pnpm run verify` runs docs lint,
> vendored-tree check, typecheck, 26 tests, and the contract-drift baseline gate across all three CI
> tiers. **Outstanding:** `railway config plan` against a real project needs the Railway CLI plus
> tenant credentials, so the generated IaC is instead type-checked against Railway's published SDK in
> CI — a strong substitute, not the same gate; and step 7 (platfolio's own stack as a manifest) is
> not started. See `packages/manifest` § Rendering status in [03](03-manifest-spec.md).

> **Status 2026-11-09 — M1 step 6 is delivered in the full sense.** The blockquote above predates it: its
> "step 6" was the CI gate around generated IaC, and the deployment step is now closed too.
> `RailwayInfraProvider.applyPlan` deployed platfolio's own pinned public image
> (`ghcr.io/fractalsynapse/platfolio-status-api:staging` + digest) into the development workspace:
> instance `live`, `https://status-production-54d3.up.railway.app` serving HTTPS with a Let's Encrypt
> certificate, `/version` reporting the deployed commit and the provider contract, and a second `applyPlan`
> that changed nothing — idempotency demonstrated on a real registry-backed service rather than the
> double. Certificate state came from reading `syncStatus` back, not from hostname inference. Sequence,
> costs (two deployments) and the two pull-verification mistakes I made are in
> [research/status-api-image-2026-11-09.md](../research/status-api-image-2026-11-09.md). Remaining in M1:
> step 7 (platfolio's own stack as a manifest, which now has a real image to name) and the CLI-less
> `config plan` question, answered differently than planned — `railway config plan --json` gave us the
> change-set shape, and `environmentApplyChangeSet` turned out to accept any JSON and apply nothing, so the
> provider applies through per-resource mutations and treats IaC as an ejection artifact.

Two boundaries are frozen in this milestone, and both are worth the review time because everything
later depends on them: `packages/contracts` (capability interfaces, config schemas, conformance
suites, version derivation) and `packages/manifest` (schema, validation, renderers).

1. Kernel skeleton: vendored Cordis (OD6), our own build (OD7), pinned Node (P7), `plugin-server`
   routes, one capability registered by name with a StandardSchema config, and the CI contract-diff
   gate from E10 wired in on day one — before there are three providers to retrofit.
2. Record intent: manifest schema draft + the two worked examples from
   [03 § Worked examples](03-manifest-spec.md) as fixtures before writing a renderer.
3. Schema and archetypes with validation rules, including the secret-name lint (rejects any field
   shaped like a value) and the domain wildcard/subdomain conflict rule.
4. Renderer → Railway IaC (`railway.ts`) and → Compose, from one shared intermediate.
5. CI gates as the acceptance mechanism: schema validation, `railway config plan` against the scratch
   project, compose bring-up smoke test, `railway.json`-present detection.
6. `infra.provider` interface plus the **provider conformance suite**, run against Railway as the first
   implementation and against the E8 fake as a second — this is the seam that proves the abstraction
   earns its cost.
7. Platfolio's own stack expressed as a manifest, so every later renderer change must not break
   platfolio hosting itself.

*Accept:* TreeDX manifest renders to both targets; the Railway plan is clean on the scratch project;
the compose stack comes up; a manifest with an embedded secret value fails CI with a readable error.
*Not in scope:* any UI, any customer.

> **Status 2026-11-08 — M2 prepared, not started; custody decided (D24).** M2's execution plane now has a
> decided shape: managed custody by default (broker holds one workspace grant per team, mints per-environment
> tokens, writes them into tenant CI), self-custody as an option, and no platfolio-run runner fleet. The
> build order follows from that: `credential.broker` in the managed mode is already implemented and
> conformance-tested, so the next piece is the dispatch/attestation round trip against a real repository,
> not more offline contracts.
 The attestation contract and its policy checks,
> the install-PR generator, credential custody (D20), secret delivery (D21), the SCM seam (D22),
> environment placement (D23) and the secrets panel as page data (`packages/page-schema`) are
> implemented and covered by 95 of the project's tests. A development Railway workspace exists
> (`82ba4aff-61f3-4b19-b863-8b650ebb66b2`, Pro plan) but **no credential for it has been provided to
> this repository** — deliberately, see the custody note below — so E15/E18/E19/E21 remain unrun. The live halves — composite action, GitHub App installation, real dispatch, real
> runner claims, JWKS verification against the issuer — are unstarted and need a tenant repository and
> credentials. See [04 § Implementation status](04-execution-plane-github-workflows.md).

## Milestone 2 — execution plane in a customer repo (1–2 weeks)

Depends on E1/E2/E5/E6.

1. GitHub App with the minimal permission set; install flow; connect pairing persisted.
2. Install PR generator (workflow + `.railway/railway.ts` + `PLATFOLIO.md`) and the uninstall/revocation
   path from the start.
3. `actions/platfolio@v1` pinned by SHA: apply, check, drift, with `errors[]`-aware success semantics.
4. Attestation ingest + verification-by-read-back; commit statuses/checks so results appear on the
   tenant's PRs; explicitly **no** job-log retrieval.
5. Token custody flow: the tenant creates per-environment project tokens and stores them as GitHub
   environment secrets; platfolio never sees either.

*Accept:* with platfolio's API stopped, `git push` still deploys; with platfolio running, a dispatch
applies a plan and the attestation matches read-back state; a stale/forged attestation is rejected.

## The connect loop has run once, end to end (2026-11-11)

A `workflow_dispatch` against this repository started a GitHub-hosted job in environment `production`; the
committed managed action fetched the plan from the live control plane, applied it through the real provider,
and posted an attestation that was **accepted and stored** -- confirmed independently by `readState` on the
provider. M2's flow in miniature, on platfolio's own tenant-shaped instance.

Three limits, named rather than implied: it is not a tenant's repository; the runner's identity is **recorded
and not verified** (#159); and the attestation's `release` fields read `0.0.0-dev` because a laptop chose the
pins, not a release job (#146). What it establishes is that the parts fit -- dispatch inputs, hash comparison,
credential boundary, single-use nonce, attestation round trip -- which is what the milestones assumed without
evidence.

## Milestone 3 — control plane surface (2–3 weeks)

1. Teams, members, roles; instance CRUD; the connect wizard (repo → platform → Railway connect →
   required-secret checklist → verify).
2. Controller with durable steps, idempotency, backoff and the reconcile sweep; lifecycle states as
   named, user-visible substates with reasons.
3. Domains and the DNS panel (CNAME + TXT pairs, apex warnings for providers that cannot flatten,
   certificate status and retry).
4. Status/health views built on attestations + probes; audit log on every mutation.
5. Public API + OpenAPI as the primary surface (the UI consumes the same client per
   [07](07-interfaces-api-mcp-mobile.md)); MCP tools generated from the capability registry, read-only
   first.

*Accept:* one real tenant (you) reaches `active` end-to-end through the UI without staff intervention;
cross-tenant authorization tests pass; the required-secret checklist turns green only via health.

## Milestone 4 — money and lifecycle (1–2 weeks, needs P2 + OD1)

1. Plans/products/features/lookup keys in test mode; entitlement ingest; local `limit` table.
2. Lifecycle timers: 23-hour checkout expiry recovery, ~14-day past-due grace, `deploy_locked` →
   `suspended` (scale-to-zero, never delete), export window, deletion on published schedule.
3. Customer portal links, invoice-paid gating, `automatic_tax` + `tax_id_collection`, dispute/refund
   handling paths.
4. Telemetry for internal margin visibility and proactive quota notices (not invoiced).

*Accept:* a scripted Stripe test-mode journey drives a real instance through paid → past-due →
suspended → recovered → canceled → exported, with duplicate and out-of-order webhooks and no manual SQL.

## Milestone 5 — ArcNexus and the identity host (2–3 weeks)

1. `full-stack-web` archetype: two services, session/cookie origin rules, CSP, domain-derived redirect
   URIs.
2. `identity.mode: byo-oidc` (config generation + discovery verification) then `hosted-realm`
   (realm intent applied by the tenant's runner, upgrade sequencing with realm export first).
3. Eject flow: full export package + the Compose-runs-standalone test as CI, not a manual demo.
4. Plan-capacity pricing for "add a platform," enforced locally with entitlement confirmation.

*Accept:* ArcNexus running with SSO shared with a second instance in the same realm; the exported
stack comes up locally with its own Keycloak and a fresh user; a P0 token is rejected by every P1
endpoint in test.

## Milestone 6 — external distribution (1–2 weeks, partly parallel)

1. Multi-arch images with provenance/SBOM; per-release corresponding source; `/api/version` + update
   check; support matrix published.
2. Installer CLI for macOS/Windows with the signing/notarization pipeline from P5.
3. License + `ENTERPRISE.md`/`/proprietary` boundary, trademark policy, AUP, DPA, sub-processor list,
   security disclosure page, and the public status/notice feed.
4. Public template publication decision (kickback-eligible) and the marketing content from the
   manifest-generated docs.

*Accept:* a stranger follows the README and has platfolio hosting a platform on their own Railway
account with no platfolio credential involved; the docs make the "we never see your secrets" claim
checkable rather than asserted.

## Standing risks worth naming now

- **Provider policy is not code.** A single AUP revision or workspace action changes the business; the
  mitigation is the tenant-owned model plus a written answer (P1), not cleverness in the controller.
- **Railway's undocumented caps** (50/100 projects per workspace, an undocumented 25-services-per-day
  safeguard on new accounts) do not bind platfolio under the tenant-owned model, but they do bind
  platfolio's own staging if it grows — measure before assuming.
- **DNS support load.** Apex CNAME flattening excludes Route 53, GoDaddy, Azure DNS, Hostinger,
  NameSilo, Hurricane Electric and Squarespace; every one of those becomes a ticket. The panel must
  detect, explain, and offer the subdomain path instead of failing mysteriously.
- **The apps are half the product.** If TreeDX and ArcNexus are not multi-tenant-ready, migration-safe
  and self-configuring purely from environment, platfolio has nothing worth subscribing to; P3 and the
  M1 fixtures are where that becomes visible.
- **Solo-scale support.** Hands-off hosting means someone is on call for other people's production.
  The plan's guardrails and export are what keep that survivable; publish a response SLA only when the
  tooling can meet it.
- **Prompt-injection surface** for anything here that fetches or summarizes external content — treat
  retrieved text as data always, including in agent-facing MCP tools.

## Pending decisions before M4

No billing decision blocks M1: OD1, OD3, OD4, OD5 and OI1–OI3 are accepted, and **OD2 is decided
(D18, Apache-2.0)**. What remains before a release is not a decision but three details inside D18
(§ Remaining under D18 in [08](08-distribution-and-licensing.md)): full license text, the
`/proprietary` boundary, and the trademark policy — plus **OD9**, the core-lineage choice from E9.


## Teardown accounting closed (#111)

`deleteInstance` now snapshots before removing anything and classifies each resource as `removed` by us,
`releasedWithProject` (which on Railway includes every bucket, since no bucket delete mutation exists), or
`orphans` — the last reserved for what is **still reachable** after `projectDelete`. Verified live: one
service `removed`, one bucket `released`, `orphans: []` as a probed claim rather than an assumption. Refusals
still land in `failures` with their reason, so #80's guarantee is intact and only the vocabulary moved.
Evidence and the two mock bugs found along the way: [teardown-accounting-2026-11-10.md](../research/teardown-accounting-2026-11-10.md).

## First tenant-shaped live run (2026-11-10)

A reference platform manifest went `buildPlan` → `applyPlan` against Railway and came up: two services `live`, a managed database `live`, its volume attached, a bucket created, a generated domain with a certificate read back as issued — using platfolio's own published image in place of the templates' placeholder digests, so the run proves the hosting mechanism rather than a real platform boot. `verified` was **false**, for the one honest reason: the tenant had not supplied `APP_API_SIGNING_KEY`, reported with its environment and service (`secret-unavailable@environments.production.services.api.…`). Teardown left `orphans: [bucket:…]` and a refused `serviceDelete` on the database (#106 — no bucket delete mutation exists, so those are now reported as released with the project; #107 — ordering, now volumes-before-services and enforced by the double). A follow-up reporting gap became #111). Evidence: [research/tenant-run-2026-11-10.md](../research/tenant-run-2026-11-10.md).

## M2 entry point

The first tenant will be platfolio hosting platfolio: `selfhost/` is authored in the Compose format with its own inventory and a generated prod overlay, and round-trips through `parseCompose → applyInventory → buildPlan → validatePlan` with no issues (#113 offline half). The live half is the ordered runbook with its two browser-only steps marked: [14-first-connect-runbook.md](14-first-connect-runbook.md).

## Follow-on work accepted with D29–D31 (2026-11-09)

Sequencing for the compose-first inversion. Step 7 is deliberately re-pointed: rather than writing
platfolio's own manifest in the old format, platfolio's already-deployed service becomes the first thing
authored in the new one, so the format is tested by a system we actually operate.

| # | Work | Notes |
| --- | --- | --- |
| C1 | Compose input adapter | parse a Compose document into the existing intermediate model; subset acceptance plus named refusals; `x-platfolio` extension block |
| C2 | Overlay generation | `compose.dev.yaml` and `compose.prod.yaml` produced, not hand-written; regenerate-and-compare as the drift gate |
| C3 | Importer report | parse → merge → map → list every refusal and every behavioural difference before any plan is generated |
| C4 | Step 7 as the experiment | `apps/control-plane (was `apps/status-api`, deleted in favour of one API)` authored in Compose, driven through provider to the same live state; compose-derived plan re-applied against the running instance must be a no-op |
| C5 | Execution split | **Trigger half done (#105).** `GithubWorkflowRunner`: `workflow_dispatch` with ref+inputs, run state normalised from status *and* conclusion, blob-hash drift on curated files (in-sync / changed / missing / unknown — a failed read is not a tenant edit), and **no log access at any layer**: no method, and a test asserting no request ever touches a logs or artifacts path |
| C7 | Environment inventory (D33) | **Done (#100).** `packages/manifest/src/inventory.ts`: typed entries parsed, cross-checked against topology, folded into the manifest so `buildPlan` and the provider keep working untouched. `.platfolio/environment.yaml` ships on the generic reference template | `.platfolio/environment.yaml` with `reference`/`secret`/`value`/`output` kinds, defaults and applicability; replaces the authoring-layer `env`/`secrets` split; hard refusal on a credential-shaped `value` |
| C8 | Secret write path (D32) | `PUT …/actions/secrets/NAME` from a request-borne value, presence via 204/404, and a UI offering rotate-and-rebind rather than replay |
| C9 | Cross-instance binding (D34) | **Done (#101).** `packages/contracts/src/binding.ts`: requires-by-capability resolution, generation tracking for stale detection, secret outputs as state only, and a team rollup that answers "how many consumers still point at the old issuer". The two reference templates now declare a provider and a consumer of the same capability. Panel rendering shipped with #104 (`buildBindingPanel`): counts per capability, per-consumer status, rebind and re-issue actions, and a structure that cannot carry a credential value | `provides`/`requires` by capability, binding records the supplier generation, credentials relayed once and re-issued on retry |
| C6 | Runner option, if ever | in-tenant-account managed runner only (D31); nothing may depend on it |
