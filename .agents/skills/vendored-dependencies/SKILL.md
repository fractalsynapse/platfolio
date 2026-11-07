---
name: vendored-dependencies
description: Use when updating, patching, reverting or verifying anything under vendor/ — including the vendored Cordis kernel — or when deciding whether a dependency should be vendored at all.
---

# Keep vendored code reproducible from upstream

Apply the [project instructions](../../../AGENTS.md). For Cordis specifically, the authoritative
mechanics are in [vendor/CORDIS.md](../../../vendor/CORDIS.md) and the tool is
`scripts/vendor-cordis.ts`. Do not duplicate either here.

## Should this be vendored?

Vendor when at least one holds: the upstream is a moving target we must pin and patch (unstable or
pre-release API), we need to carry local changes while staying reproducible, or license terms permit
redistribution and we can keep the notice. Otherwise depend on the package manager and pin the
version. Never vendor to avoid writing an upgrade note.

## Rules

1. **Never edit the vendored tree in place.** Local change becomes `vendor/patches/NNNN-*.patch`
   with a reason and an upstream issue or PR link in its header. Every patch is future merge debt, so
   the count should stay near zero.
2. **Reproducibility is the test.** Applying the recorded patches to a clean upstream checkout must
   produce exactly what is on disk; the tool's lock and tree hash are what make that checkable.
3. **Licenses travel.** Upstream `LICENSE` and notices stay present; add platfolio notices without
   replacing theirs.
4. **Keep the toolchain inside `vendor/`.** Vendored code builds by its own conventions; the
   application tree does not inherit them. The boundary is the contracts package, not a shared build
   config.
5. **Preserve relative symlinks.** Copying a tree with default options can rewrite relative links
   into absolute paths inside a scratch directory; verify catches it, so verify before claiming.
6. **Watch the boundary files.** When a planned upgrade touches files the contracts layer depends on,
   that is a design review, not a routine bump: read the diff there first, then run the conformance
   suites.
7. **Record the decision.** If a vendored dependency stops paying for itself, replace it with a pinned
   dependency and say why in the project's decision log.

## Procedure

Read the dependency's own document, then: check for a newer upstream revision, plan the move and read
the report (including what the recorded patches would do), apply only after reviewing the diff, then
verify, run the conformance suites, and commit the tree, lock and documents together. Destructive
steps are refused without explicit confirmation — treat a refusal as information, not an obstacle to
bypass with a force flag.

## Exclusions

Seam and contracts changes belong to [capability-seams](../capability-seams/SKILL.md).
