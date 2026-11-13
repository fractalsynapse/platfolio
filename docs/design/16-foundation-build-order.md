# Foundation build order — interfaces first, self-hosted as the test

## Why this document exists

The provider and contract work is done enough to build on, and that is now a liability: it is easy to keep
polishing edges of a system nobody can log into. This page fixes the order of work until platfolio runs
itself, and the rule that keeps us out of the trap — **a defect found outside the current slice gets an
issue, not a detour.** Small bugs while the foundation is missing is the failure mode this is written against.

Two facts make the ordering concrete:

- Keycloak cannot be "real identity" for a service that does not exist. Identity and the API are **one
  build**, not two steps — the OIDC provider is only useful the moment something verifies its tokens.
- Everything already measured (provisioning, attestation round trip, secrets-by-name, domains, teardown)
  is plumbing with no house on it. The first vertical slice is what turns those into a product claim.

## Stack, as already decided

[02](02-architecture.md) records it and nothing here changes it: one deployable service on the vendored
Cordis kernel (`apps/control-plane`), Postgres, Astro site later, containerized, **Docker Compose for local
development**, and its own Railway project for staging and production — the same architecture it will sell.
platfolio's own identity is Keycloak (D40), the same shared-service shape a tenant gets from
`templates/shared-identity`.

## Slice 1 — a service that starts, locally, with real tokens

Deliverable: `docker compose up` on a laptop gives Postgres + Keycloak + control-plane, and `curl` with a
token from Keycloak returns something true.

- `apps/control-plane`: Cordis app with routes `/healthz`, `/readyz` (DB connectivity), `/version`
  (contract + commit), and `GET /api/v1/whoami` echoing verified token claims — the smallest surface that
  proves verification works rather than accepting strings.
- Compose: postgres, keycloak (seeded realm `platfolio`, dev clients, one import file under
  `.platfolio/identity/` so the realm is declarative, not clicking), control-plane. That realm plan was dropped for a seeded one (#168) when Keycloak 26.8.2's import format refused role assignments in every shape tried. Seed two demo
  users and a device-flow client so the CLI path is testable on day one.
- Verification, not parsing: JWKS pinned to the configured issuer; `iss`, `aud`, `exp`/`nbf`, and a
  required `sub`. **A token that merely decodes is not authenticated** — that distinction is the whole point
  of slice 1 and it is also what #159 asks for on the runner path.
- Config by env with no secrets committed; local dev values in `.env.example`, everything else from
  Keycloak client credentials.

Done means: cold clone → `pnpm i && docker compose up -d && pnpm run identity:seed` → `pnpm run identity:smoke`
→ authenticated request succeeds, a forged one returns 401, and the check is in CI.

**Slice 1 is done (2026-11-11), with three deviations recorded rather than smoothed over:**

- `apps/control-plane` boots on the vendored Cordis runtime (`createKernel` → `ctx.identity`, `ctx.server`,
  `ctx.infra`, `ctx.custody`), and the OpenAPI document is an executable gate: `api:check` runs inside `verify`,
  checks drift in both directions, and every response body is validated **in the request path** -- a handler
  that would emit an undocumented shape returns 500 with the reason instead of shipping it.
- The realm is seeded by an idempotent Admin-API script, **not** by `--import-realm`. Keycloak 26.8.2 rejected
  role assignments in all three shapes I tried; #168 has the error text and the trade-off (two commands for a
  cold clone, dev credentials in code, guarded to loopback).
- The framework research that guided this build was partly wrong, and measurement caught it: a missing
  dependency does not produce the reported silent `PENDING` hang -- the property is simply absent, and
  `ctx.inject` resolves anyway. `requireServices` asserts presence, and says plainly that *present is not the
  same as ACTIVE*, because a provider stuck mid-init is a health-check problem this guard does not claim to
  solve.

