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

### Release delivery before the storefront cutover

For a starter template, publish the source revision, Compose, environment registry, and CI/CD
entry point. The customer imports the starter into their own repository and manages subsequent
builds there. Its workflow can publish a derived platform as a shared service or hosted application,
with public or private artifacts and a free or paid offer.

For a shared service or hosted application, the publisher builds in their own account and pushes
only approved OCI images and, if exported by CI, a deployment recipe stripped of private
configuration. The publisher can also author the recipe in Platfolio. The private source repository,
build credentials, and upstream registry credentials stay with the publisher. The hub retains the
published recipe and its immutable mapping from services to image digests. The customer's private
control plane combines that recipe with its own settings, resolves secret references in customer
infrastructure, and sends the rendered plan to the hosting provider.

Use one registry interface for free and paid delivery. Public artifacts can be cached or pulled
directly where their availability permits it. Free private releases use a zero-price acquisition.
For gated releases, authorize registry access using the installation's marketplace identity and
receipt. Issue renewable, short-lived pull access scoped to the acquired release's manifests and
blobs. Neither the customer nor the hosting provider receives a publisher registry credential.
Retain the complete released artifacts and let customers copy acquired releases into storage or a
registry they control for recovery during a hub outage.

Before opening the new storefront, prove delivery with two versions of a private image, including
subscription expiry and restoration from a customer-controlled copy. Confirm the hosted installer
can configure and renew registry access through the provider. Railway documents private registry
credentials as a Pro feature. Verify pull, retry, and fresh redeploy on an approved workspace before
advertising that hosting option. [Railway private registry requirements](https://docs.railway.com/builds/private-registries)

## Phase 2 — Service binding and optional federation

The [Phase 2 implementation plan](21-shared-services-phase-two.md) orders the local API,
customer-side execution, hosted acceptance, and optional identity work.

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
an acquired release and its state from retained artifacts while the hub is down and maintenance
eligibility has ended.

## Phase 4 — Checkout and seller settlement

Put a single paid offer through test checkout and verify event reconciliation, idempotent fulfillment,
and refund handling. Checkout fulfills a release acquisition and, where purchased, a maintenance
term. A completed acquisition grants access to the exact release. Ending maintenance ends eligibility
for new paid releases. Access to acquired releases and local runtime authorization continue.

Before onboarding a third-party seller, record the merchant, tax, support, dispute, and payout
responsibilities. The existing [billing decision](01-product-and-decisions.md)
covers Platfolio's own billing. Marketplace seller settlement needs its own decision before any Stripe
Connect integration. Begin with one seller per order.
