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
| P4 | platfolio repository/remote split from the scaffold repo, plus an application change/test/release policy (builds, migrations, deploy checks) | maintainer | M1 onward |
| P5 | Test resources: a throwaway Railway project, a scratch GitHub repo/org, Stripe test mode, an Apple Developer + Windows signing decision if an installer ships | maintainer | M0, M6 |
| P6 | **OD6 and OD7** — Cordis vendoring and toolchain boundary | maintainer | M1 (kernel wiring), everything after |
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
| E9 Kernel fit | The vendored Cordis core + `plugin-loader` + `plugin-include` + `plugin-server` boot a hello-world control plane **without** `--expose-internals`, on the pinned Node, under our own toolchain; provider swap by configuration demonstrated with two fake `infra.provider` implementations resolved through `inject` |
| E10 Contract versioning | `packages/contracts` type surface diffed in CI, with the bump classification (additive → minor, tightening/removal → major) shown on a deliberately broken example; a provider that declares an unsatisfiable range prevents startup |
| E11 Tier-2 boundary | A capability implemented as an out-of-process worker reaches the same contract over RPC, cannot read control-plane env or DB (asserted by test), and is pinned by image digest |
| E12 Hot-swap safety | Under `plugin-hmr` in **dev only**: dispose/re-register a provider mid-job and confirm no leaked listener or half-applied step (relies on `ctx.effect()` reversal); document that production uses blue/green, not swap |

**Go/no-go:** proceed to M1 if **E1 or E6** shows a viable "tenant-owned project that platfolio can
provision" path, **and E9** shows the vendored kernel booting under our toolchain without
`--expose-internals`. If the provider experiments fail, the product becomes "software the tenant
installs plus a support subscription" — a smaller, still-valid product. If only E9 fails, keep the
contracts layer and revisit OD6 (npm dependency or a thin kernel) before writing any application
code; this is the moment that answer costs one week instead of one quarter.

## Milestone 1 — contracts and the manifest are real (2–3 weeks)

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

OD1 (merchant of record) and OD2 (license) must be settled; OD3 (secret relay) has a recommended
answer in [01](01-product-and-decisions.md) and only needs ratification; OD4/OD5 (ArcNexus repo
topology, preview environments) can wait until M5/M6; OI1 (identity host at MVP or after) should be
ratified now because it changes the M3–M5 ordering.
