# platfolio — Platform Manifest specification (v0.1, proposed)

The contract between platfolio and a hosted platform. Everything else is a rendering of it:
Docker Compose, Railway IaC (`.railway/railway.ts`), the GitHub workflow inputs, the Stripe
catalog, the DNS panel, the provisioning plan, and the connect-form.
Status: **specification, not implemented.** Vocabulary follows Railway's verified IaC DSL and
GraphQL surface; sources are in [feasibility](../platfolio-feasibility.md).

## Why this document exists first

Without a versioned contract, "manage a portfolio of repositories" degrades into per-platform
copy-pasted environment lists that only work on the day they were written. The manifest is the
product's core IP; the admin UI is derivative. It must be reviewable, diffable and machine-validated
before any customer-facing feature depends on it.

## Format status (D29 — this document is becoming an input adapter)

**Accepted 2026-11-09: Docker Compose is the authoring format** ([13](13-compose-first-and-execution.md)). The
schema sketched below stays authoritative as the **intermediate model** — Compose parses into it, the
renderers, validators and `buildPlan` keep consuming it, and nothing downstream changes. What is superseded is
the idea that a human authors this YAML directly: a platform's source of truth becomes `compose.yaml` plus an
`x-platfolio` block, and this document's job is to specify that model precisely because it is what an adapter
must land on. Where a field below has a Compose-native equivalent (`image`, `build`, `environment`,
`healthcheck`, volumes, `depends_on`, limits, replicas), Compose wins and the adapter maps it; where it does
not (environment placement, ownership, custody sources, identity clients, DNS policy, lifecycle, plan,
release pinning), it lives under `x-platfolio`.

## Design rules

1. **Names, never values.** No field may hold a secret value. Secrets are declared by name with a
   `value_source` (§ Secrets). This is decision D4, enforced by the schema (`additionalProperties`
   plus a lint that rejects anything looking like a key).
2. **Declarative intent, no imperative steps.** The manifest says what should exist; the execution
   plane decides how. No shell, no ordering primitives, no scripts beyond named hooks.
3. **One vocabulary for two renderings.** Field names mirror Railway IaC (`source`, `build`, `start`,
   `healthcheck`, `preDeployCommand`, `replicas`, `env`, `domains`, `volumeMounts`, `postgres()`)
   so the renderer is a mapping, not a translation, and compose stays structurally equivalent.
4. **Archetypes carry defaults** so a real manifest is short, and so an entire class of platform
   can be validated by one fixture.
5. **Versioned and self-describing** — the renderer refuses a manifest major it does not know.

## Schema (normative sketch)

