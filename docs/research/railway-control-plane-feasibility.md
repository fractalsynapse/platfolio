# Railway control-plane feasibility — API, handover, reselling

Date: 2026-11-07. Research question for platfolio: an open-source control plane that sells managed
hosting (Stripe) and provisions **each customer's stack as its own Railway project inside platfolio's
own workspace/team** (staging + production, custom domains, later handover to the customer).

Tag legend: **[V]** verified against a primary source (Railway docs, the live public GraphQL schema,
railway.com legal/pricing pages, or a Railway-employee/staff reply on Central Station) — URL given.
**[P]** partially verified (real, but the boundary/behaviour isn't stated in writing). **[U]** unverified
/ not documented / not possible.

Method note: the Railway public API endpoint `https://backboard.railway.com/graphql/v2` answers
**schema introspection without a token**, so the operation inventory below was read from the live
schema (274 mutation fields incl. 18 deprecated, 164 query fields, 705 types), not from blog posts.
Everything marked "documented" means it also appears in an official docs page. Captured locally:
`.research/schema_full.json`, `.research/pages/*`, `.research/template_schema.json`,
`.research/env_schema.json` (not committed — scratch).

---

## 1. Platform / GraphQL API capability inventory

Endpoint `https://backboard.railway.com/graphql/v2` — "the same API that powers the Railway dashboard". [V]
<https://docs.railway.com/integrations/api.md>

| Capability | Verdict | Operation (exact name) | Source |
|---|---|---|---|
| Create project | **[V] documented** | `projectCreate(input: ProjectCreateInput!)` — `name, description, workspaceId, teamId, isPublic, prDeploys, defaultEnvironmentName, isMonorepo, runtime, plugins:[String], repo:{fullRepoName!,branch!}` | [manage-projects](https://docs.railway.com/integrations/api/manage-projects.md) |
| Create environment | **[V] documented** | `environmentCreate(input:{projectId!, name!, sourceEnvironmentId, ephemeral, skipInitialDeploys, stageInitialChanges, applyChangesInBackground})` — `sourceEnvironmentId` clones "all of the services, volumes, configuration, and variables from this source environment" | [manage-environments](https://docs.railway.com/integrations/api/manage-environments.md) |
| Rename / delete environment | **[V] documented** | `environmentRename(id, input:{name})`, `environmentDelete(id)` | same |
| Create service | **[V] documented** | `serviceCreate(input:{projectId!, name, branch, environmentId, source, registryCredentials, variables, templateId, templateServiceId})` | [manage-services](https://docs.railway.com/integrations/api/manage-services.md) |
| Deploy a GitHub repo/branch into a service | **[V] documented** — **no image push required** | `serviceCreate(input.source.repo="owner/repo")` + `branch`; or attach later with `serviceConnect(id, input:{repo, branch})`; or `githubRepoDeploy(input:{projectId!, repo!, branch, environmentId})` (schema-only); deploy a specific commit with `serviceInstanceDeployV2(serviceId, environmentId, commitSha)` | manage-services; schema |
| Deploy from image instead | **[V] documented** | `serviceCreate(input.source.image="redis:7-alpine")`; private registries via `registryCredentials` (**Pro plan required**) | manage-services; [services](https://docs.railway.com/services.md) |
| Rename / delete service | **[V]** | `serviceUpdate(id, input{name, icon})`, `serviceDelete(id)` | manage-services |
| Set / read variables | **[V] documented** | `variableUpsert(input:{projectId!, environmentId!, serviceId?, name!, value!, skipDeploys})`, `variableDelete`, query `variables(projectId, environmentId, serviceId?, unrendered?)`; shared vars `sharedVariableConfigure` | [manage-variables](https://docs.railway.com/integrations/api/manage-variables.md) |
| Generated `*.up.railway.app` domains | **[V] documented** | `serviceDomainCreate(input:{serviceId!, environmentId!, targetPort})`, `serviceDomainUpdate`, `serviceDomainDelete`, `serviceDomainAvailable(domain)`; list via query `domains(projectId, environmentId, serviceId) → AllDomains{ serviceDomains, customDomains }` | [manage-domains](https://docs.railway.com/integrations/api/manage-domains.md) |
| Custom domains | **[V] documented** | `customDomainCreate(input:{projectId!,environmentId!,serviceId!,domain,targetPort})`, `customDomainUpdate`, `customDomainDelete`, `customDomainIssueCertificate`, `customDomainAvailable(domain)`; DNS + cert state on `CustomDomain.status{ dnsRecords{hostlabel,requiredValue,currentValue,status}, verificationToken, certificateStatus }` | manage-domains |
| Railway-registered domains | **[V] read/manage, [U] purchase** | queries `railwayDomains/railwayDomain/railwayDomainDnsRecords`; mutations `railwayDomainDnsRecordCreate/Update/Delete`, `railwayDomainNameserversSet`, `railwayDomainEmailForwardingRule*`, `railwayDomainUpdate(autoRenewEnabled)`. **No purchase/search mutation exists** in the schema — buying a domain is dashboard-only | schema; [railway-domains](https://docs.railway.com/networking/domains/railway-domains.md) |
| Deployment status | **[V]** | query `deployment(id)`, `deployments(...)`, field `Deployment.status: DeploymentStatus` = `QUEUED, BUILDING, DEPLOYING, SUCCESS, FAILED, CRASHED, REMOVED, REMOVING, SLEEPING, WAITING, INITIALIZING, SKIPPED, NEEDS_APPROVAL` (+ `deploymentEvents`) | schema; [manage-deployments](https://docs.railway.com/integrations/api/manage-deployments.md) |
| Logs | **[V] documented** | `deploymentLogs(deploymentId, limit≤5000, filter, startDate/endDate)`, `buildLogs`, `httpLogs`, `environmentLogs` | manage-deployments |
| Metrics / usage | **[V] schema, [P] docs** | query `metrics(projectId, environmentId, serviceId, volumeId, workspaceId, measurements:[MetricMeasurement], startDate!, sampleRateSeconds, groupBy:[MetricTag])`; `usage(...)`, `estimatedUsage(...)`, `projectServiceUsage(workspaceId, startDate!, endDate!, first≤50)` group by `PROJECT_ID/SERVICE_ID/ENVIRONMENT_ID/BILLABLE/REGION`; measurements `CPU_USAGE, MEMORY_USAGE_GB, NETWORK_RX_GB/NETWORK_TX_GB, DISK_USAGE_GB, EPHEMERAL_DISK_USAGE_GB, CPU_LIMIT, MEMORY_LIMIT_GB, BACKUP_USAGE_GB` — this is the per-customer metering primitive | schema (`railway metrics` CLI is documented, the raw query is not in the API guide) |
| Replicas / region / scale | **[V] documented** | `serviceInstanceUpdate(input:{numReplicas, region, multiRegionConfig: JSON, restartPolicyType, restartPolicyMaxRetries, cronSchedule, sleepApplication, healthcheckPath, buildCommand, startCommand, rootDirectory, dockerfilePath, watchPatterns, preDeployCommand, drainingSeconds, overlapSeconds, source})`; read via `serviceInstance` | manage-services |
| CPU/RAM caps | **[V] schema, [P] docs** | `serviceInstanceLimitsUpdate(input:{serviceId, environmentId, vCPUs: Float, memoryGB: Float})`; read `serviceInstanceLimits`, `serviceInstanceLimitOverride` | schema (undocumented mutation) |
| Provision Postgres | **[V] possible, but not the old way** | **`pluginCreate` is DEPRECATED: "Plugins are deprecated on Railway. Use database templates instead."** Live paths: `serviceCreate(input:{templateId, templateServiceId})` (instantiates one service of a template), `templateDeployV2`, `dockerComposeImport(yaml)`, or IaC (`postgres()` / `environmentApplyChangeSet`) | schema (deprecated list); [databases](https://docs.railway.com/databases.md) |
| Provision buckets | **[V] schema, [P] docs** | `bucketCreate(input:{projectId!, name, environmentId})`, `bucketUpdate`, `bucketCredentialsReset`; read `bucketS3Credentials`, `bucketInstanceDetails`; CLI `railway bucket create` is documented | schema; [cli/bucket](https://docs.railway.com/cli/bucket.md) |
| Volumes + backups | **[V] documented** | `volumeCreate(input:{projectId!, mountPath!, serviceId, region, environmentId})`, `volumeInstanceUpdate`, `volumeInstanceBackupCreate/Restore/Delete/Lock`, `volumeInstanceBackupScheduleUpdate`, `volumeInstancePITRRestore` | [manage-volumes](https://docs.railway.com/integrations/api/manage-volumes.md) |
| Private networking | **[V] platform-managed** | `privateNetworkCreateOrGet` etc. are marked **"Removed. Private networks and endpoints are managed by the platform; enable private networking on the environment instead."** Read `privateNetworks(environmentId)`; rename `privateNetworkEndpointRename` | schema (deprecated list) |
| Deploy hooks | **[V] schema, [P] docs** | `deploymentTriggerCreate(input:{projectId, environmentId, serviceId, repository, branch, provider, checkSuites, rootDirectory})` + Update/Delete; `environmentTriggersDeploy`; read `deploymentTriggers` | schema |
| Deploy a whole template into a project | **[V]** | `templateDeployV2(input:{templateId!, serializedConfig!, projectId, workspaceId, environmentId, existingRootServiceId, stageOnly}) → {projectId, operationId, workflowId}` | schema; official manifests publish the exact call (see §6) |
| Docker Compose import | **[V] schema** | `dockerComposeImport(projectId, environmentId, yaml)` → "Create services and volumes from docker compose" | schema |
| Declarative env/project config (IaC) | **[V] documented** | `environmentPreviewChangeSet` / `environmentApplyChangeSet` (intent-level `RailwayChangeSet`, "Experimental"), `environmentStageChanges(input: EnvironmentConfig)`, `environmentPatchCommitStaged`, `environmentIacPartialTransfer/Release`; JSON schemas published at `https://backboard.railway.com/schema/environment.schema.json` (resources: `services, sharedVariables, volumes, buckets, groups, privateNetworkDisabled, stopServices`) and `.../schema/template.schema.json`; normal workflow is the CLI (`railway config plan/apply/pull`) | schema; [infrastructure-as-code](https://docs.railway.com/infrastructure-as-code.md) |
| Delete project | **[V] documented** | `projectDelete(id)` ("destructive and cannot be undone"); `projectScheduleDelete(id)` = "Deletes a project with a 48 hour grace period" (+`…Cancel`, `…Force`) | manage-projects; schema |
| **Archive** project | **[U] NOT SUPPORTED** | no `archiveProject`/`isArchived` on `Project` in the 274-field mutation list. Only delete / scheduled delete | schema |
| Rename project / settings | **[V] documented** | `projectUpdate(id, input:{name, description, isPublic, prDeploys, baseEnvironmentId, focusedPrEnvironments, botPrEnvironments, tracingEnabled, tracingSampleRate})` | manage-projects; schema |
| TCP proxy | **[P]** | `tcpProxies(environmentId, serviceId)` and `tcpProxyDelete(id)` are live; **`tcpProxyCreate` exists but is DEPRECATED** — "Use staged changes and apply them. Creating a TCP proxy with this endpoint requires you to redeploy the service for it to be active." Docs show only the dashboard flow and `railway tcp-proxy create` | schema; [tcp-proxy](https://docs.railway.com/networking/tcp-proxy.md), [cli/tcp-proxy](https://docs.railway.com/cli/tcp-proxy.md) |
| Buy a Railway VM/dedicated host, invite/create a **workspace** | **[U] NOT SUPPORTED** | no `workspaceCreate` mutation (only `workspaceUpdate`, `workspaceDelete`, `workspaceLeave`, invite/policy ops); workspaces are created in the dashboard at `railway.com/new/workspace` | schema; [workspaces](https://docs.railway.com/projects/workspaces.md) |

### UI-only (no public operation found in the schema at all)
- Workspace creation; Railway domain purchase. **[V]** by absence in the full 274-field mutation list.
- **Project "Transfer Ownership" is only partly scriptable** — see §4.

### Watch out for a moving target
`serviceInstanceDeployV2` vs legacy `serviceInstanceDeploy`, `templateDeployV2` vs deprecated
`templateDeploy`, `pluginCreate` deprecated, `serviceDuplicate` deprecated ("used only by the CLI…
use the UI"). Railway documents a deprecation policy: fields are marked `@deprecated` with a reason
and "removed only after it has been marked for a meaningful period". Introspect with
`includeDeprecated: true` and pin to non-deprecated ops. [V] <https://docs.railway.com/integrations/api.md#versioning-and-deprecation>

---

## 2. Auth / token model

**Four token types, three scopes.** [V] <https://docs.railway.com/integrations/api.md#creating-a-token>

| Token | Scope (quote) | Header |
|---|---|---|
| Account token | "If you select 'No workspace' … This is the broadest scope. The token can perform any API action you're authorized to do across all your resources and workspaces." | `Authorization: Bearer` |
| Workspace token | "A workspace token has access to all the workspace's resources, and cannot be used to access your personal resources or other workspaces." | `Authorization: Bearer` |
| **Project token** | "Project tokens are scoped to **a specific environment within a project** and can only be used to authenticate requests to that environment." | **`Project-Access-Token`** (not Bearer) |
| OAuth access token | user-granted scopes; see below | `Authorization: Bearer` |

- Per-project/per-environment token: **yes** — `projectTokenCreate(input:{projectId!, environmentId!, name})`, `projectTokenDelete`, read `projectToken`/`projectTokens`; `ProjectToken{projectId, environmentId, …}`. It is **environment-bound, not operation-scoped** (no read-only/deploy-only scopes documented). **[V]** schema + docs.
- Token *creation* via API: `apiTokenCreate(input:{name!, workspaceId})` returns the token string; `apiTokenDelete`; `workspaceApiTokens(workspaceId)` / `workspaceApiTokenDelete` are **workspace-admin** ("Review every workspace token, see who created it and when, and revoke" — Changelog #0315, 2026-11-05). **[V]**
- **Fine-grained RBAC**: `ProjectRole = ADMIN | MEMBER | VIEWER`, `TeamRole = ADMIN | MEMBER | DEPLOYER`; `projectMemberAdd/Update/Remove`, `projectInvitationCreate/Accept`, `projectInviteCodeCreate` ("24-hour project invite link"), `accessGroup*`, `workspaceSetRestrictProjectVisibilityToGroups`, `workspacePolicyItemUpdate` (**desc: "Enterprise workspaces only"**). **[V]** schema.
  - Docs table (verbatim): SAML SSO / Access groups / Environment RBAC / Guardrails → **"Enterprise"**; **Project tokens ("Binds a token to one project and one environment") → "All plans"**. [V] <https://docs.railway.com/enterprise/security.md#access-control>
  - Access groups + Guardrails: "available on eligible **committed spend plans**"; Environment RBAC + SAML: "available on **Railway Enterprise**" / "Subscribe to a committed spend plan to enable RBAC". Committed spend tiers: **$2,000** → SSO + RBAC; **$5,000** → Enterprise Resource Limits + Railway Authentication; **$10,000** → dedicated VMs. [V] <https://docs.railway.com/pricing/committed-spend.md>, [access-groups](https://docs.railway.com/enterprise/access-groups.md), [guardrails](https://docs.railway.com/enterprise/guardrails.md)
  - **No documented way to restrict a token to one project via RBAC** — RBAC governs *members*, not tokens; only project tokens narrow a token. **[U]** for finer.
- **Hobby vs Pro plan effects on API access**: the API itself is not plan-gated; the *rate limit* is (below). Plan-gated items found: private Docker registry deploys need Pro [V]; guardrails/RBAC/SAML need committed-spend/Enterprise [V]; per-plan platform limits (§5). **[U]**: no doc states "no API on Hobby" or any API feature switch by plan.
- **Rate limits (verbatim)**: "Requests per hour: **100 RPH for Free customers, 1000 RPH for Hobby customers, 10000 RPH for Pro customers; custom for Enterprise.** Requests per second: **10 RPS for Hobby customers; 50 RPS for Pro customers**; custom for Enterprise." Headers `RateLimit-Policy` (`"default";q=1000;w=3600`), `X-RateLimit-Limit/Remaining/Reset`, `Retry-After`; **HTTP 429** on excess. "We can configure a higher rate limit on Enterprise" — Railway employee (jake) on a Terraform-user 429 thread. [V] <https://docs.railway.com/integrations/api.md#rate-limits>, [thread](https://station.railway.com/questions/increase-api-rate-limit-325de642)
- Error semantics worth coding against: authorization failures come back as **HTTP 200 with `errors[]` (`INTERNAL_SERVER_ERROR`, message `Not Authorized`)**, not 401/403; `extensions.traceId` is the support handle. Mutations are **not exactly-once** ("do not assume exactly-once semantics"). [V] same page.

### The OAuth option platfolio should evaluate seriously (changes the architecture)
Railway ships a real **OAuth 2.0 / OIDC provider** aimed at exactly this product shape — documented
use cases include "Deployment frameworks: Integrate one-click deploy-to-Railway" and "Developer platforms".
Discovery: `https://backboard.railway.com/oauth/.well-known/openid-configuration` **[V] fetched live** —
`issuer https://backboard.railway.com`, `/oauth/auth`, `/oauth/token`, `/oauth/me`, `/oauth/jwks`,
`/oauth/register`; `response_types_supported: [code]`;
`grant_types_supported: authorization_code, refresh_token, **device_code**, **token-exchange**`;
`code_challenge_methods: [S256]`; `token_endpoint_auth_methods: client_secret_basic, client_secret_post, none,
**private_key_jwt**`; and `scopes_supported: openid, email, profile, offline_access, workspace:admin,
workspace:member, workspace:viewer, **project:admin**, project:member, project:viewer, **notifications, ssh_keys**`.
Note the docs scope table omits `project:admin`, `notifications` and `ssh_keys`, and the docs never mention the
device-code or token-exchange grants or `private_key_jwt` — the discovery document is the wider truth, so
**read scopes from discovery, not from the table**.
Scopes (docs, verbatim table): `openid, email, profile, offline_access, workspace:viewer|member|admin,
project:viewer|member` — **"These are selective: the user chooses which specific workspaces or projects to
share during consent. Your application only receives access to the resources they select, not their entire
account."** Access tokens expire in 1 hour; `offline_access` gives refresh tokens. Apps are created by a
**workspace admin** under Workspace Settings → Developer; **Dynamic Client Registration** is supported —
`POST https://backboard.railway.com/oauth/register` **[V] probed: `400 {"error":"invalid_redirect_uri",
"error_description":"redirect_uris is mandatory property"}`**, i.e. the route is real and live. Consent can be
revoked per resource by the user. There is no documented app-review/marketplace listing.
[V] <https://docs.railway.com/integrations/oauth.md>, [scopes-and-user-consent](https://docs.railway.com/integrations/oauth/scopes-and-user-consent.md), [creating-an-app](https://docs.railway.com/integrations/oauth/creating-an-app.md), [authorized-apps](https://docs.railway.com/integrations/oauth/authorized-apps.md), [discovery doc](https://backboard.railway.com/oauth/.well-known/openid-configuration)

Also available as a control surface: **`railway api`** (run raw GraphQL from the CLI, live introspection),
the **MCP server at `mcp.railway.com`** (tools: `list-projects`, `create-project`, `list-services`,
`redeploy`, `accept-deploy`, `railway-agent`, feature flags), and `railway deploy/add/domain/bucket/scale/config`.
[V] <https://docs.railway.com/cli/api.md>, <https://docs.railway.com/ai/mcp-server.md>

---

## 3. Programmatic GitHub connection

- Model: Railway is installed as a **GitHub App** (`https://github.com/apps/railway-app`), plus per-user
  account linking. "You must link your Railway account to GitHub, to enable Railway to connect to your
  GitHub repositories." Schema reflects installation-scoped access: `GitHubRepo.installationId`,
  `githubWritableScopes` = "Get a list of **scopes the user has installed the installation to**",
  `gitHubRepoAccessAvailable(fullRepoName) → GitHubAccess{hasAccess, isPublic}`, `githubRepos` = "repos
  for a user that Railway has access to", `githubRepoBranches(owner, repo)`. **[V]** <https://docs.railway.com/services.md#deploying-from-a-github-repo>, schema
- **Deploying a *third party's* private repo into platfolio's project — NOT a documented flow.**
  A Railway employee answered this exact scenario (agency with its own GitHub App, wanting customers'
  private repos): *"In order to deploy a github repo on railway, **the deploying user must have authorized
  railway to access the repo**… The only scenario where you can deploy a repo you didn't add is for github
  organizations. Only if you are in the repo and authorize the railway app to access it will you be able to
  deploy the customer's repo."* and *"Not 100% sure your use case is possible today."*
  **[V] as community/employee answer; [U] as documented product capability.**
  <https://station.railway.com/questions/deploying-user-s-private-git-hub-reposit-24ee7832>
- Autodeploy precondition (verbatim): "Autodeploy works only when **at least one project member has a
  connected GitHub account with contributor access to the repository**. Public repositories where no project
  member has contributor access cannot use autodeploy." Plus: "If a member of a GitHub repo doesn't have a
  linked Railway account, Railway by default will not deploy any pushes … Railway will then create a
  **Deployment Approval**" (`deploymentApprove(id)` exists in the API; status `NEEDS_APPROVAL`).
  **[V]** <https://docs.railway.com/deployments/github-autodeploys.md>, <https://docs.railway.com/services.md>, schema
- Therefore the customer must authorize one of: (a) install `railway-app` on their GitHub account/org for
  that repo **and** be the Railway-side user whose GitHub is linked, (b) add a platfolio-controlled GitHub
  user as a repo collaborator whose Railway account is in the project, or (c) skip GitHub entirely and
  hand over artifacts as images (private registries require **Pro**; `registryCredentials` on
  `serviceCreate`/`serviceInstanceUpdate`). **[V]** for (c) gating, **[P]** for (a)/(b) mechanics (inferred from the
  quotes above; no doc describes the agency case).
- "Bring your repo into someone else's Railway project" closest documented features: `templateServiceSourceEject`
  / "Eject" (copies the template repo into **your** GitHub), updatable templates, and Guardrails'
  deploy-source allowlist (Enterprise; "organization picker only lists GitHub organizations where Railway's
  GitHub app is installed and you're an organization admin"). **[V]** <https://docs.railway.com/templates/deploy.md#eject-from-template-repository>

---

## 4. Project handover / transfer

**Two different features — the naming is a trap.**

1. **"Transfer Project" (workspace → workspace)** — `projectTransfer(projectId, input:{workspaceId!})`
   ("Transfer a project to a workspace"). Docs: "You can transfer a project to another workspace **that you're
   a member of**… You must be an Admin of the project… The destination workspace must have an active Hobby or
   Pro subscription." Legacy `projectTransferToTeam` is deprecated → "Use projectTransfer instead". **[V]**
   <https://docs.railway.com/projects.md#transferring-projects>, [workspaces](https://docs.railway.com/projects/workspaces.md#transferring-projects), schema
2. **"Transfer Ownership" (owner → owner)** — `projectTransferInitiate(input:{projectId!, memberId!})` then
   `projectTransferConfirm(input:{ownershipTransferId!, projectId!, destinationWorkspaceId})`.
   **Semantics: it is *user-to-user*, not project-to-project and not service-to-service.** `memberId` proves
   the recipient must already be a member of the project; docs: "To transfer a project to another user, you
   must first add the user as a member… select the three dots next to the user and choosing `Transfer
   Ownership`"; "The recipient receives an email to confirm the transfer. **They have 24 hours to accept.**"
   "Both the source and destination must have an active **Hobby or Pro** plan subscription." **[V]** same page
- Railway-side operational detail (official station answers, Nov 2026): project invites **don't require Pro**
  ("Hobby allows up to 3 project members"); the initiating account must have **2FA enabled**; the recipient
  picks **which of their workspaces the project lands in**; and — important —
  **"If the project has any buckets, delete them before you start, because buckets block the transfer."**
  **[V] as staff answer; [U] in the docs** (not written in the docs page).
  <https://station.railway.com/questions/transfer-a-project-b8c3ed71>, <https://station.railway.com/questions/transfer-project-a8c435b8>
- Workspaces themselves are **not transferable**: "there's no way to transfer a personal workspace itself to
  another account — workspaces aren't transferable, only projects are" (+ Railway's own answer describing the
  Pro-upgrade/invite-admin path). **[V/P]** (staff + community answer, no doc states it as a limitation)
  <https://station.railway.com/questions/account-transfer-193c899c>
- **What carries over** (Railway staff, verbatim): "Project transfers move the entire project **as-is** to the
  destination workspace, so **volumes, environment variables, deployment history, and services all survive**.
  Your `*.up.railway.app` domains **persist** as well. After the transfer, all new usage is **billed to the
  destination workspace**." Custom domains and the GitHub repo linkage are part of the project object
  (`CustomDomain.projectId`, service `source.repo`), so they move with it — *documented for services/vars/
  volumes/history/domains; the GitHub-linkage survival is stated by staff for the upgrade flow ("GitHub
  deploy settings … stay exactly where they are"), not in the docs.* **[V]/[P]**
  <https://station.railway.com/questions/transfer-of-project-63b9f94f>, [account-transfer](https://station.railway.com/questions/account-transfer-193c899c)
- **What breaks / what you must warn customers about:**
  - **Plan gate both ends.** A `Free`/`Trial` platfolio workspace **cannot hand over at all** ("from a Free
    workspace the Transfer Ownership option is not available"). **[V]** transfer-project thread.
  - **Buckets block the transfer** (staff). **[V-as-forum]**
  - **The 3-members-per-project cap on Hobby** limits pre-handover staging (you need the customer as a member
    before you can transfer). **[V]** pricing table + thread.
  - **Billing follows the project owner**, always: "The Project Owner is charged for the project's usage." **[V]** <https://docs.railway.com/projects/project-members.md>
  - **Per-plan ceilings change on arrival**: custom domains 2→20, service domains 4→20, replicas 6→42,
    projects 50→100 per workspace, concurrent builds 3→10, log retention 7→30 days. A Pro customer's project
    that used 20 domains cannot be pulled back into a Hobby workspace. **[V]** pricing/plan tables — the *enforcement
    behaviour* on transfer-in is **[U]** (not documented).
  - **Private network hostnames** are per-project/environment (`<service>.railway.internal`); they survive with
    the project but are **not reachable across projects or across environments** — so nothing else on
    platfolio's side can keep talking to the customer's stack after handover. **[V]** <https://docs.railway.com/networking/private-networking.md>, <https://docs.railway.com/enterprise/security.md>
  - **Tokens**: any `projectToken` issued by platfolio is bound to platfolio's account/project; hand back/revoke
    (`projectTokenDelete`, `workspaceApiTokenDelete`) — nothing documents automatic rotation on transfer. **[U]**
  - Services **cannot be moved between projects** ("It's not currently possible to move a service from one
    project to another"), so per-customer isolation must be designed at the project boundary from day one.
    **[V]** employee answer <https://station.railway.com/questions/migrate-service-or-at-least-volume-fro-f7fc307f>
- Alternative handover with no transfer at all: **let the customer deploy a platfolio template themselves**
  (instant project in *their* account) — see §6.

---

## 5. Limits & cost model that matter for reselling

Per-workspace / per-plan ceilings (railway.com/pricing "Resources & limits"; matches docs plan table):

| | Free Trial | Free | **Hobby $5** | **Pro $20** | Enterprise |
|---|---|---|---|---|---|
| **Projects (per workspace)** | 5 trial → 1 | 1 | **50** | **100** | Unlimited |
| Services per project | 5 → 3 | 3 | 50 | 100 | Unlimited |
| CPU / RAM per service | 2 vCPU/1 GB → 1/0.5 | 1 vCPU/0.5 GB | 48 vCPU / 48 GB | 1,000 vCPU / 1 TB | 2,400 / 2.4 TB |
| Replicas per service | 2 → 1 | 1 | 6 | 42 | 50 |
| Members **per project** | 3 | 1 | **3** | Unlimited | Unlimited |
| Custom domains | 1 → 0 | 0 | **2** (per service) | **20** (per service, raisable on request) | Unlimited |
| Service domains | — | — | 2 | 4 → **20** | Unlimited |
| Volumes per project / max size | 3→1 / 500 MB | 1 / 500 MB | 10 / 5 GB | 20 (raisable) / 1 TB | Unlimited / 5 TB |
| Buckets per project | 3→1 | 1 | 50 | 100 | Unlimited |
| Cron jobs per project | — | — | 50 | 100 | Unlimited |
| **Concurrent builds** | 3 → 1 | 1 | **3** | **10** | 10+ |
| Build timeout | 20→10 min | 10 min | 40 min | 90 min | 90+ |
| Log retention | 7 → 3 days | 3 days | 7 days | 30 days | up to 90 |
| Ephemeral disk | 1 GB | 1 GB | 100 GB | 100 GB | 100 GB |

[V] <https://railway.com/pricing>, <https://docs.railway.com/pricing/plans.md>, <https://docs.railway.com/networking/domains/working-with-domains.md>
"50 projects per workspace … You can also create additional workspaces to spread projects across them" (official
answer): <https://station.railway.com/questions/how-to-have-more-than-50-projects-dec9f3a0>

**Undocumented-but-real cap:** a **25 services/day creation cap** on newer accounts — "an account-age
safeguard separate from your Pro plan's 100-services-per-project limit … rolling 24-hour window"; Railway staff
then "cleared the workspace from the new-account safeguard". Not in any docs page. Directly threatens bulk
provisioning. [V-as-forum] <https://station.railway.com/questions/service-creation-limit-0d854465>

**Money:** RAM $10/GB-month ($0.00000386/GB/s), CPU $20/vCPU-month ($0.00000772/vCPU/s), **egress $0.05/GB**,
volumes $0.15/GB-month, object storage **$0.015/GB-month with free egress and free/unlimited S3 API ops**;
builds are free ("Railway does not charge for build CPU, memory, base-image downloads, image exports, or image
storage"); private-network transfer up to 100 Gbps, public transfer ~10 Gbps; edge limits 10,000 concurrent
connections, ~11,000 RPS per domain, 32 KB headers, 5-min request cap (websockets exempt). Hobby includes $5 of
usage, Pro includes $20; **the Pro fee is per workspace, not per seat**. **[V]** <https://docs.railway.com/pricing/plans.md>, <https://railway.com/pricing>, <https://docs.railway.com/networking/public-networking/specs-and-limits.md>

**Environments are not free:** "giving you isolated instances of all services in a project", each environment
gets its own service instances, variables and network namespace → **staging + production doubles the running
resource footprint** (config is per-service-instance; there is no shared-runtime environment). **[V]**
<https://docs.railway.com/environments.md>, <https://docs.railway.com/enterprise/security.md#isolation-of-environments-and-builds>

**Cold boot / sleep:** opt-in per service (`serviceInstanceUpdate.input.sleepApplication` = "Enable sleep when
idle"). "A service must not send *outbound* traffic for at least 5 minutes" (in practice sleeps 5–10 min);
first request wakes it and **may return 502**; "Slept services still consume a slot … de-prioritizes your
workload and in remote cases may require a rebuild to re-live the service"; applies across all replicas;
documented API caveat: "This applies to the API too. `serviceInstanceUpdate` writes the value and reads it back
as set, but the running container keeps the value it was created with until the next deployment." Restart
policy `ON_FAILURE|ALWAYS|NEVER` + `restartPolicyMaxRetries`. **[V]** <https://docs.railway.com/deployments/serverless.md>, <https://docs.railway.com/deployments/restart-policy.md>

**Guardrails / spend controls:** **Usage limits are available on ALL plans** — soft limit = email alert, hard
limit = Railway takes workloads offline; minimum hard limit **$10**; per-workspace; `usageLimitSet(input:
{customerId!, softLimitDollars!, hardLimitDollars})` / `usageLimitRemove` exist in the schema (and
`railway usage limit set --target workspace --soft 75 --hard 125`), but the **API docs don't cover them**;
notification rules can also webhook you (`notificationRuleCreate(channelConfigs, eventTypes, severities,
workspaceId!, projectId, ephemeralEnvironments)`, `webhookTest`, delivery statuses; webhooks fire on deployment
status changes + volume/CPU/RAM alerts, 30s timeout, 3 retries). Replica limits (per-replica CPU/RAM ceilings)
are dashboard-only per the docs. **Railway Authentication** (identity-aware proxy for staging) is $5,000-tier+.
**[V]** <https://docs.railway.com/pricing/cost-control.md>, <https://docs.railway.com/observability/webhooks.md>, schema

**Metering per customer (the reselling primitive that does exist):** `usage`/`estimatedUsage`/
`projectServiceUsage` grouped by `PROJECT_ID` (+ `BILLABLE`), per-project `Project.subscriptionType` and
`Project.subscriptionPlanLimit`. So platfolio can build per-customer cost accounting from the API; **what does
not exist is any per-project invoice, sub-account, or customer-billing construct — Railway bills one workspace
owner only**. **[V]** schema + docs; the "no sub-account" claim is **[U]** (absence, not a doc statement).

### ToS / AUP — the reselling question, quoted
- **AUP**: "You may not use, or facilitate or allow others to use the Services … for other abuse of the
  platform, including cryptocurrency mining, torrenting, **reselling compute resources**, **evading usage or
  billing limits**, operating proxies or anonymization services, or running bots or scrapers that violate
  applicable terms of service." <https://railway.com/legal/acceptable-use> (mirrored in
  <https://docs.railway.com/platform/trust-and-safety.md>: "The Acceptable Use Policy also prohibits reselling
  compute resources, evading usage or billing limits…").
- **One account per person**: "Users are only allowed one account per person. This is enforced through email,
  GitHub, and payment method verification." <https://docs.railway.com/access/accounts.md>
- **No ban on multi-tenant per se, but multi-accounting is prohibited**: "Creating additional accounts to reuse
  the Trial plan, or to keep using Railway after an account or workspace was banned." Railway's own docs also
  cite "Multi-tenant projects don't leak data between customers" as an intended isolation property.
  <https://docs.railway.com/platform/trust-and-safety.md>, <https://docs.railway.com/networking/private-networking.md>
- **Accounts are not transferable**: "You may not transfer your account to anyone else without our prior written
  permission." <https://railway.com/legal/terms>
- Enforcement: Railway "either restricts the affected resources or bans the workspace" — the Oct 2026 incident
  produced public messages like **"This workspace cannot create new resources or deploy … upgrading, paying, or
  adding a card won't lift this restriction"**, appealable via Workspace Settings → Standing. A reseller's blast
  radius is the *whole workspace*. <https://station.railway.com/questions/this-workspace-cannot-create-new-resourc-121ce347>
- **Reading**: Railway offers no documented "hosting reseller" program, and the AUP text is close enough to
  "selling your customers hosting on your Railway bill" that platfolio should get written permission **before**
  building on this assumption. Railway's explicit invitation: "If you're unsure whether your workload is
  permitted, ask through Central Station or email abuse@railway.com **before deploying**." **[V]** (that sentence
  is in the docs); whether platfolio's specific model is blessed = **[U]** pending written answer.

### Official partner / platform programs (none is a reseller program)
- **Open Source & Technology Partners** — verified templates, commission: base **15%**, **+10% support bonus =
  25%** of usage; requires marketplace publication ("Private and unpublished templates are **not** eligible");
  withdrawals via Stripe Connect, $100–$10,000, credits or cash. <https://docs.railway.com/templates/partners.md>, <https://docs.railway.com/templates/kickbacks.md>
- **Affiliate program** — referrals get $20 credits; referrer earns **15% commission on the first 12 months of
  invoices**. <https://docs.railway.com/community/affiliate-program.md>
- **AWS Marketplace listing** — 12-month contract, base **$10,000/yr**, $1.00/unit overage ("For large
  Enterprises"). This is the only official channel where Railway usage is bought through a third-party
  marketplace. <https://docs.railway.com/pricing/aws-marketplace.md>
- **Committed spend** ($1k/$2k/$5k/$10k) and Enterprise (custom, SLAs, BYOC/"bring your own cloud" row on
  pricing) — the "platform-scale" route. <https://docs.railway.com/pricing/committed-spend.md>
- **"Railway for platforms"**: **[U] does not exist** as a documented program.

---

## 6. Templates

- **Programmatic instantiation with variables: yes, three documented ways.**
  1. **Deploy-button model** — `https://railway.com/new/template/<code>?utm_…=&referralCode=<code>` +
     `https://railway.com/button.svg`; "Deploy templates into existing projects, by clicking `+ New` from your
     project canvas and selecting `Template`". **[V]** <https://docs.railway.com/templates/publish-and-share.md#deploy-on-railway-button>
  2. **CLI** — `railway deploy --template postgres --variable "POSTGRES_USER=admin"`, service-scoped
     `--variable "Backend.PORT=3000"`; template codes for `postgres|mysql|redis|mongo`; `railway add -d postgres`.
     **[V]** <https://docs.railway.com/cli/deploy.md>, <https://docs.railway.com/cli/add.md>
  3. **GraphQL** — `templateDeployV2(input:{templateId!, serializedConfig!, projectId?, environmentId?,
     workspaceId?, existingRootServiceId?, stageOnly?}) → {projectId, operationId, workflowId}`.
     **[V]** schema.
- **Official machine-readable manifests publish the exact API call** — e.g.
  `https://railway.com/deploy/_c4Kr9/manifest.json` contains `deploy.cli`, `deploy.mcp.tool=deploy_template`,
  and a ready `deploy.api.body` with the `templateDeployV2` mutation + full `serializedConfig` including
  `variables: { PORT: {defaultValue}, SECRET_ENCRYPTION_KEY: {defaultValue:"{{SECRET_ENCRYPTION_KEY}}"} }`,
  `networking.serviceDomains`, `volumeMounts`; plus `required_inputs[] {key, service, secret, strategy:
  default|generate, default, generate: random_base64_32}` and validation telemetry
  (`status: validated`, `typical_ready_seconds`, `success_rate_30d`). Index: `https://railway.com/deploy/llms.txt`.
  **This is the cleanest contract for platfolio to render a provisioning form from.** **[V]**
  <https://railway.com/deploy/_c4Kr9/manifest.json>, <https://railway.com/llms-templates.md>
- **Variable value syntax** (usable in serializedConfig): reference variables `${{svc.ENV}}` and **template
  variable functions** `secret(length?, alphabet?)` etc. "When a template is deployed, all template variable
  functions are executed and the result replaces the `${{ ... }}`". **[V]** <https://docs.railway.com/templates/create.md#template-variable-functions>
- **Private / unlisted templates: yes.** Template status enum is `PUBLISHED | UNPUBLISHED | HIDDEN`
  ([schema]); "`railway templates create/generate` → Create an **unpublished** template from a project";
  workspace-scoped listing `workspaceTemplates` / `railway templates list --workspace`; the kickbacks page
  refers to "**Private** and unpublished templates [as] not eligible". Publishing has a gate:
  `Template.publishingRestrictionId` = "The active restriction stopping **this workspace** publishing templates".
  **[V]** for the states/CLI; **[U]** for whether an `UNPUBLISHED`/`HIDDEN` template link can be deployed by a
  *different* account (no doc states either way) — **must be tested before betting handover on it**.
  <https://docs.railway.com/cli/templates.md>, <https://docs.railway.com/templates/kickbacks.md>
- **Where the project lands: the clicking user's account.** "Upon deploy, **you will be taken to your new
  project** containing the template service(s)"; manifests say "Launch it **within your workspace**"; API
  responses carry `projectId` created under the caller's `workspaceId`. So a template link handed to a customer
  creates the stack **in the customer's own Railway account/workspace** → an instant, transfer-free handover
  path, and the *only* path that requires no platfolio-owned plan at the customer's side. **[V]**
  <https://docs.railway.com/templates/deploy.md>, <https://docs.railway.com/templates/metrics.md>
- **Monetization:** 15%→25% kickbacks (marketplace-published only), private Docker-image templates
  ("distribute proprietary code … guaranteed commission"; registry credentials stay hidden, SSH disabled),
  `templateMetrics`/`templateSearch`/`Template.totalPayout` fields, affiliate 15% × 12 months. **[V]**
  <https://docs.railway.com/templates/private-docker-images.md>, <https://docs.railway.com/templates/metrics.md>

---

## 7. Domains

**Generated Railway domains:** `*.up.railway.app`, created per service instance; API
`serviceDomainCreate(serviceId, environmentId, targetPort?)`, `serviceDomainUpdate` (rename),
`serviceDomainAvailable`, delete, and listing via `domains(...) → serviceDomains[{domain, suffix, targetPort}]`;
target ("magic") ports map one domain → one internal port. Service domains are **not** auto-created: "Railway
services don't obtain a domain automatically". Limits: Hobby 2, Pro 20 per service (unlimited Enterprise).
**`railway.gw`: not present anywhere in docs, the pricing pages, the changelog, or the schema** (`suffix` is a
free-text field on `ServiceDomain`) → **[U] undocumented**; do not hard-code it, read `domains.serviceDomains.suffix`.

**Custom domains — exact DNS (docs, verbatim):**
- **Subdomain** (`api.example.com`): a **CNAME** to the Railway service domain **plus a `TXT` record using the
  token in `status.verificationToken`**. "Both records are required - the domain will not verify with only the
  CNAME in place." "If the `TXT` record is missing, requests to your custom domain will return a **404** error
  even after the CNAME resolves."
- **Apex/root** (`example.com`): "**CNAME-flattened, ALIAS, or ANAME** record … pointing to your Railway service
  domain, plus the `TXT` record. **Railway does not publish a static IP, so `A` records are not supported.**"
  Provider examples given: Cloudflare CNAME-flattening, DNSimple ALIAS, Namecheap CNAME, bunny ANAME; explicitly
  listed as *not* supporting it: Route 53, Azure DNS, Hostinger, GoDaddy, NameSilo, Hurricane Electric,
  Squarespace → workaround = move nameservers to Cloudflare.
- **Wildcard: supported** — `*.example.com` and `*.sub.domain.example.com`, "wildcards cannot be nested
  (`*.*.yourdomain.com`)". Railway returns **two CNAMEs + one TXT**: the wildcard CNAME, the
  `_acme-challenge` CNAME ("required for Railway to issue the SSL Certificate"), and the ownership TXT.
  `authorize.railwaydns.net` **must not be proxied**. Cloudflare: disable proxy on `_acme-challenge`, enable
  Universal SSL, use **Full** (not Full-strict). For `*.nested.example.com` you must **disable** Universal SSL
  and buy Cloudflare Advanced Certificate Manager.
- **Hard conflict for a sub-domain reseller**: "Subdomains and wildcards **cannot overlap** (`foo.hello.com`
  cannot exist with `*.hello.com` unless owned by the same service)". Community threads confirm you cannot
  register `*.domain.com` on one project and `app.domain.com` on another (Vercel-style). → **platfolio cannot
  offer both `*.clients.platfolio.io` as a shared wildcard *and* per-customer `<cust>.clients.platfolio.io`
  on separate services.** Choose one: (a) no global wildcard, explicit per-customer subdomains; (b) one
  wildcard on one "router" service that reverse-proxies per-tenant (its own capacity/rate-limit risk); (c) one
  wildcard **per customer** (`*.acme.clients.platfolio.io` on acme's service).
  **[V]** <https://docs.railway.com/networking/domains/working-with-domains.md>, <https://docs.railway.com/networking/public-networking/specs-and-limits.md>, <https://station.railway.com/questions/wildcard-subdomain-conflict-4014e44b>

**TLS:** Let's Encrypt, **ECDSA** keys; issued automatically after verification; "Certificates are valid for
**90 days** and renewed when **30 days** of validity remain" (elsewhere "automatically renewed 2 months into
their life"); "Certificate issuance should happen within an hour of your DNS being updated"; Railway "attempts
to issue a certificate for **up to 72 hours** after domain creation before failing"; TLS 1.2/1.3 only, SNI
mandatory, inbound must be TLS. `certificateStatus: PENDING | ISSUED | FAILED`, retry via
`customDomainIssueCertificate`. **Proxied (Cloudflare orange-cloud) domains may not get a certificate at all** —
"Cloudflare to Railway traffic will be encrypted with TLS using the **default Railway `*.up.railway.app`
certificate**" — the documented 525-style failure mode. Propagation caveat: "Changes to DNS settings may take
**up to 72 hours** to propagate worldwide." DNS record states `PENDING|VALID|INVALID` with `requiredValue` vs
`currentValue` per `hostlabel` → platfolio can build a real self-service DNS checker from
`domains{ customDomains { status { dnsRecords { hostlabel requiredValue currentValue status } verificationToken
certificateStatus } } }`. **[V]** same page + manage-domains
- Other documented non-starters: "Freenom domains are not allowed and not supported"; non-public/internal
  domain names not supported; Unicode must be punycode; **you cannot front a Railway service with your own IP**
  (no A records / no static IP published). Railway-purchased domains cannot be **transferred in** from another
  registrar ("We don't support transferring a domain registered with another registrar into Railway") and
  transfers out are gated by a **60-day ICANN lock + 2FA**; **Railway is listed as the registrant contact** for
  domains bought through Railway. → platfolio must keep DNS at the customer's registrar, or own the registrar
  relationship itself. **[V]** <https://station.railway.com/questions/transfer-domain-f6db78ca>, <https://docs.railway.com/networking/domains/railway-domains.md>, <https://docs.railway.com/networking/domains/working-with-domains.md>
- Attach/detach **is** API-supported (§1) — including per-environment retargeting (`customDomainUpdate(id,
  environmentId, targetPort)`) — but **there is no documented API to move a custom domain between projects**;
  detach + re-create on the destination service is the transfer path (with a DNS/cert re-verification window). **[U]** for a direct move.

---

## Things that will force a design change

1. **50 projects/workspace on Hobby, 100 on Pro.** "One project per customer in my workspace" caps at 50–100
   customers, and Pro is $20/**workspace** — so N workspaces × $20, or Enterprise. Plus **50–100 services per
   project** and **25 services/day** on a young account (staff-cleared, undocumented).
   → Design must either shard across workspaces, put multiple customers in one project (loses private-network
   isolation), or not be "one project per customer".
2. **You cannot create workspaces, register domains, purchase Railway domains, or create a Railway account via
   the API.** Account creation can't be automated at all, so onboarding a customer to *their* Railway account
   is a human step.
3. **Handover is user-to-user, email-confirmed, 24 h, requires the customer to already be a project member,
   2FA on platfolio's account, active Hobby/Pro at both ends, and is blocked by buckets.** On Hobby, the 3
   members/project ceiling sits right on top of this flow. Plan the handover as a *transaction with failure
   modes*, not a button.
4. **AUP prohibits "reselling compute resources" and "evading usage or billing limits"; "one account per
   person"; account transfer needs written permission.** The core business model needs a written answer from
   Railway (their docs invite the question *before deploying*) or a different ownership model — e.g. the
   customer owns the Railway account (§6 template link / §2 OAuth app).
5. **Billing is workspace-owner-only.** No per-project invoices, no sub-accounts. platfolio must meter via
   `usage`/`projectServiceUsage` (grouped by `PROJECT_ID`, `BILLABLE`) and pass through cost itself, and accept
   that a single customer's runaway usage lands on platfolio's card until **workspace-level** usage limits
   (min hard limit $10) shut *everything* down.
6. **No wildcard+subdomain overlap** on one domain → platfolio's `*.clients.platfolio.io` story must change
   shape (§7), and apex customers need a CNAME-flattening/ALIAS-capable DNS (not Route 53/GoDaddy/etc.).
7. **Third-party private GitHub repos can't be pulled into platfolio's project by a documented flow** — the
   deploying user must have authorized the Railway app. Either the customer joins the project with a linked
   GitHub account, or platfolio ships images, or the project lives in the customer's account.
8. **Enterprise paywall**: access groups, environment RBAC, guardrails, SAML, Railway Authentication, higher
   rate limits, dedicated hosts = committed spend ($2k/$5k/$10k) / Enterprise. If platfolio's pitch is "your
   staging is sealed off", the cheap version of that is: **project tokens (all plans)** + sealed variables +
   private networking; the managed version costs Enterprise money.
9. **Rate limits are plan-tiered (100/1000/10000 RPH) and mutations aren't exactly-once** → a provisioning
   controller needs token-bucket-aware queuing, idempotent state machine, and reconciliation by read-back.
10. **Serverless/`sleepApplication` only takes effect at the next deploy** (documented API caveat) and a slept
    service's first request can 502 — don't treat a write to the API as an applied change.
11. **`pluginCreate` is deprecated** ("use database templates instead") and **`tcpProxyCreate` is deprecated**
    ("use staged changes") → don't build the Postgres/TCP-proxy path on the obvious-sounding mutations.
12. **Blast radius**: Railway restricts or bans the **workspace**. One flagged customer project can take down
    every tenant in that workspace; also, on 2026-10-22 Railway paused all sign-ups during incident response,
    which broke invite-onboarding for new collaborators.

---

## Source index

Docs: [Public API](https://docs.railway.com/integrations/api.md) ·
[cookbook](https://docs.railway.com/integrations/api/api-cookbook.md) ·
[projects](https://docs.railway.com/integrations/api/manage-projects.md) /
[services](https://docs.railway.com/integrations/api/manage-services.md) /
[deployments](https://docs.railway.com/integrations/api/manage-deployments.md) /
[variables](https://docs.railway.com/integrations/api/manage-variables.md) /
[environments](https://docs.railway.com/integrations/api/manage-environments.md) /
[domains](https://docs.railway.com/integrations/api/manage-domains.md) /
[volumes](https://docs.railway.com/integrations/api/manage-volumes.md) ·
[OAuth](https://docs.railway.com/integrations/oauth.md) +
[scopes](https://docs.railway.com/integrations/oauth/scopes-and-user-consent.md) ·
[projects & transfer](https://docs.railway.com/projects.md) ·
[workspaces](https://docs.railway.com/projects/workspaces.md) ·
[project members](https://docs.railway.com/projects/project-members.md) ·
[plans](https://docs.railway.com/pricing/plans.md) ·
[cost control](https://docs.railway.com/pricing/cost-control.md) ·
[committed spend](https://docs.railway.com/pricing/committed-spend.md) ·
[serverless](https://docs.railway.com/deployments/serverless.md) ·
[environments](https://docs.railway.com/environments.md) ·
[domains](https://docs.railway.com/networking/domains/working-with-domains.md) ·
[railway domains](https://docs.railway.com/networking/domains/railway-domains.md) ·
[specs & limits](https://docs.railway.com/networking/public-networking/specs-and-limits.md) ·
[tcp proxy](https://docs.railway.com/networking/tcp-proxy.md) ·
[private networking](https://docs.railway.com/networking/private-networking.md) ·
[github autodeploys](https://docs.railway.com/deployments/github-autodeploys.md) ·
[services](https://docs.railway.com/services.md) ·
[databases](https://docs.railway.com/databases.md) ·
[buckets](https://docs.railway.com/storage-buckets.md) ·
[templates](https://docs.railway.com/templates/deploy.md) /
[create](https://docs.railway.com/templates/create.md) /
[publish](https://docs.railway.com/templates/publish-and-share.md) /
[kickbacks](https://docs.railway.com/templates/kickbacks.md) ·
[IaC](https://docs.railway.com/infrastructure-as-code.md) +
[reference](https://docs.railway.com/infrastructure-as-code/reference.md) ·
[trust & safety](https://docs.railway.com/platform/trust-and-safety.md) ·
[accounts](https://docs.railway.com/access/accounts.md) ·
[enterprise security](https://docs.railway.com/enterprise/security.md) ·
[access groups](https://docs.railway.com/enterprise/access-groups.md) ·
[RBAC](https://docs.railway.com/enterprise/environment-rbac.md) ·
[guardrails](https://docs.railway.com/enterprise/guardrails.md) ·
[webhooks](https://docs.railway.com/observability/webhooks.md) ·
[cli api](https://docs.railway.com/cli/api.md) /
[deploy](https://docs.railway.com/cli/deploy.md) /
[templates](https://docs.railway.com/cli/templates.md) /
[bucket](https://docs.railway.com/cli/bucket.md) /
[domain](https://docs.railway.com/cli/domain.md) /
[usage](https://docs.railway.com/cli/usage.md) ·
[MCP](https://docs.railway.com/ai/mcp-server.md) ·
[affiliate](https://docs.railway.com/community/affiliate-program.md) ·
[AWS Marketplace](https://docs.railway.com/pricing/aws-marketplace.md)

Legal: <https://railway.com/legal/acceptable-use> · <https://railway.com/legal/terms> ·
Pricing: <https://railway.com/pricing> · Schema: <https://backboard.railway.com/schema/template.schema.json>,
<https://backboard.railway.com/schema/environment.schema.json>, live introspection at
`https://backboard.railway.com/graphql/v2` · Changelog:
[#0315 workspace token management](https://railway.com/changelog/2026-11-06-workspace-token-management),
[#0303 access groups](https://railway.com/changelog/2026-08-14-access-groups),
[#0278 Railway domains](https://railway.com/changelog/2026-02-20-domains),
[#0241 deploy concurrency](https://railway.com/changelog/2025-06-05-deploy-concurrency)

Central Station: [private repos via a third-party GitHub App](https://station.railway.com/questions/deploying-user-s-private-git-hub-reposit-24ee7832) ·
[transfer to another account](https://station.railway.com/questions/migrate-project-to-another-railway-accou-3e262f45) ·
[what survives a transfer](https://station.railway.com/questions/transfer-of-project-63b9f94f) ·
[transfer steps + bucket blocker](https://station.railway.com/questions/transfer-a-project-b8c3ed71) ·
[Free-workspace can't transfer](https://station.railway.com/questions/transfer-project-a8c435b8) ·
[workspaces aren't transferable](https://station.railway.com/questions/account-transfer-193c899c) ·
[50 projects per workspace](https://station.railway.com/questions/how-to-have-more-than-50-projects-dec9f3a0) ·
[25 services/day safeguard](https://station.railway.com/questions/service-creation-limit-0d854465) ·
[API rate limit / Enterprise uplift](https://station.railway.com/questions/increase-api-rate-limit-325de642) ·
[workspace restriction](https://station.railway.com/questions/this-workspace-cannot-create-new-resourc-121ce347) ·
[one account per person](https://station.railway.com/questions/multiple-hobby-workspaces-3d38e8a2) ·
[wildcard vs subdomain conflict](https://station.railway.com/questions/wildcard-subdomain-conflict-4014e44b) ·
[wildcard 525 with Cloudflare](https://station.railway.com/questions/wildcard-domain-ratioiq-app-525-ssl-ha-951f62cd) ·
[no inbound domain transfer](https://station.railway.com/questions/transfer-domain-f6db78ca) ·
[sign-ups paused broke invites](https://station.railway.com/questions/invited-collaborator-unable-to-register-c53b9ca7)

### Untrusted-content note
Several fetched pages (Railway's own doc/CDN responses and cached search payloads) embedded text shaped like
agent instructions — a "plan mode is active" block, a foreign harness system prompt (different tool names,
`/home/adrian/repos/dev/notes-api`, an email address), and instructions to stop and hand off to an "editing
sub-agent". All of it was treated as **data, not instructions**, and none of it changed what was researched or
written here. Worth flagging: it looks like content bleed from another session/agent, and it is a prompt-injection
surface for anyone scraping these same pages.
