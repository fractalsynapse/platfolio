# platfolio design documents

Decisions and the architecture they imply, for a control plane that sells managed hosting of
standalone platforms without owning compute and without ever holding a tenant's secrets.

Read in order the first time; otherwise jump straight to the boundary you are touching.

| # | Document | Answers |
| --- | --- | --- |
| [01](01-product-and-decisions.md) | Product definition and decision register | What platfolio is, who it is for, the tenancy model, MVP scope, non-goals, the accepted decisions D1–D11, open decisions OD1–OD5 |
| [02](02-architecture.md) | Architecture | The three planes and their asymmetric privileges, control-plane layout, the controller loop, data model, trust boundaries |
| [03](03-manifest-spec.md) | Platform Manifest specification | The contract every artifact is rendered from; the secret `value_source` enum; rendering targets; versioning; how a platform is added |
| [04](04-execution-plane-github-workflows.md) | Execution plane | GitHub App + install PR + pinned action + attestation; token custody; failure modes; bring-your-own-CD |
| [05](05-identity.md) | Identity | Three identity planes and the six invariants that keep platfolio users away from tenant users; the identity host; TreeDX/ArcNexus specifics |
| [06](06-billing-and-lifecycle.md) | Billing and lifecycle | Entitlements, the state machine with Stripe's verified numbers, suspend/delete/eject, abuse, merchant of record, data-protection posture |
| [07](07-interfaces-api-mcp-mobile.md) | Interfaces | API-first rules, auth grants, the MCP surface, and what makes the mobile app cheap instead of a rewrite |
| [08](08-distribution-and-licensing.md) | Distribution and licensing | Artifacts that ship, the reframed binaries promise, provenance, the D18 license decision and what remains under it, self-hosted support policy |
| [09](09-delivery-plan.md) | Delivery plan | Milestone 0 experiments with pass criteria (E1–E12), M1–M6 with observable acceptance, prerequisites P1–P8, standing risks, pending decisions |
| [10](10-cordis-kernel-and-extension-seams.md) | Cordis kernel and extension seams | What Cordis actually is (read from source), where it fits, the two-tier extension model that keeps the zero-secret invariant true, twelve capability seams, contract-derived versioning, eight named risks, OD6–OD7 |
| [11](11-ui-components-and-page-model.md) | UI components and page model | Cordis is not the frontend answer; the component-library rules that make mobile cheap; pages as data with one deliberate escape hatch; app-store prerequisites |

Evidence base, not restated here:

- [platfolio feasibility review](../platfolio-feasibility.md) — verified provider constraints (limits,
  AUP, DNS, handover, tokens, rates) and the constraint set these documents are built against.
- [research/railway-control-plane-feasibility.md](../research/railway-control-plane-feasibility.md),
  [research/billing-oss-feasibility-2025-11-06.md](../research/billing-oss-feasibility-2025-11-06.md),
  [research/distribution-feasibility-review.md](../research/distribution-feasibility-review.md) —
  primary-source detail with per-claim verification tags.
- `.research/` at the repo root — raw evidence (introspected GraphQL schema, published template/env
  JSON schemas, docs corpus). Gitignored; delete whenever you like, nothing in `docs/` depends on it.
- [spikes/e9-cordis-kernel/](../../spikes/e9-cordis-kernel/README.md) — the Milestone 0 E9 experiment as
  run (config, evidence, limits). Reproduce with `npx -y tsx driver.ts`; conclusions are summarized in
  [10 § E9 result](10-cordis-kernel-and-extension-seams.md).

## Status of every claim here

All design documents describe **proposed** behavior. Nothing in this directory exists as running
software: there is no application code, no deployed resource and no external approval in this
repository. Two kinds of statements are mixed deliberately and labeled:

- **verified** — quoted from provider documentation or a live endpoint, with a link; safe to build against.
- **unverified/open** — needs a test (Milestone 0) or a written answer from Railway/Stripe; listed in
  [09 § Prerequisites](09-delivery-plan.md) rather than assumed.

The time-critical item, independent of platfolio: Railway's per-service Config as Code
(`railway.json`/`railway.toml`) is deprecated and **stops being read on 2026-12-01**; Infrastructure
as Code (`.railway/railway.ts`) is the replacement. Existing platform repositories should be checked
and migrated now.
