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

## Delivery sequence

The customer-owned launcher and the first free claim are exercised in the pilot below. The
placement gives the worker and OpenBao one private Railway network and keeps the private
issuer independent of the hub. Workloads that need a shared service in a different Railway
project require customer-approved connectivity. A common installation or workspace ID
alone does not supply a network route.

The next slice is one-use hosted enrollment, scoped machine credentials, and an owner-run
OpenBao initialization and recovery flow. Optional Keycloak brokering follows the local
operator flow. It should demonstrate that a marketplace user has no private role until an
owner assigns one. Paid claims build on the free install path.

The one-use enrollment API is supported by the customer CLI. A hub owner uses
`customer-marketplace.ts issue` to create a code in a private file. The private installation
uses `enroll` with that file and an owner-configured OpenBao KV v2 mount named
`platfolio-registry`. Grant the installation token read, create, and update only on
`platfolio-registry/data/installation/<installation UUID>`. Use an HTTPS OpenBao endpoint
or a loopback endpoint for local tests. The installation generates its registry credential
inside the operator process and persists it in OpenBao before redeeming. The hub stores
only SHA-256 verifiers. A private installation uses `claim-enrolled` to read the pinned
release using its own credential. The hub owner's `disconnect` revokes that credential.
The saved receipt remains usable while the hub is offline.

## Customer launcher and free claim pilot

The operator runs the launcher in a customer-owned Railway workspace. The installation uses
a project named `platfolio` and each hosted app uses its own project named for that app.
The pilot uses one staging environment in each project. The customer supplies the workspace credential locally,
a verified Platfolio CI candidate, and a strong Keycloak bootstrap password in a private
file. The launcher locates the project in that workspace before applying anything. It
renders the candidate using the existing Platfolio description, provisions a private
Postgres for Platfolio and Keycloak, and assigns Railway HTTPS origins to the site, API,
and issuer. It places OpenBao and the installation worker on the same private network.
OpenBao uses a persistent volume. The worker verifies a private health response without
receiving an OpenBao root or recovery credential.

```sh
pnpm exec tsx scripts/launch-customer-railway.ts --project "$project" --candidate "$candidate"
pnpm exec tsx scripts/launch-customer-railway.ts --project "$project" --candidate "$candidate" \
  --identity-bootstrap-file "$bootstrap_file" --apply
```

Set `RAILWAY_WORKSPACE_ID` and `RAILWAY_TOKEN` in the operator's environment. The launcher
forwards the workspace token only to Railway and its CLI. The optional candidate-free mode
runs the private networking portion against an existing customer staging project. For a
new pilot, finish Keycloak onboarding on the issuer URL returned by the launcher. Review
and retain OpenBao recovery materials under customer control before storing any secrets.
Keep untrusted workloads out of a staging network with an uninitialized OpenBao.

Marketplace operations are enabled only on the hub. In this pilot, a verified hub team
owner links a customer-generated installation ID and claims the fixed free release. The
hub persists the link and disconnects it permanently. The owner obtains a fresh access
token for these operations. The launcher writes the claim receipt locally and hands Railway
only the source files read through Git at the exact pinned revision. The install step uses
a staging starter service and its private PostgreSQL in `starter-web`, reusing them when present. Runtime
build base images retain the template's own policy. The pilot pins the template source revision.

```sh
pnpm exec tsx scripts/customer-marketplace.ts connect --hub "$hub" --team "$team" \
  --installation "$installation" --identity-file "$owner_token_file"
pnpm exec tsx scripts/customer-marketplace.ts claim --hub "$hub" --team "$team" \
  --installation "$installation" --identity-file "$owner_token_file" --receipt "$receipt"
pnpm exec tsx scripts/customer-marketplace.ts install --installation "$installation" \
  --receipt "$receipt" --project "$app_project"
pnpm exec tsx scripts/customer-marketplace.ts disconnect --hub "$hub" --team "$team" \
  --installation "$installation" --identity-file "$owner_token_file"
```

Connector requests carry the installation ID and hub team scope. The hub does not receive
Railway grants, private DNS names, Keycloak administration credentials, OpenBao credentials,
or information about the app's runtime. A disconnected ID cannot be linked again by replay.
The installed application has no hub URL or credential in its runtime configuration. An
acquired release remains in the customer's possession after disconnect.

This owner-driven pilot precedes customer-facing launch workflow integration, machine
credentials, OpenBao unseal and recovery orchestration, and registry support for other
release types. The currently reviewed Railway starter deployment is a source build of one
existing repository. The private control plane's support for managing that deployment will
use its existing instance and deployment records.

### Pilot results

On November 24, 2026, the launcher placed the private site, API and Keycloak from CI candidate
`36442bc15a0de5f2dcc6976fd3769dc875744c5d` in the original `platfolio-starter-web` staging
pilot. That project has since been removed. The private issuer, site and API answered over HTTPS. The six authorization-code and
PKCE checks passed against the private issuer and API. Platfolio and Keycloak use their own
private Postgres service, separate from the starter database.

