---
name: verification-before-completion
description: Use before claiming that work is correct, a check passed, acceptance is met or delivery is ready.
---

# Evidence before claims

Follow the [project instructions](../../../AGENTS.md). Identify the precise claim and
what observation would establish it. Run or inspect the applicable check at the relevant
revision and environment; read its actual result, scope, failures and exit status when
available. Report the claim with supporting evidence and limitations.

Match verification to the artifact:

- Documentation and guidance: inspect the diff, facts, links, consistency and relevant
  reader/decision scenarios. Do not invent a software build for prose.
- Behavior: verify observable acceptance and relevant lower-level checks. Reproduce a
  reported defect where feasible and confirm the correction addresses that symptom.
- Runnable artifacts: exercise the real entry path and assembled configuration. Imports,
  compilation and fake collaborators alone cannot prove installation or production wiring.
- Delivery: inspect the actual candidate, required checks, review and applicable authority.
  Readiness for integration, integration and publication are different claims.

Tests must control relevant state and avoid altering live user resources. Distinguish
simulation, replay, local checks, hosted checks and live observations. Never present
one as proving another. Inspect delegated results and artifacts rather than treating
an agent's success message as independent evidence.

Reuse evidence whose relevant inputs and environment are unchanged. Refresh affected
checks after edits or new uncertainty; do not rerun an unchanged full suite for every
status message. A passing focused check supports its stated scope, not the whole project.

Check acceptance individually. Report failed, skipped, interrupted, unavailable and
inapplicable checks explicitly. Missing required evidence blocks the corresponding
readiness claim; an inapplicable check does not. Preserve failure evidence and existing
work while establishing a baseline. Do not erase edits or lower acceptance to claim success.
