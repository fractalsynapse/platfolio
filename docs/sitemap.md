# Platfolio site map

This map describes the route design for the free private-hosting milestone. The hub offers marketplace browsing, private Platfolio launch, and team administration. Private workspaces manage apps, instances, and environments. The [interactive mockup](design/mockup/README.md) and [wireframes](design/wireframes/README.md) show the remaining workflows.

## What the site is for

The hub launches private Platfolio installations and provides a catalog of public, pinned templates. Each installation manages its own teams, apps, deployment data, Keycloak, and OpenBao. In Railway, `platfolio` and each hosted app get separate projects in the customer's workspace. Teams keep control of their code, hosting, domains, and data. See the [hub and private installation design](design/18-hub-and-private-installations.md).

Navigation follows the [object model](design/17-object-model.md).

- A **person** signs in and can belong to several teams.
- A **team** owns instances and is the boundary for access and connections.
- An **instance** is addressed as `team/name`. It records the template source, tenant repository, provider project, and dependencies. A shared identity service is an instance that offers a capability.
- An **environment** is the target of a deployment or configuration change. Its health, revision, services, and domains are shown in that context.

The Platfolio menu groups platform links above team links. The avatar menu contains Account, Your teams, and Invitations with the pending count. A breadcrumb links back to parent pages.

## Public site and account

**MVP** marks a destination used in the acceptance journey. **Later** marks a dedicated page that can follow MVP. Where an MVP flow needs some of that page's information, the table identifies where it appears first.

| Path | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Explain what Platfolio manages and what the team owns. Link to sign-in and the hosting guide. |
| `/templates` | Later | Search by name, publisher, or capability. Filter by category and operating mode, and compare cards by capabilities, public access, environments, and update date. The MVP template picker reuses the cards. |
| `/templates/:template` | Later | Show the publisher, reviewed source, service shape, prerequisites, and capabilities the template provides or requires. Start setup with the template selected. The instance records the resolved source commit. |
| `/docs` | MVP | Give users the minimum guidance to connect, operate, and leave Platfolio. |
| `/docs/self-host` | MVP | Explain how to run a supported platform locally with Docker Compose from the same manifest, including how to verify a standalone restore. |
| `/docs/api` | Later | Provide a web reference derived from the OpenAPI contract. |
| `/sign-in` | MVP | Open dashboard sign-in. Direct dashboard links return to their authorized destination after Keycloak sign-in. Account creation appears when the operator realm enables it. |
| `/callback` | MVP | Complete the browser sign-in exchange and open the requested dashboard route with the in-memory session available to the dashboard. |
| `/dashboard` | MVP | Show the signed-in person's teams and give a new user a clear path to create one. Surface invitations when that flow is enabled. |
| `/dashboard/create-team` | MVP | Create a team and establish its slug and initial owner. Continue to instance setup. |
| `/dashboard/launch` | MVP | Show setup progress, prerequisites, and a downloadable diagnostic report. On the hub, prepare and enroll a private installation. On the private workspace, launch the pinned free app once the customer has connected Railway. |
| `/dashboard/invitations` | Later | Show and accept invitations matched to the person's verified email before team membership exists. |
| `/dashboard/notifications` | Private | Create and manage personal rules for apps on the signed-in person’s teams, with an event type, environment scope, and email delivery settings. |
| `/dashboard/account` | Both | Edit your username, display name and HTTPS avatar image URL. |
| `/dashboard/account/emails` | Both | Show your primary email. The public account policy adds self-service verification and verified secondary addresses that can be made primary. |
| `/dashboard/account/password` | Both | Ask Keycloak to send a reset link to the verified primary address. |
| `/dashboard/account/notifications` | Both | Show email delivery availability. Private workspaces also link to app notification rules. |

Use the [published template catalog](../packages/manifest/src/template-catalog.ts) as the source for template content. The account and sign-in routes are for Platfolio operators. Tenant applications use their own configured identity systems. See the [identity architecture](design/05-identity.md).

