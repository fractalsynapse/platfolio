# Platfolio hub and private installations

The hub is the official hosted launcher and public marketplace for a network of independently
operated Platfolio installations. A customer runs Platfolio in infrastructure they control and
uses it to host private apps for their own teams. The hub and private installations use the
same release, platform description, and installer. Configuration enables the public registry
and launcher on the hub. The hub can use the same system to operate itself and services it offers.

## Where data and authority live

| Owner | Data and authority |
| --- | --- |
| Hub | Hub accounts and teams, public template releases, optional installation links, claims and entitlements, and the resources the hub operates directly |
| Private installation | Local people and roles, app and repository inventory, provider connections, deployment history, status, notification rules, and audits |
| Customer's Keycloak and OpenBao | Local users and federation settings in Keycloak. Secret values and workload access policy in OpenBao. The customer's recovery materials stay with the customer. |

A hub team can launch and link an installation. A link is a registry relationship, separate
from ownership of workloads or a local admin role. Hub request logs, status messages, and
enrollment responses carry only the data needed for the hub feature. The installation chooses
whether to share a public template or any other public content. The hub has no provider grant,
repository write access, or automatic code upgrade capability inside a private installation.

Installed apps, local sign-in, credential rotation, and deployment from available artifacts
continue after unlinking or during a hub outage. New marketplace claims and downloads that
require the registry depend on its availability. Registry clients can cache or mirror public
catalog releases, including the version and provenance needed for a pinned install.

## Launch and enrollment

1. A hub team chooses a pinned Platfolio release. The hub prepares a reviewable installation
   plan and gives the launcher the registry endpoint and a short-lived, single-use enrollment
   code scoped to that hub team and launch. The customer approves provider actions in their
   own installation workflow.
2. The same installer sets up the private Platfolio services, Keycloak, OpenBao, persistent
   storage, and local owner access. The customer retains the provider credential and the
   means to recover both shared services.
3. The private installation can redeem enrollment once it is ready. It keeps its scoped
   registry credential in its own OpenBao. The hub stores the installation link and can revoke
   registry access. Failure to enroll leaves a functioning private installation with a retryable
   connection step.
4. The official hosted offering always goes through the hub launcher. A self-install can run
   independently and can opt in later through **Connect to marketplace** using the same approval
   and enrollment contract.

**Manage installation** can link to the private console. Local roles determine what someone
can do there. A future remote support capability needs separate local approval, a named scope,
an expiry, and revocation. A registry credential cannot replace running code or exercise a
private operator role. Customer-controlled review and artifact pins govern updates.

## The records that connect the two installations

These are proposed responsibilities for the existing shared product. The OpenAPI design
will settle the request and response shapes for the connected pilot.

| Record | Owner and purpose |
| --- | --- |
| Launch request | The hub team selects a pinned release and receives a one-use enrollment code. The request can expire or be cancelled before redemption. |
| Installation | The private deployment owns its installation ID, local state and access policy. The hub keeps the linked ID, hub team and marketplace access state. It learns the console URL only when the customer chooses to share it. |
| Marketplace credential | An installation-scoped grant for registry actions, issued by the hub and stored in the private OpenBao. It can rotate or be revoked independently of human access and the provider grant. |
| Account link | A verified `(issuer, subject)` associates an approved identity with an account. Each installation resolves its own roles. Unlinking the account does not remove local owners. |
| Template release and claim | The publisher releases the public, pinned material. A hub account or team claims a particular version. The private installation verifies the release and records its own installation and deployment events. |

Only the enrolling private installation and the hub need to exchange registry credentials.
Deployment automation can run under a customer-owned execution identity after enrollment.
Losing that identity prevents new provider operations until the customer replaces it. An
independent local owner and recovery process restore access without a hub session. Revoking
marketplace access affects further authorized registry calls. It leaves workload state and
already acquired artifacts in the customer's hands.

## Identity and secret management

- Bundle one Keycloak and one OpenBao per installation initially. The local operator realm
  stays separate from app sign-in. Each participating app has a local client. A customer can
  optionally broker hub sign-in for specific approved people. Identity linkage uses issuer and
  subject. A linked marketplace identity does not create local membership. Revocation and
  recovery work locally even when the hub cannot be reached.
