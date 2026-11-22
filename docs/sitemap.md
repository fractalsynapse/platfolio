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
| `/callback` | MVP | Complete the browser sign-in exchange and open the requested dashboard route with the in-memory session available to the dashboard. |
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
| `/billing` | MVP | Subscribe to the management plan, see instance limits and billing state, and manage cancellation. Show what a cancellation does to managed operations, the remaining export window, and a link to each affected instance's Lifecycle page. Railway charges remain with the provider. |

Team connections are reusable during onboarding. The selected repository and Railway project are visible on the instance. In managed mode, Platfolio holds a provider grant and the broker refuses reads of secret values. In self-custody the team retains the provider grant and runs privileged operations in its own pipeline. See [custody tiers](design/04-execution-plane-github-workflows.md#custody-tiers-and-what-the-runner-is-for-d24) and [billing and lifecycle](design/06-billing-and-lifecycle.md).

## Instance workspace

Paths in this table are relative to `/dashboard/teams/:team/instances/:instance`.

| Path suffix | Scope | Purpose |
| --- | --- | --- |
| `/` | MVP | Show the instance's template and source commit, repository, provider project, and state of each environment. Surface the most relevant next action. |
| `/setup` | MVP | Resume the connection and first deploy. Show the reviewable install PR, approvals, plan validation, workflow progress, and first verification. Show when the subscription, entitlement, or instance limit blocks activation and link to Billing. Link other blockers to the exact step or environment that needs attention. |
| `/dependencies` | Later | Show what the instance consumes and provides, explicit shares, and affected consumers. Include shared identity bindings when managed team realms are supported. |
| `/lifecycle` | MVP | Export the stack and guide the owner through leaving Platfolio. Explain what happens to compute, data, workflows, and provider access. Distinguish suspending managed compute with data retained from ejecting a stack that keeps running. Show dependency blockers and the verified outcome of each action. Full managed teardown can follow MVP. |

Give the authorized owner access to the same Lifecycle route before cancellation and throughout the documented export window after paid management access ends. Include the applied configuration, secret names, data export and restore instructions, and the steps to run independently. Ejection and audit stay available under the [target architecture's access guarantees](design/00-target-architecture.md#2-invariants). See the [ejection design](design/06-billing-and-lifecycle.md).

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

- Keep Astro for the site and one React island for the dashboard (D65). The static host must serve the dashboard shell for direct visits to tenant paths. After the callback exchange, open the intended in-site route without a document reload so the dashboard can use the in-memory session. A hard reload triggers sign-in again and returns to the same authorized route under D67.
- Use full pages for durable destinations and sheets for short actions such as inviting a member or entering a secret. Use the same component contracts at every supported width. Keep secret values out of URLs, drafts, replayed signals, and page documents.
- Compose template-specific views with the build-time component registry. A worker can omit Domains and a shared identity instance can emphasize Dependencies. The [open UI decisions](design/11-ui-components-and-page-model.md#open-decisions) still govern where template-specific page documents are authored.
- Use the generated SDK for dashboard data and a single freshness primitive. Ship with polling, show the source and age of observations, and keep the same routes when D64's event transport lands. Distinguish pending work, reported failure or partial application, unavailable verification, and verified success.
- Authorize reads and mutations through the API and resolve route slugs in the signed-in person's scope. Give an authorized member actionable role feedback where policy allows. A URL alone grants no access.

See the [normative UI rules](ui-architecture.md), [UI framework specification](design/11-ui-components-and-page-model.md), and [decision register](design/01-product-and-decisions.md#decision-register).

## MVP delivery and acceptance

1. **Sign in and subscribe (criterion 1).** In a browser without a session, open a nested environment URL directly on the static host, sign in, and confirm authenticated data loads at that URL. Hard-reload it and verify that signing in again returns to the same destination. Exercise new account signup, team creation, and subscription. Confirm the control plane requires an active or trialing plan, the relevant entitlement, and available instance capacity before reporting an active instance.
2. **Install and verify one real tenant instance (criteria 2–5).** Authorize the GitHub App for the tenant's repository and connect Railway. Confirm Platfolio opens one reviewable install PR with the managed workflow files and targets a project in the tenant's workspace. Follow the first verified deploy in Setup. Verify staging and production, services, a database, and reachable generated domains. Check the environment overview shows what was applied and why. Push through the normal branch workflow and check the GitHub commit status and matching environment overview. Run staging after production and confirm the production overview still shows its own latest result.
3. **Configure and verify the deployed environment (criteria 6–8).** Confirm that setting a required secret reports presence without turning the health-gated check green. Verify the deployed service becomes healthy before the check turns green. Configure the tenant's OIDC issuer and verify sign-in to the deployed application. Attach a custom domain, publish the provider's DNS records including the TXT, and verify HTTPS works after the certificate is issued.
4. **Leave and restore independently (criteria 9–10).** Cancel the management subscription, reach Lifecycle as an authorized owner within the export window, and export the applied stack and data restore instructions. Follow the instructions and verify the stack can run without Platfolio. Run the same manifest locally with Docker Compose.

The [product acceptance criteria](design/01-product-and-decisions.md#mvp-scope-observable) and [delivery plan](design/09-delivery-plan.md) define MVP. The route map already has API building blocks for teams, instances, plan registration, dispatches, instance-wide latest attestations, and bindings. The environment overview needs an environment-scoped deployment result, including its GitHub run and commit check. Resumable installation, custom-domain attachment, billing, and post-cancellation export also need contract or integration work. Live secret delivery and redeploy need hosted provider wiring. Design new operations in OpenAPI before exposing their controls.
