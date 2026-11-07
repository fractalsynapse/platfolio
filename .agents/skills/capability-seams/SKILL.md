---
name: capability-seams
description: Use when adding, changing or reviewing a platfolio capability seam (swappable provider), a packages/contracts interface, or code that touches the vendored Cordis framework.
---

# Work at the seam, not inside the framework

Apply the [project instructions](../../../AGENTS.md). Canonical decisions:
[10 — kernel and seams](../../../docs/design/10-cordis-kernel-and-extension-seams.md),
[D12–D15 in 01](../../../docs/design/01-product-and-decisions.md). This skill is procedure only; it
chooses no provider beyond what those documents accept.

Start from the request the seam serves. If no consumer needs the swap yet, say so and keep the
interface internal — a seam declared for its own sake is the failure mode named in 10 § R8.

## Procedure

1. **Contract first.** Add or change the capability in `packages/contracts`: interface, config
   schema, events, and the **conformance suite** for it. Nothing in `apps/`,
   `packages/providers/` or `actions/` may import `cordis` or `@cordisjs/*`; only
   `packages/kernel` does. Run the boundary grep before review; a violation is fixed at the call
   site, not by widening the exception list.
2. **Schemas are shared.** Config, manifest fields and API DTOs use one StandardSchema definition —
   do not hand-write a second validator for the same shape.
3. **Prove satisfiability with a double.** Every new seam ships with an in-memory or local test
   implementation that passes the same conformance suite as the real one. This is the cheap second
   implementation (10 § The seams) and it is what keeps an interface from becoming
   accidentally provider-shaped.
4. **A second real provider needs a reason.** Name the consumer or the accepted risk before building
   one. Business decision, not design tidiness.
5. **Version from the diff, not memory.** Classify the contracts change: additive → minor; removal
   or tightening a provider relies on → major; unobservable → patch. CI derives the bump from the
   contracts surface. If framework instability is what forced the change, absorb it in
   `packages/kernel`, never in `packages/contracts`.
6. **Name the range.** Each provider declares the contract range it supports; an unsatisfiable or
   ambiguous graph must stop startup with an actionable message rather than resolve at runtime.
7. **Check the secret rule.** A capability may reference a secret **by name** only. If the design
   needs a value, the seam is wrong — stop and revisit
   [04 § Connect Railway](../../../docs/design/04-execution-plane-github-workflows.md) before coding.

## Exclusions

Updating `vendor/cordis` itself belongs to
[vendored-dependencies](../vendored-dependencies/SKILL.md). Hosting-platform definitions belong to
[platform-manifest](../platform-manifest/SKILL.md). Claiming a seam works belongs to
[tenant-safety-check](../tenant-safety-check/SKILL.md) plus
[verification](../verification-before-completion/SKILL.md).
