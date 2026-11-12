# platfolio — product definition and decision register

Part of the [design set](01-product-and-decisions.md). Preceded by
[feasibility](../platfolio-feasibility.md); evidence in [research/](../research/).
Status: **proposed product definition**. No capability described here exists yet.

## Thesis

platfolio is a **meta-platform**: a control plane that hands a *team* managed hosting for
standalone platforms, without platfolio owning the compute and without platfolio ever persisting
the platform's secret values. Per the accepted position: **sell management, not compute.**

*(D24, 2026-11-08: whether platfolio holds the provider **credential** is a disclosed tier choice — managed
default, self-custody option — not an implied promise. The sentence above was always about secret values and
remains true; the sentence that was overreaching was "without holding tenant credentials", now corrected
wherever it appeared, including README and AGENTS.md.)*

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
| D24 | **Credential custody: A (managed broker) is the default tier, B (self-custody) is an option — decided by the maintainer on 2026-11-08.** Mechanism, measured the same day: a workspace grant creates the project and mints per-environment project tokens through the API, and those tokens deploy; the account token is required only by the Railway CLI, which is therefore optional. **platfolio does not operate a fleet of tenant runners** — a machine that executes a tenant's job sees that tenant's credential, which forfeits the only reason B exists while losing A's single hardenable boundary. Paid *management* of tenant-owned runners remains a possible later service. | Resolves OD10 (logged as RESOLVED below). Consequences are stated per tier and never blurred: managed = "will not read", enforced at one boundary and audited; self-custody = "cannot read", architectural. The deciding argument was the runner question, not the UX argument: see [02 § Custody](02-architecture.md) and [the measured record](../research/railway-token-and-sealing-2026-11-08.md). |
| D28 | **The shipped catalog carries no platform identities.** `templates/` holds generic reference manifests (`example-web-app`, `example-full-stack`) exercising the two shapes the renderer must handle — single service, and multi-service with an external auth dependency. TreeDX and ArcNexus are **separate projects**: their manifests live in their own repositories, entered as tenant data through the install flow. Platform names remain in documentation only where they illustrate a real case | 2026-11-09 | [03](03-manifest-spec.md), [08 § D9 exception](08-distribution-and-licensing.md) |
| D29 | **Docker Compose is the authoring format for hosted platforms.** Services, images, build, env, volumes, health, dependencies, limits and replicas are plain Compose; platfolio-only semantics (environment placement, ownership, hostnames, secret custody sources, identity clients, DNS policy, lifecycle, plan, release pinning) live under `x-platfolio`, the spec's designated extension mechanism. Dev and prod are Compose overlays and **the prod overlay is generated by the release pipeline — nobody maintains it by hand**, with regenerate-and-compare as the drift gate. We support a documented subset and refuse the rest by name, because a silently dropped field yields a system that differs from the file the tenant read | 2026-11-09 | [13](13-compose-first-and-execution.md) |
| D30 | **platfolio is the actor; the tenant's pipeline is the executor.** App deployments are applied by curated workflows running with the tenant's grants, triggered by platfolio (`workflow_dispatch`) so the tenant's pipeline stays the path of record; observing state and enforcing lifecycle (suspend, scale-to-zero, restore) stay with platfolio's managed grant, because otherwise disabling Actions would disable the control plane. Four laws: a secret is written once and never read back (D32 supersedes the original wording, which conflated transit with storage); workflow logs are never read; a pinned digest must be one the release job built; curated workflows ship as PRs and pin actions by SHA | 2026-11-09 | [13](13-compose-first-and-execution.md), D22, D24 |
| D31 | **No platfolio-run runner fleet, ever.** A runner holds the tenant's checkout and secrets, so a shared fleet puts every tenant's credentials on our hardware. Optional instead: a runner installed and managed **inside the tenant's own account**, priced as management — never a dependency of any capability. GitHub-hosted runners remain the default | 2026-11-09 | [13](13-compose-first-and-execution.md) |
| D32 | **Secrets are written once and never read back.** platfolio, as the sole management interface, may set a workflow secret from the value a tenant supplied in that request; it may not store, cache, log, or fetch it again. GitHub's write-only API enforces the read side; Railway's readable variables do not, so the provider's keys-only rule is behavioural and stays enforced by test. Consequence stated to tenants: re-apply cannot re-deliver a lost secret — the action is rotate-and-rebind. | 2026-11-09 | [13 § Four laws](13-compose-first-and-execution.md) |
| D33 | **Environment inventory is a first-class artifact of the platform repository.** Typed entries (`reference` / `secret` / `value` / `output`) with defaults, applicability and descriptions, accumulating over time; `secret` entries carry names only, never values, anywhere in the repository. It answers 'what does this need to run' and drives the onboarding panel and the presence checks. | 2026-11-09 | [13 § environment inventory](13-compose-first-and-execution.md) |
| D34 | **Management-layer services provide typed outputs that dependent platforms require by capability, not by identity.** `provides` / `requires` / binding, with credentials relayed once and **re-issued rather than replayed**, and bindings recording the supplier generation they were satisfied against. | 2026-11-09 | [13 § Feeding outputs into inputs](13-compose-first-and-execution.md), OD11 |
| D26 | **One Railway project per platform instance; teams hold multiple platforms.** An instance is the unit of provisioning, deletion, token scope and billing visibility. Shared team services (Keycloak-class) are their own instances rather than side-effects of another platform's project. Confirmed by the maintainer alongside the release | 2026-11-09 | [02](02-architecture.md) |
| D27 | **Domains live with the platform repository.** Each hosted platform has its own repo (forked per tenant), and development flows through commits to it, so literal hostnames in that repo's manifest are tenant configuration rather than catalog data -- which retires the `0.1.0` worry that a shared manifest would leak one tenant's domain into another's. One repository never serves multiple platforms | 2026-11-09 | [12](12-domains-and-dns.md), OD12 |
| D25 | **Domain records are read from the provider, never synthesised; DNS is always the tenant's to manage.** Attach precedes DNS (measured: `customDomainCreate` on a real zone with no record published succeeds and returns `dnsRecords` with `requiredValue`/`currentValue`/`status`), the routing target is the provider's own host rather than any hostname we can derive, and `ACME_DNS01_CHALLENGE` records may appear after attach — so the checklist is re-read every poll, not authored once. Availability is checked pre-attach via `customDomainAvailable`, which is the only source of a human-readable reason. Infrastructure health and domain health stay separate axes, and no capability may require tenant DNS-provider credentials | 2026-11-09 | [12](12-domains-and-dns.md), [evidence](../research/railway-domains-dns-2026-11-09.md) |
| D23 | **Per-service deployment-environment policy.** A service declares which environments it exists in (`spec.services.<name>.environments`), defaulting from ownership: a maintained platform service runs in every enabled environment; `ownership: external` (an upstream image platfolio does not develop — Keycloak-class) is production-only unless stated otherwise. | Some hosted things are infrastructure the tenant consumes, not software under active development, and a staging copy of them costs money and attention for no signal. Renderers must honour the scope, validation must reject a service asking for a disabled environment, and the domain-overlap check must be evaluated *per environment* — a production-only host and a staging host are not in conflict. |
: registered once per platfolio deployment through the App-manifest flow; attached per tenant by one install link; no webhooks in v1.** | Manifest flow verified in GitHub docs: one browser approval returns `id`, `pem`, `webhook_secret`, `client_secret` — so the setup wizard is "register the app → one click → back to platfolio's UI" with nothing to transcribe. Webhook-free connect (poll `GET /app/installations` after the redirect) removes the public-tunnel requirement from development entirely. The `scm.provider` seam carries two implementations from the start — App and PAT/OAuth-app — so a self-hostor who will not install an App is not a support ticket. |
| D19 | **Release tags are bare semver** — `<major>.<minor>.<patch>`, optionally `-prerelease` or `+build`. No `v` prefix. | `production.yml` classifies every tag push against one tested rule and **fails** a `v1.2.3`-style attempt instead of quietly skipping it; provenance's "previous release" lookup reads bare semver tags. |
| D15 | **OD6 decided:** Cordis is vendored at `vendor/cordis` (tag `v4.0.0-rc.12`), managed by `scripts/vendor-cordis.ts` with a lock file and replayed patches. **OD7 decided:** platfolio meets the framework **only at `packages/contracts`**; our tree keeps its own toolchain; if the framework contracts look unstable, an anti-corruption **shell** in `packages/kernel` absorbs the change so `packages/contracts` stays semver-stable. | `vendor/CORDIS.md` is authoritative for the mechanics; the boundary rules are enforceable by CI lint. |
| D16 | **Repository toolchain: pnpm via corepack, pinned by `packageManager`; no dependency build scripts run.** One root manifest with `pnpm run verify` as the single gate command that CI and humans both run. | CI cannot rely on `npx -p` package trees (tsc resolves `@types` by walking to `./node_modules/@types`); a root manifest also keeps installs inside the repository — without one, `npm install` walked up and wrote into `/home/adrian/node_modules`. `strictDepBuilds: false` plus `ignoredBuiltDependencies: [esbuild]` state the posture instead of blanket-allowing scripts. |
| D35 | The GitHub App holds `administration: write` and provisions environments and tenant repositories | A tenant must be able to do everything through platfolio except grant OAuth consent. Measured: `PUT …/environments/{name}` is 403 with `environments: write` alone, and the API has no narrower route. Compensating controls already in the write path: tokens are minted per operation with the narrowest working subset and revoked at the end; the app's *installation* grant is verified by reading it, not by assuming the manifest was approved. Follow-ups filed: try GitHub's narrower `repository_creation` permission (its manifest key cannot be validated from outside a registration), and whether required reviewers are settable through the API at all |
| D36 | platfolio creates and updates tenant repositories; it does **not** delete them | The maintainer's decision, on the risk side of an asymmetric trade: a mistaken `apply` is recoverable, a deleted repository may not be. Eject and suspend therefore remove platfolio's *management records* and leave the repository to its owner to keep, archive, or delete themselves -- which is also honest about ownership, since the tenant's source history was never platfolio's to destroy. The capability gap #130 found (an app-created repository is invisible to the app, so it cannot be deleted) is therefore **accepted rather than worked around**; #125's `repository_creation` permission is still worth trying, but for create-and-configure only, not as a route to deletion |
| D37 | The managed action is a composite action in platfolio's own repository, pinned by commit SHA, and a stale `plan_hash` fails closed | Answers #123's open design questions. In-repo packaging sidesteps #130 entirely -- the repository already exists and is where the app is installed -- and D30 law 3 still requires the pin to be a SHA the release job produced, never a hand-typed value. On a mismatch the action refuses and reports rather than applying the current plan: a queued dispatch applying a superseded plan is the kind of silent drift this project keeps meeting, and failing closed leaves the tenant's infrastructure unchanged while platfolio re-dispatches. Partial completion is a distinct outcome state, never collapsed into success or failure |
| D38 | Platform templates live in `templates/` as source, are published into tenant repositories by platfolio, and the org repositories are generated artifacts | Three kinds (public web service, inbound-less worker, shared identity) so the set exercises domains, retained volumes and capability publishing rather than three variants of one. The source of truth stays here and is checked by tests; the published repository is a fork point a team owns outright. Publishing **writes** but never creates or deletes a repository: #130 makes creation half-useful (the app cannot see what it made) and D36 makes deletion unthinkable |
| D39 | Review gates are waived for the agent's own pull requests until the platform has tenants | The maintainer's call during build-out: no human is waiting on these diffs, so stopping to ask turns every merge into a round trip with no added safety. Tests still gate `staging`; a Production run still gates a tag; a release to `main` still needs the maintainer's permission for that release. The install PR keeps its review shape because it is what a tenant will meet, not because anyone is reviewing these |
| D40 | platfolio uses Keycloak for **its own** identity, and the foundation is built interfaces-first with the platform hosting itself as the test | The same shared-service shape a tenant gets (`templates/shared-identity`), so our identity path is exercised by the product rather than beside it. Ordering consequence: identity and the API are one build — an OIDC provider protects nothing until a service verifies its tokens — so the sequence is local Compose (Postgres + Keycloak + control-plane), then records and the controller, then self-hosting across staging/production, then CLI and web. Recorded because the maintainer's instruction was explicitly to stop polishing edges and pour the foundation: defects found outside the current slice get an issue, not a detour. See [16](16-foundation-build-order.md) |
| D41 | The control-plane API is designed spec-first in OpenAPI, and the specification is the validation mechanism (`api:check`) | The maintainer's rule, written into AGENTS.md. Enforced in both directions -- a handler without a spec entry fails, a spec entry without a handler fails -- because one-sided validation catches only half the drift, and because a pluggable platform's contract must be the thing that is checked rather than a description of one implementation. Shared shapes stay defined once: StandardSchema remains the source where a shape is also a capability contract (see D15's seam rule) |
| D42 | Teams **can** share services with one another, via an explicit grant rather than an open capability | The maintainer's answer to #176. A capability that any team could consume is a lateral-movement path: a hostile instance asking a shared Keycloak for a client secret should not succeed because the realm exists. So `capability_shares` is a first-class record (provider instance → consuming team), binding requires a live share when the teams differ, and revoking a share does not silently break the consumer -- it moves the binding to `stale`, because a running app keeps working while the *intent* is withdrawn. Modelling it now means widening later is a policy row, not a migration |
| D43 | `destroy` is owner-only, tears down **the managed service only**, and must be safe by construction | Answer to #176 question 2: only owners destroy, and the thing destroyed is what platfolio provisioned -- never the repository (D36) and never their development workflow. Safety is structural rather than a warning dialog: a destroy that would strand a consumer is refused with the consumer named, a member is told `owner role required` for a resource they can see (403, deliberately, since they are already authorised to see it), and the CLI returns a reference plus a plan of what goes and what stays. An easy path that is unsafe is how a team loses production at 2am |
| D44 | Open SaaS: any person may create a team and manage membership; **invitations** are in scope for the first release | Answer to #176 question 3. This changes `team_members` semantics: an invited person is an intent to become a member, not a member, so invitations need their own state (`pending`/`accepted`/`revoked`/`expired`) and must be claimed against a verified identity (#178) rather than an email someone typed. A platform meant to be opened up cannot make adding a teammate an admin task |
| D45 | Instances are addressed `team/name`, the name is unique per team, and it follows repository-style slug rules | Answer to #176 question 4: `org/repo` familiarity is free and prevents the invisible collision. Slug constraints are enforced in the schema and the database, and the conformance suite exercises them -- an application-layer check would be a second rule the in-memory double would not reproduce |
| D46 | Platform email is sent through a **remote SMTP provider**, configured not embedded; local development uses **Mailpit**, asserted through its HTTP API | The maintainer's answer to #186: option A is accepted for *identity* -- the IdP asserts whether an address is verified, and platfolio does not invent its own proof-of-ownership flow. But transactional email (invitations, expiry notices, security alerts) still has to be delivered, so sending is a capability seam with two implementations rather than a feature of the control plane: `smtp` remote in staging/production, Mailpit in Compose locally. Mailpit's message API is what makes "the invitation was sent, to this address, with this link" a test assertion instead of a log line someone reads -- the same reason every other seam here has a second implementation. SMTP credentials follow D4: a name and a presence check, never a value the platform stores. |

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

- **OD12 — RESOLVED by D27: literal hosts stay, in the platform's own repository.** The per-instance root-domain and pattern scheme was designed against a shared-catalog assumption that does not hold: repos are forked per tenant and domains are not secrets. What remains is the *placement-aware* host handling already implemented, plus the checklist flow in [12](12-domains-and-dns.md).
- **OD13 — Database provisioning via templates: OPEN, and now known to be possible.** `serviceCreate` with a `templateId` creates the service; what is unresolved is making it deploy and wiring its URL into app services without platfolio ever holding the value. This is the provider's top priority: without it the flagship platforms cannot run.
- **OD12 — (superseded) Manifest hosts become patterns. RESOLVED.** `services[].domains` currently holds literal hosts (`app.treedx.example.com`), which is fixture data a tenant would inherit and cannot serve two teams from one manifest. Shape: the manifest declares *which* services are public and the host pattern (`app`, `api`, wildcard policy); the instance supplies the root domain per environment; the plan resolves them. Breaks manifest fixtures, so do it before tenants exist rather than after — see [12 § Where a domain is defined](12-domains-and-dns.md).
- **OD11 — Team services: typed `provides`/`requires` between instances. OPEN; S2 preferred by the
  maintainer (2026-11-08). Nothing here is implemented.**

  **Why this is a decision and not a feature request.** Three of our own artifacts currently contradict
  each other:

  1. [05 § I2](05-identity.md) promises *"P1 users live in a per-team realm"* — one identity per team.
  2. [samples/full-stack/manifest.yaml](../../samples/full-stack/manifest.yaml) puts `keycloak` **inside the
     ArcNexus instance's services**, with `identity.mode: hosted-realm`. Deploy TreeDX and ArcNexus for one
     team and the model yields two Keycloaks and two user databases — exactly what I2 forbids.
  3. The same fixture carried `OIDC_ISSUER: placeholder-resolved-at-apply-time`, because there is no way to
     say "this value comes from something else we run". The closed `value_source` enum is
     `preserve | shared-variable | resource | platform-internal | customer-held`, and
     [03](03-manifest-spec.md) forbids `platfolio-held`. A renderer would have shipped the literal string,
     the app would have failed, and the controller would have correctly reported an unhealthy deploy.

  **Ownership is not the new axis.** All services — internal, shared, external, independent — belong to the
  **team**: one billing relationship, one management surface, one deletion authority. That is unchanged and
  uniform. What is new is a service's **role**: whether it exists inside one instance, or
  **provides typed outputs that other instances consume.** A "team service" is a role, not a different owner.

  **Shapes considered.**

  - **S1 — `spec.sharedServices` inside a manifest.** Rejected. One document would then describe resources
    with different *roles and lifecycles*, and every instance-level answer becomes ambiguous: does ejecting
    TreeDX include the realm and its user data; what happens when two teams' manifests both declare
    `keycloak-host`; does suspending an app suspend what it consumes. Each answer is another flag.
  - **S2 — a provider instance plus an explicit reference edge.** Preferred. The provider is an ordinary
    instance of an ordinary platform (`keycloak-host`, `openbao-host`, `loki-host`), owned by the team and
    billed like anything else; it declares outputs, and consumers declare requirements against them. The
    model keeps its most valuable property — **one document, one lifecycle** — and the new machinery is
    narrow and nameable.

  **What S2 actually adds** (all of it still to design and build):

  - `provides:` on the provider: typed outputs (`url`, `realm-client-template`, `secret-path`, `endpoint`) —
    a contract, so a consumer cannot ask for an output that does not exist.
  - `requires:` on the consumer, plus a new `team-service` member of the closed `value_source` enum, so
    resolution is explicit at plan time rather than string interpolation at apply time.
  - **Ordering** in the controller loop: a plan whose requirements are unresolved is not dispatched; provider
    readiness is a precondition, verified by read-back like everything else.
  - **Reference-counted deletion and suspension**: removing a provider with live consumers is refused by
    default, with an explicit override path that states the blast radius. The team holds the authority, and
    the consumer instance's owner can see who is blocked.
  - **Health as a dependency state**: a consumer can be "healthy, provider degraded" rather than a misleading
    red or green.

  **Open sub-questions, before any of it is buildable:**

  - Per-environment mapping: a provider's `production`/`staging` are the *provider's*, not the consumer's. If
    the provider is production-only (D23 `ownership: external`), consumer staging has no identity source and
    must either get its own or declare `identity.mode: none`. Needs a rule, not an assumption.
  - Cross-project reachability is **unverified**: if the provider lives in another Railway project, can
    consumers reach it privately, or only over a public TLS endpoint? Fine for Keycloak by design, material
    for a log pipeline and a vault. → **E23**.
  - Runtime versus deploy-time consumption: OpenBao is deploy-time only (the runner fetches and injects), so
    it tolerates an outage at deploy time and nothing else. Loki is runtime-coupled, so the provider's
    availability is on the hot path of every consumer. The contract should say which is which.
  - Whether a provider may be a *different platform version* than its consumers pinned to, and what an
    upgrade of a shared provider means for instances that did not consent to it.
  - Migration of `identity.mode: hosted-realm` in [05](05-identity.md): under S2 "hosted realm" stops being a
    thing inside an instance and becomes "the team has a `keycloak-host` provider instance". 05 now points
    here instead of restating it.

  **Decision-free fix taken alongside this record:** the manifest validator now rejects placeholder-shaped
  literal env values (`placeholder…`, `TODO`, `changeme`, `replace_me`, `xxx`), so an unresolved reference
  fails at parse with a located message. The ArcNexus fixture was corrected to a real issuer URL and marked as
  *manually supplied until OD11 lands* — the fixture no longer encodes a value the system cannot produce.

- **OD10 — Where the provider credential lives, and who the trusted computer is: RESOLVED by D24
  (2026-11-08) — A as the default tier, B as a self-custody option, no platfolio-run runner fleet.**
  What was decided with measurement rather than argument: created by
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
