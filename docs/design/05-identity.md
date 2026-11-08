# platfolio — identity architecture

Implements D6 (platfolio users ≠ hosted-platform users) and D7 (identity host). Vocabulary from
[03](03-manifest-spec.md); execution constraints from
[04](04-execution-plane-github-workflows.md). Status: proposed.

## Three identity planes, and why they never touch

| Plane | Population | Where it runs | Who can read it |
| --- | --- | --- | --- |
| **P0 control-plane identity** | team members who buy and operate platfolio | platfolio's own stack | platfolio staff (audited) |
| **P1 platform end-user identity** | the tenant's customers/users (e.g. ArcNexus users) | **the tenant's own Railway project** | the tenant only |
| **P2 team-internal identity** | the tenant's staff/SSO (their Okta/AD/Keycloak) | the tenant's IdP | the tenant only |

D6's reason to exist: platfolio is a meta-platform hosting standalone platforms. If P0 and P1 shared
a realm, a platfolio breach would expose every tenant's user credentials, and every tenant's user
base would be platfolio's regulated data. Keeping them apart also keeps the eject story honest.

**Invariants (each is testable):**

- I1 — separate issuers: `iss` of P0 ≠ `iss` of any P1 realm; no realm hosts both platfolio clients
  and platform clients.
- I2 — separate stores: P0 users live in platfolio's identity DB; P1 users live in a per-team realm
  in the team's project. No shared table, no shared subject namespace; a P0 `sub` is never a valid
  P1 subject.
- I3 — separate cookies: platfolio session cookies are set only on platfolio's own host; nothing is
  ever cookie-scoped to a shared parent domain like `.platfolio.app`, because a tenant platform on
  `*.platfolio.app` would then receive control-plane cookies.
- I4 — platfolio cannot read P1 credentials. The IdP admin secret for a hosted realm is a
  `source: preserve` secret in the tenant's project; realm mutations are performed by the tenant's
  runner, not by platfolio (mirrors D4).
- I5 — a compromise of platfolio yields: intent metadata, entitlements, non-secret config, and the
  ability to *ask* a tenant's workflow to do work. It does not yield P1 password hashes, tokens, or
  signing keys.
- I6 — platform-to-platform isolation within one team: P1 realms are per team, per platform client —
  two platforms in one team may share a realm only when the team opts in (that is exactly D7's
  "share the same user system"), and the default for a new instance is its own client.

## Why per-tenant identity is now affordable

Earlier analysis found per-tenant Keycloak expensive — Keycloak's container docs say set the memory
limit to "at least 750 MB", 2 GB recommended for smaller production deployments, plus its own
Postgres, ≈ **$7.50–20/month** at Railway rates, before any product service runs. Under D1/D2 that
cost lands on the tenant, in the tenant's project, on the tenant's bill — which is the correct
economic and security shape. It also means platfolio never operates identity for other companies as
a sub-processor of their user credentials, which materially shrinks the DPA surface
([06](06-billing-and-lifecycle.md)).

Choices, by mode:

| Mode (`identity.mode`) | Mechanism | When |
| --- | --- | --- |
| `none` | platform's native auth (API keys, its own local users) | TreeDX v1 is a strong candidate |
| `byo-oidc` | platfolio renders client config + redirect URIs from `domains[]`, verifies discovery, never stores anything | teams with an existing user base / internal IdP (P2) |
| `hosted-realm` | a Keycloak (or lighter) service declared as a manifest resource **in the tenant's project**, realm managed by intent + their runner | D7 identity host: one user system for the team's platforms |
| `embedded` | `oidc-provider`-style provider inside platfolio's own control plane | self-hosted/local installs only, where spinning up a JVM IdP is unreasonable |

Verified alternatives for `embedded`/light paths: `oidc-provider` (MIT, TypeScript, implements OIDC
Core/Discovery/Dynamic Registration/PKCE), Better Auth's OAuth 2.1/OIDC plugin (MIT, young, no
certification claim), Zitadel (Go, ~512 MB but AGPL-3.0 — a licensing decision, not just technical),
Authentik (Python, 2 CPU/2 GB compose minimum, "test setups and small-scale production"). Ory Hydra
is certified OIDC but **headless** — no user store or login UI, so it is not a Keycloak substitute.
Lucia is deprecated (March 2025) and was never an OIDC provider.

## The identity host as a product feature

`hosted-realm` gives a team one user system across their platforms — platfolio's most differentiated
offering, because it is what a *team* pays for rather than what a single app needs.

Lifecycle, all consistent with the execution plane:

