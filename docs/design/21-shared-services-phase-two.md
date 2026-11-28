# Phase 2 implementation plan

Connect an application to Shared Identity from a private Platfolio installation. A marketplace
acquisition identifies what to install. The private installation owns the choice of service,
deployment environment, client registration, and credential placement. The hub remains outside
that runtime path. See the [marketplace roadmap](19-marketplace-migration.md)
and [identity invariants](05-identity.md).

## 2A — Publish the contract and record a binding locally

Add two operations to [OpenAPI](../../apps/control-plane/openapi.yaml). A team member can publish the
identity output names and kinds from the installed, reviewed Shared Identity release at its saved Git
revision. Start with the catalog's built-in release. Use the same release validator as the legacy
installer. A compatible offer already recorded on the instance keeps its existing placement state.
The existing publication operation continues to handle manually published offers and other versions.

A consumer team member can select a Shared Identity instance on the same team and specify whether its
client is public or confidential. The API derives the destination names, checks the provider's declared
outputs, and saves the relationship in the existing `identity` binding record. A public client uses
issuer, JWKS URI, and client ID. A confidential client also needs a client secret. `bound` describes the
recorded dependency. The response carries output and destination names only. A retry returns the
original binding. A different existing dependency must be reviewed before it can be replaced.
Existing discovery, unbind, share, and removal operations continue to use the same records.

Verify both API operations locally with the reviewed release and with controlled failure cases.
Cover authentication, same-team scoping, incompatible offers, retries, and removal refusal while a
consumer depends on the service. Check that decisions and audit entries contain only identifiers and
output metadata. Keep existing acquisition receipts, instance pins, and database rows compatible.

## 2B — Provision a client in one environment

Add explicit consumer OIDC input declarations to the approved Starter Web project. Its Phase 1 pin
has no OIDC inputs. Use a new source release for the consumer and preserve older pins. Read
the selected provider and consumer manifests from their retained releases. Verify that the provider
advertises the expected capability and that the consumer declares each destination with the right
custody. Cover Git-backed and OCI-backed installations through their saved source or bundle. Resolve
the specific provider and consumer environments before registration.

Design the execution and status operations in OpenAPI before wiring the private worker. Use one
application client per consumer environment in the team's application realm, with exact redirect URIs
and PKCE S256 for public clients. Keep Keycloak administration and confidential client credentials
within customer infrastructure. OpenBao and the execution environment hold any secret values. The
control plane records names, placement status, observed issuer or client identifiers when needed,
and audit outcomes. Confirm issuer discovery, client registration, and consumer sign-in before
calling the binding operational. A failed placement can be retried or reissued without creating a
second client or replaying a secret from the control plane.

Make decommissioning and new binding execution mutually exclusive at the durable boundary. An active
or stale dependency keeps provider removal blocked. Work through an explicit client revocation and
consumer detach or replacement before releasing the dependency. A withdrawn team share continues to
mark its bindings stale. Verify the distinction between share withdrawal and an actual Keycloak client
revocation. Exercise interrupted execution, repeated requests, and loss of hub connectivity in the
local stack with independent control-plane and application issuers.

The local implementation uses the private worker's existing OpenBao AppRole. The owner provisions an
application-realm service account with `manage-clients` assigned to the account and included in its client
scope. Attach the `kc-admin-api` default client scope for the Admin API audience on Keycloak 26.8.2.
The owner writes the issuer, client ID, and credential
directly to the `customer-launch` KV mount under `identity/providers/<provider-id>/<environment>`.
The owner records the exact Starter Web `redirectUri` at `identity/consumers/<consumer-id>/<environment>`.
The API takes the provider environment alongside the saved binding. The worker derives the client ID,
checks discovery, and places the runtime configuration at `identity/clients/<consumer-id>/<environment>`.
Give the app a vault policy that reads only its own placement. The runtime loads that placement before
starting. The existing OpenBao policy recovery flow applies the added worker paths to an older vault.

The worker stores registration checkpoints under `identity/state`. Postgres keeps a reservation on the
original binding while a client is pending or placed. Revocation disables the client, removes its vault
placement, and verifies both before releasing the reservation. Detach the binding after revocation.
Existing app sessions expire under the app's own session policy.

To reproduce the local proof, run `pnpm exec tsx scripts/smoke-shared-identity.ts <starter-web-checkout>`
with the OIDC-capable Starter Web revision checked out. The command uses disposable local containers,
the actual private worker, and the reviewed Shared Identity pin. It checks recovery from a refused vault
write, worker restart, authorization-code sign-in, vault isolation, and revocation. Hosted runtime
delivery and cross-project connectivity remain part of 2C.

