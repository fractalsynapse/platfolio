# Skills

Two sets live here, and they are maintained differently.

**Inherited from the starter package** — keep identical to the source, so updates can be re-applied
without merge conflicts. Do not adapt them to platfolio; if one ever conflicts with project reality,
report it and resolve in the project decision log instead of editing the skill:
`brainstorming`, `doc-coauthoring`, `documentation-writer`, `find-skills`, `gh-cli`, `github-ops`,
`initialize-project`, `release-workflow`, `systematic-debugging`, `verification-before-completion`,
`writing-plans`, `writing-skills`.

**Platfolio-specific** — owned by this project, added 2026-11-07:

| Skill | Use |
| --- | --- |
| [capability-seams](capability-seams/SKILL.md) | adding or reviewing a swappable provider, a `packages/contracts` interface, or anything touching the vendored framework |
| [platform-manifest](platform-manifest/SKILL.md) | adding a hosted platform to the catalog, or changing the manifest schema and renderers |
| [tenant-safety-check](tenant-safety-check/SKILL.md) | before claiming a control-plane, provisioning, identity, billing or execution-plane change is correct |
| [vendored-dependencies](vendored-dependencies/SKILL.md) | updating, patching or verifying anything under `vendor/` |

Each project skill is procedure only and links to the canonical documents in
[../design/README.md](../../docs/design/README.md) rather than restating decisions. Shared policy stays in
[../../AGENTS.md](../../AGENTS.md). Validate after edits by checking that every skill's frontmatter
`name` matches its directory, its `description` states a trigger, and all relative references resolve.
