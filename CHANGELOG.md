# Changelog

Notable changes to the platfolio project. One human-readable entry per user- or developer-visible
change; entries describe merged intent, not aspirations.

## [Unreleased]

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
