# Instance workspace

The instance context is the team and the instance slug. Each environment row opens a durable route. [Wireframe index](README.md)

## Instance overview

`/dashboard/teams/:team/instances/:instance` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Instance overview                                                  | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Environment list         | |  | | Instance summary         | | | |
| | | | Staging | Production     | |  | | Template and source      | | | |
| | | | Status, build, checked   | |  | | commit                   | | | |
| | | +--------------------------+ |  | | Tenant repository |      | | | |
| | | +--------------------------+ |  | | Railway project          | | | |
| | | | Next action              | |  | +--------------------------+ | | |
| | | | Resume setup | Resolve   | |  +------------------------------+ | |
| | | | blocker                  | |                                   | |
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
| +--------------------------------+ |
| | Instance overview              | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Environment list               | |
| | Staging | Production           | |
| | Status, build, last checked    | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Next action                    | |
| | Resume setup | Resolve blocker | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Observation status             | |
| | Source | Age                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open source and project        | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Instance summary           | | |
| | | Template and source commit | | |
| | | Tenant repository |        | | |
| | | Railway project            | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Open the environment named in a row. In the mockup, the status, build, and last checked time come from the recorded deployment check for that environment. Incomplete installs lead to [Setup](#setup). Open [Manage app](#lifecycle) to pause, restart, export, or remove the app.

## Setup

`/dashboard/teams/:team/instances/:instance/setup` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Setup                                                              | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Setup checklist          | |  | | Setup evidence           | | | |
| | | | Install PR | Plan        | |  | | PR link | Plan revision  | | | |
| | | | validation               | |  | | Workflow and environment | | | |
| | | | Workflow | First         | |  | | links                    | | | |
| | | | verification             | |  | +--------------------------+ | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | +--------------------------+ |  | | Observation status       | | | |
| | | | Blocker and next action  | |  | | Source | Age             | | | |
| | | | Open GitHub review |     | |  | +--------------------------+ | | |
| | | | Review blocked step     | |  +------------------------------+ | |
| | | | Open environment         | |                                   | |
| | | | configuration            | |                                   | |
| | | +--------------------------+ |                                   | |
| | | +--------------------------+ |                                   | |
| | | | Setup outcome            | |                                   | |
| | | | Awaiting input | Failed  | |                                   | |
| | | | | Verified               | |                                   | |
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
| | Setup                          | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Setup checklist                | |
| | Install PR | Plan validation   | |
| | Workflow | First verification  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Blocker and next action        | |
| | Open GitHub review | Open      | |
| | Activation requirements        | |
| | Open environment configuration | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Setup outcome                  | |
| | Awaiting input | Failed |      | |
| | Verified                       | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open setup evidence            | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Setup evidence             | | |
| | | PR link | Plan revision    | | |
| | | Workflow and environment   | | |
| | | links                      | | |
| | +----------------------------+ | |
| | +----------------------------+ | |
| | | Observation status         | | |
| | | Source | Age               | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Resume from recorded progress. Activation depends on a verified deployment. A verified run opens the corresponding environment overview.

## Dependencies

`/dashboard/teams/:team/instances/:instance/dependencies` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Dependencies                                                       | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Consumer bindings        | |  | | Affected consumers       | | | |
| | | | Required capability |    | |  | | Consumer instance |      | | | |
| | | | Provider                 | |  | | Binding state            | | | |
| | | | Binding state | Change   | |  | | Authorized instance      | | | |
| | | | binding                  | |  | | links                    | | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
| | | | Capability offers        | |                                   | |
| | | | Offered capability |     | |                                   | |
| | | | Shares                   | |                                   | |
| | | | Manage explicit shares   | |                                   | |
| | | | (owner)                  | |                                   | |
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
| | Dependencies                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Consumer bindings              | |
| | Required capability | Provider | |
| | Binding state | Change binding | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Capability offers              | |
| | Offered capability | Shares    | |
| | Manage explicit shares (owner) | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open affected consumers        | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Affected consumers         | | |
| | | Consumer instance |        | | |
| | | Binding state              | | |
| | | Authorized instance links  | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

Both shared identity and other declared capabilities fit this page. The consumer list informs change review and lifecycle blockers.

## Lifecycle

`/dashboard/teams/:team/instances/:instance/lifecycle` · MVP

**Desktop**

```text
+----------------------------------------------------------------------------+
| +------------------------------------------------------------------------+ |
| | Header | Team selector | Avatar                                        | |
| | Instance breadcrumb | Manage app | Team navigation                      | |
| +------------------------------------------------------------------------+ |
| +----------------------------------+  +----------------------------------+ |
| | Manage compute                   |  | Instance state                   | |
| | Suspend | Resume                 |  | Management status                | |
| | Review the available action      |  | Railway project | Repository     | |
| +----------------------------------+  +----------------------------------+ |
| +----------------------------------+  +----------------------------------+ |
| | Remove from Platfolio            |  | Export                           | |
| | Railway resources stay with team |  | Revisions | Secret names         | |
| | Review removal                   |  | Download sample export           | |
| +----------------------------------+  +----------------------------------+ |
| +------------------------------------------------------------------------+ |
| | Action review (when open)                                              | |
| | Railway compute and data | GitHub workflow | Provider grants           | |
| | Affected apps | Blockers                                               | |
| | Confirm or cancel                                                      | |
| +------------------------------------------------------------------------+ |
| +------------------------------------------------------------------------+ |
| | Removal progress                                                      | |
| | Requested | Blocked | Confirmed                                        | |
| +------------------------------------------------------------------------+ |
| +------------------------------------------------------------------------+ |
| | After removal                                                          | |
| | Independent operation checklist | Export remains available             | |
| +------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------+
```

**Mobile**

```text
+--------------------------------------+
| +----------------------------------+ |
| | Header | Team selector | Avatar  | |
| | Manage app | Team navigation      | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Manage compute                   | |
| | Suspend | Resume                 | |
| | Review the available action      | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Remove from Platfolio            | |
| | Railway resources stay with team | |
| | Review removal                   | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Instance state                   | |
| | Status | Project | Repository    | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Export                           | |
| | Revisions | Secret names         | |
| | Download sample export           | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Action review (when open)        | |
| | Effects on compute and data      | |
| | Workflow and provider access     | |
| | Affected apps | Blockers         | |
| | Confirm or cancel                | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Removal progress                 | |
| | Requested | Blocked | Confirmed  | |
| +----------------------------------+ |
| +----------------------------------+ |
| | After removal                    | |
| | Independent operation checklist  | |
| | Export remains available         | |
| +----------------------------------+ |
+--------------------------------------+
```

Review applies to the chosen action across the instance. Suspension retains data, and resume uses the retained configuration. In the mockup's handoff flow, removal leaves the stack running. The owner types the instance name to confirm the handoff and can reach the same route from Removed apps to export.

For keep-data and wipe-data removal, show the outcome in Manage app. Show Requested while the provider action is pending. If a dependent app blocks removal, show which app needs attention. Confirm keep-data removal after checking that the deployments stopped and the volumes remain. Confirm a wipe after checking that Railway deleted the project. See the [lifecycle scope in the sitemap](../../sitemap.md#instance-workspace).

## Status

`/dashboard/teams/:team/instances/:instance/status` · Later

**Desktop**

```text
+----------------------------------------------------------------------+
| Header | Team | Avatar                                               |
| App breadcrumb | Status | Team navigation                            |
| +-----------------------------------+  +---------------------------+ |
| | Service checks                    |  | Public page               | |
| | Service | Up/down | Last check   |  | Name | Color | Services  | |
| | Recent daily check history        |  | Preview | Publish         | |
| +-----------------------------------+  +---------------------------+ |
| | Outages and all updates           |  |                           | |
| | Ongoing or resolved | Visibility  |  |                           | |
| +-----------------------------------+  +---------------------------+ |
+----------------------------------------------------------------------+
```

**Mobile**

```text
+--------------------------------------+
| Header | Team | Avatar               |
| App breadcrumb | Status              |
| [Service checks | Daily history]     |
| [Outages | All updates | Visibility] |
| [Public page | Preview | Publish]    |
+--------------------------------------+
```

**Public visitor page**

`/status/:team/:instance` · Later

Service history and outage reports use the same daily chart and timeline as deployment activity in the [team workspace](team.md#team-instances). The visitor page uses a single-column layout on mobile and desktop. It shows the app's branding, overall status, the approved service checks, and any included outage reports. The owner can inspect this view before publishing. The local mockup publishes a snapshot in the same browser.
