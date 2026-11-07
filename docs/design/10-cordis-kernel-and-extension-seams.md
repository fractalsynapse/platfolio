# platfolio — Cordis kernel and extension seams

Implements the maintainer's direction of 2026-11-07: **the platform is built as a plugin framework,
with swappable providers at every seam, using Cordis** (vendored at [`vendor/cordis`](../../vendor/CORDIS.md),
tag `v4.0.0-rc.12`). Read with
[02 architecture](02-architecture.md), [03 manifest](03-manifest-spec.md),
[11 UI component and page model](11-ui-components-and-page-model.md). Status: **proposal, with two
decisions that need your call (OD6, OD7).**

## What Cordis actually is (read from the source, 2026-11-07)

Not a web framework — a **composability runtime**. The parts that matter here:

| Concept | Evidence | platfolio use |
| --- | --- | --- |
| `Context` — a service container; a service owns a stable `ctx.<name>` | `core/src/context.ts`, primer: "一个服务占据一个稳定的 `ctx.<key>`… 其他插件通过 key 查找服务，而非导入具体实现" | the seam lookup: consumers depend on a **capability name**, never an implementation |
| `Service` base + `reflect.provide` | `core/src/service.ts`, `core/src/reflect.ts` | every provider interface is a `Service` subclass |
| `inject` — declared dependencies, load order derived from them | `registry.ts` (`Inject`), primer: "加载顺序通过服务依赖表达，而非手动编排启动序列" | no hand-written bootstrap order; entitlement/auth/billing order falls out of the graph |
| Typed events with five dispatch modes (`emit`/`parallel`/`serial`/`bail`/`waterfall`) | `core/src/events.ts:14` | `bail` for policy gates (entitlement, approval), `waterfall` for wrapping a provisioning step |
| `ctx.effect()` — registration as a **reversible** side effect | primer: "注册是可逆的副作用… reload 和 teardown 时会按预期撤销" | hot-swap stays safe: capabilities are installed and uninstalled, not leaked |
| `isolate(name, label)` — service-view scoping | `context.ts:65`, `tests/isolate.spec.ts` ("does not expose own provisions across isolation boundaries") | per-tenant and per-plugin context views |
| `intercept(name, config)` — layered config merge into a service | `context.ts:73`, `tests/intercept.spec.ts` ("merge context intercepts from outer to inner") | per-tenant provider configuration, plan-limited defaults |
| `Plugin.Config` as **StandardSchemaV1** | `registry.ts` (`import { StandardSchemaV1 } from '@standard-schema/spec'`) | the manifest schema and every plugin's config schema are the same mechanism — zod fits |
| Fiber disposal states (`DISPOSED`, "settle disposed fibers to DISPOSED") | `core/src/fiber.ts`, commit `5dac695` | long-running job fibers with deterministic teardown |
| `@cordisjs/plugin-loader` — dynamic plugin entries by name, `EntryOptions{id,name,config,group,disabled,inject}`, entry/config validation with source-located errors | `loader/src/config/entry.ts`, commits `67538f6`, `1a6df96` | runtime provider selection from configuration |
| `@cordisjs/plugin-include` — YAML config trees with patches/journal/reconcile and `!!js` expression tags | `include/src/index.ts`, primer loader section | declarative plugin sets per deployment profile |
| `@cordisjs/plugin-hmr` — hot module reload | `hmr/src/index.ts` | dev loop |
| `@cordisjs/plugin-server` — HTTP + WS server plugin (`path-to-regexp-typed`, `schemastery`, `ws`) | npm registry 2026-11-07: `@cordisjs/plugin-server@1.7.0`, peer `cordis@^4.0.0-rc.6` | replaces the Fastify/Hono choice in [02](02-architecture.md) |

Assessment: **the dependency-injection-by-name, config-as-schema, effect-reversal and
intercept-isolation model is a genuinely good match** for a platform whose selling point is
"every aspect is a swappable interface". This is not a square peg.

## The collision, and the resolution

