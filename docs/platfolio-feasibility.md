# platfolio — concept review and pre-plan decisions

Date: 2026-11-07. Status: **analysis complete; the maintainer has since accepted the direction
("sell management, not compute") and set the tenancy, secrets and CI decisions — those now live in
the [design set](design/README.md), which is the authoritative statement of intent. Nothing is
implemented: there is no application code, no deployed resource, and no written approval from
Railway or Stripe yet.** This memo records the verified constraints those designs are built against
and the pre-plan reasoning behind them.

Evidence lives in the three research reports it links. Claims here are marked:
**V** verified against a primary source, **P** partially verified, **U** unverified/open.

- [Railway control-plane feasibility](research/railway-control-plane-feasibility.md) — API
  inventory from the live public GraphQL schema, tokens, limits, handover, templates, DNS.
- [Billing and open-source licensing](research/billing-oss-feasibility-2025-11-06.md) — Stripe
  Billing/Entitlements/metering/MoR/tax, GDPR processor duties, comparable project licenses.
- [Distribution feasibility](research/distribution-feasibility-review.md) — single-binary options,
  IdP footprint, what the PaaS category actually ships, config-drift and update policy.

## Verdict

Buildable, and the interesting work is not the web app. The product is a **multi-tenant
provisioning controller plus a versioned contract between platfolio and each hosted
platform**. Feasibility is gated by provider policy and provider limits, not by TypeScript,
Astro or Stripe. Four decisions below must be made first; one of them (infra ownership)
determines most of the rest.

## Constraints that change the original concept

1. **Reselling Railway compute is prohibited.** The Railway AUP forbids use "for other abuse
   of the platform, including cryptocurrency mining, torrenting, **reselling compute
   resources**, **evading usage or billing limits**, operating proxies or anonymization
   services" and instructs "ask us **before deploying**". Docs also state "Users are only
   allowed **one account per person**" (enforced by email, GitHub and payment method), and
   Terms: "You may not transfer your account to anyone else without our prior written
   permission." There is **no reseller program**; the sanctioned programs are Open Source
   Partner / template kickbacks (15%, 25% with support), affiliate (15% of first 12 months),
   AWS Marketplace and committed-spend/Enterprise. **V**
   → *Consequence:* "platfolio pays Railway, bills the customer a hosting margin" needs
   Railway's written approval, or must not be the primary architecture.

