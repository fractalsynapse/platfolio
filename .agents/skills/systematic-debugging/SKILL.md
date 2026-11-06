---
name: systematic-debugging
description: Use when a failure, unexpected result or environment-dependent behavior needs diagnosis before correction.
---

# Diagnose before correcting

Follow the [project instructions](../../../AGENTS.md). Identify the user's observed
symptom, expected behavior, affected revision and relevant environment. Preserve
existing work and failure evidence; establish a baseline before temporary mutations.
If a reproduction is unavailable, state what is known and what evidence is missing.

Reproduce the smallest failing case in isolated state. Control ambient configuration,
data, credentials, ports and services relevant to the failure without changing live
user resources. Compare failing and working conditions; capture a before measurement
when the claim depends on a difference. A pre-existing defect is still a defect, but
its discovery does not authorize an unrelated repair.

Form a specific hypothesis and choose an observation that can disprove it. Inspect
the actual integration boundary and current primary sources before asserting a tool
or dependency cannot support something. Record configuration and distinguish measured
facts from inference. Change one meaningful variable at a time when isolating causality.

After finding the cause, establish a regression check at the observable boundary when
feasible, make the smallest coherent correction and verify the original symptom alone.
Then run affected broader checks once the focused result warrants confirmation. Do not
rerun already passing expensive suites to search blindly or raise a bound to hide failure.

Use [verification](../verification-before-completion/SKILL.md) to state results and
limitations. After three equivalent attempts without progress, diagnose the repetition
and change approach or report the blocker. If the failure exposes a recurring process
gap, propose its cheapest useful check separately from unrelated implementation work.