```yaml
apiVersion: platfolio.dev/v1alpha1
kind: Platform
metadata:
  name: arcnexus
  version: 0.9.2                # semver of the PLATFORM RELEASE, not of the manifest
  title: ArcNexus
  summary: Multi-agent architecture studio
  archetype: full-stack-web     # api-service | full-stack-web
  repository: https://github.com/acme/arcnexus
  architectures: [amd64, arm64] # build targets; self-hosted runners honour this
  changelog: CHANGELOG.md#L0-9-2
  license: Apache-2.0           # what the CUSTOMER receives; must not be restrictive
spec:
  requires:
    platfolio: ">=0.4 <1"       # renderer compatibility window
    migration_window: 15m
  identity:
    mode: byo-oidc | hosted-realm | none
    client:                     # only when the tenant gets a platfolio-hosted realm
      protocol: openid-connect
      redirectUris: derived     # from domains[] at render time
      logoutUris: derived
      userAttributeNamespace: acme.example/
      roles: [studio-admin, studio-user]
    requiredClaims: [sub, email, preferred_username]
  environments:
    production: { enabled: true,  branch: main }
    staging:    { enabled: true,  branch: staging, cloneFrom: production }
    preview:    { enabled: false }
  resources:
    database: { kind: postgres, name: arcnexus-db }       # Railway postgres() | compose service
    cache:    { kind: redis, name: arcnexus-cache }
    storage:  { kind: bucket,  name: arcnexus-media, region: iad }   # optional
    volumes:  [ { name: workspace-data, mountPath: /data, sizeGB: 10, service: worker } ]
  services:
    frontend:
      source: { image: ghcr.io/acme/arcnexus-web }        # digest-pinned by the release job
      build: { repository: acme/arcnexus, rootDirectory: apps/web }  # only when not image-based
      ports: [3000]
      healthcheck: /api/health
      start: node build/index.js
      preDeployCommand: null
      replicas: { production: 2, staging: 1 }
      limits:   { cpu: 1, memoryGB: 0.5 }
      domains:  [ { host: app.example.com, port: 3000 } ]
      dependsOn: [backend]
    backend:
      source: { image: ghcr.io/acme/arcnexus-api }
      ports: [8080]
      healthcheck: /healthz
      preDeployCommand: pnpm db:migrate          # Railway: "a failing command stops the deployment"
      limits: { cpu: 1, memoryGB: 1 }
      domains: [ { host: api.example.com, port: 8080 } ]
      env:
        LOG_LEVEL:          { valueFrom: config, default: info }
        DATABASE_URL:       { valueFrom: resource, resource: database }     # Railway injects
        REDIS_URL:          { valueFrom: resource, resource: cache }
        OIDC_ISSUER:        { valueFrom: identity }                          # resolved by mode
        OIDC_CLIENT_ID:     { valueFrom: identity }
        OIDC_CLIENT_SECRET: { valueFrom: secret, source: preserve }          # NAME ONLY
        STRIPE_WEBHOOK_SECRET: { valueFrom: secret, source: preserve }
        FEATURE_FLAGS:      { valueFrom: config, default: "" }
  secrets:                      # derived inventory; what the connect UI lists
    - { name: OIDC_CLIENT_SECRET, service: backend, rotation: manual, requiredFor: [production] }
  releases:
    strategy: immutable-digest   # digest pinned per release, never :latest
    gate: { production: required-reviewer }   # maps to a GitHub Actions environment protection rule
  lifecycle:
    onSuspend: scale-to-zero     # there is no archive primitive on Railway
    onEject:   [railway-iac, compose, data-export, realm-export, secret-inventory]
    onDelete:  { graceDays: 30, backupAgeOutDays: 90 }
  dns:
    ownershipVerification: txt          # Railway requires CNAME + TXT or requests 404
    apexPolicy: cname-flattening-only   # Railway publishes no static IP; A records unsupported
    wildcards: conflict-check           # subdomain and wildcard on one apex cannot overlap
  observability:
    statusEndpoint: /healthz
    logRetentionDays: 7
    uptimeChecks: [app.example.com/api/health, api.example.com/healthz]
  billing:
    sku: arcnexus-standard
    metered: none                # D1: no infra pass-through. seat/instance counts only.
    resourceCostHint: { minGB: 2.5, maxGB: 12 }   # internal margin visibility, not a price
```

### Archetype defaults

| Archetype | Injected defaults |
| --- | --- |
| `api-service` (TreeDX) | one service, no public static asset handling, required `healthcheck`, `domains` limited to api/host subdomains, no frontend redirect rules, mandatory `apiAuth` block (OIDC bearer or platform-native key) |
| `full-stack-web` (ArcNexus) | two+ services, session/cookie origin rules derived from `domains`, CSRF-safe same-site defaults, CSP report endpoint, `/health` conventions, static asset service optional |

An archetype is a defaults module plus a validation rule set — not a separate format.

### Archetypes and volume retention

`archetype` gates validation, so a new value has to carry a rule or it is just a label: `worker` is refused
if any service publishes a host (nothing connects inbound), `shared-service` requires one (an unreachable
team service cannot be bound to). Both were added for the template set; `api-service` and `full-stack-web`
keep their existing rules.

`resources.volumes` entries accept `retention: instance | survive` — `survive` keeps the disk when the
instance is torn down, so a later service can mount the same state. The **mount** is the identity used
throughout, because Railway names volumes itself and ignores the declared label.

### Environment inventory (D33, implemented)

Obligations live beside the manifest, not inside it: `templates/*/.platfolio/environment.yaml` declares
`reference` / `secret` / `value` / `output` entries with defaults, applicability and descriptions.
`applyInventory` folds them into the service model, so the plan builder and provider stay untouched, and it
is idempotent because install can be re-run after a tenant edits the file. The refusal rules are the point:
a secret entry carrying a value is refused with the reason rather than an "unrecognized key", and a
credential-shaped `value` default is refused outright. See
[13 § environment inventory](13-compose-first-and-execution.md).

