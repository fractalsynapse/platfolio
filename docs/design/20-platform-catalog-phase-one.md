# Platform catalog implementation plan

This is phase one of the [marketplace migration](19-marketplace-migration.md). A marketplace platform
is a publisher's listing. A release pins the publisher's inputs. An instance is the customer's local
deployment. Keep [manifest topology](03-manifest-spec.md#kind-and-mode-defaults) independent of the
marketplace variant.

| Variant | Release inputs | Install outcome |
| --- | --- | --- |
| Starter template | Source repository and commit, Compose, workflow entry point, and setup instructions | A customer-owned repository with CI/CD and the starter release recorded as provenance |
| Shared service | Deployment recipe and image digests, with capability declarations where applicable | A running API or worker, with any declared outputs available for later binding |
| Hosted application | Deployment recipe, image digests, and user-facing configuration and health requirements | A publisher-built app running in the customer's infrastructure |

## 1A — OpenAPI and catalog migration

1. Specify public reads for platforms and for a platform's release history in the
   [control-plane OpenAPI contract](../../apps/control-plane/openapi.yaml). Define shared DTOs in
   `packages/contracts` and generate schemas and client types through the existing tools. Expose
   published coordinates and compatibility metadata without issuing deployment authority.
2. Add platform identities and variants in a forward migration. Map `starter-web` and
   `starter-worker` to starter templates and `shared-identity` to a shared service. Preserve every
   published version and all bundled pins, including the source revision, installer, and image digest
   where present. Use the existing release records as the source of stored release pins. The
   compatibility association should work for releases written by an older hub binary during rollout.
3. Keep the existing anonymous catalog, authenticated template list, enrolled registry catalog,
   claim responses, and private launch operations wire-compatible. Leave installed instance IDs,
   provider project IDs, and private journals in place. These journals remain the source for retry,
   restore, and redeploy. Recover a missing association from an exact recorded pin when possible.
4. Test mixed-version compatibility. Exercise legacy reads and claims against the upgraded API and
   resume or redeploy an existing private journal while the catalog advertises a newer release.
   Exercise the forward migration against a pre-migration database with legacy rows. Verify that
   old release writes remain visible and that the migration preserves recorded pin values.

### Rollout for 1A

Apply migration `024_marketplace_platforms.sql` before deploying the hub binary that serves the new
reads. The migration associates release rows with platform identities through the existing template
key. The legacy publisher continues writing the same table and new platform reads see those versions.
Keep the old storefront and private clients on their existing endpoints during this rollout. A hub
binary rollback leaves the additive migration in place and uses the original release table. The new
endpoints are `GET /api/v1/marketplace/platforms` and
`GET /api/v1/marketplace/platforms/{platformId}/releases`.

The local verification includes a schema `023` to `024` upgrade with a saved release and a replay of
the public staging catalog against a Postgres-backed hub. The private worker test reloads and redeploys
a saved pin after a restart. Hosted acceptance still needs the migrated hub and a private installation
exercised together in staging.

## 1B — Publication and exact acquisition

Team owners create listings and publish versions. A new listing appears in the existing platform catalog
when it has a release. Slugs are unique within the publisher team. Publication pins a source repository
and commit for the deployment recipe. Shared services and hosted applications also pin their container
images. The hub records these coordinates. The private installer will retrieve and validate the recipe
and images in 1C. Existing official aliases retain their publication route and stored releases.

Use the existing enrolled installation grant for free acquisitions. The hub derives the acquiring team
from the grant and checks the requested platform, version and descriptor digest. The same team can acquire
the same version more than once and receive the original receipt. Keep artifact coordinates for new
listings behind acquisition. The public catalog exposes the digest, and legacy public coordinates keep
their 1A behavior. Ownership checks apply to publication. The acquisition grant confers registry access.

Verify publication, acquisition, revocation and the previous private pin paths locally, including a real
Postgres migration and repeat claims. Registry acquisition performs no provider action. Reserve hosted
deployment verification for 1C so this slice consumes no Railway service deployment quota.

### Rollout for 1B

Apply `025_marketplace_publication.sql` after `024_marketplace_platforms.sql` before serving the new
operations in the [OpenAPI contract](../../apps/control-plane/openapi.yaml). The tables for team-owned
releases and acquisitions are additive. The official templates keep their existing publication and
claim paths. Their release history is also available through the new platform catalog.

The hub checks the descriptor selected in the catalog and returns its pinned repository and images in
the acquisition receipt. For a new publication, the digest identifies the publisher's declared
coordinates. The 1C installer must verify those coordinates against the material it fetches before
performing provider actions.

## 1C — Receipt-backed private installs

An installation owner prepares an install by naming a local instance and selecting a platform,
version and descriptor digest. The private worker requests the receipt using its enrolled machine
grant. It verifies the receipt, reads the recipe from the pinned Git commit and, for image installs,
matches the recipe's deployable images to the receipt and hashes their registry manifests. The
private control plane records the receipt, instance and any image plan atomically. The existing
hosting apply operation provisions from the saved plan. A retry of the preparation returns the
saved install for that name and exact selection, even without the hub. A new name is a new install.

For a starter, the owner imports the acquired commit into a customer-owned repository and supplies
that repository to the installer. The private control plane verifies the commit through its
configured source-control capability. The customer can then use the existing install workflow to
build and report later artifacts.
Shared services and hosted applications retain an immutable image plan. Their marketplace variants
describe how they are used. The plan still follows the recipe's runtime topology and environment
policy. The generic path uses the Compose hosting obligations, as repository-based planning does.
The existing Shared Identity release uses its established inventory translation. Only services
explicitly declared public receive generated provider domains. Verification
supports tagged, digest-pinned public images on Docker Hub, GHCR and Quay. Private artifact delivery,
registry credential brokering and mirroring are outside the current free catalog slice.

Use the existing approved projects for acceptance. Starter Web or Starter Worker should produce a
customer-owned source project that deploys a change through its workflow. Shared Identity should
install its pinned image and pass discovery checks. Platfolio should launch from a hosted-application
release verified through the catalog path, using its existing bootstrap contract.

Local verification covers the three receipt paths with the test provider, including the starter
artifact API, an invalid registry response, pin retention and reapply with the hub offline. The
local runtime checks cover a Starter Web build from its original commit and the original Shared
Identity image. A local registry supplies the three images for Platfolio's real Compose recipe to
test preparation of both environments. Generated host and secret bootstrap through the hosted
provider remain part of staging acceptance, along with the storefront switch.

## 1D — Artifact delivery and storefront acceptance

The [marketplace roadmap](19-marketplace-migration.md#release-delivery-before-the-storefront-cutover)
defines the publication and credential boundaries. 1A–1C can integrate with the existing storefront
and installers in service. The following checks gate the storefront cutover and Phase 1 acceptance.

Use a private OCI Distribution backend and a gateway that checks Platfolio-issued, short-lived
credentials. A publisher can push only into the namespace for its platform and release version.
Publishing validates the recipe and the complete OCI graph before recording its digest. Pulls can
read only the published roots and their reachable manifests and blobs. The backend stays on a
private network. Maintenance eligibility gates new acquisition rows, and a pull always resolves
against an existing receipt. API and database changes are additive. Git-backed releases keep
their original descriptor digest and installer.

The [OCI hub overlay](../../compose.marketplace-artifacts.yaml) runs the gateway from the same
control-plane image and persists the native registry backend on its own volume. Set the external
registry origin and the shared signing key for the hub and gateway. Keep the backend private and
disable artifact deletion. Restrict production ingress to TLS. Bring the gateway up before
enabling publishers to issue upload grants.

Publishers request `POST …/platforms/{platformId}/uploads` for a version, then push tagged images
in the returned namespace using normal Docker authentication. Publish through
`POST …/platforms/{platformId}/bundles` with the pinned image references and recipe. The
publication compares image pins to the recipe and checks the reachable OCI graph. Authenticated
private installers acquire the bundle and exchange its receipt for a read grant. The private
worker renews that grant before an apply or redeploy. Keep an acquired copy in customer-controlled
storage for independent recovery. Copy manifest lists, their child manifests and all layers while
preserving digests, then point the saved recipe at the customer's registry.

1. Use the existing Platfolio or Shared Identity project to prepare two image releases with a
   minimal, versioned recipe. Ingest the full OCI content and record the immutable bundle digest.
   Verify installation needs only the exported release and works without access to the publisher's
   Git repository or registry credentials.
2. Exercise a free acquisition and simulate maintenance eligibility with two releases. Acquire the
   first, expire maintenance, and verify a clean client can still pull the first. Verify that the
   same installation cannot acquire or pull the second through the gated registry, even with its
   exact digest. Check isolation against a separate team's installation.
3. Seed a customer-controlled copy of the acquired release. Remove access to the hub and publisher
   registries, then recreate the workload from the retained recipe, manifests, and layers on a clean
   target. Publishing a newer version must leave earlier installation pins intact.
4. On an approved staging deployment, verify private Platfolio bootstrap, the legacy worker and the
   new install path. Check Railway's plan and credential permissions, an authenticated private
   pull, and a cold redeploy after pull-grant expiry or renewal. Record the results separately from
   local verification. Keep the existing storefront in service until those checks pass.

### Hosted apply and cold redeploy measured on 2026-11-27

The private installation reconnected Railway with a grant scoped to Internal Platfolio. The retained
Starter Web `0.1.0` receipt provisioned `platfolio-starter-web`. Railway reported both services
successful and no public database domain or TCP proxy. The first web process started before the
database reference was available. A cold redeploy through Platfolio started a new deployment and web
process on the same pinned image. The new process reported its database reference configured.
The private Platfolio deployment remained healthy through these checks.

Run `pnpm run verify` for repository changes. Payments, federated sign-in, cross-installation
bindings, and managed release promotion follow in later phases.
