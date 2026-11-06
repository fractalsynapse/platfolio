---
name: writing-plans
description: Use when an agreed outcome needs an ordered plan because of dependencies, risk or coordination.
---

# Plan a useful delivery

Apply the [project instructions](../../../AGENTS.md) and read accepted requirements
and current project state. Preserve the user's execution method and settled decisions.
Use available tools directly; no execution framework, delegation or new installation
is required. A routine edit needs no separate plan.

Choose the smallest complete batch that can demonstrate useful behavior. Keep a
short plan in the existing work record; use a separate document when it aids execution.
Include only decisions the implementer needs:

- The goal, observable acceptance, exclusions and source decisions.
- Affected responsibilities and public boundaries; exact contracts only where another
  component depends on them. Leave internal decomposition to the implementer.
- Ordered work: record changed intent, establish applicable tests/checks, implement,
  verify the assembled result, review and deliver under project policy.
- Relevant failure cases, prerequisites and actual verification methods discovered
  from the project. Mark unknown checks explicitly rather than inventing commands.
- Any genuinely pending decisions or approvals and which steps depend on them.

Describe actions, assertions and completion evidence in prose. Do not prewrite
implementation or use sample code, assumed source layouts or a mandatory architecture.
Name actual target files, contracts and check commands when discovered and useful.
Split work where outcomes can meaningfully be accepted independently; avoid tiny tasks
that repeat the same expensive verification without resolving new uncertainty.

Self-review requirement coverage, dependency order, boundary consistency, failure cases
and proportion. Each step needs a checkable result. Track completion from evidence,
not intention. Link the plan when useful. If execution is already authorized, proceed
once pending decisions are resolved; if only planning was requested, deliver the plan.
Use [verification](../verification-before-completion/SKILL.md) for completion claims.
