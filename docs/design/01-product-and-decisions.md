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
| D2 | Customers bring their own Railway credentials for v1. | platfolio stores **no** long-lived infrastructure credential. Onboarding = connect flow, not a pasted master token. |
| D3 | Tenant unit is a **team**; a team subscribes and may host **many platforms**. A hosted "project" is one platform instance. | `Team → Subscription → PlatformInstance(→ Railway project)`; entitlements and limits at team level, state at instance level. |
| D4 | platfolio must not have access to hosted platform secrets. | Secrets are declared by **name** and resolved out-of-band. Enforced as the zero-secret invariant (§ [04](04-execution-plane-github-workflows.md)); a capability that needs the value is rejected by design. |
| D5 | Manage platforms by installing and using **GitHub workflows** in the customer's repo. | The execution plane is the customer's Actions. platfolio's GitHub App gets an install-scoped, PR-reviewed workflow, then dispatch-only. Also satisfies D4 and sidesteps D2's credential custody. |
| D6 | platfolio's own users ≠ hosted platforms' users. | Two strictly separated identity planes (§ [05](05-identity.md)). No shared realm, cookie domain, user ID or database. |
| D7 | An **identity host** is a platfolio product feature: a team's platforms can share one user system, or the team can point at its internal OIDC. | Identity is a provisionable resource + a declared dependency (`OIDC_ISSUER`), never a hard-wired service. |
| D8 | First two platforms: **TreeDX** (API-only) and **ArcNexus** (frontend + backend, already Keycloak-based). | Two archetypes in the manifest spec: `api-service` and `full-stack-web` (§ [03](03-manifest-spec.md)). |
| D9 | Hosted platforms are added over time. | Platform catalog is data-driven and versioned; adding a platform must not require a platfolio code release. |
| D10 | Mobile management app is a goal; React component portability and API/MCP interfaces matter. | API-first contract, shared component package, and an MCP surface equal to the public API (§ [07](07-interfaces-api-mcp-mobile.md)). |
| D11 | Distribution: multi-arch OCI images + workflow/action artifacts + installer; **not** a self-contained control-plane binary. | See [08](08-distribution-and-licensing.md). |

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

## Open decisions

- **OD1 — Merchant of record:** platfolio as MoR with Stripe Tax, or Stripe Managed Payments
  (+3.5%, Stripe files in 80+ countries, no ad-hoc invoice items). Affects the invoice pipeline
  shape; decide before building billing.
- **OD2 — License:** Apache-2.0 core + `/proprietary` (keeps "open source" literally true) vs
  BUSL/FSL with change date (stronger anti-rebrand, source-available). See
  [08](08-distribution-and-licensing.md).
- **OD3 — Secret relay policy for the connect flow:** does platfolio ever accept a secret value
  (browser-encrypted, ciphertext-passthrough) for convenience, or is the strictly no-value path
  the only supported one? Recommendation: v1 = no value ever crosses platfolio; revisit only if
  onboarding friction measurably loses customers.
- **OD4 — Repo topology for ArcNexus:** one repo for front+back, or two. Affects whether Railway's
  multi-repo IaC `partial` ownership is needed on day one.
- **OD5 — Preview environments:** in or out (they multiply per-tenant cost; `sleepApplication`
  behavior means they wake with a possible 502).
