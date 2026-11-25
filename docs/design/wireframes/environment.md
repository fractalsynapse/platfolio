# Environment workspace

The route supplies the environment. Every operation, status, and evidence panel on the page uses that target. [Wireframe index](README.md)

The mockup keeps a Production/Staging switcher and shared Overview, Deployments, Configuration, and Domains links on each environment page. Deployment detail links retain the environment in the breadcrumb. The later-scope deployment history and detail routes are included for design review. [Mockup walkthrough](../mockup/README.md)

## Environment overview

`/dashboard/teams/:team/instances/:instance/environments/:environment` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| | Breadcrumb: Instance link                                          | |
| +--------------------------------------------------------------------+ |
| | Environment overview                                               | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Deployment result                                                  | |
| | Latest result for this environment                                 | |
| | GitHub run | Commit check                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Service status list      | |  | | Revision summary         | | | |
| | | | Service | Health         | |  | | Desired | Applied | What | | | |
| | | | Generated URL where      | |  | | changed                  | | | |
| | | | applicable               | |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
| | | +--------------------------+ |                                   | |
| | | | Next action              | |                                   | |
| | | | Open configuration |     | |                                   | |
| | | | Open Domains             | |                                   | |
| | | +--------------------------+ |                                   | |
| | | +--------------------------+ |                                   | |
| | | | Observation status       | |                                   | |
| | | | Source | Age             | |                                   | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| | Breadcrumb: Instance link      | |
| +--------------------------------+ |
| | Environment overview           | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment result              | |
| | Latest result for this         | |
| | environment                    | |
| | GitHub run | Commit check      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Service status list            | |
| | Service | Health               | |
| | Generated URL where applicable | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Next action                    | |
| | Open configuration | Open      | |
| | Domains                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Observation status             | |
| | Source | Age                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open deployment evidence       | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Revision summary           | | |
| | | Desired | Applied | What   | | |
| | | changed                    | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

An environment deep link keeps its target through sign-in. A newer staging run cannot replace production evidence. Domains appears for publicly reachable services.

## Deployment history

