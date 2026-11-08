# platfolio — product definition and decision register

Part of the [design set](01-product-and-decisions.md). Preceded by
[feasibility](../platfolio-feasibility.md); evidence in [research/](../research/).
Status: **proposed product definition**. No capability described here exists yet.

## Thesis

platfolio is a **meta-platform**: a control plane that hands a *team* managed hosting for
standalone platforms, without platfolio owning the compute and without platfolio ever holding
the platform's secrets. Per the accepted position: **sell management, not compute.**

Two sentences from the feasibility review carry the whole design:

- Railway's AUP prohibits "**reselling compute resources**" ([railway.com/legal/acceptable-use](https://railway.com/legal/acceptable-use)), so platfolio must not bill for capacity it bought.
- Railway projects are capped at **50 (Hobby) / 100 (Pro) per workspace**, so a platfolio-owned estate dies at ~50–100 tenants regardless of demand.

The architecture therefore separates **intent** (platfolio) from **privileged execution**
(the customer's own CI, holding the customer's own credentials). That separation is what makes
"no access to hosted platform secrets" provable rather than aspirational.

## Decision register

Accepted by the maintainer on 2026-11-07. Anything marked *consequence* follows from the decision;
it is not a new choice.

| # | Decision | Consequence for design |
| --- | --- | --- |
| D1 | Sell management, not compute. | platfolio bills a software + operations subscription. Never a margin on Railway usage. |
| D2 | Customers bring their own Railway credentials for v1. | *(Scope narrowed 2026-11-08 by D20: this is now mode A, still supported. Original consequence stood as written: platfolio stores **no** long-lived infrastructure credential; onboarding is a connect flow, never a pasted master token. In mode B one grant per account is held through the broker; it is never a personal account token, and never pasted per project.)* |
| D3 | Tenant unit is a **team**; a team subscribes and may host **many platforms**. A hosted "project" is one platform instance. | `Team → Subscription → PlatformInstance(→ Railway project)`; entitlements and limits at team level, state at instance level. |
| D4 | platfolio must not have access to hosted platform secrets. | Secrets are declared by **name** and resolved out-of-band. Enforced as the zero-secret invariant (§ [04](04-execution-plane-github-workflows.md)); a capability that needs the value is rejected by design. |
| D5 | Manage platforms by installing and using **GitHub workflows** in the customer's repo. | The execution plane is the customer's Actions. platfolio's GitHub App gets an install-scoped, PR-reviewed workflow, then dispatch-only. Also satisfies D4 and sidesteps D2's credential custody. |
| D6 | platfolio's own users ≠ hosted platforms' users. | Two strictly separated identity planes (§ [05](05-identity.md)). No shared realm, cookie domain, user ID or database. |
| D7 | An **identity host** is a platfolio product feature: a team's platforms can share one user system, or the team can point at its internal OIDC. | Identity is a provisionable resource + a declared dependency (`OIDC_ISSUER`), never a hard-wired service. |
| D8 | First two platforms: **TreeDX** (API-only) and **ArcNexus** (frontend + backend, already Keycloak-based). | Two archetypes in the manifest spec: `api-service` and `full-stack-web` (§ [03](03-manifest-spec.md)). |
| D9 | Hosted platforms are added over time. | Platform catalog is data-driven and versioned; adding a platform must not require a platfolio code release. |
| D10 | Mobile management app is a goal; React component portability and API/MCP interfaces matter. | API-first contract, shared component package, and an MCP surface equal to the public API (§ [07](07-interfaces-api-mcp-mobile.md)). |
| D11 | Distribution: multi-arch OCI images + workflow/action artifacts + installer; **not** a self-contained control-plane binary. | See [08](08-distribution-and-licensing.md). |
| D12 | The control plane is built on **Cordis** as its kernel: interface contracts at every seam, swappable providers, plugin-defined business processes, and contract diffs that derive version bumps. | Analysis, seam list and eight named risks in [10](10-cordis-kernel-and-extension-seams.md). Raises **OD6** (vendoring) and **OD7** (toolchain). |
| D13 | Extensions come in **two tiers**: first-party plugins in-process; third-party or tenant-authored extensions out-of-process behind the same contract over RPC. | Required to keep D4 true — Cordis `isolate()` scopes service *views*, it is not a sandbox, so in-process plugins share the heap. |
| D14 | Frontend is a **component library plus declarative page documents**; no runtime-loaded third-party React. | The security boundary, and what makes the mobile app a second renderer rather than a rewrite ([11](11-ui-components-and-page-model.md)). |
| D18 | **OD2 decided: platfolio code and documents are licensed under Apache-2.0.** Root `LICENSE`, `Copyright 2026 Fractal Synapse Labs LCA PBC`, added 2026-11-08. | The grant exists, so a release tag is possible once `LICENSE` is on `main`. Three sub-questions inside this decision stay open (§ [08 § Remaining under D18](08-distribution-and-licensing.md)): full license text vs the short-form notice now present, the `/proprietary` boundary, and the trademark policy. |
| D20 | **Credential model: managed (B) is the default, strict (A) is a first-class configurable mode.** One grant per tenant account — Railway OAuth `workspace:admin`, or one workspace token through the broker — and platfolio mints per-project/per-environment tokens and writes them into the tenant's GitHub environment secrets itself. | Amends the consequence of D2 ("customers bring their own Railway credentials for v1"): that becomes mode A, still supported, not the default. The seam that makes this one switch instead of a fork is the provider-credential broker + `infra.provider`; the difference between "won't read" and "can't read" is documented per mode, in this repo and on the site. |
| D21 | **Platfolio may set a hosted platform's secret values, by default sealed.** Delivery modes: `relay-sealed` (default), `relay-plain` (opt-out, e.g. debug instances), `tenant-side` (deep link into the tenant's provider UI), `runner-side` (mode A: value enters via the tenant's CI secret). A relayed value is forwarded once and never persisted, logged, cached, queued, or returned in an error. | Amends **OD3** ("secret relay: not offered"), which was written when A was the only mode. Sealing is what makes the convenience safe: Railway states a sealed value cannot be retrieved via the API, so after delivery platfolio cannot read it back either. **Amended 2026-11-08:** the property is *capture nothing anywhere* — the value travels from a UI field through the API to Railway and exists in no platfolio log, cache, queue, error, database row or response, and there is no read-back endpoint to mistake for a view. Because `relay-sealed` depends on provider support that E18 has not confirmed, delivery **refuses** to run in that mode when the provider does not advertise the `sealed-variables` capability, rather than silently writing an unsealed secret. `isSealed` exists in the IaC SDK's `VariableConfig` and in the introspected GraphQL schema; whether `variableUpsert` honours it was to be verified live (E18), not assumed. **E18 result (2026-11-08, measured on a live workspace):** it does not, and cannot — full introspection of the v2 schema shows `isSealed` exactly once, as the readable `Variable.isSealed`; no input field anywhere accepts a seal flag, and no query returns a `Variable`, so sealing cannot be verified either. Both a workspace grant and an environment-scoped project token read a sentinel back immediately after writing it. Shipped default is therefore `tenant-side`; `relay-sealed` survives only as a provider-agnostic capability flag (`sealedVariables: false` for Railway), and the panel's refusal to render inputs without that flag became the mechanism that mattered. |
| D23 | **Per-service deployment-environment policy.** A service declares which environments it exists in (`spec.services.<name>.environments`), defaulting from ownership: a maintained platform service runs in every enabled environment; `ownership: external` (an upstream image platfolio does not develop — Keycloak-class) is production-only unless stated otherwise. | Some hosted things are infrastructure the tenant consumes, not software under active development, and a staging copy of them costs money and attention for no signal. Renderers must honour the scope, validation must reject a service asking for a disabled environment, and the domain-overlap check must be evaluated *per environment* — a production-only host and a staging host are not in conflict. |
: registered once per platfolio deployment through the App-manifest flow; attached per tenant by one install link; no webhooks in v1.** | Manifest flow verified in GitHub docs: one browser approval returns `id`, `pem`, `webhook_secret`, `client_secret` — so the setup wizard is "register the app → one click → back to platfolio's UI" with nothing to transcribe. Webhook-free connect (poll `GET /app/installations` after the redirect) removes the public-tunnel requirement from development entirely. The `scm.provider` seam carries two implementations from the start — App and PAT/OAuth-app — so a self-hostor who will not install an App is not a support ticket. |
| D19 | **Release tags are bare semver** — `<major>.<minor>.<patch>`, optionally `-prerelease` or `+build`. No `v` prefix. | `production.yml` classifies every tag push against one tested rule and **fails** a `v1.2.3`-style attempt instead of quietly skipping it; provenance's "previous release" lookup reads bare semver tags. |
| D15 | **OD6 decided:** Cordis is vendored at `vendor/cordis` (tag `v4.0.0-rc.12`), managed by `scripts/vendor-cordis.ts` with a lock file and replayed patches. **OD7 decided:** platfolio meets the framework **only at `packages/contracts`**; our tree keeps its own toolchain; if the framework contracts look unstable, an anti-corruption **shell** in `packages/kernel` absorbs the change so `packages/contracts` stays semver-stable. | `vendor/CORDIS.md` is authoritative for the mechanics; the boundary rules are enforceable by CI lint. |
| D16 | **Repository toolchain: pnpm via corepack, pinned by `packageManager`; no dependency build scripts run.** One root manifest with `pnpm run verify` as the single gate command that CI and humans both run. | CI cannot rely on `npx -p` package trees (tsc resolves `@types` by walking to `./node_modules/@types`); a root manifest also keeps installs inside the repository — without one, `npm install` walked up and wrote into `/home/adrian/node_modules`. `strictDepBuilds: false` plus `ignoredBuiltDependencies: [esbuild]` state the posture instead of blanket-allowing scripts. |

## Who it is for

**Customer:** a small team (1–10) that operates one or more platforms and wants hosting set up
once and then hands-off, inside the development process they already have (GitHub). They keep
their repos, their review gates, their credentials, and their own domain.

**Not the customer:** people who want a generic Heroku-alternative for arbitrary apps. platfolio
only hosts platforms for which a manifest exists (D9 defines how that set grows).

## Tenancy model

```
Platform (catalog entry, versioned manifest)      e.g. treedx@1.4.0, arcnexus@0.9.2
  └── Team (tenant org; the billing + identity unit)
        ├── Subscription (one Stripe object; entitlements + limits)
        ├── TeamMember (roles: owner|admin|member|viewer)
        └── PlatformInstance  ← "a project" in D3
              ├── environments: production, staging (optional), preview (optional)
              ├── connection: GitHub repo(s) + Railway project + per-env token custody
              ├── identity binding: platfolio-hosted realm | customer IdP | platform-local
              └── domains, resources, releases, jobs, audit trail
```

`PlatformInstance` is the unit that maps to one Railway project **in the customer's account**.
One team can hold several instances; the 50/100-projects-per-workspace ceiling is therefore the
customer's ceiling, not platfolio's.

## MVP scope (observable)

An MVP is reached when a team can:

1. Sign up for platfolio, create a team, and subscribe to a plan that allows N platform instances.
2. Connect a GitHub repository for TreeDX, and for ArcNexus, using platfolio's GitHub App, and see
   platfolio open one review-able PR that installs the managed-workflow files.
3. Connect their Railway account (project-scoped OAuth consent or a project token they create),
   with the target project in **their** workspace.
4. Click "create platform" and get: staging + production environments, the platform's services,
   a database, generated domains reachable, and a status page showing what was applied and why.
5. Have deploys happen on their normal push-to-branch, with platfolio reporting the result as
   GitHub commit statuses/checks.
6. See a configuration screen listing every required secret **by name**, with a green check only
   when the deployed service is actually healthy — never showing or storing a value (D4).
7. Point the platform at their own OIDC, or at a platfolio-hosted identity realm for the team.
8. Attach a custom domain with a copy-paste DNS panel, including the required TXT verification.
9. Cancel and then export: full stack-as-config, data dump instructions, and a transfer/eject path
   that works when platfolio is turned off.
10. Run the same install locally with Docker Compose from the same manifest.

## Explicit non-goals for v1

No arbitrary-app hosting; no in-platform code editor or preview-deploy-per-PR at first; no
billing of Railway usage; no multi-cloud (Railway only, with the abstraction documented but not
implemented); no WYSIWYK marketing-page builder (content collections and git authoring only); no
SOC 2 audit program (the controls listed in [06](06-billing-and-lifecycle.md) are the start, not
the attestation); no per-customer Keycloak inside platfolio's own account.

## Decision log — previously open items

**Accepted 2026-11-07; extended 2026-11-08.** The maintainer accepted the recommended answers to OD1,
OD3, OD4, OD5, OD6a and OD8, and to the identity questions OI1–OI3 (now recorded as decisions in
[05 § Identity decisions](05-identity.md)). **OD2 is now decided** — Apache-2.0, recorded as D18.
**One remains open: OD9** (core lineage, created by E9). The Railway and Stripe written answers
(P1, P2) are handled directly by the maintainer; they gate milestones rather than this document.

- **OD1 — Merchant of record: platfolio is the MoR.** Standard Stripe Billing, **no Connect**, flat SKUs
  on `billing_mode=classic`, Stripe Tax with self-managed registrations plus `tax_id_collection` for EU
  B2B reverse charge. Revisit [Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments)
  (+3.5%, Stripe files in 80+ countries, incompatible with Connect, no ad-hoc invoice items) before
  selling into many consumer jurisdictions — harmless under D1 because platfolio never passes usage
  through. Consequence: the invoice pipeline assumes platfolio-created subscriptions.
- **OD3 — Secret relay: superseded by D21** (2026-11-08). The original answer — never accept a value —
  assumed mode A was the only mode. Under B the tenant already grants a credential that could read
  variables, so refusing to *write* them bought UX cost without buying much secrecy, and sealing
  converts the write path into one whose values platfolio then cannot read back. The remaining parts of
  the original answer stand: presence-by-name plus behavioral verification, and support is
  tenant-executed. Relay is opt-out per secret, and the strict mode keeps the original property.
- **OD4 — ArcNexus topology: one repository for MVP.** Railway's multi-repo `partial` ownership stays a
  documented extension, not a day-one requirement. Revisit if frontend and backend ship independently.
- **OD5 — Preview environments: out of MVP.** Production plus optional staging, staging sleep-by-default
  or opt-in, because environments do not share runtime and each enabled environment doubles billable
  footprint. Ephemeral environments are a later, priced feature.
- **OD6a — Consuming the vendored framework: publish patched forks under our own scope** (e.g.
  `@platfolio/cordis`) built from `vendor/cordis`, consumed by exact version. Rejected: making `vendor/`
  a workspace member — that drags the framework toolchain into platfolio's tree, contrary to OD7. For
  the E9 spike the published upstream `4.0.0-rc.12` artifacts stand in, which is sound **only** because
  the vendored tree is an unpatched checkout of that tag; the moment `vendor/patches/` is non-empty the
  spike must use our own packages. Evidence in
  [10 § E9 result](10-cordis-kernel-and-extension-seams.md).
- **OD8 — Seams: declare all twelve, multi-implement two.** Every seam ships an interface plus a
  conformance-tested in-memory or local **test double** — the cheap second implementation that proves the
  interface is not provider-shaped. A second **real** implementation ships only for `render.target`
  (Railway IaC + Compose, both already required) and `provision.flow` (`standard-saas` +
  `import-existing`, the path by which a tenant migrates to us). `infra.provider` keeps one real
  implementation until a named customer needs another.

**OD6 and OD7** were decided earlier and are recorded as D15 in the register above: vendored at
`vendor/cordis` (`v4.0.0-rc.12`, MIT notice preserved, managed by `scripts/vendor-cordis.ts` with
`verify` as the CI gate and local changes only as `vendor/patches/*.patch`), meeting the framework
only at `packages/contracts` with an anti-corruption shell in `packages/kernel` if its surface proves
unstable. Mechanics in [vendor/CORDIS.md](../../vendor/CORDIS.md).

- **OD10 — Where the provider credential lives, and who the trusted computer is: OPEN, created by
  E15/E18/E21/E22. Blocks M2's shape; nothing further on the execution plane should be built until it is
  chosen.** *(2026-11-08)*

  **Measured premises** ([record](../research/railway-token-and-sealing-2026-11-08.md)):

  1. **Any Railway grant platfolio holds can read platform secret values.**
     `variables(projectId, environmentId, serviceId)` returned the sentinel for both a workspace token and an
     env-scoped project token. `Environment.config` redacts values; `variables()` does not — that difference
     is what made this look ambiguous. Stated plainly: *if we hold a grant, we can read.* Sealing does not
     save us, because the API can neither set it nor let us verify it (E18/E22).
  2. Grants differ in capability: the workspace token performs `projectCreate`, `environmentCreate`,
     `projectTokenCreate`, `variableUpsert` and variable reads, but **not** `serviceCreate`; the
     env-scoped project token (header `Project-Access-Token`) performs `serviceCreate` and variable reads.
     `serviceInstanceDeploy` denied for both, but only against a nonexistent service id — **inconclusive**.
  3. **The Railway CLI accepts neither token**: `config plan/apply` needs an account token, and hand-built
     `environmentApplyChangeSet` payloads are accepted yet have no observable effect (etag unchanged). So
     there is **no proven CLI-less config-as-code path** today.
  4. **GitHub Actions secrets are write-only by API design** — values are never revealed, only names. A
     Railway credential in the tenant's GitHub environment secrets is something platfolio can write and
     provably cannot read; the same credential in platfolio's store is readable.

  The real question is **which machine we are willing to call trusted**:

  - **A — platfolio holds the grant** (today's D20 default). Best UX: one click, instant provisioning, no
    runner minutes for control-plane calls. Property: *"we will not read"* — demonstrated by code, one
    boundary, an audit log, and marketing that says exactly that. Note premise 3 still bites for deploys.
  - **B — the tenant's CI holds the grant.** platfolio dispatches and verifies; credentials and secrets sit
    in GitHub where we cannot read them. Property: *"we cannot read"* — the only option where invariant 1 in
    [00](00-target-architecture.md) is literally true. Costs: runner minutes on private repos (the maintainer
    flagged this as real money for tenants), an async dispatch UX, and — if deploys need the CLI — an
    **account token** living in that repo, readable by anyone who can commit a workflow. Blast radius moves
    from platfolio to the tenant.
  - **C — platfolio-operated self-hosted runners.** Removes the per-minute cost but puts tenant secrets and
    tenant-controlled workflow code on machines platfolio operates: the property collapses back into "will
    not read", it adds an estate that [00](00-target-architecture.md) forbids (management, not compute), and
    it carries a genuine remote-code surface. Against as a default; *for* as instructions a tenant runs on
    their own machine.
  - **D — tiered: B as default, A as an explicit "hassle-free" option.** Two conformance-tested custody modes
    rather than one (the seams already assume this: `credential.broker`, `execution.plane`, `infra.provider`),
    and each tier's guarantee stated in one honest sentence.

  **RESOLVED CONDITION (2026-11-08, measured with maintainer approval, 1 deploy consumed): a project token
  deploys.** `serviceCreate` with an image source and `serviceInstanceDeploy` both succeeded on an
  environment-scoped project token, reaching `SUCCESS`. The account token is therefore needed only by the
  Railway CLI, and the CLI is now optional: rendered IaC becomes an ejection/handover artifact rather than
  the runner's execution mechanism, while the runner applies state through ordinary mutations. Least
  privilege is available exactly where it matters — a per-instance, per-environment token leaks one
  environment of one project. **Option B's main objection has fallen; D with B as default stands
  unconditionally.** Full table:
  [research record](../research/railway-token-and-sealing-2026-11-08.md).

  **Recommendation: D with B as the default — conditional on one measurement.** If a project token can deploy
  without the CLI, B needs no account token anywhere, and the pitch becomes "least-privilege per environment,
  held by your CI, unreadable by us" at the lowest ongoing cost. If it cannot, B is forced to store an account
  token in the tenant's repo, which is a **worse** posture than A holding a scoped token — and then the
  default should be A with disclosure instead. One real deploy (1 of the 20/day ceiling) settles it; I am not
  choosing on an inconclusive probe.

- **OD9 — Core lineage: OPEN, created by the E9 experiment.** E9 confirmed the vendored core boots and
  swaps providers by configuration, but showed the published `@cordisjs/plugin-server@1.7.0` requires a
  symbol (`Service.resolveConfig`) that exists only in the fork **`@deepseek-ai/cordis@4.1.0`**, not in
  upstream `cordiverse/cordis`. Choose one: **(a) stay on upstream cordiverse/cordis** (what is
  vendored today) and author platfolio's own transport and provider adapters — self-contained, no
  inherited plugin supply chain, more code we own; or **(b) track the fork**, gaining working published
  plugins at the cost of depending on a third party's divergence, whose license and provenance must be
  verified **before** any vendoring change. Recommendation: **(a) for v1** — HTTP and GitHub/Stripe
  clients are small, well-understood surfaces we would wrap anyway behind `packages/kernel`, and the
  boundary in D15 makes the fork decision reversible later. Evidence and consequences:
  [10 § E9 result](10-cordis-kernel-and-extension-seams.md), [E13](09-delivery-plan.md).

  Provenance check (2026-11-07, informs E13): the fork is MIT-licensed, but its `repository.url` points
  at `github.com/deepseek-ai/deepseek-harness` and `github.com/deepseek-ai/cordis` returns 404 — so
  option (b) means tracking a framework copy maintained **inside another product's repository**, at
  version `4.1.0` (ahead of the vendored `4.0.0-rc.12`). That strengthens the recommendation for (a).