### Service wiring: `references` (issue #84, implemented)

A service may declare `references: [{ variable, database, output? }]` to wire a declared database into one of
its environment variables. It is deliberately **not** a `secrets[]` entry: a reference is resolved by the
provider, its name is public configuration, and the secrets panel exists to tell a tenant what only they can
supply. Mixing them would list wiring as something to type in.

Validation reuses the plan rule rather than a second one: a reference to a database the manifest does not
declare is rejected by the contract (`unknown-database`), and the provider refuses to build a plan whose
wiring it could not resolve. `templates/example-web-app` declares one (`DATABASE_URL` from `app-db`) so the
catalog exercises it.

### Domains: literal hosts are provisional (OD12)

The sketch above shows `domains: [ { host: app.example.com, port: 3000 } ]`, which is **fixture data standing in
for configuration**. One manifest serves many tenants, so it cannot name a domain any more than it can name a
secret value. The target shape, measured reasoning and the migration are in
[12 § Where a domain is defined](12-domains-and-dns.md): the manifest declares which services are publicly
reachable and the host *pattern* (`app`, `api`, wildcard and apex policy); the instance supplies the root domain
per environment; the plan resolves the two into the concrete hosts the provider already consumes. Until OD12
lands, treat literal hosts in manifests and templates as examples — never copy one into a platform definition
intended for more than one tenant.
## Secrets

`value_source` is a closed enum, and it is the mechanism that keeps decision D4 true:

Secrets are **the hosted platform's own** requirements, declared per platform and never confused with
platfolio's infrastructure credentials (which are governed by [04 § The tenant's experience](04-execution-plane-github-workflows.md)).
Each declaration may carry a `delivery` hint; the default is `relay-sealed`, and platform authors pick
per secret, not the tenant:

Two per-service fields decide *where* a service runs, which then decides what gets rendered,
dispatched and checked (D23):

| Field | Default | Meaning |
| --- | --- | --- |
| `ownership` | `maintained` | `maintained` = software the tenant develops (needs staging); `external` = an upstream image platfolio hosts but does not develop (Keycloak-class), production-only unless stated |
| `environments` | derived from `ownership` and the platform's enabled environments | explicit list wins; a service may not name a disabled environment |

Consequences the renderers and validator must honour: Railway IaC expresses this with `ctx.isEnvironment(...)`
(documented in the SDK for per-environment logic), so an external service is *declared but attached only*
where it exists; Compose ignores the scope because local development wants the whole stack, including
Keycloak; the host-overlap rule is evaluated **per environment**, since a production-only host and a
staging host are not in conflict; and the secrets checklist is filtered by environment, so a
production-only external service never demands its secrets be filled in a staging environment that has
no place for them. Whether `railway config plan` honours per-environment resource membership is E21 —
the shape type-checks here, which is a weaker claim than "it deploys correctly".

Staging is **a duplicate of production, created after the services exist** — measured in E25: Railway has
no "add service to this environment" call, `environmentCreate(sourceEnvironmentId: …)` copies the services
present at that moment, and a service added later is absent from the existing duplicate. `cloneFrom`
therefore carries ordering and completeness meaning, not just "start from this config": a platform that
grows a service must recreate the environment, and the provider refuses to pretend otherwise
(`instance-missing-in-environment`). See [the record](../research/railway-token-and-sealing-2026-11-08.md).

The default is **`tenant-side`**, not `relay-sealed` — that ordering was reversed by E18, and the panel
renders accordingly.

| `delivery` | Behaviour | Use when |
| --- | --- | --- |
| `relay-sealed` | tenant types the value into platfolio once; platfolio writes it **and seals it**, so it cannot be read back afterwards. **Measured unavailable on Railway (E18, 2026-11-08):** no seal setter exists in the API and sealing cannot be verified, so `sealedVariables` is `false` for this provider and the mode must not be offered | providers that genuinely support sealing (unmeasured) |
| `relay-plain` | written, not sealed: still never persisted or logged by platfolio, but readable by the granted credential in mode B | debug instances; never the default |
| `tenant-side` | platfolio shows the name and a deep link; the tenant enters it in their provider project | mode A, or a tenant who will not type into us |
| `runner-side` | the tenant stores it as a CI secret and the runner writes it | mode A with CI-side custody |