Publishing teams can share a reusable platform with a source revision, an optional cover, and a description of the included materials. The current hosting scope defers template sales, paid publisher management, and subscription flows.

The Platfolio authentication theme covers sign-in, account creation, recovery, and email verification when those steps are handled by Keycloak. The local mockup gives each screen a preview route.

## Team workspace

Paths in this table are relative to `/dashboard/teams/:team`. The team pages share a navigation bar beneath their headings. The Platfolio menu also links to Team workspace. Breadcrumbs appear on nested pages and link to their parents within the team, such as the instance above an environment.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Show the team's activity. On the hub, owners can open private installation management. In a private workspace, show instances and deployment activity. |
| `/create-instance` | Private | Choose a template and a pinned release. Continue to setup in the private workspace. |
| `/publish-template` | Later | Let a team owner select a source platform and revision, describe the included materials, and preview the listing before publishing. |
| `/members` | Later | Show the roster and roles. Owners can review role changes and removals. The owner-only Invitations tab separates active invitations from history and shows email status in both views. |
| `/settings` | Later | Show the stable URL Name first and the editable Display name below it. |
| `/connections` | MVP | Set up owner-controlled OpenBao, connect Railway, and connect the marketplace in a private installation. On the hub, issue and revoke private installation codes. Ask for a GitHub App connection when the team chooses to deploy from a private repository. |
| `/activity` | Later | Show the full team activity timeline beyond the profile preview. Link to authorized deployment, environment, and lifecycle views. The backend audit trail is required for operations from the start. |

The selected repository and Railway project are visible on the instance. The installation keeps its Railway authorization local. Unlinking from the hub ends registry access and leaves the private workspace and apps available.

## Instance workspace

Paths in this table are relative to `/dashboard/teams/:team/instances/:instance`. Instance and environment pages require a private workspace with a visible instance.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Show the instance's template and source commit, repository, provider project, and state of each environment. Surface the most relevant next action. |
| `/setup` | MVP | Resume the connection and first deploy. Show the reviewable install PR, approvals, plan validation, workflow progress, and first verification. Link blockers to the exact step or environment that needs attention. |
| `/dependencies` | Later | Show what the instance consumes and provides, explicit shares, and affected consumers. Include shared identity bindings when managed team realms are supported. |
| `/status` | Later | Show whether app services are up, current check times, recent outages, and their updates. Owners can preview and publish a branded page with selected production services and approved outage reports. |
| `/lifecycle` | MVP | Show the effects of suspending, resuming, exporting, or removing a platform. Offer explicit keep-data and wipe-data actions where supported. A retained project keeps its storage for restore. A wipe requires confirmation and schedules storage for deletion under the provider's recovery policy. |

