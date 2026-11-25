# Team workspace

The team context applies to every list and operation here. Every team page uses the same navigation beneath the heading for Team workspace, Choose template, Activity, Members, and Team settings. Owners also see Connections and Publish template. Breadcrumbs on nested pages link to parents inside the team. Actions that require ownership stay subject to API policy. [Wireframe index](README.md)

## Private installation connections

`/dashboard/teams/:team/connections` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| [Platfolio]                                          [Team] [Avatar]   |
| Connections                                                            |
| [Team navigation]                                                      |
| Set up Platfolio                                                       |
| [Secret storage] [Status] [Owner key, recovery, and unlock actions]      |
| [Railway]        [Status] [Review and connect access after unlock]       |
| [Marketplace]   [Status] [One-time code or saved Starter Web release]    |
| [Set up Starter Web]                                                    |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+--------------------------------------+
| [Platfolio]         [Team] [Avatar]  |
| Connections                          |
| [Team navigation]                    |
| Set up Platfolio                      |
| [Secret storage] [Status]            |
| [Owner key and recovery actions]     |
| [Railway] [Status]                   |
| [Connect Railway]                    |
| [Marketplace] [Status]               |
| [Code or saved release]              |
| [Set up Starter Web]                 |
+--------------------------------------+
```

The owner saves the recovery files before unlocking secret storage. Railway access is stored in OpenBao when Railway confirms it. A marketplace connection saves the pinned Starter Web release for use in the private installation. The hub team's Connections page issues and revokes the marketplace code.

## Team instances

`/dashboard/teams/:team` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Header | Platfolio | Team | Avatar                                      |
| Team workspace | Member count | Your role                              |
| Workspace | Choose template | Activity | Members | Settings | Publish  |
| +-------------------------+  +---------------------------------------+ |
| | Apps                    |  | Deployment activity                   | |
| | Status | Repository     |  | Deployment checks in 14 days          | |
| | Open instance           |  | Recent runs | Open run details        | |
| +-------------------------+  +---------------------------------------+ |
| +-------------------------+  +---------------------------------------+ |
| | Removed apps            |  | Activity log                          | |
| | Owner export handoff    |  | Action | Actor | Time | Open target   | |
| +-------------------------+  +---------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+--------------------------------------+
| Header | Platfolio | Team | Avatar    |
| Team workspace | Member count | Role  |
| Team navigation                       |
| +----------------------------------+ |
| | Apps      | Status | Open        | |
| +----------------------------------+ |
| | Removed apps      | Handoff      | |
| +----------------------------------+ |
| | Deployment activity              | |
| | Verified runs | Open run          | |
| +----------------------------------+ |
| | Activity log | Open target       | |
| +----------------------------------+ |
+--------------------------------------+
```

