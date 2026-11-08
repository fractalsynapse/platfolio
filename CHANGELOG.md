# Changelog

Notable changes to the platfolio project. One human-readable entry per user- or developer-visible
change; entries describe merged intent, not aspirations.

## [Unreleased]

### Added

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
