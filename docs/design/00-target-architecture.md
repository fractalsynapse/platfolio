# platfolio — target architecture and invariants

**Read this first.** It is the one document that says what platfolio is being built to *be*,
independent of milestones, pricing, or schedule. Everything else in this directory describes how to get
there or what is provable today; [09](09-delivery-plan.md) says when.

Scope: **the system's own capabilities.** Business, commercial, licensing-go-to-market and support
material are deliberately absent — this is an open-source technical repository, and the company built on
top of it is a separate artifact. Two consequences of that separation *are* architectural and appear as
invariants: nothing may make a tenant's stack dependent on platfolio remaining present, and nothing
that protects a tenant may be gated behind a paid tier.

Written for agents and reviewers working in this repo. If a change here feels faster than an invariant,
the invariant wins and the change is wrong.

## How to use this document

- **Before implementing**, test the change against § 2. A constraint that blocks the change is
  information about the change, not an obstacle to route around.
- **When a future feature looks tempting**, check § 4 then § 3. If it is in neither, it is not on any
  roadmap: stop and raise it as a question rather than building it.
- **Never restate decisions here.** Accepted decisions are canonical in
  [01 § Decision register](01-product-and-decisions.md); provider facts in
  [feasibility](../platfolio-feasibility.md) and [research/](../research/). If this document and those
  disagree, the disagreement is a defect to fix in the same change, in the direction of less claim.
- **Status honesty.** § 2 names enforcement mechanisms; a mechanism marked *(design)* does not exist
  yet and must not be cited as a control.

## 1. The goal, stated as capabilities

platfolio is a **meta-platform**: a control plane that operates *other, standalone platforms* as
managed hosting targets for a **team**, on infrastructure the **team owns**, described by **versioned
data** rather than bespoke code.

| Capability | What "done" means |
| --- | --- |
| **Platforms as data** | Adding a hosted platform is a catalog change — a manifest plus page documents — not a control-plane release (D9). Two archetypes are specified (`api-service`, `full-stack-web`); a third is a schema change, not a special case. Nothing in this row is implemented yet. |
| **One contract, many renderings** | A single manifest renders the Compose file, the provider's IaC file, the workflow inputs, the DNS panel, the identity config and the provisioning plan. Local dev, hosted deploys and self-hosted installs are three renderings of one artifact, verified by the same fixtures ([03](03-manifest-spec.md)). |
| **Tenant-owned infrastructure** | The tenant's project, credentials, secrets, data, domains and desired-state file live with the tenant. platfolio holds intent, status and orchestration — and can be deleted without stranding anyone. |
| **Provider swap at every seam** | Every provider-shaped dependency is a named capability with a versioned contract, a conformance suite, and at minimum a real implementation plus a test double ([10](10-cordis-kernel-and-extension-seams.md)). Swapping a provider is configuration, not a fork. |
| **Execution through the tenant's own pipeline** | Privileged actions happen in the tenant's CI with the tenant's credentials; platfolio dispatches intent and verifies attested, read-back results ([04](04-execution-plane-github-workflows.md)). |
| **Identity as a declared dependency** | `OIDC_ISSUER` and friends are resolved by mode: none, bring-your-own OIDC, platfolio-hosted per-team realm. A tenant's platform never learns platfolio exists in order to authenticate. |
| **Complete lifecycle** | Connect → operate (deploy, observe, limit, rotate, scale) → suspend without data loss → export → leave. Each transition is a named, resumable, idempotent sequence, never a hopeful script. |
| **One surface, many clients** | The public API is the only implementation path: web dashboard, mobile app, CLI, MCP tools and tenant automation are peers of it, never privileged side channels ([07](07-interfaces-api-mcp-mobile.md)). |
| **Portability as a first-class property** | Multi-architecture images; the same stack runs in plain Docker Compose; the architecture a workload needs is a manifest field, not a packaging project. |
| **Ejection as a capability** | The export package is tested in CI, not demoed: rendered config, data dumps with restore steps, checksummed archives, secret *inventory* with no values, and a working standalone bring-up. |
| **Operation without access** | platfolio can run a tenant's stack well while being unable to read what runs in it. This is a design goal, not a trust promise. |

## 2. Invariants

These hold at every stage, including the MVP, and they are the reason later stages are cheap.

1. **No tenant secret or credential ever crosses platfolio.** Names only; provider-side `preserve()`;
   presence verified by GitHub secret listing, which cannot reveal values; privileged credentials held
   only by the tenant's runner. Enforced by the secret-name lint on manifests and the zero-secret audit
   in [tenant-safety-check](../../.agents/skills/tenant-safety-check/SKILL.md) *(design — no code yet)*.
2. **No compute resale, no platfolio-owned tenant estate.** The system sells management; capacity is
   the tenant's contract with their provider. This is provider policy as much as preference
   ([feasibility constraint 1](../platfolio-feasibility.md)).
3. **The tenant owns the source of truth for desired state.** platfolio renders it into their repo; a
   human on their side merges and applies it. platfolio never becomes the only party that can
   reconfigure a running stack.
4. **Control-plane users and tenant end users never share an identity substrate** — no shared realm,
   issuer, subject namespace, cookie scope or database
   ([05 § invariants](05-identity.md)). A platfolio breach must not yield a tenant's user store.