**Problem.** A plugin hot-loaded into the control-plane process shares that process's heap, its
environment variables, its database connection, and any credential the process holds. `isolate`
scopes *service views*; it is a composition boundary, **not** a security boundary — nothing in
`core/src` stops plugin code from calling `node:fs` or reading `process.env`. So "everything
pluggable with runtime hot-loading" as stated would break decision D4 (platfolio never reaches a
tenant's secrets) and the trust boundaries in [04](04-execution-plane-github-workflows.md), and would
make platfolio's own compromise equivalent to compromising every tenant it can dispatch to.

**Resolution: two extension tiers, one contract.**

| | **Tier 1 — first-party plugins** | **Tier 2 — third-party / tenant-authored** |
| --- | --- | --- |
| Runs | in-process, inside the control plane | out-of-process: its own worker/container, or the tenant's execution plane |
| Authored by | platfolio maintainers, code-reviewed | anyone |
| Distribution | vendored/compiled into a release artifact | OCI image or remote endpoint, pinned by digest |
| Contract | Cordis `Service` + capability name + StandardSchema config | the **same contract over RPC** (HTTP/MCP), with capability-scoped, short-TTL, per-tenant tokens |
| Reach | platfolio's own config, non-secret tenant state | only what the dispatch explicitly grants; **never** platfolio's env or DB |
| Hot-load | dev only (see R4) | per-deployment, by configuration; no in-process swap |
| Examples | Railway provider, Stripe provider, GitHub execution plane, IaC renderer, provisioning flows | a customer's own provider, a marketplace extension, an agency's bespoke creation process |

The rule to write into the code: **a capability that can mutate tenant infrastructure is Tier 2, or is
Tier 1 but executes through the tenant's runner** ([04](04-execution-plane-github-workflows.md)).
That keeps both properties the maintainer wants — pluggable everywhere, secrets unreachable — because
the plugin's *contract* is the same in both tiers; only the transport differs. This is the design
cost of the request, and it is worth paying.

## The seams (capability names, not implementations)

**What "a second implementation" means (OD8).** A seam is only real if something other than the
original code path can satisfy it. The way to find out is the **rule of two**: write the interface
with one implementation now, and add a *second* implementation only where it earns its keep. A second
implementation is the test that the interface is not accidentally Railway-shaped, Stripe-shaped, or
GitHub-shaped — one interface written against one provider is a guess, and the cost of that guess
shows up as a rewrite when the first real alternative arrives.

The cheap version is not a second *cloud vendor*: it is a **test double that implements the same
contract** (in-memory provider, local compose renderer). It runs in CI, proves the interface is
satisfiable in more than one way, and costs days instead of weeks. A second *real* provider is a
business decision that should follow a named customer.

My recommendation, recorded as **OD8**: declare all twelve seams; ship a conformance-tested test
double for every one; ship a second **real** implementation only for `render.target`
(Railway IaC + Compose — both are already required by the product) and a second `provision.flow`
(`import-existing` — needed to migrate anyone to us at all). `infra.provider` keeps exactly one real
implementation until someone asks to leave Railway.

| Capability | v1 implementation | Named alternatives | Why it is a seam |
| --- | --- | --- | --- |
| `infra.provider` | Railway (GraphQL + IaC) | Fly.io, Northflank, Kubernetes, "customer's own shell scripts" | D1: the provider is a commodity behind the contract |
| `billing.provider` | Stripe Billing | Stripe Managed Payments (a variant, not a swap), Lemon Squeezy/Paddle MoR, manual invoice | OD1 is undecided — decide it *after* the interface exists |
| `scm.provider` | GitHub (App + Actions) | GitLab CI, Bitbucket Pipelines | customer's dev process |
| `execution.plane` | customer GitHub workflow | direct API (rejected by D4), local runner, self-hosted runner | how intent reaches reality |
| `render.target` | Railway IaC + Compose | Helm, Terraform, plain scripts | [03](03-manifest-spec.md) rendering |
| `identity.provider` | byo-oidc, hosted Keycloak realm | `oidc-provider` embedded, Zitadel, Auth0 | D6/D7, [05](05-identity.md) |
| `secret.broker` | names-only preserve / GH-secrets presence check | HashiCorp Vault, Doppler, 1Password | D4's enforcement point |
| `provision.flow` | `standard-saas` | **`import-existing`** (adopt a stack that already runs), `agency-assisted`, `self-serve-template` | the "swap out the creation process" request, verbatim |
| `notification.channel` | email | Slack, webhook, mobile push | ops surface |
| `observability.sink` | structured logs | OTel (Railway tracing exists with `OTEL_*` injection), Sentry | ops surface |
| `entitlement.source` | Stripe Entitlements + local limits | own plan table | [06](06-billing-and-lifecycle.md) |
| `ui.registry` | component library + page schema | — | [11](11-ui-components-and-page-model.md) |