- The local control plane records secret references, access policy metadata, and delivery
  status. OpenBao stores values. Local runners and workloads receive access scoped to their
  approved team, app, and environment. Application secret values stay out of manifests, registry
  payloads, ordinary control-plane storage, notifications, and logs.
- Initialize OpenBao with customer-owned recovery material. Keycloak start and OpenBao unseal
  need usable recovery paths independent of each other. Prefer short-lived workload identities
  where the provider and network support them. Test cold restart and recovery before depending
  on automatic rotation or provisioning.

## Registry and transactions

Published repositories remain template sources. A registry release records publisher, license,
version, source revision, artifact digests where applicable, service requirements, and secret
names. Publication is an explicit export and review of public material. The registry needs
neither the private app's applied manifest nor its deployment record. The first transaction
proof is publish, claim, and install a free version. Paid claims and other hub services can
build on the same installation and account links.

## First proof and acceptance

The proof uses the existing Platfolio and starter fixtures. It adds no new template repository.
Bootstrap, registry authorization, and customer workflows are separate evidence tiers.

| Step | Evidence |
| --- | --- |
| Local paired runtime | Both installations run the same Platfolio artifact with separate stores, issuers, and OpenBao storage. Expected local tokens work. A peer issuer is rejected. An initialized OpenBao restarts from persistent storage and can be recovered independently. A scoped test identity can access its own test secret and is denied in the other installation. |
| Railway staging | From the existing starter app's staging runtime, measure private service reachability inside the same project and environment, then across any available distinct boundaries. Test reachability separately from authorization. Keep OpenBao private. Record the project and environment involved and the observed DNS or connection result. |
| Connected pilot | A hub launch enrolls a private installation. An approved identity can claim and install a pinned template there. Expiry, replay, and revocation are rejected. Local sign-in, deployment, and rotation still work after unlinking. |

