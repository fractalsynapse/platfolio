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

The proof is tracked on the implementation branch. This section records measured outcomes as
they are exercised. Scope and limits belong alongside the results.