`provision.flow` deserves special note: **`import-existing`** (take over management of a Railway
project the customer already runs, by `railway config pull` + a plan diff) is likely the single most
important early flow, because hands-off migration is why a team would switch vendors at all.

## Interface contracts drive versioning (the maintainer's semver idea)

The intent — "these interfaces being used to determine major/minor patch version bumps" — is right,
and it is only real if it is **mechanically enforced**. Proposal:

- `packages/contracts` holds every capability interface, its StandardSchema config, its event
  declarations, and the **provider conformance suite** for that capability. It is the only package
  that is API-stable, and it is published/versioned independently.
- A CI gate diffs the contracts surface (api-extractor-style) and classifies the change:
  **major** = capability removed, or a signature/config-schema tightening a provider relies on;
  **minor** = capability or optional field added; **patch** = nothing a provider can observe changed.
  The bump is derived from the diff, not from a human's memory.
- Every provider declares supported contract ranges (`requires.platfolio`-style, already in
  [03](03-manifest-spec.md)); the control plane resolves a provider by name + range and **refuses to
  start** on an unsatisfiable or ambiguous graph — which is exactly what `inject` dependency ordering
  already does for service readiness.
- One contract suite is run **against every implementation** (Railway today, whoever tomorrow). A
  provider that has not passed conformance cannot be selected, and that is what makes "swappable"
  a claim instead of a hope.
- Third-party Tier 2 plugins consume only `packages/contracts` + the RPC schema, never internal
  modules. That is the boundary that lets us refactor the kernel.

## Risks (name them now, design around them, don't pretend)

