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

## 2C — Verify hosted connectivity and lifecycle

Finish Phase 1 hosted acceptance before running this slice on Railway. Keep the existing private
`platfolio` test deployment available until those gates pass. Its in-place data and release pins are
part of that evidence. Teardown follows the acceptance decision and is independent of local Phase 2 work.

Use approved Shared Identity and Starter Web targets to measure which endpoints the consumer runtime,
private worker, and end-user browser can reach across projects. Select the transport after that
measurement. Verify sign-in, customer-controlled credential placement, revocation, and removal refusal
with active dependents. Test a cold recovery with the hub unavailable and record what remains usable.

## 2D — Optional hub sign-in and application registration

Give a private installation owner an explicit opt-in to accept hub sign-in. Link verified issuer and
subject proofs and have the local owner grant roles. Verify that a marketplace account alone conveys
no local access and that local owner login stays available through a hub outage. Design end-user app
registration separately, with an explicitly registered client, independent audiences, and app-owned
roles. Use [the private installation identity model](18-hub-and-private-installations.md) for the
account-linking boundary. Payments and managed release promotion are later phases.