- Railway reported zero public service domains, custom domains or TCP proxies for OpenBao
  and the installation worker. Within the project, the worker reached OpenBao and received
  HTTP 501 with `initialized=false` and `sealed=true`. This measured private connectivity.
  Owner initialization and secret access were outside this test. [Worker deployment](https://railway.com/project/d14c2c1a-0040-457d-b6e0-cc6381b76d68/service/ec9e000b-8b9a-4fd8-ada2-2c0f6a255741?id=f6f726c0-ce9e-4e85-819e-eaece004be25)
- The local hub issued a free `starter-web` 0.1.0 claim pinned to
  `f2a095711f98696a98ed1711a87ed288ef034bf4`. The installer read source blobs at that commit
  and Railway marked the corresponding starter deployment successful. [Starter deployment](https://railway.com/project/d14c2c1a-0040-457d-b6e0-cc6381b76d68/service/61475175-f2c7-4be6-9825-da4662165d59?id=23901917-a3e2-4fad-a124-05d2498fe938)
- On disconnect, the hub returned HTTP 204, followed by HTTP 404 for a new claim and a
  replayed connect. With the hub API then stopped, the Railway worker received a healthy
  starter response over the private network. Railway reported the same deployment ID
  and a successful state. The retained receipt also produced a fresh successful deployment
  while the hub API was offline. The hub was restored after both checks. [Offline redeployment](https://railway.com/project/d14c2c1a-0040-457d-b6e0-cc6381b76d68/service/61475175-f2c7-4be6-9825-da4662165d59?id=e88d9aad-8a2c-47d6-8ceb-b21ef9cf3c97)

The local hub ran the new registry code. The private Railway installation used the previously
published CI candidate, with marketplace operations disabled. Hub enrollment and the private
installation's sign-in remained independent throughout the pilot.


### Browser launch and app removal

The customer runs a local launch preview connected to a single team and Railway workspace.
A team owner signs in, selects the connected team, and clicks **Launch starter** to install
`starter-web` from the pinned free release. The launcher provides a Railway HTTPS link and
creates the database automatically. The public template needs no GitHub grant, custom DNS,
or app credential. The generated URL is public. Connecting a private repository and setting
up Railway authorization for a first-time user are future steps.

The launcher checks project ownership and service placement before making changes. It refuses
an unrelated project that happens to have the same name. Platfolio uses the dependencies in
`compose.customer.yaml` to wait for Keycloak and then API readiness before starting the site.
Railway reports the state of each exact deployment. The launcher also checks its HTTPS health
endpoint. The API readiness endpoint checks identity configuration and the database. OpenBao
has private ingress only. Its worker can distinguish network reachability from a sealed store.
This pilot refuses app secret delivery until customer-owned OpenBao authorization is wired.

The browser shows each stage and offers a JSON troubleshooting report. It records the pinned
release, provider resource IDs and statuses, operation timestamps, and safe recovery messages.
Credentials, environment values, and raw build output stay out of the report. Keep the journal
in a private location so a restarted preview can resume setup without duplicating resources.

- **Remove and keep data** stops the app and database deployments and verifies the same volume
  IDs still exist. The project retains its service settings and volumes. **Restore app** uses
  that project again. Railway can continue to charge for the retained storage.
- **Remove and wipe data** requires typing the app name. It deletes the app's Railway project
  and schedules its storage for deletion under Railway's recovery policy. [Railway volume lifecycle](https://docs.railway.com/volumes/reference)

The pilot's browser operations are owner-scoped and limited to the connected team. The
workspace grant stays in the local runner. The hosted hub and the published private
Platfolio candidate do not run this preview runner.

The staging replacement used separate Railway projects named
[`platfolio`](https://railway.com/project/25da1227-410c-4d3c-9bde-7b5faced4ee0) and
[`starter-web`](https://railway.com/project/f74ef54e-178a-4dd9-93e9-66da088ca833).
The old mixed pilot was removed, with three volumes queued for deletion. The local browser
launched Starter Web, showed the report, and removed the app with data kept. Its public
endpoint stopped answering and both deployments were gone from the active list. Restore
started both services with the same project ID and a read-back of the original attached
volume ID. The test verified the volume identity. It did not inspect stored database rows.
Private Platfolio passed six browser sign-in checks against its new issuer. Its worker
reached OpenBao privately while the store was sealed and uninitialized.

### Hosted starter launch

A fresh private Keycloak can seed its operator realm on first startup. Start the identity
image with `start-private`, the private `PLATFOLIO_SITE_ORIGIN`, an initial owner email,
and a generated initial owner password under the installation's custody. The import derives
the exact browser callback from the site origin. It creates one operator and disables open
registration. An existing realm is skipped on restart. After the owner signs in and changes
the initial password, switch the service to `start` and remove the two bootstrap values.
The owner then creates their team in Platfolio and completes the vault setup.
The customer Railway launcher also accepts `--owner-bootstrap-file` with a private JSON
file containing `email` and a generated URL-safe `password`. This starts the private
realm in the identity service and prints only its public origin.

The customer launcher can run as a private worker in the installation project. Pass a
CI candidate, the exact installation project ID, and a private `--launch-config-file`
when applying `launch-customer-railway.ts`. Keep that file in the installation owner's
credential store. It contains the local owner team's `team` ID and two independent
random credentials named `workerKey` and
`openBaoSecret`. The latter authorize the private API relay and the OpenBao worker role,
respectively. An existing Railway public OAuth `client` ID is optional. The candidate's API
image runs the worker under a separate entry point.
A persistent worker volume keeps the launch journal and the encrypted recovery receipt.

The Railway OAuth callback is the installation API origin plus `/api/v1/railway/callback`.
If supplying a client, register the exact callback on that public PKCE client. For a dedicated workspace,
authorize workspace administration so the worker can create a separate app project.
For an existing app, set `appProject` to the exact Starter Web Railway project ID
and authorize only that project. The worker checks its workspace, name, role marker,
environment and service placement before making changes. A project-only grant cannot
create or permanently delete a project.

The team owner generates and downloads an encryption key in the browser before
initialization. The worker returns the recovery receipt encrypted to that key. The
owner decrypts and saves the recovery file locally and confirms it in the browser.
The file contains three Shamir shares, of which two unlock the store, plus the initial
bootstrap credential. After verifying its scoped AppRole, the worker revokes that
bootstrap credential. Keep the recovery file in the owner's credential store and use
it to unlock OpenBao after a restart. The owner can recover an administrative token
from the shares through OpenBao's standard recovery procedure.

After OpenBao is ready, the owner grants access in Railway. If the installation has no
configured client ID, its worker first registers a public OAuth client with Railway for
the exact callback and stores its registration in the local vault at
`customer-launch/data/railway-client`. Repeated attempts use that saved registration.
The initial registration grants no access to a Railway project. The subsequent owner
consent still selects the projects or workspace.

The worker exchanges the
one-use code with PKCE and stores the OAuth grant at one scoped OpenBao KV path.
Railway may refresh the grant during later launches. The workspace page reads readiness
and the deployment timeline through the owner-scoped API. The hub does not receive the
grant, the bootstrap credential, the recovery shares, or the app configuration.

### Private app availability

The private installation checks the verified Starter Web staging address once per
reconciliation interval. The address comes from the worker's successful deployment
report. The check follows no redirects and tests the app's health endpoint. It reports
service reachability and the most recent check time. Two consecutive failures confirm an
outage. A subsequent passing check records the recovery. Removing an app with data kept
is a planned stop. The same check can start again after restore.

The private app status page uses the team activity timeline component. The control plane
keeps the observations and outage transitions within the installation. Publishing status
to the public site requires an explicit production environment and a separate owner action.

### Private marketplace connection

Set the installation worker's hub with the launcher's `--registry-origin` option.
The worker accepts an HTTPS origin from the installation owner and refuses redirects.
On the hub, a team owner opens **Connections** and creates a one-use code. Paste it
into **Connections → Marketplace** in the private Platfolio. The code is valid for
15 minutes. The hub Connections page shows pending and connected installations,
lets owners replace a pending code, and can disconnect an installation.

The worker generates its registry credential, saves it to OpenBao with an exact
version check, and exchanges the code and a SHA-256 verifier with the configured
hub. It confirms the claim matches the reviewed release pin before showing it as
acquired. Retrying after an interrupted exchange uses the same saved credential.
The browser gets connection state and release metadata. A hub owner can revoke the
connection with the existing marketplace disconnect operation. The private worker
keeps the acquired release metadata and local apps continue running.
For a new install configured with a registry the worker checks for a saved claim before
it deploys Starter Web. The check reads OpenBao and can succeed while the hub is offline.
An existing deployment can also be restored without contacting the hub.

New worker policies include the exact OpenBao path
`customer-launch/data/marketplace`. For an installation initialized before this
change, the OpenBao administrator adds the following stanza to the existing
`platfolio-launcher` policy using their normal administrative access.

```hcl
path "customer-launch/data/marketplace" {
  capabilities = ["create", "read", "update"]
}
```

### Private notifications

A person can follow failed deployments, outages, and environment secret updates for
apps that belong to their current teams. Each rule selects an environment or follows all
environments of one app. Recent matching events appear in the private workspace.
Notification results include the app, event, environment, and time. The event feed carries
neither secret names nor values. Email delivery starts with an explicit opt-in for the
verified primary address. The installation's own Keycloak confirms that the identity is
enabled and the address is verified before each delivery. Disabling email leaves the
workspace rules intact. Deliveries reference the event and person and carry a bounded
retry window. Address selection and team-specific destinations require the shared
address-ownership check in D70.