## 2C — Verify hosted connectivity and lifecycle

Finish Phase 1 hosted acceptance before running this slice on Railway. Keep the existing private
`platfolio` test deployment available until those gates pass. Its in-place data and release pins are
part of that evidence. Teardown follows the acceptance decision and is independent of local Phase 2 work.

### Railway connectivity measured on 2026-11-27

| Origin | Shared Identity over HTTPS | Shared Identity private DNS | OpenBao private DNS |
| --- | --- | --- | --- |
| Starter Web runtime | OIDC discovery returned the expected issuer | Unresolved | Unresolved |
| Private installation worker | OIDC discovery returned the expected issuer | Unresolved | Resolved and the health endpoint answered |
| Browser | OIDC discovery returned the expected issuer | Unmeasured | Unmeasured |

The Starter Web runtime also resolved its own PostgreSQL service over private DNS. The probes ran
in the existing approved projects and retained their image pins. The Shared Identity probe read
Master realm metadata. The application login test still needs a dedicated application realm.
[Railway private networking](https://docs.railway.com/networking/private-networking/how-it-works)

### Hosted credential delivery

The private worker reads the issued client configuration from OpenBao. For a retained Marketplace
OCI install, it checks the applied plan, image pin, Railway project ownership, named environment,
and bound web callback before delivery. The worker writes the declared OIDC variables to that
service, verifies their names, renews the release’s registry grant, and checks that a new deployment
of the pinned image becomes healthy. The hub receives neither the configuration nor the Railway
grant. Revocation disables the Keycloak client before removing the Railway variables. The worker
verifies that the pinned application restarts and removes the OpenBao placement before releasing
the reservation. A partial revocation can be retried without enabling the client again.

For an older worker policy, use **Enable Shared Identity** in **Connections** with the saved owner
recovery file. The site encrypts the file to the private worker. OpenBao issues a temporary admin
token inside the installation to update the worker policy, and the recovery code verifies retirement.

An owner can prepare the management grant and exact callback directly in private OpenBao or send
them with the first placement request. For the latter, get the worker public key from
`GET /api/v1/teams/{teamId}/starter-launch/setup`. Encrypt the JSON object containing
`clientId` and `clientSecret` with RSA-OAEP and SHA-256. Base64-encode the ciphertext and supply it
as `setup.realmGrant` with the application realm `setup.issuer` and the consumer’s
`setup.redirectUri`. The worker validates the realm before storing the manager once in OpenBao.
Later placements can omit the setup fields. Existing manager grants can be rotated directly in
customer OpenBao. A release or callback change requires revoking the previous placement first.

### Hosted acceptance on 2026-11-27

An isolated control plane and private OpenBao worker applied the exact Starter Web 0.1.1
Marketplace bundle in a separate Railway project in Internal Platfolio. Railway hosted Starter
Web and Keycloak in distinct projects. The API refused to remove Shared Identity with a live
consumer. Placement started a new deployment, a repeated placement kept that deployment, and an
HTTPS authorization-code sign-in established a Starter Web session.

Revocation disabled the Keycloak client, removed its OpenBao placement, and refreshed the
application at the same image digest. Keycloak refused a fresh sign-in through the old client.
The restarted app returned 404 for its login route, and Railway reported all five OIDC variable
names absent. The private Platfolio deployment and existing Starter Web 0.1.0 install retained
their deployment IDs and image pins throughout.

The first apply hit the API's 30-second socket timeout after the provider had accepted the plan.
On retry, the verified release receipt resolved to the same plan hash on the existing project.
Authorized hosting apply, placement, and revocation now allow the worker's verification window
to finish before the socket times out.

The production-like private installation kept its existing release during this run. Updating
that installation's worker and checking cold recovery during a hub outage remain separate
operational checks.

## 2D — Optional hub sign-in and application registration

Give a private installation owner an explicit opt-in to accept hub sign-in. Link verified issuer and
subject proofs and have the local owner grant roles. Verify that a marketplace account alone conveys
no local access and that local owner login stays available through a hub outage. Design end-user app
registration separately, with an explicitly registered client, independent audiences, and app-owned
roles. Use [the private installation identity model](18-hub-and-private-installations.md) for the
account-linking boundary. Payments and managed release promotion are later phases.