1. **Declare** — the platform's manifest contributes a `client` block (protocol, redirect URIs
   derived from `domains`, roles, attribute namespace, required claims).
2. **Compose** — the control plane renders a realm definition (JSON) + the client list; the realm is
   owned by the team, not platfolio.
3. **Apply** — the tenant's runner performs `kcadm`/Admin REST import using its own preserved admin
   credential. platfolio sees the realm definition it authored and the attestation, nothing else.
4. **Verify** — behavioral: the platform's health check passes and an authorization-code test
   completes in the browser. platfolio does not fetch tokens or user data.
5. **Upgrade** — IdP version bumps are sequenced releases with a realm export taken first (by the
   runner), because Keycloak auto-migrates its schema on first start of a new version, does not
   support migration on the dev-file/H2 database, requires full shutdown for minor/major upgrades,
   and has a documented per-version breaking-change list. Staging is upgraded first, always.
6. **Back up** — realm export + volume snapshot on the tenant's schedule; exports contain PII, so
   they inherit the tenant's retention policy, not platfolio's.
7. **Eject** — realm export, credential rotation, and either the tenant runs the same Keycloak
   themselves or they flip `OIDC_ISSUER` to their own IdP. Because the platform consumes identity via
   env, this is a config change, not a migration.

## ArcNexus specifics (D8)

ArcNexus already uses Keycloak for its own identity, so it exercises the interesting path:

- **v1 default:** each ArcNexus instance gets its own realm inside its own Keycloak service. Its
  existing configuration becomes the realm template, so the platform needs no code change.
- **Identity-host payoff:** a team running ArcNexus *and* a later platform turns on `hosted-realm`
  and adds the second platform as another client in the same realm — SSO without either platform
  knowing about the other.
- **Redirect URIs must be generated, not guessed.** They derive from the instance's `domains[]`, so
  attaching a custom domain is an identity-affecting change and must re-apply the realm client
  through the runner.
- **Eject test:** an exported ArcNexus stack, with its Keycloak volume and realm export, must come up
  in plain Docker Compose with no platfolio artifacts. That is the acceptance criterion that proves
  "we do not hold you hostage."
- OD4 (one repo vs two for ArcNexus) decides whether Railway's multi-repo `partial` ownership is
  needed at MVP. Prefer single-repo for MVP and keep `partial` support as a documented extension.

## TreeDX specifics (D8)

API-only. If TreeDX's authentication is API-key based, `identity.mode: none` is the honest default
and the keys are `platform-internal` secrets generated by TreeDX itself — so platfolio still never
sees a value, and the required-secret checklist is shorter. Revisit `byo-oidc` only if TreeDX wants
to expose a human-facing console later.

## Security controls to implement with this

- Admin API tokens for the control plane: short TTL, refresh rotation, revocation on uninstall,
  separate client from user-facing clients; audience validation per plane (I1/I2).
- Every realm/client mutation is an audited, attested job; never performed interactively by staff.
- Staff access to a tenant's P1 store must be **impossible by design**, not by policy: no platfolio
  credential can reach it (I4). Support flows work through tenant-executed commands and
  tenant-granted, expiring read-only access when absolutely necessary.
- Token/claim hygiene: per-client audiences, no wildcard redirect URIs, `pkce` required for public
  clients, user attribute namespace per platform to avoid claim collisions.
- Cross-tenant authorization tests in CI: a token from team A's realm must be rejected by team B's
  instance; a P0 token must be rejected by every P1 endpoint.

## Identity decisions (accepted 2026-11-07)

The three questions raised here were accepted as recommended, and are decisions rather than options.
See the decision log in [01](01-product-and-decisions.md).

- **OI1 — Identity host ships after MVP.** MVP supports `none` and `byo-oidc`; `hosted-realm` lands in
  M5, because realm lifecycle, backup and upgrade sequencing must not be built while provisioning is
  still unproven. Consequence: ArcNexus runs against its own Keycloak service or the tenant's issuer at
  MVP, and the shared-realm payoff is the first post-MVP feature.
- **OI2 — `oidc-provider` behind an interface for the `embedded` mode**, with its own decision record.
  Zitadel's AGPL-3.0 is avoided unless OD2 lands on a permissive core anyway. Ory Hydra is excluded as
  the embedded answer because it is headless (no user store or login UI).
- **OI3 — Realm-per-team, client-per-instance.** That is what "the team's applications share one user
  system" means, it keeps the Keycloak service count at one per team, and it makes SSO across platforms
  the default rather than a migration.
