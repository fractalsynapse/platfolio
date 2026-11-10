# What a Railway project token can actually do (2026-11-10) — the boundary D37/B needs

Issue #135 asks which credential the managed action runs with. The answer depends on a capability list that
had only ever been partly measured, so it was measured against a live project (`platfolio-iac-sample`) with a
freshly minted environment-scoped token. **No deploys were consumed**: creating a service and a volume is free,
and everything created was removed in the same run.

## Results, per operation

| Operation | Project token | Notes |
| --- | --- | --- |
| `variableUpsert` | **allowed** | the core of applying configuration |
| `variableDelete` | **allowed** | |
| `serviceCreate` | **allowed** | creates a definition; costs nothing without a deploy |
| `serviceDelete` | **allowed** | after its volumes are released (#107) |
| `template(code:"postgresql")` | **allowed** | a surprise: read of `serializedConfig` worked, so the action could in principle resolve a database template |
| `volumeCreate` | **allowed** | |
| `volumeDelete` | **denied** (`Not Authorized`) | |
| `bucketCreate` | **denied** (`Bad Access`) | consistent with E28 |
| `environmentCreate` | **denied** | |
| `customDomainAvailable` | **denied** | |

Not tested, because each costs a deploy or needs a real domain: `serviceInstanceDeploy`, `customDomainCreate`,
`serviceInstanceUpdate`.

## The asymmetry that decides the design

**`volumeCreate` succeeds and `volumeDelete` does not.** A project-tier runner could therefore provision
storage it cannot release — the exact shape of #106's undeletable bucket, arriving a second time from a
different direction. So volume creation belongs to the workspace tier even though the API permits it to the
project token. Capability is not the same as suitability, and this is the case that proves the sentence.

## What this means for option B (chosen)

The split is workable and narrower than today's code assumes:

- **Connect-time provisioning (workspace grant, platfolio, once):** project, environments, buckets, volumes,
  domains, and *any deletion*, because deletion rights are strictly narrower than creation rights on this API.
- **Per-dispatch mutation (project token, the runner):** variables, service definitions, deploys, and reading
  templates. The plan handed to the runner must already reference existing environments and volumes.

`RailwayInfraProvider` today calls `credentials.workspace()` for project lookup on every `applyPlan`, so this is
a real refactor of the provisioning path — not a flag — and it is #123's remaining blocker.

## My own probe error, because it nearly produced a wrong finding

The first probe sent the project token as `Authorization: Bearer` and every call answered `Not Authorized`,
which reads like a grant problem and is a **header** problem: project tokens authenticate only in
`Project-Access-Token`. [`railway-transport.ts`](../../packages/contracts/src/railway-transport.ts) has documented
that rule since E25 and implements it correctly — I bypassed the provider I already trust with a raw curl and
nearly recorded a false capability matrix. Second attempt, using the documented header, is the table above.
The lesson generalizes: when a manual probe contradicts code that has passed live runs, suspect the probe.

## Cleanup

Both probe tokens (`tier-probe`, `tier-probe2`) revoked; the probe service deleted; no probe volume remains
(`postgres-volume`, `web-volume` as before); `TIER_PROBE` variable deleted. Final project shape verified equal
to the starting shape.
