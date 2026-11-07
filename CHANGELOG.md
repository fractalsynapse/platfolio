# Changelog

Notable changes to the platfolio project. One human-readable entry per user- or developer-visible
change; entries describe merged intent, not aspirations.

## [Unreleased]

### Added

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

- **OD2** — license for platfolio code. No license is granted yet, deliberately.
- **OD9** — core lineage: upstream `cordiverse/cordis` versus the fork the published plugins expect.

### Earlier history

Commits before the platform work began carry this repository's origin as the `scaffold` starter
package. The starter's own change history is maintained upstream, not here.
