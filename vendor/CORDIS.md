# Vendored: Cordis

Framework source vendored into this repository under **OD6**. It is a dependency of platfolio's
control-plane kernel only, and platfolio code is never allowed to depend on it directly — see the
boundary rules below.

## Provenance

The table below is maintained by `scripts/vendor-cordis.ts`; edit `vendor/cordis.lock.json` only
through that tool.

<!-- BEGIN managed: vendor provenance -->
| Field | Value |
| --- | --- |
| Upstream | `https://github.com/cordiverse/cordis` |
| Ref | `v4.0.0-rc.12` |
| Commit | `01b396240ce47cf2779c40af9bc445bb748fe112` |
| Tree hash | `0943a732ab0a8342…` (152 files) |
| License | MIT — Copyright (c) 2021-present Shigma |
| Vendored | 2026-11-07 |
| Updated | 2026-11-07 |
| Local patches | none |
| Tool | `scripts/vendor-cordis.ts` (`verify` is the CI check) |
<!-- END managed: vendor provenance -->

The tree is the upstream checkout **as-is**: `packages/core`, `loader`, `include`, `hmr`, `group`,
`timer`, `logger-console`, `create`, plus their configs. No platfolio edits. Local changes are not
made in place: they live as `vendor/patches/*.patch` and are replayed by the update tool (see
Updating below), because the tree must always be reproducible from upstream alone.

## How platfolio consumes it (OD7)

platfolio meets Cordis **only at `packages/contracts`**. The vendored source is not a workspace
member of the application build, and nothing under `apps/`, `packages/providers/` or `actions/`
imports `cordis` or `@cordisjs/*` except the kernel adapter.

**Consumption mechanism — to be confirmed (OD6a):**

1. **Recommended: publish patched forks under our own scope** (e.g. `@platfolio/cordis`,
   `@platfolio/plugin-loader`) to GitHub Packages from this vendored tree, and have the kernel depend
   on those by exact version. Real provenance, reproducible CI, no build-system coupling, and
   upstream updates become a deliberate version bump instead of a surprise.
2. Fallback for trivial patches: depend on the upstream npm `4.0.0-rc.12` releases and apply patches
   at install time (`patch-package`-style). Less machinery, more fragile as patches accumulate.
3. Rejected: making the vendored tree a workspace member. It builds with `yarn 4` + `yakumo` +
   `esbuild` + `tsc` + `@cordisjs/unyaml` + a `@cordiverse/tsx` fork, uses `.ts` relative import
   specifiers, and would drag that whole toolchain into platfolio's tree — exactly what OD7 rules out.

Because `packages/core` exports `./src/*` as well as `lib`, the option of bundling framework source
directly looks tempting; it is not taken, for the same toolchain-coupling reason.

## Boundary rules (enforceable, not advisory)

- **`packages/kernel` (the shell) is the only importer of framework modules.** A CI lint greps for
  `from 'cordis'` / `@cordisjs/` outside `packages/kernel` and `vendor/`, and fails.
- If the contracts ever look unstable enough to justify it, the shell absorbs the change so
  `packages/contracts` stays semantically versioned — the shell is where an anti-corruption layer
  goes, and it is deliberately thin (wire plugins, map events to intents, translate lifecycle).
- Kernel-visible framework concepts are renamed into platfolio vocabulary at the boundary:
  `Context` → runtime, `Service` → capability, `inject` → requires, `intercept` → scope override,
  `isolate` → tenant view, `effect` → registration. Third-party extension authors never learn these.
- Capability interfaces and config schemas live in `packages/contracts` and are validated through
  **StandardSchema** (`@standard-schema/spec`), which the framework already uses for `Plugin.Config`,
  so the same schema object serves the manifest, plugin config and API DTOs.

## Runtime constraints inherited from this tree

- **Node ≥ 22** (`packages/create` declares `engines.node >= 22`; `loader/src/internal.ts` returns
  nothing below major 22, and distinguishes loader shapes because "`v2` landed in `24.12.0`"). Pin the
  exact Node version in the image and CI.