Railway documents its private network as scoped to a single project and environment and
available at runtime. The same-project proof is a baseline. The decision about grouping
related apps or providing customer-owned cross-project connectivity depends on the staging
measurements. [Railway private networking](https://docs.railway.com/networking/private-networking/how-it-works)

The local and staging checks precede production changes and the connected pilot. New API
operations follow [D41](01-product-and-decisions.md#decision-register). The existing mockup
is the basis for the private workspace. The hub needs launch, link, browse, publish, and claim
screens.

## Evidence

Measured on November 24, 2026.

### Local paired runtime

The two installations run with separate Compose projects, networks, Postgres volumes,
Keycloak realm stores and OpenBao Raft volumes. Both reuse the same API and site images built
from the checkout. The site's runtime config selects its own API and issuer. The two loopback
hostnames also give each Keycloak its own browser cookie scope.

| Installation | Site | Control plane | Keycloak | OpenBao |
| --- | --- | --- | --- | --- |
| Hub | `http://localhost:18173` | `http://localhost:18082` | `http://localhost:18081` | `http://localhost:18200` |
| Private | `http://127.0.0.1:19173` | `http://127.0.0.1:19082` | `http://127.0.0.1:19081` | `http://127.0.0.1:19200` |

Build once with the existing production-shaped Dockerfiles, then start and check both local
installations. The site needs build-time addresses for its static shell and takes the actual
installation addresses from its runtime config.

```sh
pnpm install --frozen-lockfile
docker build -f apps/control-plane/Dockerfile -t platfolio-control-plane:hub-spoke-proof .
docker build -f apps/site/Dockerfile -t platfolio-site:hub-spoke-proof \
  --build-arg PLATFOLIO_SITE_ORIGIN=http://localhost:18173 \
  --build-arg PLATFOLIO_URL=http://localhost:18082 \
  --build-arg PLATFOLIO_IDENTITY_ISSUER=http://localhost:18081/realms/platfolio .
pnpm exec tsx scripts/prove-hub-spoke.ts
```

The proof checks image identity, endpoint health and site configuration for both
installations. The repository’s authorization-code and PKCE sign-in check passed all six
assertions on each installation. Each issuer's token reaches its own API, the peer token gets HTTP 401, and
local teams with the same slug have separate IDs and memberships. Each OpenBao allows its
own scoped token and returns HTTP 403 for the peer token and for a path outside its policy.
The two servers each seal on restart, unseal with their own recovery material, and return the
value written before the restart. The private installation obtains a new local token and reads
its teams while the hub site, API and Keycloak are stopped. The command restores the hub
before exiting.

This local proof uses loopback HTTP, the existing development Keycloak seed, and one
OpenBao recovery share per instance. The proof script keeps the generated OpenBao root token
and unseal material in private, Git-ignored files under `.tmp/hub-spoke/`. Keep those files
with the local Raft volumes if you restart the proof. Keep an empty reserved recovery file for
inspection if initialization is interrupted. An initialized server requires its original
recovery material. A customer installation needs its own TLS, recovery and bootstrap policy.
The local control plane has no OpenBao integration in this proof. A test client exercises
OpenBao directly. Registry enrollment and optional shared sign-in are the connected pilot.

### Railway staging

The starter has a staging-only Railway project named `platfolio-starter-web`. It was deployed
from the existing starter repository, revision `f2a095711f98696a98ed1711a87ed288ef034bf4`.
The Railway probe is appended to the starter's staging image at build time and runs inside
`web-staging` at startup. It logs a DNS result and a PostgreSQL protocol result with no
addresses or credentials. The steady-state app uses the original starter source.

| Check | Measured result |
| --- | --- |
| Same project and environment | `web-staging` resolved `app-db-staging.railway.internal` over IPv4 and IPv6. PostgreSQL answered the protocol probe on port 5432. The runtime's configured database reference used the same private hostname. |
| Across projects | Both DNS queries for `api-staging.railway.internal` in `platfolio-selfhost` returned `ENOTFOUND` from the starter runtime. Railway reported the target endpoint active in a separate private network. This probes service discovery. Direct private-IP routing and isolation between environments in the same project remain unmeasured. |
| Deployment and ingress | Railway marked both the instrumented run and the subsequent unmodified starter deployment successful. The starter's project has only `staging`. The PostgreSQL template initially created a public TCP proxy. It was removed and Railway returned zero proxies for the starter database. |

The first probe reached PostgreSQL before Railway had resolved the application's database
reference. Reapplying the reference after the database service existed made the reference
resolve on the next deployment. The launcher should reuse the provider’s ordering, waiting
for the database to be placed before wiring its reference, and verify the resulting runtime
configuration. The starter reports whether a database URL was configured. The probe checks
transport and the reference without using a database password. [Instrumented deployment](https://railway.com/project/d14c2c1a-0040-457d-b6e0-cc6381b76d68/service/61475175-f2c7-4be6-9825-da4662165d59?id=e038f55b-c400-4537-b537-ab49c3c51da9) · [Unmodified starter deployment](https://railway.com/project/d14c2c1a-0040-457d-b6e0-cc6381b76d68/service/61475175-f2c7-4be6-9825-da4662165d59?id=01bd35ea-1071-445e-bddf-8362dec90e9e)

To rerun the networking check, copy `scripts/probe-railway-starter-network.ts` into a clean
checkout of the pinned starter as `src/network-proof.mts`. Append this build-only override
and deploy to the existing `web-staging` service. Read the two `PLATFOLIO_NETWORK_PROOF`
lines from that deployment. Redeploy the unmodified revision when finished.

```dockerfile
CMD ["sh", "-c", "node src/network-proof.mts && exec node src/server.mjs"]
```

## Next delivery

Build the customer-owned launcher around the existing manifest, plan and provider seams. The
first Railway installer should deploy the private control plane, Keycloak, OpenBao and its
local execution worker onto an explicitly reviewed network placement. Verify that the worker
reaches OpenBao privately and that the customer can restore identity and unseal OpenBao
without the hub. Use the existing starter app for the first deployment from the private
installation. Workloads that need a shared service in another Railway project require a
customer-approved connectivity design. A shared installation or workspace ID alone does not
supply a network route.

Add the enrollment, scoped registry credential and free-template claim in the next slice.
Make redemption single use, rotate and revoke the credential, and prove local sign-in and
operations through a disconnect. Optional Keycloak brokering follows the local operator
flow and can be tested with a marketplace user who has no private role until an owner
assigns one. Keep billing and paid listings behind the free claim-and-install proof.
