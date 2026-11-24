# Platfolio wireframes

These desktop and mobile layouts cover the routes in the [sitemap](../../sitemap.md). MVP routes are marked in the index. The authentication screens and the Account tabs also have their own wireframes. The [mockup](../mockup/README.md) previews the header, account, and team flows.

## How to read the boxes

- The outer box is the screen. Inner boxes name navigation, layout containers, and components. Labels inside a component identify the information or actions it contains.
- On desktop, a split shows the main stack beside a contextual rail. On mobile, a labeled control opens the same rail content in a sheet. A diagram marked **When opened** shows an alternate state within the same screen. Multiple sheets on one diagram are shown as separate states.
- Short forms use the page-level sheet on mobile and a dialog on desktop. Keep an equivalent action on both sizes. Long workflows and consequential action reviews use the full page.
- The workspace scope comes from the route. The same team, instance, and environment stay visible when an action is reviewed. All server-derived status includes its observation source and age. Component labels are candidates for planning.
- Navigation shows the destinations available to the person and scope. Account, Members, Activity, and dedicated deployment history appear when those routes are enabled.

See the [UI rules](../../ui-architecture.md) and [layout contract](../11-ui-components-and-page-model.md#2-layout-contract).

## Workspace header

The same order applies on desktop and mobile. A small breadcrumb below the header links to available parent pages. Within a team, it appears on nested pages and shows their parents inside the workspace. The Team selector reflects the active Platfolio workspace. Choose a team to open its workspace, or use the Platfolio popup for navigation within the selected team. An account without a membership shows No team.

```text
+-----------------------------------------------+
| [Platfolio menu] [Team selector] [User avatar] |
+-----------------------------------------------+
[Breadcrumb when applicable]

  Platfolio menu     Team selector    User menu
  [Home]             [Active team]    [Account]
  [Templates]        [Other teams]    [Your teams]
  ----------------                    [Invitations (count)]
  [Team workspace]                    [Log out]
  [Other team destinations]
```

## Components to reuse

| Area | Reuse from the current UI | Components to draft |
| --- | --- | --- |
| Workspace navigation | `context.switcher` for scoped selection | Shared header with the logo popup, Team selector, and avatar popup |
| Instance and environment status | `instance.list`, `instance.row`, `instance.state`, `instance.detail`, and `freshness.label` | Environment rows, service status rows, setup blockers, and source or revision summaries |
| Deployment evidence | The latest attestation presentation in `instance.detail` | A common Deployment result for setup, environment overview, history, and run record. Environment-scoped reads and GitHub links need contract work. |
| Lists and details | The existing instance master-detail placement | Shared list and detail layout for teams, invitations, domains, runs, and events. Keep resource-specific fields in their own components. |
| Setup and verification | The existing freshness component for observed evidence | Step checklist, blocker with next action, outcome, DNS records, and required-secret checklist |
| Forms and consequence review | The layout primitives and declarative component contracts | Form fields and validation, sheet or dialog host, and action review that names the target and its effects. Keep operation-specific fields and confirmations visible. |
| Public and guide content | Astro shell and existing content layout primitives | Public navigation, template summary, guide contents, and reference block |

Use the existing generated SDK and build-time component registry. Treat component names in these drafts as proposals. See the [OpenAPI contract](../../../apps/control-plane/openapi.yaml) and the [open UI decisions](../11-ui-components-and-page-model.md#open-decisions).

## Walk through the workflows

| Workflow | Route sequence and evidence |
| --- | --- |
| Sign in and create a team | [Sign-in](public.md#sign-in) → [Callback](public.md#callback) → [Team selection](account.md#team-selection) → [Create team](account.md#create-team). A deep link returns to its authorized target after sign-in. |
| Install and verify | [Connections](team.md#connections) → [Create instance](team.md#create-instance) → [Setup](instance.md#setup) → [Environment overview](environment.md#environment-overview). The tenant reviews the install PR in GitHub and follows the first verified run. Setup links back to the exact blocking step. |
| Operate an environment | [Environment overview](environment.md#environment-overview) → [Configuration](environment.md#configuration) or [Domains](environment.md#domains) → overview. Show secret presence separately from verified health. Show DNS, certificate, and HTTPS readiness independently. An ordinary push updates the matching environment and GitHub commit check. |
| Export and hand off | [Lifecycle](instance.md#lifecycle) → [Compose and restore guide](public.md#compose-and-restore-guide). Review suspend, resume, and removal. The owner can export from the handoff page after management ends. |
| Collaborate and inspect | An owner invites an address from [Members](team.md#invitations-tab). The recipient verifies that primary email, accepts from [My invitations](account.md#my-invitations), and opens [Team instances](team.md#team-instances). [Team settings](team.md#team-settings) shows the stable URL Name and the editable Display name. |

The layouts show the intended workflow. Delivery dependencies and the ten criteria remain in the [sitemap acceptance section](../../sitemap.md#mvp-delivery-and-acceptance).

## Route index

### [Public site and sign-in](public.md)

- [Landing](public.md#landing) · MVP
- [Template catalog](public.md#template-catalog) · Later
- [Template detail](public.md#template-detail) · Later
- [Guides](public.md#guides) · MVP
- [Compose and restore guide](public.md#compose-and-restore-guide) · MVP
- [API reference](public.md#api-reference) · Later
- [Sign-in](public.md#sign-in) · MVP
- [Sign-up](public.md#sign-up), [Recovery](public.md#password-recovery), [Reset](public.md#password-reset), [Email verification](public.md#email-verification) · Themed authentication screens
- [Callback](public.md#callback) · MVP

### [Account and team selection](account.md)

- [Team selection](account.md#team-selection) · MVP
- [Create team](account.md#create-team) · MVP
- [My invitations](account.md#my-invitations) · Later
- [Account](account.md#account) · Later
  - [Profile](account.md#profile-tab), [Emails](account.md#emails-tab), [Password](account.md#password-tab), [Notifications](account.md#notifications-tab)

### [Team workspace](team.md)

- [Team instances](team.md#team-instances) · MVP
- [Create instance](team.md#create-instance) · MVP
- [Publish template](team.md#publish-template) · Later
- [Members](team.md#members) · Later
- [Team settings](team.md#team-settings) · Later
- [Connections](team.md#connections) · MVP
- [Team activity](team.md#team-activity) · Later

### [Instance workspace](instance.md)

- [Instance overview](instance.md#instance-overview) · MVP
- [Setup](instance.md#setup) · MVP
- [Dependencies](instance.md#dependencies) · Later
- [Lifecycle](instance.md#lifecycle) · MVP

### [Environment workspace](environment.md)

- [Environment overview](environment.md#environment-overview) · MVP
- [Deployment history](environment.md#deployment-history) · Later
- [Deployment record](environment.md#deployment-record) · Later
- [Configuration](environment.md#configuration) · MVP
- [Domains](environment.md#domains) · MVP
