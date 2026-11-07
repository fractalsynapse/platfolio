---
name: tenant-safety-check
description: Use before claiming any platfolio control-plane, provisioning, identity, billing or execution-plane change is correct, shipped or safe — the project-specific invariants that generic verification does not cover.
---

# Check the invariants a tenant depends on

Apply the [project instructions](../../../AGENTS.md) and
[verification](../verification-before-completion/SKILL.md) first; this skill adds the platfolio
invariants only. Canonical sources: decisions D1–D15 in
[01](../../../docs/design/01-product-and-decisions.md), constraints in
[feasibility](../../../docs/platfolio-feasibility.md), and the per-area documents named below. Report
each item as passed, failed, not run, or not applicable — never infer one from code review alone.

## Zero-secret invariant (D4)

- No secret value is accepted, stored, rendered or logged by the control plane. Check the code path,
  the request/response DTOs, structured logs, error messages, crash dumps and the database schema.
- Rebuild an instance from an empty database with every required secret set out-of-band, and confirm
  it reaches `active`. Green must come from a **healthy deployment**, not from reading anything.
- No held provider credential. A Railway or tenant-side token that could call `variables()` is
  disqualifying, because tokens carry roles rather than capability subsets
  ([04 § Connect Railway](../../../docs/design/04-execution-plane-github-workflows.md)).
- Never fetch Actions job logs. Attestations are structured fields only.

## Identity separation (D6)

- Control-plane users and hosted-platform users stay on distinct issuers with distinct stores, and no
  subject from one resolves in the other. Run the cross-tenant test: a token from team A rejected by
  team B, a control-plane token rejected by every tenant endpoint.
- Nothing is cookie-scoped to a shared parent domain.
- No support or staff path can read a tenant's end-user credential store. Confirm by test or by
  absence of the capability, not by policy text
  ([05 § invariants](../../../docs/design/05-identity.md)).

## Provisioning integrity

- Retried or interrupted jobs do not duplicate resources: kill mid-apply, restart, assert a clean
  plan and no orphans.
- Success is verified by read-back, never by a 2xx — including auth denials that arrive as HTTP 200
  with an error body, and rate limits that arrive as `429`.
- Destructive operations are named and reversible-in-window only. There is no archive primitive:
  `suspended` must mean scale-to-zero with data intact, and cancel must never delete a tenant database.
- Tenant-owned state remains reachable when platfolio is unavailable: their own push still deploys.

## Tenant-facing behavior

- Every user-visible failure carries a cause and a next action (DNS TXT missing, certificate pending,
  deployment awaiting approval, plan limit reached).
- Plan limits and quotas are enforced server-side on every mutation, from entitlement plus local
  numeric limits — not from a client-supplied plan name.
- Lifecycle timers match the documented numbers, and the published deletion/backup schedule matches
  what the code actually does.

## Distribution and runtime

- Production profiles run without `--expose-internals`; dev-only flags do not leak into shipped
  config, and the Node pin matches what the vendored kernel requires.
- Generated artifacts (IaC, compose, workflow files) come from the manifest, and no checked-in
  `railway.json`/`railway.toml` support was added — that mechanism is retired upstream.
- Vendored trees are untouched except through their recorded patches; run the vendoring tool's own
  verify before claiming so.

## Leaving

- The export package imports and runs without platfolio present, in plain compose, with a secret
  inventory that contains names and no values.
- Revocation is complete and demonstrated: app install removed, workflow gone, nothing platfolio-side
  still able to act on the tenant's stack.

## Exclusions

Provider or contracts design belongs to [capability-seams](../capability-seams/SKILL.md); hosting
definitions to [platform-manifest](../platform-manifest/SKILL.md); vendored dependency updates to
[vendored-dependencies](../vendored-dependencies/SKILL.md).