Sealing has hard consequences the renderer and controller must honour, all from the provider's own
documented behaviour: a sealed value **cannot be un-sealed**, is **not copied** when an environment or
service is duplicated, is not provided by the CLI, and is not shown in environment-sync diffs. So the
`cloneFrom` staging bootstrap must **expect** to arrive without these values, and the checklist turns
red for exactly that reason — which is correct behaviour, not a bug. Rotation becomes
"set a new value, verify, then revoke the old credential" with no read-back, and the UI must say so.

`team-service` is **proposed, not valid** — it is the subject of
[OD11](01-product-and-decisions.md). Until that decision lands, the enum below is closed and a manifest
that references another instance is rejected at parse.

| `source` | Meaning | Who holds the value |
| --- | --- | --- |
| `preserve` | Railway IaC `preserve()`: "keep the value that is already set in Railway" (**V**) | Railway, in the customer's project |
| `shared-variable` | Railway shared variable on the environment; IaC `ctx.shared.NAME` "points at an existing shared variable … it does not define or manage" it (**V**) | Railway/customer |
| `resource` | injected by Railway for a database/cache (e.g. `db.env.DATABASE_URL`) (**V**) | Railway |
| `platform-internal` | generated by the platform itself on first boot (API keys it issues) | the platform |
| `customer-held` | the customer's own secret manager, referenced by name only | customer |
| ~~`platfolio-held`~~ | **not a valid source** | — |

Consequences that must hold in the implementation:

- platfolio stores and displays **names + status**, never values, and logs a redaction marker if one
  is ever submitted (`POST /instances/:id/secrets` does not exist).
- Verification is **behavioral**: after the customer sets the value in their Railway project, the
  next deploy either passes its health check or it does not. platfolio records
  `required_secret.verified_at` from a *healthy deployment*, not from reading anything.
- Rotation is a documented runbook step plus a `rotation: manual` hint; platfolio may prompt for it
  and may trigger a redeploy, but cannot perform it.
- The renderer emits `preserve()` for every `source: preserve` key, so `railway config apply` from a
  fresh clone cannot wipe customer secrets — and conversely a plan that would *delete* a preserved
  key is a hard validation error.

## Rendering status (implementation note, 2026-11-08)

`packages/manifest` implements a subset of this specification, and where reality differed from the
sketch it was corrected here rather than in code comments. Verified facts from
`railway@3.16.0` (the package the generated file is type-checked against in CI):

- **Resource ceilings are not expressible in Railway IaC — but they ARE settable through the API.**
  `IntentServiceConfig` has no CPU/memory field, so the renderer records manifest limits as comments in
  the generated file and notes them in `Rendered.notes`. That is a limit of the *exported artifact*, not
  of platfolio: the provider applies ceilings with `serviceInstanceLimitsUpdate` (introspected and now
  implemented in `RailwayInfraProvider`), and reports `ceilings-not-applied` if the call fails. The
  earlier note told tenants to apply them out of band, which was an inference from the IaC type
  surfacing generalized into a provider limit; corrected 2026-11-08.
- **Resource references go through `.env`.** The SDK exposes `ReferencableDatabaseNode.env`, so the
  generated code emits `db.env.DATABASE_URL`; `db.DATABASE_URL` does not type-check.
- **Bucket regions are an allowlist, not a cast.** `BucketRegion = "sjc" | "iad" | "ams" | "sin"`, and
  validation rejects anything else with `unknown-region` rather than generating `as never`.
- **Compose needs different values than IaC for the same reference.** Pre-substituting Railway syntax
  into Compose produced `$$`-escape and invalid-interpolation errors from `docker compose config`;
  the intermediate therefore carries structured refs (`resource-ref` entries) resolved per target.
- **Secrets render as `preserve()` in IaC and `"$${NAME:-}"` in Compose** — names in both, values never.
- Comments are language-appropriate per target: sharing a `#` header with the Compose output made the
  generated TypeScript fail to parse.
