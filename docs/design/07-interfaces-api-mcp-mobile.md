# platfolio — interfaces: API, MCP, web and mobile

Implements D10. Status: proposed. This document is mostly **rules**, because the value is in the
constraint that every capability is reachable through the same contract.

## The rule

**No feature ships in a UI first.** Every operation exists as an API mutation before it exists as a
button, and the MCP tool surface is generated from the same capability registry. The mobile app, the
web dashboard, the CLI, an AI agent and a customer's own automation are five clients of one contract.
If a capability can only be reached by clicking, it is a bug in the API.

## Public API

- **Shape:** REST + OpenAPI 3 as the canonical contract; `/v1` path versioning; additive changes only
  within a major; breaking changes get a new version with a documented sunset window.
- **Generated artifacts:** `packages/sdk` (typed client from the spec), server-side validation
  middleware generated from the same spec (so the spec cannot drift from behavior), MCP tool
  definitions, and public reference docs.
- **Idempotency:** every state-changing mutation accepts an `Idempotency-Key` header; provisioning
  operations require it. The controller's retry story depends on this.
- **Pagination/errors:** cursor pagination everywhere; a single error envelope with stable
  `code` values (`entitlement_limit_reached`, `execution_plane_missing`, `secret_unverified`,
  `provider_rate_limited`, …) so clients can branch on codes rather than message text.
- **Never in a response:** secret values (any shape), raw provider credentials, customer logs,
  P1 identity data of another team.
- **Authorization:** team-scoped, entitlement-checked server-side, on every route; a token from team
  A must fail against team B's instance in a CI test, not in production
  ([05 invariants](05-identity.md)).
- **Events out:** webhooks to the tenant (release finished, deployment failed, domain certificate
  issued, instance suspended) with HMAC signatures and retry + replay endpoint, because "hands-off"
  means their tooling learns about state without polling.

## Auth for clients

- platfolio's own control-plane identity (P0) is OIDC; API access for non-browser clients uses
  short-TTL access tokens with refresh rotation, per-client scopes, and revocation on uninstall.
- **Device authorization grant** for CLI and mobile sign-in (Railway's own discovery document
  advertises `urn:ietf:params:oauth:grant-type:device_code`; platfolio clients should be able to do
  the same), plus PKCE (S256) for public clients.
- Scopes are capability-shaped (`instances:read`, `instances:write`, `releases:write`,
  `billing:read`, `admin:*`), not role-shaped, so an MCP tool or a mobile screen requests exactly
  what it needs.
- Staff access uses a separate, audited, time-boxed path — never a shared admin password, and never
  any path that could read a tenant's P1 identity store ([I4/I5](05-identity.md)).

## MCP server

Ship `platfolio mcp` (hosted and self-hosted modes) exposing the capability registry as tools, with
Railway's own MCP server as the precedent that this is how platform customers now expect to operate
infrastructure (`mcp.railway.com` with `create-project`, `list-services`, `redeploy`,
`accept-deploy`).

- Same auth, same entitlement checks, same rate limits as REST — **no privileged side channel**.
- Tool descriptions are static strings; **all tenant-supplied and retrieved content is treated as
  data**, never as instructions. During research several fetched pages carried embedded text shaped
  like agent prompts; that is a live injection surface for anything here that scrapes or summarizes
  customer logs/domains.
- Write tools are gated behind explicit confirmation semantics in the tool contract (`dryRun` first,
  then `apply` with a plan hash), mirroring `railway config plan` → `apply`, so an agent cannot
  accidentally mutate a production stack.
- Read tools return projections, not raw provider dumps, and never secrets or logs.

## Web (Astro) and mobile portability

- `apps/site` — Astro: static marketing + content collections; SSR dashboard routes with React
  islands; `@astrojs/node` adapter in its own container.
- `packages/ui` — the shared component layer. Rules that make a future React Native/Expo app cheap
  rather than a rewrite:
  - **presentational + headless**: behavior in framework-level hooks with no DOM assumptions; avoid
    `document`/`window`/CSS-only layout primitives inside components;
  - **no data fetching inside components** — everything arrives via props or the generated SDK client
    plus one state layer;
  - design tokens (color/spacing/typography) in a provider, not in Tailwind class strings alone, so a
    native theme can map onto them;
  - navigation described by a route table the mobile app can reinterpret, not by `<a href>`
    assumptions;
  - forms and validation reuse the same **StandardSchema** layer used by `packages/manifest` and by
    Cordis `Plugin.Config`, so one validation implementation serves the API, the server, the web form
    and the mobile form;
  - a `packages/ui` CI check (or lint rule) that flags direct DOM/global access — this is the check
    that keeps the promise instead of the intention.
- The mobile v1 scope is deliberately small and reads mostly: instance list, status, recent releases,
  deploy/redeploy with confirmation, incident notices, and approve/decline gates
  (`railway config apply` equivalents and `deploymentApprove`). Writes that change infrastructure
  require the plan-hash confirmation flow. Push notifications ride on lifecycle events, not polling.
- Offline posture: mobile shows last-known attested state with an age indicator, never a stale
  "healthy".

## CLI

Deferred until the execution-plane contract is stable, then either a Bun/Deno cross-compiled single
binary (both document full cross-target matrices per [08](08-distribution-and-licensing.md)) or a Go
binary. Its job is connect/install/status/deploy-confirmation for **local** development against a
tenant's stack — not to become a second control plane. Device-flow auth; same scopes.

## Compatibility promise

Because platfolio's own value proposition is "you can leave," the public API and MCP surface are
things tenants may build on. That means: published changelog per version, deprecation headers
(`Sunset`/`Deprecation`) at least one minor before removal, and a documented, tested path for
"customer replaces platfolio with their own script calling the same GitHub workflow." The export in
[06](06-billing-and-lifecycle.md) is the compliance answer; this is the convenience answer.