5. **No destructive shortcut.** There is no archive in the provider surface, so `suspended` means
   scale-to-zero with data intact, and deletion happens only inside a published window, after export is
   possible. A failed payment never destroys a tenant's production data.
6. **The framework boundary is contractual.** Nothing imports the vendored framework outside
   `packages/kernel`; `packages/contracts` is the only API-stable layer; framework instability is
   absorbed in the shell rather than propagated (D15).
7. **Every mutation is server-side entitlement-checked, idempotent, and verified by read-back.** A
   successful HTTP response is not success. Rate-limited and partially-applied states are expected
   conditions with designed handling, not exceptions.
8. **Nothing ships that cannot be reconciled.** Interrupted or retried provisioning must converge, and
   a failure must leave no orphaned resource and no state only a human can guess at.
9. **Security and exit are never paid features.** Authentication, tenant isolation, export, ejection,
   data access and audit are equally present in every build of the software; what may differ between
   deployments is operational convenience (managed upgrades, monitoring, backup automation, team
   workflow features). This is the architectural consequence of an open-source core, stated as a rule so
   it is not eroded one "temporarily gated" feature at a time.
10. **Config is validated, never assumed.** A profile or manifest that fails validation stops the
    operation with a located error; "it started" is not evidence that configuration is correct
    (E14, *(design)*).
11. **Retrieved and tenant-supplied content is data, never instructions** — including in agent-facing
    surfaces, where injected text is an observed condition in this project's own research history.

## 3. Deferred by design

A deferral is a decision to build something later, not a prohibition. The right column is what has to be
true before it is built, so "not now" does not silently become "never" or "because it seemed cool".

| Deferred concession | Becomes | Build it when |
| --- | --- | --- |
| Tenants bring their own provider credentials (D2) | Brokered or assumed short-lived credentials; an optionally platfolio-operated tier | A real tenant declines to manage provider accounts **and** a credential broker exists that provably cannot read variables (invariant 1) **and** the provider's policy question is answered in writing |
| One real infrastructure provider | Second provider behind the same conformance suite | A named demand, and the suite already passes for a non-Railway double |
| Identity host after MVP ([05 OI1](05-identity.md)) | Per-team realm SSO across a team's platforms | Provisioning is proven stable; realm backup, upgrade sequencing and client rotation are automated, not manual |
| Flat SKUs, no metered billing (OD1) | Usage-shaped pricing where genuinely warranted | A measured pricing need **and** a decided metering path; never as a way to hide a margin |
| No preview/ephemeral environments (OD5) | On-demand environments | Per-environment cost and provider ceilings measured, with a sleep/wake behavior tenants accept |
| Mobile is read-mostly ([07](07-interfaces-api-mcp-mobile.md)) | Approvals and infrastructure writes from mobile | The page-schema and confirmation-intent contract are stable and shared with web; device-flow auth is real |
| CLI deferred | Scriptable tenant automation and agent use | Contracts stop moving; the same capability registry already serves the MCP surface |
| Vendored framework, upstream lineage undecided (OD9) | Whatever the lineage decision turns out to be | It is decided, deliberately, with the fork's license and provenance checked — not by drifting |

## 4. Not on any roadmap

These are not deferred — they contradict § 1 and § 2, and time estimates never make them correct.

- A general PaaS for arbitrary applications. platfolio hosts platforms for which a manifest exists.
- In-app code editing, a page builder, or a marketing-site product.
- Running tenant workloads inside platfolio's own provider account for margin, or any estate model that
  inherits another tenant's abuse, suspension or bill.
- Holding a tenant secret, "just briefly", "just for convenience", or behind an opt-in checkbox.
- Features reachable only from the dashboard — if it is not in the public API, it does not exist for
  agents, mobile, CLI, or the tenant's own automation.
- Runtime-loaded third-party UI, or any downloaded code executing with a user's session.
- Lock-in by omission: telemetry, DNS, backups, or authentication that a tenant cannot replace on the way
  out.
- Treating the multi-arch *binary* packaging of the control plane as a goal; images plus an installer
  satisfy the requirement ([08](08-distribution-and-licensing.md)).
- Business, pricing, packaging, support or go-to-market content of any kind. It is not this repository's
  subject matter, and documents here should not imply that it is.

## 5. Where the detail lives

| Need | Canonical |
| --- | --- |
| What was decided and why | [01 § Decision register](01-product-and-decisions.md) |
| System shape and boundaries | [02](02-architecture.md), [10](10-cordis-kernel-and-extension-seams.md) |
| The data contract everything renders from | [03](03-manifest-spec.md) |
| How privileged work actually happens | [04](04-execution-plane-github-workflows.md) |
| Identity separation and the identity host | [05](05-identity.md) |
| Money, lifecycle, ejection duties | [06](06-billing-and-lifecycle.md) |
| Surfaces clients can rely on | [07](07-interfaces-api-mcp-mobile.md) |
| Packaging and licensing of code | [08](08-distribution-and-licensing.md) |
| Order of work and acceptance | [09](09-delivery-plan.md) |
| Provider facts, with per-claim verification | [feasibility](../platfolio-feasibility.md), [research/](../research/) |
