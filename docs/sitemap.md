# Platfolio site map

**Proposed design.** This document describes the intended web experience and the minimum pages needed to demonstrate the [MVP acceptance criteria](design/01-product-and-decisions.md#mvp-scope-observable). The current site has a public landing page, a read-only instance viewer at `/dashboard`, and a technical `/callback` route. Completing the browser sign-in journey is part of MVP.

## What the site is for

Platfolio helps a team connect and operate a supported platform on infrastructure the team owns. The team connects its repository and provider workspace, reviews the install PR, and sees what its workflow applied. It can then operate each environment, share services, and export the stack to run independently. The tenant keeps its repository, infrastructure, domains, and data throughout. See the [target architecture](design/00-target-architecture.md) and [GitHub execution design](design/04-execution-plane-github-workflows.md).

Navigation follows the [object model](design/17-object-model.md).

- A **person** signs in and can belong to several teams.
- A **team** owns instances and is the boundary for access, connections, and the management subscription.
- An **instance** is addressed as `team/name`. It records the template source, tenant repository, provider project, and dependencies. A shared identity service is an instance that offers a capability.
- An **environment** is the target of a deployment or configuration change. Its health, revision, services, and domains are shown in that context.

## Public site and account

**MVP** marks a destination used in the acceptance journey. **Later** marks a dedicated page that can follow MVP. Where an MVP flow needs some of that page's information, the table identifies where it appears first.

| Path | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Explain what Platfolio manages and what the team owns. Link to sign-in and the hosting guide. |
| `/templates` | Later | Browse supported starting points, including the web, worker, and shared identity templates. The MVP setup flow includes a template picker. |
| `/templates/:template` | Later | Show the source repository, service shape, prerequisites, and capabilities the template provides or requires. Start setup with the template selected. The instance records the resolved source commit. |
| `/docs` | MVP | Give users the minimum guidance to connect, operate, and leave Platfolio. |
| `/docs/self-host` | MVP | Explain how to run a supported platform locally with Docker Compose from the same manifest, including how to verify a standalone restore. |
| `/docs/api` | Later | Provide a web reference derived from the OpenAPI contract. |
| `/sign-in` | MVP | Start Keycloak sign-in and preserve the intended in-site destination. Include an account-creation path for new users. |
| `/callback` | MVP | Complete the browser sign-in exchange and return to the intended dashboard destination with the session available to the dashboard. |
| `/dashboard` | MVP | Show the signed-in person's teams and give a new user a clear path to create one. Surface invitations when that flow is enabled. |
| `/dashboard/create-team` | MVP | Create a team and establish its slug and initial owner. Continue to subscription or setup as appropriate. |
| `/dashboard/invitations` | Later | Show and accept invitations matched to the person's verified email before team membership exists. |
| `/dashboard/account` | Later | Show the current person and their sign-in identities. Link to supported identity-provider account actions. |

Use the [published template catalog](../packages/manifest/src/template-catalog.ts) as the source for template content. The account and sign-in routes are for Platfolio operators. Tenant applications use their own configured identity systems. See the [identity architecture](design/05-identity.md).

## Team workspace

Paths in this table are relative to `/dashboard/teams/:team`.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | List the team's instances with environment status and the next step for any blocked setup. This is the home for the current instance list. |
| `/create-instance` | MVP | Choose a template and tenant repository, name the instance, and review the target workspace and environments. Continue to the instance's setup page once its record exists. |
| `/members` | Later | Show membership and roles. Give owners invitation controls and show whether invitations were sent. |
| `/connections` | MVP | Connect the GitHub App and the tenant's Railway workspace. Show granted access, where the provider credential lives, what can be verified, and how to revoke the connection. |
| `/activity` | Later | Show the team audit trail with links to authorized instances and environments. The backend audit trail is required for operations from the start. |
| `/billing` | MVP | Subscribe to the management plan, see instance limits and billing state, and manage cancellation. Direct users to the instance's export path and show the applicable access window. Railway charges remain with the provider. |

Team connections are reusable during onboarding. The selected repository and Railway project are visible on the instance. In managed mode, Platfolio holds a provider grant and the broker refuses reads of secret values. In self-custody the team retains the provider grant and runs privileged operations in its own pipeline. See [custody tiers](design/04-execution-plane-github-workflows.md#custody-tiers-and-what-the-runner-is-for-d24) and [billing and lifecycle](design/06-billing-and-lifecycle.md).

## Instance workspace

Paths in this table are relative to `/dashboard/teams/:team/instances/:instance`.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Show the instance's template and source commit, repository, provider project, and state of each environment. Surface the most relevant next action. |
| `/setup` | MVP | Resume the connection and first deploy. Show the reviewable install PR, approvals, plan validation, workflow progress, and first verification. Link to the exact step or environment that needs attention. |
| `/dependencies` | Later | Show what the instance consumes and provides, explicit shares, and affected consumers. Surface any binding the MVP identity setup needs within `/setup` or the relevant environment's configuration. |
| `/lifecycle` | MVP | Export the stack and guide the owner through leaving Platfolio. Show what keeps running, what is retained, and which dependencies block removal. Full managed teardown can follow the MVP export and eject flow. When available, show its requested and verified outcomes distinctly. |

Make export available before cancellation and during the documented access window. Include the applied configuration, secret names, data export and restore instructions, and the steps to run independently. Ejection and audit stay available under the [target architecture's access guarantees](design/00-target-architecture.md#2-invariants). See the [ejection design](design/06-billing-and-lifecycle.md).

## Environment workspace

Paths in this table are relative to `/dashboard/teams/:team/instances/:instance/environments/:environment`.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Show services, observed health, desired and applied revisions, and the latest runner result for this environment. Show when and how the state was observed. |
| `/deployments` | MVP | Show the latest deploy and its GitHub run and commit check. Add full history and confirmed manual deploy or redeploy actions when their APIs and provider wiring support them. |
| `/deployments/:dispatchId` | Later | Link directly to a deployment record with the requested action, plan and artifact identity, GitHub run, reported result, and provider verification. |
| `/configuration` | MVP | Show the environment's settings, required secret names, and application identity mode. Distinguish presence from healthy behavior. Guide users to complete configuration in their provider or runner. Show a write-only delivery form where supported. |
| `/domains` | MVP | For services with public endpoints, show generated URLs and the provider's required DNS records, including TXT verification. Track DNS verification and certificate issuance separately. |

A production link contains `/environments/production` even when the operator last viewed staging. Use the environment declared in the plan and show it in action confirmations. See [domains and DNS](design/12-domains-and-dns.md) and the [OpenAPI contract](../apps/control-plane/openapi.yaml).

## Navigation and UI constraints

- Keep Astro for the site and one React island for the dashboard (D65). Direct links to tenant routes must work on a fresh page load, and post-sign-in navigation must preserve the session under the in-memory token policy (D67).
- Use full pages for durable destinations and sheets for short actions such as inviting a member or entering a secret. Use the same component contracts at every supported width. Keep secret values out of URLs, drafts, replayed signals, and page documents.
- Compose template-specific views with the build-time component registry. A worker can omit Domains and a shared identity instance can emphasize Dependencies. The [open UI decisions](design/11-ui-components-and-page-model.md#open-decisions) still govern where template-specific page documents are authored.
- Use the generated SDK for dashboard data. Ship with polling and show observation age. A deployment request stays pending until the runner reports and the relevant verification succeeds. Keep partial application and unavailable verification visible.
- Authorize reads and mutations through the API and resolve route slugs in the signed-in person's scope. Give an authorized member actionable role feedback where policy allows. A URL alone grants no access.

See the [normative UI rules](ui-architecture.md), [UI framework specification](design/11-ui-components-and-page-model.md), and [decision register](design/01-product-and-decisions.md#decision-register).

## MVP delivery and acceptance

1. **Sign in and navigate.** Finish browser sign-in, team creation and selection, and deep links. Reuse the current instance viewer for team, instance, and environment pages. Verify that an operator opening an environment URL can sign in and land on that environment.
2. **Install and verify one real tenant instance.** From Connections and Create Instance, connect the tenant's GitHub repository and Railway workspace, review the install PR in GitHub, and follow the first verified deploy in Setup. Verify staging and production, services, a database, and reachable generated domains. Exercise an ordinary push and see the result in both GitHub and the environment's deployment view.
3. **Complete the remaining MVP journeys.** Subscribe at team level, verify the required-secret checklist and supported tenant identity setup, and attach a custom domain through the DNS panel. Cancel, export, and restore the stack independently. Run the same manifest locally with Docker Compose.

The [product acceptance criteria](design/01-product-and-decisions.md#mvp-scope-observable) and [delivery plan](design/09-delivery-plan.md) define MVP. The route map already has API building blocks for teams, instances, plan registration, dispatches, latest attestations, and bindings. Resumable installation, GitHub commit checks, domain management, billing, and export still need contract or integration work. Live secret delivery and redeploy also need hosted provider wiring. Design new operations in OpenAPI before exposing their controls.