- **`--expose-internals` (or `node-addon-require-builtin`) is a dev-profile flag only.** Without it,
  HMR warns "loader internals are unavailable, source code HMR is disabled" and takes a documented
  degraded path — that degraded path is the **production** path, and E9 in
  [the delivery plan](../docs/design/09-delivery-plan.md) must confirm the control plane boots there.
- Hot module reload is a development affordance. Production provider changes are blue/green worker
  deployments ([10 R4](../docs/design/10-cordis-kernel-and-extension-seams.md)).
- `plugin-include` treats `!!js` in YAML as an expression node, so **config files containing `!!js`
  are trusted first-party input only** — never generated from tenant-supplied values, never stored in
  the database.
- Ecosystem note (settled by E9, 2026-11-07): `@cordisjs/plugin-server@1.7.0` is **not usable with this
  tree** — it registers but fails at the first route definition because it calls
  `Service.resolveConfig`, which exists only in the fork `@deepseek-ai/cordis@4.1.0`. Its peer range
  `^4.0.0-rc.6` permits the broken combination, so treat any `@cordisjs/*` plugin as unverified against
  this core until proven. platfolio's HTTP surface is a kernel-owned `node:http` adapter, and the
  lineage question is tracked as OD9 / E13 in the design set.
- Upstream status to track: `cordis` is a release candidate whose README says "The API is not yet
  stable and may change without notice"; official documentation is "still under construction". The
  practical consequence is the boundary rule above, not a wait.

## Updating

Everything about this tree is managed by `scripts/vendor-cordis.ts`. Node here has no built-in
TypeScript support, so run it through a loader:

```bash
export npm_config_cache="$PWD/.cache/npm"          # ~/.npm is read-only in some environments
npx -y tsx scripts/vendor-cordis.ts check          # exit 1 when a newer upstream tag exists (CI gate)
npx -y tsx scripts/vendor-cordis.ts list           # upstream tags and branches
npx -y tsx scripts/vendor-cordis.ts plan --to v4.0.0-rc.13   # diff only; writes a report, changes nothing
npx -y tsx scripts/vendor-cordis.ts apply --to v4.0.0-rc.13 --yes
npx -y tsx scripts/vendor-cordis.ts verify         # also the post-apply and CI check
```

| Command | What it does |
| --- | --- |
| `adopt --to <tag>` | records an already-present tree (used once, after manual vendoring) |
| `verify` | tree hash matches `vendor/cordis.lock.json`; `LICENSE` present; no nested `.git`; recorded ref agrees with `packages/core` version; **no symlink resolves outside the tree** |
| `check` | compares the recorded ref with upstream tags; non-zero exit when outdated |
| `plan --to <ref>` | fetches into `.cache/`, diffs against the vendored tree, writes `vendor/cordis.plan-<ref>.md`, and **dry-runs every recorded patch** |
| `apply --to <ref>` | rebuilds the tree from the target commit in staging, **replays `vendor/patches/*.patch`**, then swaps atomically; restores the previous tree if the swap fails |

What the tool refuses to do, and why:

- **`apply` stops on unrecorded local edits** unless `--force`. A hand-edited file in a vendored tree
  is invisible debt that silently vanishes on the next upgrade, so edits must become patch files.
- **Boundary files are called out separately in the plan** (`packages/core/src/{context,registry,
  service,events,fiber,reflect}.ts`, `packages/loader/…`, `packages/include/src/index.ts`). Those are
  what `packages/contracts` and `packages/kernel` are written against, so touching them is a platfolio
  decision, not a dependency bump.
- **The candidate is copied with `verbatimSymlinks`** so relative symlinks stay relative. (Default
  behaviour rewrites them into absolute paths pointing at `.cache/`, which looks fine until the cache
  is cleaned — `verify` now catches it.)

Patches live in `vendor/patches/NNNN-description.patch`, must apply with `-p1`, and are listed in the
lock and in the provenance table above. Each one needs a reason and an upstream issue or PR link in
its header comment — every patch is future merge debt.

After any update: run `verify`, then the contracts conformance suites, then commit `vendor/cordis/`,
`vendor/cordis.lock.json`, and this file together. Ship it as a platfolio **minor** — version bumps
come from the `packages/contracts` diff, not from this tree's version.