`/dashboard/teams/:team/instances/:instance/environments/:environment/deployments` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Deployment history                                                 | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Deployment list          | |  | | Deployment result        | | | |
| | | | Time | Commit | Result   | |  | | Selected run | GitHub    | | | |
| | | | Open run record          | |  | | link                     | | | |
| | | +--------------------------+ |  | | Observation source | Age | | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Deployment actions (when | |  +------------------------------+ | |
| | | | supported)               | |                                   | |
| | | | Request deploy | Request | |                                   | |
| | | | redeploy                 | |                                   | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Deployment review (when open)                                      | |
| | Target and revision | Plan hash                                    | |
| | Confirm request or go back                                         | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment history             | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment list                | |
| | Time | Commit | Result         | |
| | Open run record                | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment actions (when       | |
| | supported)                     | |
| | Request deploy | Request       | |
| | redeploy                       | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open selected run              | |
| | Opens details sheet            | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment review (when open)  | |
| | Target and revision | Plan     | |
| | hash                           | |
| | Confirm request or go back     | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Deployment result          | | |
| | | Selected run | GitHub link | | |
| | | Observation source | Age   | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Latest status is already on [Environment overview](#environment-overview) in MVP. A manual action uses a full review surface before submission.

## Deployment record

`/dashboard/teams/:team/instances/:instance/environments/:environment/deployments/:dispatchId` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Deployment record                                                  | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Deployment result        | |  | | Revision summary         | | | |
| | | | Requested action |       | |  | | Plan hash | Artifact     | | | |
| | | | Reported result          | |  | | identity                 | | | |
| | | | Provider verification |  | |  | | Requested and applied    | | | |
| | | | Source and age           | |  | | revisions                | | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
| | | | Run links                | |                                   | |
| | | | Open GitHub run | Back   | |                                   | |
| | | | to history               | |                                   | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment record              | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Deployment result              | |
| | Requested action | Reported    | |
| | result                         | |
| | Provider verification | Source | |
| | and age                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Run links                      | |
| | Open GitHub run | Back to      | |
| | history                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open plan and artifact         | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Revision summary           | | |
| | | Plan hash | Artifact       | | |
| | | identity                   | | |
| | | Requested and applied      | | |
| | | revisions                  | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

A direct link opens the record for the specified environment and dispatch. Missing verification remains distinct from reported failure.

## Configuration

`/dashboard/teams/:team/instances/:instance/environments/:environment/configuration` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Configuration                                                      | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Required secret list                                               | |
| | Service | Secret name | Presence                                   | |
| | Health verification | Source and age                               | |
| | Provider or runner instructions                                    | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Secret action (when supported)                                     | |
| | Deliver secret                                                     | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Application identity form                                          | |
| | Identity mode | Tenant OIDC issuer                                 | |
| | Review and verify application sign-in                              | |
| +--------------------------------------------------------------------+ |
| When opened                                                            |
| +--------------------------------------------------------------------+ |
| | Deliver secret dialog                                              | |
| | +----------------------------------------------------------------+ | |
| | | Write-only secret form                                         | | |
| | | Target service and secret name                                 | | |
| | | Enter value | Deliver                                          | | |
| | +----------------------------------------------------------------+ | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Configuration                  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Required secret list           | |
| | Service | Secret name |        | |
| | Presence                       | |
| | Health verification | Source   | |
| | and age                        | |
| | Provider or runner             | |
| | instructions                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Secret action (when supported) | |
| | Deliver secret                 | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Application identity form      | |
| | Identity mode | Tenant OIDC    | |
| | issuer                         | |
| | Review and verify application  | |
| | sign-in                        | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Deliver secret sheet           | |
| | +----------------------------+ | |
| | | Write-only secret form     | | |
| | | Target service and secret  | | |
| | | name                       | | |
| | | Enter value | Deliver      | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Presence and healthy behavior are separate fields. A green verification check depends on deployed service health. The optional secret input is discarded when the sheet closes.

## Domains

`/dashboard/teams/:team/instances/:instance/environments/:environment/domains` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Domains                                                            | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Domain list              | |  | | Domain verification      | | | |
| | | | Generated URL | Custom   | |  | | DNS | Certificate |      | | | |
| | | | hostname                 | |  | | HTTPS readiness          | | | |
| | | | Attach hostname          | |  | | Observation source | Age | | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
| | | | DNS record list          | |                                   | |
| | | | Zone | Name | Type |     | |                                   | |
| | | | Value                    | |                                   | |
| | | | Copy provider records    | |                                   | |
| | | | including TXT            | |                                   | |
| | | +--------------------------+ |                                   | |
| | +------------------------------+                                   | |
| +--------------------------------------------------------------------+ |
| When opened                                                            |
| +--------------------------------------------------------------------+ |
| | Attach hostname dialog                                             | |
| | +----------------------------------------------------------------+ | |
| | | Hostname form                                                  | | |
| | | Target service | Custom hostname                               | | |
| | | Validate and attach                                            | | |
| | +----------------------------------------------------------------+ | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| Mobile screen                      |
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Domains                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Domain list                    | |
| | Generated URL | Custom         | |
| | hostname                       | |
| | Attach hostname                | |
| +--------------------------------+ |
| +--------------------------------+ |
| | DNS record list                | |
| | Zone | Name | Type | Value     | |
| | Copy provider records          | |
| | including TXT                  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open verification details      | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Domain verification        | | |
| | | DNS | Certificate | HTTPS  | | |
| | | readiness                  | | |
| | | Observation source | Age   | | |
| | +----------------------------+ | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Attach hostname sheet          | |
| | +----------------------------+ | |
| | | Hostname form              | | |
| | | Target service | Custom    | | |
| | | hostname                   | | |
| | | Validate and attach        | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

The tenant publishes DNS records at its DNS provider. The environment shows DNS verification, certificate issuance, and verified HTTPS as separate outcomes.