2. **Hard platform caps end the "one project per tenant in my workspace" model.** Projects
   per workspace: 1 (free) / **50 (Hobby)** / **100 (Pro)** / unlimited (Enterprise). Services
   per project 3/50/100; members per project 1/3/unlimited; custom domains 0/2/20 **per
   service**; volumes 1/10/20; replicas 1/6/42; concurrent builds 1/3/10. Plus an
   undocumented **25-services-per-rolling-day** safeguard on young accounts, cleared by
   staff as the account ages. Pro is $20/**workspace**, not per seat. **V**
   → *Consequence:* the estate caps at ~50–100 tenants per workspace, and the only automatic
   cost brake (`usageLimitSet`, minimum hard limit $10) is **workspace-wide** — tripping it
   takes every tenant offline. No per-project invoicing and no sub-accounts exist, so cost
   allocation must be built from `usage` / `projectServiceUsage` (groupBy PROJECT_ID /
   SERVICE_ID / ENVIRONMENT_ID / BILLABLE / REGION). **V**

3. **Least-privilege provisioning is a native Railway feature, so use it.** Four token types
   (V, live schema): account, workspace, **project** (`projectTokenCreate(projectId,
   environmentId)` — bound to one environment, available on **all** plans, sent via the
   `Project-Access-Token` header), and OAuth. Consent is **selective**: "the user chooses
   which specific workspaces or projects to share … not their entire account", and the
   requested scope is capped by the consenting user's real role. RBAC (`ProjectRole`,
   `TeamRole`, access groups, guardrails, Railway Authentication) governs **members, not
   tokens**, and the good parts sit behind committed spend ($2k/$5k/$10k) or Enterprise. **V**

   **The published scope table is stale — read the discovery document instead.**
   `https://backboard.railway.com/oauth/.well-known/openid-configuration` (verified live
   2026-11-07) returns `scopes_supported`:
   `openid, email, profile, offline_access, workspace:admin, workspace:member, workspace:viewer,
   project:admin, project:member, project:viewer, notifications, ssh_keys` — the docs page omits
   **`project:admin`**, `notifications` and `ssh_keys`. It also advertises
   `grant_types_supported: authorization_code, refresh_token, device_code, token-exchange`,
   `token_endpoint_auth_methods_supported: client_secret_basic, client_secret_post, none,
   private_key_jwt`, `response_types_supported: [code]`, `code_challenge_methods_supported:
   [S256]`, and a **live** `registration_endpoint` (`POST /oauth/register`).
   → *Consequence:* (a) resolve scopes from discovery at runtime, never from a hard-coded list;
   (b) `project:admin` makes "the customer authorizes platfolio into the customer's own project"
   fully capable, not degraded; (c) `device_code` is the right grant for the future
   `platfolio` CLI, and `private_key_jwt` is available if platfolio ever wants secretless
   confidential-client auth. Still open (**U**): whether a Railway user outside platfolio's
   workspace can consent to platfolio's OAuth app — the spike's first test.

4. **Templates are the acquisition path and a free ejection path.** `templateDeployV2(input:
   {templateId, serializedConfig, projectId?, workspaceId?, environmentId?})` exists (**V**,
   live schema), as does the deploy-button URL and `railway deploy --template … --variable`.
   Published templates ship a machine-readable manifest
   (`https://railway.com/deploy/<code>/manifest.json`) containing `deploy.api.body` — a literal
   `templateDeployV2` call with `serializedConfig`, `required_inputs[]{key,service,secret,
   strategy}` — plus validation telemetry. **The launched project lands in the account of the
   user who clicked**, so a platfolio template link produces a customer-owned stack with no
   transfer step and no platfolio plan ceiling. Kickbacks require marketplace publishing:
   "Private and unpublished templates are not eligible." Whether a *hidden* template link can
   be deployed by another account is **U**. **V/P**

5. **Identity is the cost and coupling problem, not auth code.** Keycloak container docs: set
   the memory limit to "**at least 750 MB**", 2 GB recommended for smaller production
   deployments; sizing guide base pod ~1250 MB + ~300 MB non-heap, ~1 vCPU per 15 logins/s;
   dev-file/H2 is explicitly not for production. At Railway's $10/GB-month RAM rate a
   **per-tenant IdP costs roughly $7.50–20/month before any product service runs**, and makes
   platfolio the operator of N identity providers with Keycloak's upgrade model. **V**
   → *Consequence:* hosted tenants share one platfolio IdP (per-tenant realm/client +
   `tenant_id` claim); self-hosted/ejected tenants must be able to swap in their own issuer.
   Therefore `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` are **manifest-declared
   dependencies**, never hard-wired. Lighter verified options for the local variant:
   `oidc-provider` (MIT, TS, real OIDC Core, embedded) or Better Auth's OAuth-2.1/OIDC plugin;
   Zitadel is ~512 MB but AGPL-3.0; Ory Hydra is certified OIDC but **headless** (no user
   store/login UI); Lucia was deprecated in March 2025 and was never OIDC.

6. **DNS has three sharp edges, all documented.** (a) "Railway does not publish a static IP, so
   **A records are not supported**" — apex needs CNAME-flattening/ALIAS/ANAME, which Route 53,
   Azure DNS, GoDaddy, Hostinger, NameSilo, Hurricane Electric and Squarespace cannot do
   (workaround: move nameservers to Cloudflare). (b) Subdomains require **both** a CNAME and a
   TXT verification record — "If the TXT record is missing, requests to your custom domain will
   return a **404**". (c) Certificates are Let's Encrypt ECDSA, issued within ~an hour, retried
   for **72 hours then `FAILED`**; `customDomainIssueCertificate` retries manually; Cloudflare
   "proxied" records may fail issuance. Wildcards are supported but **"subdomains and wildcards
   cannot overlap"** — so `*.clients.platfolio.io` plus per-customer subdomains on separate
   services is impossible; pick explicit per-customer subdomains, one wildcard behind a single
   router service, or one wildcard per customer service. And there is **no documented API to move
   a custom domain between projects** (detach + re-add ⇒ re-verify + re-issue). **V**

7. **Teardown and handover are harsher than the pitch.** There is **no archive**: `projectDelete`
   and `projectScheduleDelete` (48-hour grace, then irreversible). Services can **never** move
   between projects; workspaces are not transferable and cannot be created by API; accounts and
   Railway domains cannot be created by API either. Handover has two distinct features:
   `projectTransfer` (workspace→workspace, destination must already be one you're a member of)
   and **Transfer Ownership** `projectTransferInitiate` → `projectTransferConfirm` (owner→owner:
   recipient must already be a project **member**, gets an email, has **24 hours** to accept,
   **both ends need an active Hobby or Pro plan**, platfolio's account needs 2FA, and staff note
   **"If the project has any buckets, delete them before you start, because buckets block the
   transfer"** — Hobby's 3-member cap sits on top of that). What survives: "the entire project
   as-is … volumes, environment variables, deployment history, and services all survive",
   `*.up.railway.app` domains persist, usage bills to the destination workspace. **V**
   → *Consequence:* "suspend" in the subscription lifecycle must mean scale-to-zero/sleep, not
   archive. And handover is a transaction with failure modes — prefer the template model where
   the customer owns the project from minute one.
   Note also `sleepApplication` opt-in behavior: services sleep after ~5 min without outbound
   traffic, the first request may return **502**, and API writes to `sleepApplication` do not
   take effect until the next deploy. **V**

8. **Bringing a customer's private GitHub repo into platfolio-owned infra is not a documented
   flow.** Provisioning uses Railway's GitHub App plus per-user account linking
   (`GitHubRepo.installationId`, `gitHubRepoAccessAvailable`, `githubWritableScopes`), and
   "Autodeploy works only when at least one project member has a connected GitHub account with
   contributor access"; unlinked committers produce `NEEDS_APPROVAL` + `deploymentApprove`. On
   the exact agency scenario a Railway employee answered: "**the deploying user must have
   authorized railway to access the repo** … **Not 100% sure your use case is possible today.**"
   **V** for the mechanism, **U** for cross-account repo provisioning.
   → *Consequence:* MVP deploys **platfolio-built images** (digest-pinned, GHCR), which sidesteps
   the problem and is what a versioned platform release needs anyway.

9. **The compile matrix is solved; the dependency matrix is not.** `bun build --compile --target`
   documents 8 targets (linux glibc+musl × x64/arm64, windows x64/arm64, darwin x64/arm64) and
   full-stack executables embed the front end; `deno compile` cross-compiles to 6 targets from
   any host and since 2.8 builds Astro itself; Node SEA is Stability 1.1, must disable
   snapshot/code-cache for cross-builds, cannot load native addons from the VFS, and does not
   CI-test macOS x64 or Alpine. But Postgres and a JVM IdP don't fit in a binary, macOS requires
   Developer ID + **notarization** ($99/yr), Windows signing runs $9.99/month–$300/yr with EV
   no longer granting instant SmartScreen bypass, and **no category leader ships this**: Coolify,
   Dokploy and CapRover are all "curl script → Linux server + Docker" (amd64/arm64). **V**
   Also: **Railway has no official Terraform or Pulumi provider** — automation is the GraphQL API
   (256 mutations / 164 queries), the CLI, and templates. `railway config plan/apply/pull` and
   `environmentStageChanges` / `environmentApplyChangeSet` (marked *experimental*) are the
   closest IaC-ish surface, and `dockerComposeImport(yaml)` exists — relevant to keeping Compose
   and Railway on one source of truth. **V** (confirmed against the live public schema, no token
   required, on 2026-11-07: `projectTokenCreate`, `templateDeployV2`, `usageLimitSet`,
   `environmentStageChanges`/`Apply`, `projectTransferInitiate`/`Confirm`, `projectScheduleDelete`,
   `bucketCreate`, `dockerComposeImport`, `customDomainIssueCertificate`, `deploymentApprove`,
   `githubRepoDeploy`, `serviceInstanceDeployV2`, `volumeInstancePITRRestore`, `sharedVariableConfigure`
   all present; `pluginCreate` and `tcpProxyCreate` **absent** — do not build on deprecated
   operations; Postgres comes from database templates / `templateId` / `railway.ts` `postgres()`.)

10. **Railway Infrastructure as Code is GA, and the older mechanism has a hard cutoff three weeks
    away.** `.railway/railway.ts` (TypeScript generally available; Python/Go beta) is "one file" that
    declares "services, databases, volumes, buckets, custom domains, environment variables, replicas,
    and canvas groups," driven by `railway config init|pull|plan|apply|migrate|partials`, with
    `ctx.environment` for per-environment desired state and `defineRailway` sources for `github()` and
    `image()` (with `autoUpdates` for Docker Hub/GHCR only). Database helpers `postgres()`, `redis()`,
    `mysql()`, plus `volume()`, `bucket()`, service `domains`, `preDeployCommand`, `healthcheck`,
    `replicas`, `tracing`, and named **partials** for multi-repo projects where Railway "rejects a file
    that declares a resource owned by another partial". **Config as Code (`railway.json` /
    `railway.toml`) is deprecated: "New services cannot opt into Config as Code" and "Existing Config
    as Code files stop being read on 2026-12-01 (hard cutoff)."**
    → *Consequence:* IaC is the correct rendering target for the platfolio manifest (better than raw
    GraphQL orchestration: plan/apply semantics for free, and the file lives in the customer's repo).
    Any `railway.json` in existing platform repositories must be migrated **now**, independent of
    platfolio. **V** ([IaC](https://docs.railway.com/infrastructure-as-code),
    [reference](https://docs.railway.com/infrastructure-as-code/reference),
    [cli/config](https://docs.railway.com/cli/config))

11. **"platfolio never sees a hosted platform's secret" is implementable, not aspirational.** Three
    independent verified facts make it so: Railway IaC has `preserve()` — "mainly used for imported
    secrets whose values are not available to the CLI … 'keep the value that is already set in
    Railway'" — and shared-variable references (`ctx.shared.NAME`) that point at an existing variable
    without managing it; GitHub's Actions API returns secrets "without revealing their encrypted
    value" (`{name, created_at, updated_at}`) while still allowing presence checks and
    public-key-encrypted writes; and `workflow_dispatch` is a documented trigger, so a tenant's own CI
    can be the only holder of the Railway project token and the platform secrets. Railway offers no
    operation-level token scopes (a project token is environment-bound), which is precisely why the
    privileged executor must be the customer's runner rather than platfolio.
    → *Consequence:* the zero-secret invariant in the design set is enforceable by a lint plus a test.
    Related caution: Actions job logs are retrievable via the API, so a controller that "reads the
    deploy logs" would become the secret leak — attestations must be structured.
    **V** ([IaC reference](https://docs.railway.com/infrastructure-as-code/reference.md),
    [REST: secrets](https://docs.github.com/en/rest/actions/secrets),
    [REST: workflows](https://docs.github.com/en/rest/actions/workflows))

## Recommended shape

> **Superseded in part by the [design set](design/README.md) (same date).** The topology conclusion
> below held, and still does. Two specifics changed once constraints 10–11 were verified: rendering
> targets the **Railway IaC file committed in the customer's repo** rather than platfolio orchestrating
> GraphQL directly, and the execution plane is **the customer's GitHub workflow**, because that is what
> makes the zero-secret invariant true. Read the sections below as the reasoning that led there.

**Topology.** Primary: **customer owns the Railway account**, platfolio provisions into it
via Railway OAuth (project-scoped consent, `project:admin` makes this fully capable) or a
platfolio template deploy; platfolio bills a software + operations subscription. This one choice
simultaneously removes four separate problems: the 50/100-projects-per-workspace cap, the AUP
"reselling compute resources" question, the buckets-block-transfer blocker, and the 24-hour
handover dance — because the project is born in the customer's account and platfolio never holds
the estate. Secondary/acquisition: **Railway as a Stripe marketplace
provider** — [docs.railway.com/integrations/stripe](https://docs.railway.com/integrations/stripe)
(V) documents the Agentic Provisioning Protocol: `stripe projects add railway/hosting --config
'{"repo":"owner/repo","branch":"staging"}'` or `{"image":…}`, `railway/postgres|redis|mongo|bucket`,
plans free/hobby/pro, `stripe projects env --reveal`, `rotate`, `remove`, and an extended API
(env vars, public domains, replicas 1–100, redeploy/restart, logs). The customer's compute is
invoiced by Stripe/Railway, never resold by platfolio. Tertiary: "fully managed on platfolio
infrastructure" only after written Railway approval, in dedicated Pro/Enterprise workspaces,
with per-workspace hard usage limits and a tenant kill switch. Open (**U**): whether APP is
usable programmatically by a platform across many tenants, and who is MoR for that line item.

**Three planes, one contract.**

- *Control plane:* Astro site (static marketing + SSR dashboard islands, `@astrojs/node`) and one
  API service with a durable job runner. pnpm monorepo: `apps/site`, `apps/api`,
  `packages/manifest`, `packages/provisioner`, `packages/db`.
- *Identity plane:* OIDC as a declared dependency with three modes — platfolio-operated shared
  IdP (default), tenant-local IdP, customer's own IdP.
- *Data plane:* each tenant stack is a **rendering of a versioned Platform Manifest** — services,
  image/repo sources with digest pins, ports, health checks, env schema with `secret: true`
  flags, DB/bucket requirements, resource limits, migration hooks, staging/production overrides,
  domain targets, `architectures`, billing SKU. The manifest generates the Compose file, the
  Railway template `serializedConfig`, the DNS instruction panel, the Stripe product/feature
  catalog and the provisioning plan. **This is the core IP; without it, local dev, Railway prod
  and self-hosted installs become three products.**

**Provisioning is a controller, not a webhook handler.** Railway is the source of truth for
infrastructure; platfolio stores intent + reconciled state. Requirements proven by the API:
mutations are **not exactly-once**, auth failures arrive as **HTTP 200 with `errors[]`**,
`Deployment.status` includes `NEEDS_APPROVAL`/`SLEEPING`/`WAITING`, rate limits are
**100/1000/10000 RPH** (free/Hobby/Pro) and 10/50 RPS with `429` + `Retry-After`, and
`dockerComposeImport`/`environmentCreate(sourceEnvironmentId)` (clones services, volumes,
configuration and variables) give cheap clone paths. So: per-step durable jobs keyed by
idempotency tokens, **verify by read-back**, a token bucket sized to the plan tier,
webhook-first status (`project webhooks`: deployment status + volume/CPU/RAM alerts, 3 retries,
30s timeout) with polling fallback, drift detection, saga compensation, and a reconciliation
sweep. Never delete-then-recreate on retry.

**Subscription state machine** (numbers from Stripe docs, V): `pending_checkout` →
`provisioning` (`checkout.session.completed`, tenant id in `client_reference_id`, ToS gate via
`consent_collection.terms_of_service=required`) → `active` (`invoice.paid` +
`entitlements.active_entitlement_summary.updated`) → `past_due` grace ≈ **14 days** (new-account
default is Smart Retries, **up to 8 attempts within 2 weeks**; Stripe stops after the last one,
and Smart Retries never retry the **first** payment, which must land within **23 hours** or the
subscription becomes `incomplete_expired` and the invoice is voided — recovery needs a *new*
subscription) → **suspend at `unpaid`** (Stripe: "revoke access to your product when the
subscription is `unpaid`"; scale to zero, keep data; there is no archive primitive) → documented
export window → delete. Publish live-deletion days and a backup age-out schedule: GDPR Art
28(3)(g) delete-or-return, Art 17(1) "without undue delay", Art 12(3) one month, Art 20
machine-readable export; ICO permits backup copies only if put "beyond use" on a stated
schedule. Precedent wording: Stripe DPA (30-day sub-processor notice / 30-day objection),
Railway DPA (10-day notice, "purges or anonymizes" on account deletion, SCC deletion certificate
on request). Also handle `invoice.finalization_failed` with
`automatic_tax.status=requires_location_inputs` as a **provisioning gate**, and dedupe webhooks on
`event.id` with 2xx-then-async processing (no ordering guarantee; live retries up to 3 days).

**Entitlements.** Use first-party Stripe Entitlements (`entitlements.feature` + `lookup_key`,
`GET /v1/entitlements/active_entitlements?customer=`) as the capability authority — noting there
is **no POST** (only Stripe mints them) and existing subscriptions pick up new product→feature
mappings only at the **next billing period**. Keep a local `lookup_key → numeric limits` table
(max services, RAM cap, seats) because Stripe has no numeric-entitlement concept. Ship **flat
SKUs** on `billing_mode=classic`: Stripe now recommends Metronome for new usage-based builds and
marks the Billing Meters guide "Not Recommended" (Meters remain fully supported and keep
Checkout/Connect/Dashboard compatibility; Metronome lacks them); metered gotchas — identifier
uniqueness only ~24h, event timestamps limited to past 35 days/+5 min, invoice-time visibility,
and "if you don't prorate the subscription, all metered usage gets discarded". `credit_price` and
`usage_future` do not exist. `billing_mode` classic→flexible is **one-way**; the Trial Offer API
requires flexible + `2026-09-30.endive` and does not support metered items.

**Merchant of record.** If customers pay platfolio in platfolio's name: standard Stripe Billing,
**no Connect** (Connect is for moving a third party's money; $2/monthly-active-account +
0.25%+25¢/payout when you set pricing). Stripe Tax = calculation + registrations + filing options
with you as seller (registrations `oss_union`/`oss_non_union`/`ioss`, "Register for me" US-only,
automated filing US/Ireland/Canada, EU via Taxually/Marosa, global filing private preview;
`reverse_charge` applied automatically from tax-ID presence → enable `tax_id_collection`).
Alternative: **Stripe Managed Payments** where Stripe is MoR (80+ countries, explicit support for
the *Website Hosting* / IaaS tax codes, +3.5% on top) — attractive for a small team selling
globally, but **incompatible with Connect and no ad-hoc invoice items**, which forecloses usage
pass-through. Under the recommended topology platfolio never passes usage through, so the two
constraints no longer conflict; decide anyway before building the invoice pipeline.

**Distribution.** Multi-arch OCI images (`linux/amd64`, `linux/arm64` via buildx, digest-pinned)
+ one canonical Compose file + a Railway template + a small installer CLI (`platfolio up` = bring
up Compose), cross-compiled with GoReleaser v2 (builders for Go, Bun, Node, Rust, Deno).
**Drop** the "the whole control plane as a self-contained binary on any OS/CPU" promise; **reframe**
to "one command on Linux; signed installer binary for macOS/Windows that manages Docker + Compose"
— same user-facing story, roughly 10× lower cost. Update policy: version stamped at build,
`/api/version` + release check + banner, forward-only migrations at startup behind a lock with a
backup warning, self-hosted support = latest minor +1 with ~6 months of security cherry-picks to
the previous minor (mirrors Keycloak's own cadence and the Coolify/Zitadel/Ory/Red Hat precedent
of monetizing older-version support).

**License.** Not the moat — Coolify is plain Apache-2.0 with self-hosted "free forever, full
access to all features" and still has a business. Two coherent options: (i) **Apache-2.0/MIT core
with a directory-scoped `/proprietary`** tier (Dokploy's DSAL pattern; GitLab's `ee/`; n8n's
`.ee.`), which keeps the "open source" claim literally true; or (ii) **BUSL-1.1/FSL-1.1 with a
Change Date** (24 months → Apache-2.0), borrowing BSL's "competitive offering / Product /
Embedded / internal purposes" definitions, with an Additional Use Grant that expressly permits
internal use, self-hosting your own workloads, and agency work for client workloads. Option (ii)
is stronger against a cloud provider rebranding platfolio, but it is **source-available, not OSI
open source**, so the README must say so. Either way: **Apache-2.0 for everything a customer
ships** (`templates/`, `blueprints/`, `sdk/`) so an ejected stack carries no encumbrance; publish
corresponding source per release so binaries stay redistributable; and a GitLab-style trademark
policy that reserves the name/logo, permits descriptive "managed service for platfolio" phrasing,
and forbids the mark as the first word of a fork name.

## Decisions required before planning

> Ratified 2026-11-07 by the maintainer: **customer-owned infrastructure with bring-your-own
> credentials**, **tenant = team** (a team subscribes and hosts many platform instances), **end users
> of hosted platforms are separate from platfolio's own users**, **secrets stay out of platfolio's
> reach**, and **management via GitHub workflows installed in the customer's repository**. Remaining
> open items (OD1–OD5, OI1–OI3) are tracked in
> [design/01 § Open decisions](design/01-product-and-decisions.md) and
> [design/05 § Open identity questions](design/05-identity.md).

1. **Infra ownership** — customer-owned (recommended), platfolio-managed with written Railway
   approval, or both tiers. Decides the 50/100-project ceiling, who carries runaway usage, the
   AUP exposure, and how eject works.
2. **Tenant unit** — is a "project" a *company* (org with several platforms) or one *platform
   instance*? Decides Stripe object mapping, identity scoping and the data model.
3. **Whose end users log in** — the tenant's customers (shared IdP, sub-processor duties, SSO,
   their domain) or the tenant themselves (much simpler).
4. **Portfolio readiness** — are the candidate apps already multi-tenant, migration-tested and
   self-configurable via env? This is frequently the real bottleneck, cheaper to find now.
5. **Merchant of record** — platfolio (Stripe Billing + Stripe Tax) vs Stripe Managed Payments
   (+3.5%, no ad-hoc invoices).
6. **License** — Apache-2.0 core + `/proprietary`, vs BUSL/FSL source-available with change date.

## Milestone 0: a one-week spike that can say no

> **Carried forward into [design/09 § Milestone 0](design/09-delivery-plan.md)**, which adds the two
> experiments the revised architecture depends on (E1 OAuth third-party consent, E2 IaC apply from CI
> with `preserve()` proven rather than assumed, E5 attestation trust) and the go/no-go rule. The list
> below is kept as the original framing; treat it as superseded, not deleted, so the reasoning trail
> stays intact.

Evidence, not features. Pass = all of:

- [ ] Email Railway (ask-before-deploying / partner terms) and Stripe (APP multi-tenant + MoR for
      the Railway line item); record the answers. Non-technical, highest information value.
- [ ] Prove **third-party OAuth consent**: a Railway account that is *not* in platfolio's
      workspace consents platfolio's OAuth app to a single project with `project:admin`, and
      platfolio then creates a service in it with the resulting token only. Fetch scopes from the
      OIDC discovery document (not the docs table), confirm refresh-token rotation/revocation, and
      confirm whether dynamic registration at `/oauth/register` is usable for platfolio or whether
      an app must be pre-created by a workspace admin.
- [ ] Template path: publish a platfolio template; render its `manifest.json` → build a form from
      `required_inputs`; `templateDeployV2` a stack **into the customer's workspace**; confirm the
      project works with zero platfolio credentials left behind, and test whether a HIDDEN
      template is deployable by another account.
- [ ] Compose round-trip: `dockerComposeImport` a manifest-rendered Compose file, then
      `environmentCreate(sourceEnvironmentId)` to clone production→staging; assert services,
      volumes and variables carried over.
- [ ] Lifecycle: variables, `serviceInstanceDeployV2`, `latestDeployment` polling under a
      token-bucket at the plan's RPH, `customDomainAvailable`/`Create` with the required TXT,
      certificate issuance observed, `customDomainUpdate` retarget staging→production,
      `deploymentRollback`, `projectScheduleDelete`, and **zero leftover resources**.
- [ ] Resilience: kill the controller mid-provision and restart; prove no duplicate services and
      no orphaned domains. Handle an auth denial returned as HTTP 200 + `errors[]`, and a `429`.
- [ ] Stripe test mode: subscription Checkout → `client_reference_id` → entitlement event →
      provision; deliver **duplicate, out-of-order and failed** webhooks; observe
      `invoice.payment_failed` → past_due → unpaid; verify signature on the raw body.
- [ ] Build a **fake Railway** (in-memory GraphQL stub generated from the real schema, which
      introspects without a token) so the reconcile loop is unit-testable offline; add contract
      tests against real Railway in a throwaway project.
- [ ] Cost measurement: real tenant, 2 environments, no staging sleep vs sleep; price it at
      $20/vCPU-month, $10/GB-month RAM, $0.15/GB-month volumes, $0.05/GB egress.

If OAuth-for-third-parties or hidden-template deploys fail, the architecture pivots to
"platfolio as software the customer installs + support subscription", which is a different (and
smaller) product — better to learn that in a week than in a quarter.

## Open items (unverified)

Need a **live test**, not more reading: (1) whether an **UNPUBLISHED/HIDDEN template** link can be
deployed by a *different* account; (2) enforcement when transferring a project in that exceeds the
destination plan's ceilings (e.g. 20 custom domains into Hobby); (3) whether project tokens, deploy
triggers and private-network hostnames survive a transfer (docs only enumerate services, variables,
volumes, history and domains); (4) OAuth consent by an account outside platfolio's workspace.

Need a **written answer from Railway**: whether platfolio's model is blessed under the AUP
"reselling compute resources" clause — their docs say to ask `abuse@railway.com` *before deploying*.

Need a **written answer from Stripe**: whether APP can be orchestrated programmatically by a
platform across many tenants, and who is merchant of record for the Railway line item.

Docs-only gaps: Entitlements under Connect and Accounts v2; `days_until_due` range; the exact
Stripe sub-processor list URL. **Legal, not docs**: US state-by-state taxability of hosting/IaaS,
VAT treatment of resold infrastructure, and whether Railway grants a managed-service arrangement
and on what terms.

## Evidence base

The raw material behind the three reports is kept in `.research/` at the repo root (untracked):
the full introspected Railway GraphQL schema (`schema_full.json`, ~1.1 MB), the published template
and resource JSON schemas, the docs corpus as text plus ~110 pages as markdown, and the fetched
legal/pricing/central-station thread text. Keep it while the design is being planned — it is how
any claim here can be re-verified without re-fetching; delete it before the first application
commit if it should not be part of the project history.

## Repo housekeeping before implementation

`origin` is `git@github.com:fractalsynapse/scaffold.git` and [README.md](../README.md) /
[docs/MAINTAINING.md](MAINTAINING.md) describe the **instruction package**, which explicitly
scopes itself to the starter and "does not select an application architecture, language,
framework, forge or delivery platform". platfolio app work therefore needs: its own repository
(or a rewired remote), its own change/test/release policy covering builds, migrations and deploy
checks, and a `.gitignore` that covers `node_modules`, `.codegraph/`, generated template JSON and
local DB volumes. None of that is authorized by this memo; it is a decision for the maintainer.

## Method note

Railway's `https://backboard.railway.com/graphql/v2` answers schema introspection without a
token (256 mutations / 164 queries), which is why the API inventory above is primary rather than
inferred. Separately: several fetched pages and search results arrived carrying embedded text
shaped like agent instructions naming unrelated repositories and addresses. All retrieved
content was treated as data. Anything in this project that scrapes the web — including a future
platfolio deploy-status notifier — should apply the same rule.