Open an [instance](instance.md#instance-overview) for direct entry to its environment pages. Deployment activity counts verified runs and puts requests in the recent list with their own status. The log records recent hosting actions and links to each target. Open [Activity](#team-activity) for the complete timeline. An empty instance list links to [Create instance](#create-instance).

## Create instance

`/dashboard/teams/:team/create-instance` · MVP

### Template review

The picker opens with catalog search, filters, and template cards. Use template opens the connection step. Template details keeps the source commit and supported environments available for review.

**Desktop**

```text
+------------------------------------------------------------------------+
| [Header] [Team navigation]                                             |
| [Choose a template]                                                    |
| [Search | Category | Operating mode | Sort]                            |
| [Template cards | View details | Select template]                      |
| When selected                                                          |
| [Review template] [Template | Connections | Environments | Plan]       |
| [Selected template | Source repository | Source commit | Environments] |
| [Change template | View details | Continue to connections]             |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| [Header] [Team navigation]         |
| [Choose a template]                |
| [Search | Filters | Sort]          |
| [Template cards stacked]           |
| When selected                      |
| [Review template] [Setup steps]     |
| [Selected template and source]     |
| [Environments and listing terms]    |
| [Continue to connections]          |
+------------------------------------+
```

### Connections, environments, and deployment plan

The steps share `/create-instance?template=:template&step=...`. Configure staging and production for development templates, or production for hosted templates. Each environment has a deploy branch and shows the selected template's available non-secret settings.

**Desktop**

```text
+------------------------------------------------------------------------+
| [Header] [Team navigation]                                             |
| [Current step] [Template | Connections | Environments | Plan]           |
| Connections                                                            |
| [Instance name] [GitHub App and repository] [Railway workspace]         |
| [Configure environments]                                               |
| Environments                                                           |
| [Staging if declared: branch | setting] [Production: branch | setting] |
| [Review deployment plan]                                               |
| Deployment plan                                                        |
| [Template ref | Deployment repository | Railway workspace and project]  |
| [Resources and public access by environment]                           |
| [Credential names | Resolved references] [GitHub install PR handoff]    |
| [Edit connections | Edit environments | Back to team workspace]        |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| [Header] [Team navigation]         |
| [Current step] [Setup steps]        |
| Connections                        |
| [Instance name]                    |
| [GitHub App and repository]        |
| [Railway workspace]                |
| [Configure environments]           |
| Environments                       |
| [Staging if declared] [Branch]     |
| [Production] [Branch]              |
| [Non-secret settings]              |
| [Review deployment plan]           |
| Deployment plan                    |
| [Source and targets]               |
| [Planned resources by environment] |
| [Credentials and references]       |
| [GitHub install PR handoff]         |
| [Edit connections or environments] |
+------------------------------------+
```

The review shows the template source separately from the tenant deployment repository. The installation flow resolves and records the tenant source revision when rendering a real plan. The prototype stops at review. Once the API creates an instance record, its ongoing installation progress belongs in [Setup](instance.md#setup).

## Publish template

`/dashboard/teams/:team/publish-template` · Later · Owner view

**Desktop**

```text
+------------------------------------------------------------------------+
| [Header]                                                               |
| [Publish template]                                                     |
| [Team workspace | Choose template | Members | Settings | Publish]      |
| +--------------------------------+  +--------------------------------+ |
| | Listing details                |  | Listing preview                | |
| | Source platform and revision   |  | Name | Publisher | Description  | |
| | Name | Description             |  | Included materials             | |
| | Optional cover image           |  | Card header | Publisher | Date | |
| | Included materials             |  | Publish demo listing           | |
| +--------------------------------+  +--------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| [Header]                           |
| [Publish template]                 |
| [Team navigation buttons]          |
| +--------------------------------+ |
| | Listing details                | |
| | Platform and revision          | |
| | Name | Description             | |
| | Optional cover image           | |
| | Included materials             | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Listing preview                | |
| | Publisher | Inclusions         | |
| | Publish demo listing           | |
| +--------------------------------+ |
+------------------------------------+
```

The owner chooses a team platform with a source revision. The card header uses a gradient by default. The owner can preview and add an optional cover image, such as a screenshot. The detail listing carries the description and included materials shown in the preview.

## Team settings

`/dashboard/teams/:team/settings` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| | Team settings                                                      | |
| | Team navigation buttons                                            | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Team details                                                       | |
| | Name (stable URL prefix)                                           | |
| | Display name                                                       | |
| | Save changes (owner)                                               | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| | Team settings                  | |
| | Team navigation buttons        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Team details                   | |
| | Name (stable URL prefix)       | |
| | Display name                   | |
| | Save changes (owner)           | |
| +--------------------------------+ |
+------------------------------------+
```

Name is the stable route and instance address prefix. Owners can edit Display name. Members can view both fields.

## Members

`/dashboard/teams/:team/members` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| | Members                                                            | |
| | Team navigation buttons                                            | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Team tabs                                                          | |
| | Members | Invitations (owner)                                      | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Member list                                                        | |
| | Name | Username | Role                                             | |
| | Change role | Remove                                               | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Owner action review                                                | |
| | Team | Member | Proposed effect                                    | |
| | Confirm | Cancel                                                   | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| | Members                        | |
| | Team navigation buttons        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Team tabs                      | |
| | Members | Invitations (owner)  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Member list                    | |
| | Name | Username | Role         | |
| | Change role | Remove           | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Owner action review            | |
| | Team | Member | Proposed       | |
| | effect                         | |
| | Confirm | Cancel               | |
| +--------------------------------+ |
+------------------------------------+
```

Members can see the team roster and roles. Owners can use Change role or Remove beside each eligible member. At least one owner must remain. The mock team opens with Adrian Webb as Owner and Morgan Lee and Jamie Chen as Members. Team settings, roster reads, and member mutations are design targets for the mockup. See [the API contract](../../../apps/control-plane/openapi.yaml) for the existing operations.

### Invitations tab

`/dashboard/teams/:team/members?section=invitations` · Owner view · Add `&view=history` for History

**Desktop**

```text
+------------------------------------------------------------------------+
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| | Members                                                            | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Team tabs                                                          | |
| | Members | Invitations (owner)                                      | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Active | History                                                    | |
| | Active invitations                                                 | |
| | Email | Role | Expiry                                              | |
| | Created | State | Email delivery                                   | |
| | Preview email | Revoke pending                                     | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Invite member (owner)                                              | |
| | Email | Role | Send invitation                                     | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Demo email preview                                                 | |
| | Team | Target address                                              | |
| | Open sign-in / sign-up                                             | |
| +--------------------------------------------------------------------+ |
+------------------------------------------------------------------------+
```

**Mobile**

```text
+------------------------------------+
| +--------------------------------+ |
| | Header                         | |
| | Platfolio | Team | Avatar      | |
| +--------------------------------+ |
| | Members                        | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Team tabs                      | |
| | Members | Invitations (owner)  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Active | History               | |
| | Active invitations             | |
| | Email | Role | Expiry          | |
| | Created | State | Email status | |
| | Preview email | Revoke pending | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Invite member (owner)          | |
| | Email | Role | Send invitation | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Demo email preview             | |
| | Team | Target address          | |
| | Open sign-in / sign-up         | |
| +--------------------------------+ |
+------------------------------------+
```

History uses the same list on both sizes. It shows revoked, expired, and accepted entries with creation time and email status. Owners can preview an available email from History. Revoke and Invite member are Active actions.

An owner can invite an email address before its holder has an account. The invitation record and delivery outcome are separate. The recipient signs in or creates an account, verifies the addressed primary email, then accepts in [My invitations](account.md#my-invitations). Opening or forwarding the email alone grants no membership. The mockup prepares a local email preview.

## Connections

`/dashboard/teams/:team/connections` · MVP

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Connections                                                        | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | GitHub connection                                                  | |
| | App access | Authorized repositories                               | |
| | Authorize at GitHub | Revoke access                                | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Railway connection                                                 | |
| | Tenant workspace | Authorization state                             | |
| | Authorize at provider | Revoke access                              | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Custody summary                                                    | |
| | Managed grant | Self-custody runner                                | |
| | What Platfolio can verify                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Action review (when needed)                                        | |
| | Connection | Team | Affected instances                             | |
| | Review impact | Confirm or back                                    | |
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
| | Connections                    | |
| +--------------------------------+ |
| +--------------------------------+ |
| | GitHub connection              | |
| | App access | Authorized        | |
| | repositories                   | |
| | Authorize at GitHub | Revoke   | |
| | access                         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Railway connection             | |
| | Tenant workspace |             | |
| | Authorization state            | |
| | Authorize at provider | Revoke | |
| | access                         | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Custody summary                | |
| | Managed grant | Self-custody   | |
| | runner                         | |
| | What Platfolio can verify      | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Action review (when needed)    | |
| | Connection | Team | Affected   | |
| | instances                      | |
| | Review impact | Confirm or     | |
| | back                           | |
| +--------------------------------+ |
+------------------------------------+
```

Authorized connections feed the repository and workspace selection in [Create instance](#create-instance). Revalidate access after returning from the provider.

## Team activity

`/dashboard/teams/:team/activity` · Later

**Desktop**

```text
+------------------------------------------------------------------------+
| Desktop screen                                                         |
| +--------------------------------------------------------------------+ |
| | Header                                                             | |
| | Platfolio | Team | Avatar                                          | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Team activity                                                      | |
| +--------------------------------------------------------------------+ |
| +--------------------------------------------------------------------+ |
| | Split                                                              | |
| | +------------------------------+  +------------------------------+ | |
| | | Stack                        |  | Context rail                 | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | | Audit list               | |  | | Audit detail             | | | |
| | | | Time | Actor | Action |  | |  | | Target | Result | Reason | | | |
| | | | Outcome                  | |  | | Open authorized instance | | | |
| | | | Open event               | |  | | or environment           | | | |
| | | +--------------------------+ |  | +--------------------------+ | | |
| | | +--------------------------+ |  +------------------------------+ | |
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
| | Team activity                  | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Audit list                     | |
| | Time | Actor | Action |        | |
| | Outcome                        | |
| | Open event                     | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Observation status             | |
| | Source | Age                   | |
| +--------------------------------+ |
| +--------------------------------+ |
| | Open event details             | |
| | Opens details sheet            | |
| +--------------------------------+ |
| When opened                        |
| +--------------------------------+ |
| | Details sheet                  | |
| | +----------------------------+ | |
| | | Audit detail               | | |
| | | Target | Result | Reason   | | |
| | | Open authorized instance   | | |
| | | or environment             | | |
| | +----------------------------+ | |
| +--------------------------------+ |
+------------------------------------+
```

The event view links only to resources the signed-in person may access. The audit record describes actions and outcomes without credential values.