- **`image` must carry a tag alongside the digest.** Measured in E26: Railway accepts
  `repo@sha256:…` and then never deploys it — the deployment sat in `DEPLOYING` for over 20 minutes,
  while `repo:tag@sha256:…` reached `SUCCESS` in about 20 seconds, and the reference is stored verbatim.
  Digest pinning is the invariant; the tag is how the provider is told *which* manifest to resolve.
  Validation rejects it with `image-tag-missing` in the manifest and again in `RailwayInfraProvider`.

The fixture suite in `packages/manifest/test/` is the executable form of § Validation gates: two real
platform manifests render and validate clean, and five negative fixtures each produce a specific code
(`secret-value-inline`, `wildcard-conflict`, `mutable-tag`, `unknown-dependency`,
`renderer-version-window`).

## Rendering targets

| Target | Generated from | Notes |
| --- | --- | --- |
| `.railway/railway.ts` | `resources`, `services`, `environments`, `domains` | `defineRailway((ctx) => …)` with per-env overrides from `ctx.environment`; `railway config plan` output is the acceptance check (**V**) |
| `docker-compose.yml` | same, minus Railway-only resources | local dev parity; `postgres()` → image service, buckets → MinIO optional |
| Railway template `serializedConfig` | same | for template deploys and the 15–25% kickback path; `required_inputs[]` shape reused for the connect form (name/secret/strategy) |
| GitHub workflow + action inputs | `releases.gate`, `architectures`, `environments.branch` | see [04](04-execution-plane-github-workflows.md) |
| Stripe catalog | `billing.sku` → `entitlements.feature.lookup_key`, product, price | flat SKUs only (D1) |
| DNS panel | `dns`, `services[].domains` | CNAME + TXT pairs, apex policy warnings, wildcard conflict message |
| Identity config | `identity` | realm/client JSON for hosted mode, or a redirect-URI checklist for BYO mode |
| Docs/onboarding | whole manifest | generated "what this platform needs from you" page |

One source, many artifacts, **verified by CI**: every catalog PR runs schema validation → `railway
config plan` against a throwaway project → compose bring-up smoke test → secret-name lint → domain
conflict check. A manifest that cannot be rendered is not mergeable.

## Versioning and release policy

- `metadata.version` is the platform release; `apiVersion` is the manifest schema. Both matter: a
  tenant pinned to `arcnexus@0.8` must not be force-rendered with `1.x` semantics.
- `requires.platfolio` is enforced by the control plane before dispatch, with an actionable message
  ("this platform needs platfolio renderer ≥ 0.4; your instance is running 0.3.2").
- Migrations run via `preDeployCommand`, forward-only, with `migration_window` advisory; the release
  record stores the git SHA, image digest and migration version so a rollback is honest about the DB.
- Breaking changes to the *manifest schema* require a new `apiVersion` plus a renderer that supports
  N-1 for a documented window; breaking changes to a *platform* get migration notes in `CHANGELOG`.
- Self-hosted support policy (see [08](08-distribution-and-licensing.md)): latest minor +1,
  security cherry-picks to the previous minor for ~6 months.

## Adding a platform (D9)

Adding TreeDX or any future platform is a **data PR** into `templates/<name>/<version>/` containing
the manifest, archetype overrides, an example `.env.example` (names only), a fixture used by CI, and
generated docs. No control-plane code change. If a new platform requires a new field, that is a
schema change and gets its own `apiVersion` review.

## Worked examples to write next

1. `templates/example-web-app/manifest.yaml` — `api-service`, one service, Postgres, object storage of
   repository clones, API-key auth, no identity host. Verify: can it be deployed with zero secrets
   known to platfolio? Its AI-context generation workload needs a resource ceiling and a queue,
   otherwise one tenant saturates its own project (and its own bill — correct under D1).
2. `templates/example-full-stack/manifest.yaml` — `full-stack-web`, Keycloak dependency already in the
   platform, so both `hosted-realm` and `byo-oidc` modes must be exercised. Verify: realm import
   round-trip and that ejecting leaves a working, self-contained ArcNexus with its own IdP.
3. `ops/platfolio/manifest.yaml` — platfolio hosting itself, which is how the renderer stays honest.
