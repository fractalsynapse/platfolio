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
`platform-templates/shared-identity`.

## Slice 1 — a service that starts, locally, with real tokens

Deliverable: `docker compose up` on a laptop gives Postgres + Keycloak + control-plane, and `curl` with a
token from Keycloak returns something true.

- `apps/control-plane`: Cordis app with routes `/healthz`, `/readyz` (DB connectivity), `/version`
  (contract + commit), and `GET /api/v1/whoami` echoing verified token claims — the smallest surface that
  proves verification works rather than accepting strings.
- Compose: postgres, keycloak (seeded realm `platfolio`, dev clients, one import file under
  `platforms/platfolio/identity/` so the realm is declarative, not clicking), control-plane. Seed two demo
  users and a device-flow client so the CLI path is testable on day one.
- Verification, not parsing: JWKS pinned to the configured issuer; `iss`, `aud`, `exp`/`nbf`, and a
  required `sub`. **A token that merely decodes is not authenticated** — that distinction is the whole point
  of slice 1 and it is also what #159 asks for on the runner path.
- Config by env with no secrets committed; local dev values in `.env.example`, everything else from
  Keycloak client credentials.

Done means: cold clone → `pnpm i && docker compose up` → obtain a token → authenticated request succeeds,
a forged one returns 401, and the check is in CI.

## Slice 2 — records and the controller

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