Keep the Lifecycle route available to the authorized owner during the documented export window after management ends. Include the applied configuration, secret names, data export and restore instructions, and the steps to run independently. Ejection and audit stay available under the [target architecture's access guarantees](design/00-target-architecture.md#2-invariants). See the [ejection design](design/06-billing-and-lifecycle.md).

### Public app status

`/status/:team/:instance` · Later. Show the team's display name and colors, the checks for selected services, and outage updates approved for public view. The page opens without an account and remains private until a team owner publishes it. Keep staging, provider details, and team-only reports on the internal Status page. Continuous checks and publication need production data and authorization before implementation.

## Environment workspace

Paths in this table are relative to `/dashboard/teams/:team/instances/:instance/environments/:environment`.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Show services, observed health, desired and applied revisions, and the latest deployment result for this environment, with its GitHub run and commit check. Show when and how each result was observed. |
| `/deployments` | Later | Show full deployment history for the environment. Add confirmed manual deploy or redeploy actions when their APIs and provider wiring support them. |
| `/deployments/:dispatchId` | Later | Link directly to a deployment record with the requested action, plan and artifact identity, GitHub run, reported result, and provider verification. |
| `/configuration` | MVP | List every required secret by name. Report presence separately and show a green verification check only after the deployed service is verified healthy. Guide users to configure values in their provider or runner. Let the team configure its own OIDC issuer for the tenant application. Offer write-only secret delivery when supported. |
| `/domains` | MVP | For services with public endpoints, show generated URLs and let the team attach a custom hostname for the environment. Show the exact copyable DNS records returned by the provider, including the required verification TXT. Track DNS verification and certificate issuance separately, and show when HTTPS is ready. |

A production link contains `/environments/production` even when the operator last viewed staging. Use the environment declared in the plan and show it in action confirmations. See [domains and DNS](design/12-domains-and-dns.md) and the [OpenAPI contract](../apps/control-plane/openapi.yaml).

Bring-your-own OIDC satisfies the MVP identity criterion. Preserve native authentication for platforms that declare it. Managed team realms and shared-realm setup follow MVP under [identity decision OI1](design/05-identity.md#identity-decisions-accepted-2026-11-07).

## Navigation and UI constraints

- In the dashboard header, the logo opens navigation, one Team selector sets the active workspace, and the avatar opens Account, Notifications, and Log out. The page title follows the header. A Platfolio workspace is the view of a team. Railway workspaces remain provider resources.
- Keep Astro for the site and one React island for the dashboard (D65). The static host serves the dashboard shell for direct visits. After the callback exchange, open the intended route without a reload so the dashboard keeps the in-memory session. On a hard reload, try one non-interactive sign-in and offer the sign-in screen if the issuer needs user interaction (D67).
- Use full pages for durable destinations and sheets for short actions such as inviting a member or entering a secret. Use the same component contracts at every supported width. Keep secret values out of URLs, drafts, replayed signals, and page documents.
- Compose template-specific views with the build-time component registry. A worker can omit Domains and a shared identity instance can emphasize Dependencies. The [open UI decisions](design/11-ui-components-and-page-model.md#open-decisions) still govern where template-specific page documents are authored.
- Name actions and results in terms a first-time founder can use. Use deployment checks for the result and explain what was checked. Keep exact terms such as GitHub commit and DNS record where someone needs them to act.
- Use the generated SDK for dashboard data and a single freshness primitive. Ship with polling, show the source and age of observations, and keep the same routes when D64's event transport lands. Distinguish pending work, reported failure or partial application, unavailable verification, and verified success.
- Authorize reads and mutations through the API and resolve route slugs in the signed-in person's scope. Give an authorized member actionable role feedback where policy allows. A URL alone grants no access.

See the [normative UI rules](ui-architecture.md), [UI framework specification](design/11-ui-components-and-page-model.md), and [decision register](design/01-product-and-decisions.md#decision-register).

## MVP delivery and acceptance

1. **Sign in and create a team.** Verify registration and recovery by email. Open a nested environment URL without a session, sign in, and confirm the browser returns to the same authorized destination. Confirm a user from another team cannot read it.
2. **Launch a private installation.** An owner connects their Railway workspace and launches `platfolio`. The setup page reports the health of the site, API, and Keycloak and confirms authenticated worker access to OpenBao before enabling app secret delivery. Verify the owner can recover OpenBao independently and enroll with the hub once.
3. **Deploy the pinned free app.** Claim Starter Web and verify that `starter-web` has its own project, healthy service, and database. Show each setup step, actionable failures, and a diagnostic report that excludes secret values.
4. **Stay independent and restore data.** Unlink from the hub and verify local sign-in and the installed app. Save a test record, keep data during removal, restore the app, and read the same record. Verify that only the approved app project is in scope for a separately confirmed wipe.

The [product acceptance criteria](design/01-product-and-decisions.md#mvp-scope-observable) and [delivery plan](design/09-delivery-plan.md) record the broader roadmap. This route map describes the current hosting slice. The route map already has API building blocks for teams, instances, plan registration, dispatches, instance-wide latest attestations, and bindings. The environment overview needs an environment-scoped deployment result, including its GitHub run and commit check. Resumable installation, custom-domain attachment, and the lifecycle actions also need contract or integration work. Live secret delivery and redeploy need hosted provider wiring. Design new operations in OpenAPI before exposing their controls.
