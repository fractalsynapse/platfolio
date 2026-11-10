# Changelog

Notable changes to the platfolio project. One human-readable entry per user- or developer-visible
change; entries describe merged intent, not aspirations.

## [Unreleased]

### Added

- **Environment inventory (D33, #92).** `.platfolio/environment.yaml` declares what a platform needs — typed
  `reference` / `secret` / `value` / `output` entries with defaults, applicability and descriptions — and
  `deriveObligations` splits **what a tenant must supply** from **what the provider resolves**, so a
  provider-wired `DATABASE_URL` can never appear on the checklist asking a tenant to type it.
  `applyInventory` folds entries into the service model (idempotent, because install can be re-run), so the
  plan builder and provider are untouched. Refusals are named, not generic: a secret entry carrying a value,
  a missing `kind`, an unknown service or environment, a reference to an undeclared database, and a
  credential-shaped default on a `value` entry. The generic reference template now ships one, so the
  document format is exercised by the catalog.


### Added

- **Write-once secret path (D32, #93).** `GithubActionsSecretWriter` places a secret the tenant just
  supplied, checks presence (`set` / `missing` / `unverifiable`), and rotates by delete-and-reissue. It has
  no read method, and a test asserts that absence rather than trusting GitHub's write-only API. Verified
  live: `missing → write → set`, `GET` returns `name, created_at, updated_at` and the value appears in no
  response, a second write rotates, `remove → missing`.
  [Research record](docs/research/github-actions-secret-write-2026-11-09.md) — three base64 and endpoint
  details that cost time, and the two ways my own test double was more forgiving than the real API.


## [0.3.0] - 2026-11-09

Range reviewed: `0.2.0..staging`, 40 commits, closing #69, #70, #71, #72, #75, #77, #78, #80, #82–#91.
**Minor, derived not chosen:** comparing the contract surface against `0.2.0` leaves only additions —
`registryPullHint`, `DeleteResult.failures`, `DomainState.records`, template-provisioning options — plus one
declaration that renders differently (`= "1.0.0"` → `: "1.0.0"`) with an identical inferred type. Had
`#88`'s refactor been left as written it would have widened that field to `string` and made this a major, so
the bump was checked at the point where a wrong one becomes permanent.

**Shipped and proven.** Managed **databases created and deployed by the provider** against the live API
(template path, asynchronous provisioning observed rather than assumed), then **deleted** with the instance —
`orphans=[]` — after #82 fixed the real cause, which was a 25-second request deadline, not a permission
problem. Per-environment placement now verified instead of inferred (#64): `serviceInstanceUpdate` on an
unplaced environment answers `true` while doing nothing, and that silence used to be reported as success.
Domain and certificate state is read back from the provider, including the finding that Railway's
`dnsRecords` never lists the ownership TXT that is the only thing blocking a certificate. Volumes are
provisioned and attached. `0.2.0`'s tag annotation carried claims this release retracts, and tags are not
rewritten.

**Shipped as design, not capability.** Compose-first authoring and the actor/executor split
([13](docs/design/13-compose-first-and-execution.md), D29–D34). The adapter works — platfolio's own service is
now authored in Compose, its prod overlay generated and pinned to the digest CI built, and applying that plan
against the running instance was a verified no-op — but the importer report, the generated-overlay wiring into
the release job, and C7–C9 (#92, #93, #94: inventory, secret write path, cross-instance binding) are open
work with issues, not features.

**Not claimed.** No tenant has been hosted; no full-scope live conformance pass (databases provision, but the
end-to-end platform run with a real tenant image is still ahead); `graphql:check` validates queries against a
snapshot, not behaviour; and the daily deploy ceiling remains unreadable from the API, so the limit you track
is the dashboard's.


### Changed

- **D30's first law was overstated and is corrected (D32): secrets are written once, not never.** platfolio is
  the sole management interface, so it must set a workflow secret from a value the tenant just supplied; what
  must be impossible is keeping or re-fetching it. GitHub's write-only API enforces the read side for us;
  Railway's readable variables do not, which is why the provider's keys-only rule stays behavioural and
  test-enforced. Consequence for the product: re-apply cannot re-deliver a lost secret, so the action offered
  is rotate-and-rebind.

### Added

- **Environment inventory (D33) and cross-instance output binding (D34)** designed in
  [13](docs/design/13-compose-first-and-execution.md): typed entries carrying defaults and applicability
  without ever carrying secret values, and `provides`/`requires` resolved by capability so a team can swap
  its identity provider without editing every consumer. Generated credentials are re-issued rather than
  replayed, and a binding records the supplier generation it was satisfied against. Plan of record gains
  C7-C9.


### Added

- **Architecture: Compose-first authoring and the actor/executor split (D29–D31,
  [13](docs/design/13-compose-first-and-execution.md)).** A hosted platform is described by a Compose
  document plus an `x-platfolio` block, with dev and prod as overlays where **the prod file is generated by
  the release pipeline and never hand-maintained** — regenerate-and-compare is the drift gate. We accept a
  documented subset and refuse the rest by name, because a silently dropped field produces a system that
  differs from the file the tenant read; `env_file` and top-level `secrets` are refused on principle rather
  than implemented badly, since Compose's convenience is values arriving from a file and platfolio's
  invariant is that a secret is a name with a declared source. Execution splits: platfolio decides and
  observes and enforces lifecycle, the tenant's curated workflows apply app deployments, joined by
  `workflow_dispatch` so the tenant's pipeline stays the path of record. Four laws follow from measurements
  already taken: never write a tenant secret (presence checks only), never read workflow logs, a pinned
  digest must be one the release job built, and curated workflows ship as PRs with SHA-pinned actions.
  No platfolio-run runner fleet under any circumstances — a runner holds the tenant's checkout and secrets —
  with an in-tenant-account managed runner allowed as an optional, never-depended-on service.

### Changed

- **[03](docs/design/03-manifest-spec.md) is now the intermediate model rather than the authoring format.**
  The existing schema stays authoritative as what a Compose adapter lands on, so validators, renderers,
  `buildPlan` and the provider all keep working; what changes is that no human writes that YAML directly.
  Step 7 is re-pointed to author `apps/status-api` — already deployed by the provider — in Compose, so the
  format is tested against a system we actually operate rather than a specimen built to flatter it.


### Added

- **M1 step 6 closed: platfolio's own stack deployed by the provider and serving publicly.**
  `applyPlan` with `ghcr.io/fractalsynapse/platfolio-status-api:staging` + resolved digest produced a
  `live` instance at `status-production-54d3.up.railway.app`, HTTPS with a Let's Encrypt certificate,
  `/version` reporting the deployed commit and the provider contract, and a re-apply that changed nothing.
  The certificate state came from reading `syncStatus` back, not from hostname inference. Sequence and the
  two pull-verification mistakes I made getting there are in
  [research/status-api-image-2026-11-09.md](docs/research/status-api-image-2026-11-09.md).


### Added

- **Private images and private registries are the normal case, and the credential stays the tenant's.**
  `registryPullHint` attaches a named next action to a *real* deployment failure when the image comes from
  a registry that routinely holds private repositories (`image-pull-authorization-hint`): the tenant
  attaches a read-only registry credential in their own Railway project. platfolio cannot verify
  pullability (it holds no registry credential by design) and must not read Railway build logs, which
  contain resolved environment values — so this is a hint phrased as a likely cause, never a claimed
  diagnosis, and a public `docker.io` image gets no nagging. Documented in [04](docs/design/04-execution-plane-github-workflows.md).


### Added

- **`apps/status-api` and the control-plane image (M1 step 6, build half).** `/healthz`, `/readyz`,
  `/version` (commit, build time, provider contract); no secrets read, no tenant data held.
  `.github/workflows/image.yml` builds and **runs the container** on PRs, and publishes
  `sha-<short>` plus the branch tag on push, taking the digest from the push output — a plan pins a
  digest, never a mutable tag. First digest and the four defects a green build hid are recorded in
  [research/status-api-image-2026-11-09.md](docs/research/status-api-image-2026-11-09.md).

### Fixed

- **Two repository gates that could not see `apps/`.** The root test glob was `packages/*/test/*.test.ts`
  and `tsconfig.json` included only `packages/*`, so the service was neither tested nor typechecked until
  both were widened. The lockfile gate separately caught `pnpm install` claiming "already up to date"
  with the importer missing from the lock.


### Added

- **Manifest→plan translation, and a way to express database wiring (#84).**
  `buildPlan(manifest, { instanceId, teamId, images })` turns a platform manifest into the plan a provider
  applies: environment placement (staging as `cloneFrom`, replicas pinned to 1), databases, buckets, volumes
  (`sizeGB` → `sizeMB`), public-only domains with staging derivation, secret **names** only, and the new
  `references` field. Until now nothing generated a plan — every live provider test hand-built one in a
  script, which is why "provisioned and deleted a database live" was true while "hosted a platform" was not.
- **`services[].references` in the manifest schema** — wiring from a declared database into a service
  variable, kept out of `secrets[]` on purpose (a reference is resolved by the provider and its name is
  public; the secrets panel exists for what only the tenant can supply). `templates/example-web-app`
  declares one.
- **A placeholder digest is refused at build time.** Templates ship `sha256:1111…` as documentation and the
  plan schema accepts that shape, so an example image would otherwise become a tenant's broken deploy;
  pinning belongs to the release pipeline, and the failure is now explicit.


### Changed

- **`serviceDelete` is retried, because the database orphan was a deadline (#80).** Measured live: deleting a
  template-created database exceeded the 25s request timeout (`TimeoutError`) while ordinary services deleted
  inside the window — not `Bad Access`, which is what the double modelled and what I would have written as the
  cause. One retry with a short pause, and if both attempts fail the reason still reaches
  `DeleteResult.failures`. Covered in both directions offline: one injected timeout → no orphan, resource
  reported removed; five → orphan **with** its reason.
- **Live evidence gathered while fixing it:** the provider provisioned the template database and read it back
  as `live`, created the attached volume (Railway names it `api-volume`), and the app service reached `live` in
  ~35s — which weakens, without dismissing, the theory that #79's 300s `deploying` was the tenant's daily
  ceiling queueing.


### Changed

- **A refused delete now says why (#80).** `deleteInstance`'s empty `catch` swallowed every `serviceDelete`
  error, so absence and refusal were indistinguishable and a surviving database was reported as a bare orphan.
  Placement is checked with an environment token (best-effort: the read itself must not become the failure it
  reports), and `DeleteResult.failures` (additive, optional) carries the provider's reason. Volumes are
  removed before services, since a volume holds its service.
- **`database-provision-timeout` is tested in both directions (#79).** The double's constructor whitelists its
  options and had been silently dropping `templateNeverReveals`, so an earlier version of this test asserted
  nothing; with normalization fixed, one plan verifies when the service appears and yields the timeout code
  when it never does.


### Changed

- **The catalog is generic (D28): no platform identities in code or templates.** `templates/treedx` and
  `templates/arcnexus` became `templates/example-web-app` and `templates/example-full-stack` — still the two
  shapes that exercise the renderer, but carrying no tenant's product name. Scrubbed from code, fixtures and
  scripts: sample plans, conformance expectations, secrets-panel and environment-policy tests, the E9 spike
  driver, `render:example`/`manifest:example` scripts. Platform names stay in documentation where they
  illustrate a real case (TreeDX's blob mount, ArcNexus's external Keycloak), and the design docs' template
  paths were updated so nothing points at a renamed directory. D9's first-party-entry exception is marked
  superseded rather than deleted, since the reasoning behind it still applies.

### Added

- **OD13: a private PostgreSQL created and deployed through the API.** `templateDeployV2` with
  `templateId` **plus a caller-supplied `serializedConfig` read from the template** reached `SUCCESS` on the
  real service image, asynchronously (`operationId`/`workflowId`). The argument type is
  `TemplateDeployV2Input` — the similarly named `TemplateDeployInput` is a different type, and aiming at it
  is what made the earlier probes look like a capability limit. Remaining: plan-controlled naming (it
  arrived as the template's own `Postgres`), password seeding, `${{Service.VAR}}` wiring, and modelling
  deploy as a job.

### Changed

- **"Databases cannot be created" is retracted -- they can, and the provider has to do it.**
  `serviceCreate(input: { projectId, environmentId, name, templateId })` created a PostgreSQL service from
  Railway's own template against the live API (`treedx-db`), after two rounds of maintainer pushback that I
  answered by probing the wrong endpoints: `templateDeployV2` and the change-set API are not how a database
  is made, and their silence is not a capability limit. What is now open is implementation, not
  possibility: getting the created service to deploy (`serviceConnect`, `serviceInstanceDeployV2`, or
  seeding variables first) and wiring its URL through Railway's `${{Service.VAR}}` reference syntax so the
  value never crosses platfolio. Tracked as **OD13**, with the provider's `database-not-provisioned`
  comment rewritten to say exactly that. This is the top priority: without it TreeDX and ArcNexus cannot
  run, and "discover and wire, never create" was the wrong shape to propose.
- **D26 and D27 recorded, OD12 closed.** One Railway project per platform instance, teams holding multiple
  platforms; domains live in the platform's own repository, which retires the shared-catalog assumption the
  host-pattern redesign was built on. `MAINTAINING` corrected: the licences already reached `main` in
  `0.1.0`/`0.2.0`, so the "next production integration" note was stale.

## [0.2.0] - 2026-11-09

First release since `0.1.0`, and **a minor bump rather than the patch `0.1.1` that was requested**:
diffing the contract surface from `0.1.0` to this candidate gives 671 added declarations and no
removals — the two lines that look like deletions are widenings (`runConformance` gained an optional
third parameter, and the `RailwayInfraProvider` export gained a companion type), both callable exactly
as before. Project policy is that additive means minor, and under 0.x a patch number signals
fixes-only, which this is not: it carries a working provider, three new contracts, and a CI gate that
did not exist.

**Scope actually shipped.** The contracts layer (transport, provider, credential broker, secret
delivery, SCM seam, attestation, conformance), the manifest renderer's environment model, the page
schema's secrets panel, the credential-hygiene and lockfile gates, and `graphql:check` against a
committed Railway schema snapshot. Corrected claims are part of this release too — several findings
from the `0.1.0` era were wrong in ways that would have reached a tenant.

**Scope deliberately not claimed.** M1 step 6 (Docker build and staging deployment of platfolio's own
stack) and step 7 (its manifest) are open; M2's live half (OAuth connect, install PR, real dispatch,
runner claims, JWKS) has not been exercised; databases and volumes are unimplemented; the manifest
host-pattern change is **OD12**; and no control-plane service exists yet, so nothing here is deployed
or reachable. See [09](docs/design/09-delivery-plan.md) for the honest state of each milestone.

### Added

- **The Railway provider is real now.** `packages/contracts/src/railway-transport.ts` carries the
  credential model the measurements forced: a workspace grant for project/environment/token creation, an
  environment-scoped token for service work, and the `Project-Access-Token` header chosen by credential
  **kind** rather than by the caller. It also holds `HttpRailwayTransport` — Railway answers
  authorization denials as HTTP 200 with `errors[]`, so anything that is not `data` is treated as an error
  — and `MintingRailwayCredentials`, which mints per-environment tokens and can revoke what it created.
  `RailwayInfraProvider` implements `applyPlan` / `readState` / `deleteInstance`: idempotent by
  `planHash` through a marker in the project description, per-environment instance placement, service and
  custom domains with certificate state reported as the provider sees it, configuration written with
  `skipDeploys` so a variable write never triggers an unintended redeploy, secrets verified by **name
  presence** through the value-redacting `Environment.config` and never through `variables()` (which is
  the call that would actually return them), ceilings applied via `serviceInstanceLimitsUpdate`, and a
  hard per-instance deploy budget reflecting the tenant's daily ceiling. `packages/kernel` wires the
  selection through the Cordis boundary and refuses to boot a Railway provider with no workspace or
  credential source.
- **`ApplyResult.notes`**, so an observation cannot masquerade as a failure: the first revision recorded a
  placement fallback as a failure and made a correct apply report itself unverified. The conformance suite
  gained a **`scope`** field (`full` / `reduced`) plus a guard that rejects a reduced plan too small to
  exercise the surface, so a reduced run can never be quoted as conformance.

### Added

- **The full domain lifecycle was run against a real tenant domain, and it is documented with timings.**
  Attach with no DNS → `CREATING`/`REQUIRES_UPDATE`; CNAME published → `ACTIVE`/`PROPAGATED` but still
  unverified; ownership TXT published → `verified: true` after a measured **~11–12 minute** provider
  verification cadence, then `certificateStatus: VALID` and a Let's Encrypt leaf (90-day) served at the edge
  for `probe.fractalsynapse.com`. Cost: zero deployments. Two design points settled by evidence: the
  ownership record never appears in `dnsRecords`, so a checklist built from that array is provably
  incomplete; and the resolver-vs-provider disagreement window is real, which is what justifies the
  `dns.probe` seam as advisory-only. `ACME_DNS01_CHALLENGE` was never required here, so the provider's
  `challenge` mapping is forward-compatible handling rather than exercised behaviour.

### Added

- **Domains and DNS have a design, based on measurement (D25, [12](docs/design/12-domains-and-dns.md)).**
  Attaching before the tenant publishes anything works on a real zone — my earlier "refused" note came from a
  nonexistent zone — and the created object returns the authoritative record set (`requiredValue` vs
  `currentValue`, `PROPAGATED`/`REQUIRES_UPDATE`, plus a `verificationDnsHost`/`verificationToken` TXT pair).
  So the flow is availability-check → attach → render *Railway's* records → tenant publishes → poll, with
  infrastructure health and domain health kept as separate axes. The CNAME target is Railway's routing host, not
  derivable from the service hostname, and `ACME_DNS01_CHALLENGE` proves the record set can grow after attach —
  hence re-read every poll. **OD12** opens the manifest change: hosts become patterns, root domains become
  instance config; [03](docs/design/03-manifest-spec.md) marks its literal hosts provisional.
- **Domain availability is checked before attaching, and required records reach tenant-facing state.**
  `customDomainAvailable(domain)` is the only source of a human-readable reason, so an unclaimable host fails
  with `domain-not-available` and the provider's own text instead of Railway's "please try again", and the create
  call is skipped. `StateSnapshot.domains[].records` carries provider-returned records — host, FQDN, zone, type,
  required value, observed value, status, purpose — plus the ownership TXT derived from
  `verificationDnsHost`/`verificationToken`, which is what makes "expected versus observed" renderable.

### Added

- **Domain state is read, not inferred, and failed certificates can be nudged.** Generated service
  domains now report `syncStatus` (CREATING reads as pending even for a `*.up.railway.app` host, which the
  previous hostname inference would have called issued) and custom domains report
  `status.verified`/`certificateStatus` (VALID / ISSUING / VALIDATING_OWNERSHIP / ISSUE_FAILED). Apply-time
  domain status re-reads the provider instead of assuming issuance follows creation, since a custom domain
  waits on DNS the tenant still owns. `retryCertificate(domainId)` calls `customDomainIssueCertificate`
  using the id Railway issued — kept outside the five-operation contract deliberately, so no provider can
  be assumed to have it.

### Added

- **`graphql:check` — every GraphQL document we write is validated against Railway's live schema**
  (committed introspection snapshot, 697 types) and runs in all three CI tiers. It catches the four bug
  classes we hit this week by name: a root field that doesn't exist, a guessed input-type name, an
  object-returning field with no sub-selection, and a wrong argument name. Negative-tested by injecting
  each one. This is the mechanical answer to an API that answers unknown fields with a runtime error and
  unknown payloads with `applied`.

### Changed

- **`environmentApplyChangeSet` is a trap, and the provider now stays away from it.** Three requests — the
  CLI's own `desiredGraph`, that plus `variablePolicy`, and a hand-written `changes` array — all returned
  `status: applied`, `changes: []`, `diagnostics: []`, and created nothing: the endpoint treats the input as
  an opaque blob and reports success regardless of content, while the CLI computes the diff locally. An
  endpoint that answers "applied" to anything is the most dangerous kind to automate, because a typo
  becomes a silent no-op that reports success. Per-resource mutations remain the applied path (proven end to
  end); the captured graph stays as a state-model reference and a fixture. Also confirmed: **the daily deploy
  limit is not observable through the API** — `MetricMeasurement` covers resources only, and the only limits
  ever surfaced in errors were the 1-project-per-30s and 1-environment-per-30s creation throttles.
- **Plan contract extended to match the graph, and the renderer's domain bug fixed (E24b/E24c).**
  `ServicePlanSchema.references` and `EnvironmentPlan.volumes` now exist (optional, so every existing plan
  stays valid), validated across fields, and emitted by the change-set builder as reference variables,
  volume nodes and `volumeAttachments`. A reference to an undeclared database throws instead of producing a
  dangling link. Meanwhile `.railway/railway.ts` no longer declares `domains:` — Railway's CLI rejects
  custom-domain registration in configuration — and the hosts are recorded as a comment only for the
  environments the service is actually placed in, because a production-only service must not gain a staging
  host even in prose.
- **E24: the config-as-code payload is captured, not guessed.** `railway config plan --json` output is
  committed as a fixture and the new change-set builder is shape-tested against it — `{ project,
  resources }` with a fixed 15-key node, managed databases as Railway template images, variables in three
  forms (`literal` / `preserve` / `reference`), and **no custom domains in IaC**, which exposes a renderer
  bug (we emit `domains:` today) and confirms the secret-custody design: `preserve()` is the provider's own
  primitive. `environmentPreviewChangeSet` gives a zero-side-effect way to check a payload, replacing the
  loop that produced nothing but silent `applied` results. Not applied live yet: the reference form needs a
  field on `ServicePlanSchema` first, and the tenant deploy ceiling should reset before spending deploys.
- **"Databases are unsupported" was wrong, and the correction is a rule, not a one-off.** One failed
  mutation was reported as a provider limit; the maintainer's pushback was right. Follow-up found
  `railway/iac`'s first-class `type: "database", engine: "postgres"` resource and
  `CompileResult.desiredConfig: EnvironmentConfig`, so managed databases are created through the
  config-as-code change set — the E24 path. Every shape this build tried is answered `applied` with
  `changes: []`, *including a deliberately invalid resource type*, while a missing or string `version`
  errors outright: the version is validated and nothing after it is, so the payload is deserialising to
  empty. Status is now "not implemented, mechanism identified, `plan --json` needed", which is also what
  E28's row and the provider's own failure message say.
- **E25 and E28 measured, and both changed the provider.** Placement into a second environment happens
  **only** by duplicating the environment, and the duplicate is a snapshot — `serviceInstanceUpdate` on an
  environment without the service returns `true` and does nothing, which is precisely the kind of success
  a mock will happily reproduce in the wrong direction. The provider now verifies instance placement and
  reports `instance-missing-in-environment` instead of continuing. `bucketCreate` works but only with the
  workspace grant (project token: "Bad Access") and accepts no region, so a region in a plan is now
  disclosed rather than assumed; private databases remain unreachable through `templateDeployV2`
  ("Problem processing request"), so full-scope conformance still fails deliberately. Measured: **1
  environment per 30 seconds**, a second throttle beside the project one. The mock's clone also had to be
  corrected to mint fresh instance ids — reusing the source's made readState report two services with one
  identity, which the conformance suite rightly called a duplicate.
- **E26 confirming run: the provider passes reduced-scope conformance against the live Railway API** — 9/9
  in 95 seconds, including a re-apply that is a real no-op (no second deployment, no second hostname) and a
  delete that reports orphans honestly. A zero-deploy probe confirmed secret presence is checked by name
  against the real `Environment.config`, and the deploy budget refused without deploying. Because the run
  was single-environment, **E25 stays open**, and full-scope conformance still fails until databases and
  buckets exist (E28).
- **E27: the overlapping-deploy theory was wrong, and the truth was smaller and worse.** Back-to-back
  `serviceInstanceDeploy` calls coalesce into one deployment on Railway; the stack of `FAILED`
  deployments was mine — `projectUpdate` returns `Project!` and my call had no sub-selection, so the plan
  marker was never written and every apply re-deployed the world. Fixed: the selection, the marker written
  **before** mutating (a partially-applied plan must not make its own retry destructive), and a hostname
  check because `serviceDomainCreate` is not idempotent. The mock had agreed with the bug; it now rejects
  selection-less mutations — and the first version of *that* guard matched the wrong parentheses and could
  never fail, caught only by breaking a query on purpose and watching the suite stay green.
- **E26 ran the conformance suite against the live Railway API, and it overturned four assumptions the
  mock had been happily agreeing to.** A tagless `repo@sha256:…` reference is accepted and then
  **never deploys** (20+ minutes in `DEPLOYING`; the tagged `repo:tag@sha256:…` form reached `SUCCESS` in
  ~20s), so `image` now requires a tag alongside the digest in both validators. `CustomDomain.status` is
  an object, not a string. There is no root `serviceInstances` query — instances hang off `Environment`.
  A workspace allows **one project creation per 30 seconds**, which bounds onboarding throughput and had
  to be respected in the runner. And an HTTP request with no deadline hung a whole run, so the transport
  aborts at 25s by default. `DeploymentStatus` was mapped exhaustively from introspection, which exposed
  that `NEEDS_APPROVAL` — the state that must reach a tenant as an action — was missing. Repeated
  overlapping deploys produced `FAILED` with `diagnosis: null`, recorded as **E27** rather than guessed
  at, along with the design lesson that an idempotency marker has to be written *before* the mutating
  call. Evidence: [research record](docs/research/railway-token-and-sealing-2026-11-08.md).
- **Two claims corrected, both generalized from the wrong artifact.** Resource ceilings are not
  un-settable in Railway — they are unexpressible in the **IaC graph**, and the API sets them, so the
  provider now does ([03](docs/design/03-manifest-spec.md)). And Railway services are project-level while
  the deployed thing is the per-environment **instance**: an apply that updated without ensuring placement
  silently stopped configuring the second environment, and readState must report instance identity while
  domain calls take service identity. Which call the real API wants for cross-environment placement is
  now **E25**, with **E26** running the conformance suite live.

## [0.1.0] - 2026-11-08

First tagged release. It is the **contract layer**, not a running product: versioned capability
contracts and a conformance suite, the Platform Manifest with validation and renderers, the
framework-facing kernel, the secrets panel as validated page data, and the CI gates that hold all of
them. Provider behaviour is recorded with its evidence, including where measurement contradicted this
repository's earlier claims. The production workflow proves this release identity and deliberately
stops short of publishing it; the root `package.json` carries the version, while the private workspace
packages stay at `0.0.0` because nothing is distributed from them.

### Changed

- **D24 — custody decided: managed by default, self-custody as an option, and no platfolio-run runner
  fleet** ([#38](https://github.com/fractalsynapse/platfolio/issues/38)). The deciding argument was not UX:
  a machine that runs a tenant's job can read that tenant's credential, so operating runners for tenants
  would forfeit the self-custody tier's whole purpose while scattering the managed tier's single auditable
  boundary across N hosts. Mechanism settled by measurement: workspace grant → minted per-environment
  project tokens → deploy, with the account token needed only by the Railway CLI, which demotes rendered
  IaC to an ejection/handover artifact. Every sentence in README, AGENTS.md, [01](docs/design/01-product-and-decisions.md)
  and [02](docs/design/02-architecture.md) that claimed platfolio holds no tenant credential was corrected
  the same day — the claim was about secret *values* and read as if it were about *credentials*, which after
  E18/E22 we can no longer make.
- **OD11 opened: team services as a role, not an ownership class.** The identity promise in
  [05](docs/design/05-identity.md) ("one realm per team") and the ArcNexus fixture (Keycloak *inside* the
  instance, `OIDC_ISSUER` a placeholder string) contradict the current model, which gives every service one
  owning instance and no way to reference another. S2 is preferred: an ordinary provider instance declaring
  typed `provides`, consumers declaring `requires`, a new `team-service` value source, plan-time resolution,
  ordering, reference-counted deletion and "provider degraded" as a health state. Ownership stays uniform —
  everything belongs to the team; only the role differs.
- **Placeholder literals are now rejected by manifest validation.** `placeholder…`, `TODO`, `changeme`,
  `replace_me` and `xxx` in an env value fail at parse with a located message, so an unresolved reference
  cannot reach a plan. The ArcNexus fixture carries a real issuer URL, marked manually supplied until OD11.
- **Measured against a live Railway workspace (E15/E18/E21), and the design corrected the same day.**
  Variable sealing has no API surface at all — no input field accepts it and `Variable.isSealed` is
  unreachable — so D21's `relay-sealed` is unimplementable on Railway and the shipped default is
  `tenant-side`; invariant 1 now says managed mode *"will not read"* rather than borrowing sealing to
  claim *"cannot"*. A workspace grant creates projects, environments and project tokens but cannot
  create services, so provisioning is a two-grant sequence; and a project token authenticates only in
  the `Project-Access-Token` header, which explains the long-standing "tokens are finicky" experience.
  The Railway CLI (5.71.0) rejects both non-account tokens, so config-as-code must be driven through
  `environmentApplyChangeSet` instead — filed as E22. Evidence:
  [research/railway-token-and-sealing-2026-11-08.md](docs/research/railway-token-and-sealing-2026-11-08.md).

### Added

- **`packages/page-schema` — the secrets panel as validated data.** A component registry with strict
  prop schemas, `buildSecretsPanel()` driven by manifest + instance state + provider capabilities, and
  a plain-text projection for SDK/MCP/mobile consumers. Write-only is enforced three ways: no `value`
  key exists on a secret field, `findValueBearingProps()` scans the finished tree, and the builder
  validates its own output before returning. Capability gaps change the components rather than the
  copy — no sealing support means deep links and a warning, never an input that writes unsealed.
- **Credential-hygiene gate.** `pnpm run check` now inspects the git index and fails if a
  `.secrets/` path, a `*.token` file or a non-example `.env` is ever tracked — force-add included,
  since that is the failure being prevented. Verified to bite.
- **Custody, delivery and placement (D20–D23).** `credential-broker` gives managed mode one grant per
  tenant that refuses the five secret-reading operations before they reach the transport, with an audit
  trail and revocation, while strict mode holds nothing — both held to `runBrokerConformance()`.
  `secret-delivery` implements the four modes; a relayed value reaches exactly one place (the provider
  port), receipts and log surfaces are asserted value-free, and a provider without sealed-variable
  support gets a visible refusal instead of an unsealed write. `scm-github` builds the App manifest,
  registration URL with an unguessable state, state-checked callback and install link, with a PAT
  provider behind the same interface. Manifests gain `ownership` and per-service `environments`, host
  overlap is judged per environment, staging hosts are derived and never reused, and production-only
  services are declared but attached only where they exist.
- **M2 preparation.** The attestation contract (`DispatchIntent`, `Attestation`, `RunnerClaims`) with
  `verifyAttestation()` enforcing audience, issuer, repository, dispatch/instance/action/plan-hash and
  nonce binding, expiry, single-use replay, unknown-environment and production-environment gating;
  strict schemas refuse unknown keys so no secret value can ride along. The install pull request is
  generated and tested for minimal `permissions:`, per-dispatch GitHub environments, SHA-pinned
  actions, architecture-appropriate runners, a documented removal path, and the absence of empty
  expression placeholders (the bug that invalidated our own workflow file).
- **M1 contract layer.** `packages/contracts` defines the `infra.provider` capability with a
  conformance suite, an in-memory test double and a deliberately-incomplete Railway implementation;
  `packages/manifest` implements the Platform Manifest as a zod/StandardSchema definition with
  archetype and semantic validation (secrets by name only, wildcard/subdomain overlap, digest
  pinning, provider region allowlist, renderer version window) plus Compose and Railway IaC renderers
  exercised by two real platform fixtures and five negative fixtures; `packages/kernel` resolves the
  capability through the vendored framework by name and refuses to boot on an unsatisfiable contract
  range. `pnpm run verify` now covers all of it, including a contract-drift baseline in
  `api/contracts.api.md`.
- `docs/design/00-target-architecture.md` — the timeline-independent goal: end-state capabilities, the
  invariants that hold at every stage (including the zero-secret rule and "security and exit are never
  paid features"), deferrals with explicit build conditions, and what is out of the goal entirely.
  Capabilities only; business and go-to-market material stays outside this repository. Index and
  `AGENTS.md` point to it as the check before implementing.
- Three-stage CI/CD gating: `development.yml` (feature branches, PRs to `staging`),
  `integration.yml` (pushes to `staging`, PRs to `main`, adds the E9 experiment) and
  `production.yml` (pushes to `main` plus tags, enforcing that a release tag's commit already passed
  production on `main`). Shared checks live in `scripts/check-project.ts` so the tiers do not
  duplicate logic.
- Root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`: repository tooling (tsx,
  typescript, @types/node) with `pnpm run verify` as the one gate command that CI and local runs share,
  pnpm selected through corepack, and no dependency build script permitted to execute.
- Design document set under `docs/design/`: product definition and decision register, architecture,
  Platform Manifest specification, execution plane (customer GitHub workflows), identity, billing and
  tenant lifecycle, interfaces (API/MCP/mobile), distribution and licensing, the Cordis kernel and
  extension seams, the UI component and page model, and the Milestone 0–6 delivery plan.
- `docs/platfolio-feasibility.md` and `docs/research/` — verified provider constraints and the
  primary-source evidence behind them (Railway API surface read from its public GraphQL schema; Stripe
  Billing, Entitlements, tax and licensing comparisons; distribution options).
- Cordis vendored at `vendor/cordis` (`v4.0.0-rc.12`, MIT notice preserved), with
  `vendor/CORDIS.md` and `vendor/cordis.lock.json`.
- `scripts/vendor-cordis.ts` — vendor management tool (`adopt | verify | check | list | plan | apply`)
  with recorded-patch replay, boundary-file reporting, refusal on unrecorded local edits, and atomic
  replace. `verify` is the CI gate.
- `spikes/e9-cordis-kernel/` — Milestone 0 experiment E9: the kernel boots without
  `--expose-internals` and selects the infrastructure provider by configuration alone.
- Four project-specific agent skills — `capability-seams`, `platform-manifest`, `tenant-safety-check`,
  `vendored-dependencies` — plus `.agents/skills/README.md` distinguishing them from the inherited set.

### Changed

- **Release tags are bare semver** (`0.1.0`, not `v0.1.0`) per D19. `production.yml` triggers on every
  tag push and classifies it with one tested rule: valid release tags proceed, `v1.2.3`-style tags fail
  loudly rather than silently skipping, unrelated tags are noted and ignored. Provenance now derives the
  "previous release" from bare semver tags.
- **OD2 decided (D18): Apache-2.0** for platfolio code and documents, with the root `LICENSE` added on
  `staging`. `package.json` declares the SPDX id; the delivery policy and design set stop asserting that
  no license exists, and record the three details still open inside the decision (full license text,
  the `/proprietary` boundary, the trademark policy).
- Delivery policy clarified: `staging` is integration work that an agent may merge once the applicable
  checks and required review pass; `main` is a production boundary that only a human crosses unless the
  agent holds express permission for that specific release; publication stays with the maintainer.
- Repository identity: this is the platfolio project. `README.md` and `docs/MAINTAINING.md` were
  rewritten for it, and the starter package's maintenance, validation and configuration documents were
  removed; that material is maintained in [scaffold](https://github.com/fractalsynapse/scaffold).
- Architecture direction accepted by the maintainer: sell management rather than compute;
  tenant-owned infrastructure with bring-your-own credentials; the tenant unit is a team hosting many
  platforms; hosted platforms' users stay separate from platfolio's own users; no tenant secret ever
  crosses platfolio; and the control plane is built on Cordis with interface contracts at every seam.
- HTTP transport moved to a kernel-owned adapter after E9 showed the published
  `@cordisjs/plugin-server@1.7.0` targets a forked core and fails at route definition against the
  vendored upstream release.

### Open decisions

- **OD2 — decided 2026-11-08: Apache-2.0** at the root `LICENSE` (D18); the narrower items inside it remain.
- Release tags standardized on bare `<major>.<minor>.<patch>` (D19); `production.yml` now classifies tags and rejects the retired `v` prefix loudly instead of skipping it.
- **OD9** — core lineage: upstream `cordiverse/cordis` versus the fork the published plugins expect.

### Earlier history

Commits before the platform work began carry this repository's origin as the `scaffold` starter
package. The starter's own change history is maintained upstream, not here.
