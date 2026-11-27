# Marketplace migration

This roadmap extends [the hub and private installation design](18-hub-and-private-installations.md). The
hub owns public publication, discovery, and acquisitions. Private installations own deployment, runtime
access, and application configuration. An installed release remains usable with its retained artifacts
after a marketplace disconnection or the end of maintenance coverage.

## Phase 1 — Platform catalog and free installations

Classify listings as starter templates, shared services, or hosted applications. Preserve each
previously published release and local pin. Introduce a release-specific free acquisition and an
instance-scoped install path. Prove all three journeys with the existing approved projects. The
[phase-one implementation plan](20-platform-catalog-phase-one.md) defines the API and rollout.

## Phase 2 — Service binding and optional federation

Connect a consumer to Shared Identity through its private installation. Verify actual sign-in,
credential placement under customer custody, revocation, and dependent-removal protection. Measure
connectivity between provider projects before selecting how private services communicate.

Allow a private owner to opt in to hub sign-in and grant local roles. Prove local owner access while the
hub is offline. Treat end-user app registration as a separate identity flow with an explicitly
registered client and local app authorization. See [identity boundaries](05-identity.md) and
[hub enrollment](18-hub-and-private-installations.md#launch-and-enrollment).

## Phase 3 — Maintained releases

Deliver a publisher-built release to staging, verify declared dependency and health checks, and
promote the same image digests. Rehearse recovery for a stateful upgrade. Prove a customer can restore
an acquired release from retained artifacts while the hub is down and maintenance eligibility has ended.

## Phase 4 — Checkout and seller settlement

Put a single paid offer through test checkout and verify event reconciliation, idempotent fulfillment,
and refund handling. An acquisition grants access to specific artifacts. A maintenance term determines
eligibility for future acquisitions. Both are separate from runtime authorization.

Before onboarding a third-party seller, record the merchant, tax, support, dispute, and payout
responsibilities. The existing [billing decision](01-product-and-decisions.md)
covers Platfolio's own billing. Marketplace seller settlement needs its own decision before any Stripe
Connect integration. Begin with one seller per order.