- **R1 — release candidate API.** `cordis` is `4.0.0-rc.12`, its own README says "**The API is not yet
  stable and may change without notice**", and official documentation "is still under construction";
  the available primer is DeepSeek Harness's vendored-usage doc, not a Cordis reference. Mitigation:
  **vendor the fork** (OD6, done — see [Decisions](#decisions)), pin exactly, treat `packages/contracts` as the stable surface so Cordis
  churn stays internal, and budget a maintenance window per Cordis upgrade.
- **R2 — build/runtime coupling.** The repo builds through `yakumo` + `esbuild` + `tsc` + `tsx`
  (a `@cordiverse` fork) + `@cordisjs/unyaml` (YAML-as-module), with `.ts` relative imports and a
  `pnpm`-less yarn-4 workspace. Adopting it means adopting its toolchain, or reimplementing a build
  for our own tree. Decide this before writing application code, not during.
- **R3 — Node floor and internals.** `create-cordis` declares `engines.node >= 22`;
  `loader/src/internal.ts` returns nothing below major 22 and distinguishes loader shapes because
  "`v2` landed in `24.12.0`, so a major-version test mistags every 24.0–24.11.1"; HMR warns
  "loader internals are unavailable, source code HMR is disabled; pass `--expose-internals` or install
  `node-addon-require-builtin`". Mitigation: pin the exact Node version in our image, ship
  `--expose-internals` **only** in dev profiles (it is a hardening-reduction flag and needs a written
  justification in the security doc), and never make hot-reload a production dependency.
- **R4 — hot-swap correctness in a multi-tenant controller.** Swapping a provider mid-plan can leave
  a step applied by one version and its follow-up by another. Mitigation, in order of preference:
  (a) hot-load in dev only; (b) production changes use blue/green — a new worker version drains the
  old one; (c) if in-process swap is ever enabled, it must be **at fiber boundaries only**, with
  per-instance capability-version pinning, and every step idempotent + read-back-verified (already
  required by [02](02-architecture.md)). The `ctx.effect()` reversal model makes (c) tractable;
  the controller design makes it not necessary for v1.
- **R5 — config with executable expressions.** `plugin-include` resolves `!!js` into expression
  nodes, so a YAML config **is** code. Rule: config files containing `!!js` are trusted-input only
  (first-party, in source control, reviewed) and must never be generated from tenant-supplied values
  or stored in the database. Write this into the threat model now, because it is the kind of thing
  that gets discovered through an incident.
- **R6 — thin ecosystem.** npm search on `cordis` today returns the core, the `@cordisjs/plugin-*`
  set, `@deepseek-ai/*` harness packages and one unrelated kernel. Do not plan around "there is a
  marketplace to inherit"; we author the providers.
- **R7 — not a frontend story.** `@deepseek-ai/dsh-client-ui-cordis` exists but peers onto harness
  client packages, so it is not reusable here; Cordis *can* run in a browser (`logger-console` ships
  `lib/browser.js`) but UI extension is a different problem. See
  [11](11-ui-components-and-page-model.md): a **component library plus a declarative page schema**
  instead of hot-loaded React — which is also what makes the mobile app a renderer rather than a
  rewrite (D10).
- **R8 — the meta-framework tax.** The failure mode of "build everything on a plugin framework" is
  shipping a framework instead of a product: every feature becomes three files (contract, provider,
  registry wiring) and the vertical slice never lands. Guardrail: **MVP is one tenant, one platform,
  one provider per seam, end to end.** Seams are *declared* everywhere and *multi-implemented* in only
  three places.

## Decisions

**OD6 and OD7 are decided (2026-11-07), recorded as D15.**

- **OD6 — vendoring: decided (a).** Cordis is vendored at
  [`vendor/cordis`](../../vendor/CORDIS.md) at tag `v4.0.0-rc.12` (commit `01b396240ce4`), MIT license
  and notice preserved, with the nested `.git` removed because upstream is public. Management is
  scripted: `scripts/vendor-cordis.ts` (`adopt | verify | check | list | plan | apply`) with
  `vendor/cordis.lock.json` as the machine record and `vendor/patches/*.patch` as the only sanctioned
  way to carry a local change. `verify` is the CI gate.
- **OD7 — toolchain: decided.** platfolio keeps its own build; the framework keeps its `yakumo` +
  esbuild + `unyaml` conventions inside `vendor/`; the two meet **only** at `packages/contracts`.
  Your addition is the important part: **if the framework's own surface proves unstable, the
  instability is absorbed by a shell rather than leaked into our contracts.** That shell is
  `packages/kernel`, deliberately thin — it wires plugins, translates framework events into platfolio
  intents, and maps lifecycle — and it is the only importer of `cordis`/`@cordisjs/*`, enforced by a
  CI grep.

**Open:**

- **OD6a — how the vendored tree becomes a dependency.** Publish patched forks under our own scope
  (recommended: real provenance, reproducible CI, no build coupling), or depend on upstream npm at
  `4.0.0-rc.12` and apply patches at install. Making `vendor/` a workspace member is rejected: it
  drags the framework's toolchain into platfolio's tree, which is what OD7 rules out.
- **OD8 — which seams get a second real implementation at MVP.** See
  [§ The seams](#the-seams-capability-names-not-implementations) for the recommendation: declare all
  twelve, conformance-test a double for each, and multi-implement only `render.target` and
  `provision.flow`.

Consequences already applied elsewhere: [02](02-architecture.md) now runs on
`@cordisjs/plugin-server` instead of Fastify/Hono, and [09](09-delivery-plan.md) carries experiments
E9–E12 plus prerequisites P6–P8.