Live evidence (`pnpm run identity:smoke`, 12/12 against Keycloak 26.8.2 in Compose): a real token → 200 with
the verified subject and `tenantAuthority: false`; flipped signature → `401 unauthenticated:signature` naming
the `kid`; no credentials → 401; a verified but unscoped user → 403; a master-realm admin token → refused as
`unknown-key`. Plus one finding worth keeping: requesting a *foreign* audience does not strip the mapped one --
in OIDC the client is the boundary, not a claim the caller names.

## Slice 2 — records and the controller

**Delivered 2026-11-11 (#162).** What exists now, and what deliberately does not:

- `Store` is a capability with **two implementations under one conformance suite** (Postgres in
  `packages/contracts/src/postgres-store.ts`, the in-memory double beside it). CI runs the Postgres half as its
  own job so the seam cannot be greened by a skip.
- Acceptance policy for attestations is **one pure function** shared by both drivers. If each implemented
  "is this admissible", swapping persistence would change a security decision.
- The controller consumes attestations into stored state (`ok`/`noop` → live, `partial` → degraded, `failed`
  → failed) and signs its own rows in the audit trail as `controller`/`sweep-N`.
- Migrations are forward-only, recorded in-schema, and applied by `db:migrate` -- not as a side effect of boot,
  except in the local compose file where that is explicitly labelled a convenience.
- **Authorization, added after the fact (#173):** verified authentication turned out not to be authorization.
  Team-scoped routes are built with a `scoped()` wrapper that resolves membership before the handler runs,
  cross-team reads answer 404 rather than 403, and a route-table-driven test walks every instance-scoped
  operation so a new route cannot skip the guard. The audit filter found a second bug on the way:
  `dispatch.create` rows targeted the dispatch id and were therefore invisible to the caller who took the
  action.
- **Not here yet:** commit statuses back to GitHub (item 5) and the connect pairing, because they need a
  repository connection written by something other than a smoke script. Dispatch issuance is still an operator
  action over the API rather than a reaction to a push.


Postgres entities (team, member, instance, platform connection, dispatch, attestation, audit log) replacing
the in-memory maps; the durable **controller** — idempotency, backoff, reconcile sweep, `runState` finally
getting its caller; commit statuses/checks back to GitHub (#123's other half). Self-host dispatch moves from
"a script I run" to "the platform doing it," which is what makes #146 (release-produced pins) impossible to
defer quietly.

## Slice 3 — platfolio hosts platfolio

The control-plane and its Keycloak deployed as platfolio instances across staging and production in the
maintainer's Railway workspace, driven through platfolio's own connect path. This is the test medium, and it
is deliberately third: it hurts most, which is the point.

Expect three things to break here, and they are the deliverable, not setbacks: credential tiering
(#135 — a project token must be enough for a real deploy), pin/provenance discipline (#146), and the
default-branch constraint on dispatch (#149). If the platform can host itself with those resolved, the
foundation claim is true instead of asserted.

## Slice 4 — the surfaces a human touches

CLI first (`pnpm platfolio login`, device flow; `platform create/status/logs`), then the connect wizard and
the panels already built against nothing: secrets-by-name with health-gated ticks (item 6), DNS copy-paste
panel (item 8), status page (item 4). Order matters: the CLI is the smallest interface that can prove the
API is coherent, and the web UI is written against an API that has stopped moving.

Then [09](09-delivery-plan.md)'s M4 (Stripe + lifecycle) and M5 (a real tenant platform).

## MVP acceptance, restated as one sentence

MVP is the ten observable items in [01](01-product-and-decisions.md) demonstrated **on a real tenant stack,
not a mock** — and the moment the platform hosts itself, item 10 (same manifest, local Compose) stops being
a claim we make and becomes the way we work.

## Rules of engagement

1. One slice at a time, each ending in something runnable. No slice advances on mocks where a live check is
   available, and none blocks on a live check that a mock can approximate honestly — labelled either way.
2. A bug outside the current slice is filed and left. "While we're in there" is how foundations get polished
   and never poured.
3. Every claim in this repo keeps its evidence tier visible: measured, tested, or designed-and-unexercised.
   A green check is not proof; a run that produced an artefact is.
