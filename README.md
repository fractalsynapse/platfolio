# platfolio

An open, self-hostable control plane that sells **managed hosting of standalone platforms** — without
reselling compute, and without ever persisting a tenant's secret values. Where the privileged credential
lives is a **tier choice**, not a secret: **managed** (default) holds one least-privilege grant per team and
*will not* read secrets; **self-custody** holds nothing and therefore *cannot*.

**Status: design phase, with the contract layer implemented.** `packages/contracts`, `packages/manifest`,
`packages/kernel` and `packages/page-schema` exist and are tested (98 tests, run in CI); there is still no
service, no deployed resource and no written approval from Railway or Stripe. Measured provider facts are
recorded with their evidence: [E9](spikes/e9-cordis-kernel/README.md) falsified two framework assumptions,
and [the token/sealing experiments](docs/research/railway-token-and-sealing-2026-11-08.md) falsified a
credential claim this repository had been making.

## What it does

A **team** subscribes to platfolio, then hosts one or more **platforms** (TreeDX, ArcNexus, …) as
isolated projects **in the team's own infrastructure account**. platfolio holds the intent: the catalog of
platforms, the entitlements, the provisioning state machine, the status view and the operations. The
provider credential lives in platfolio's broker in the managed tier (we *will not* read tenant variables —
one boundary, refused calls, audit) and in the team's own CI in the self-custody tier (we hold nothing, so
we *cannot*). Secret values are never persisted in either tier, and the team can leave with everything
running.

Three properties carry the whole design, and everything else follows from them:

| Property | Why it is there |
| --- | --- |
| **Sell management, not compute** | Provider policy forbids reselling capacity, and project ceilings cap a platfolio-owned estate at ~50–100 tenants either way |
| **Never persist a tenant secret value** | No secret value in any platfolio log, cache, queue, error or database row; connection URLs come from declared resources via Railway `preserve()` and name-only references. The *credential* question is a disclosed tier choice, not an implied promise |
| **Management through the tenant's own workflows** | Hands-off operation inside the customer's existing development process, where the exit path is a revocation rather than a migration |

## Where things are

| Path | Contents |
| --- | --- |
| [docs/design/README.md](docs/design/README.md) | **Start here.** The design set: product and decision register, architecture, manifest specification, execution plane, identity, billing and lifecycle, interfaces, distribution, the Cordis kernel, and the delivery plan |
| [docs/platfolio-feasibility.md](docs/platfolio-feasibility.md) | Verified provider constraints the designs are built against, with the reasoning that led to them |
| [docs/research/](docs/research/) | Primary-source evidence per claim, tagged verified/unverified |
| [LICENSE](LICENSE) | Apache-2.0 grant for platfolio code and documents |
| [vendor/CORDIS.md](vendor/CORDIS.md) | The vendored framework: provenance, boundary rules, runtime constraints, update procedure |
| [scripts/vendor-cordis.ts](scripts/vendor-cordis.ts) | Vendor management tool — `verify` is the CI gate, `check` flags upstream drift |
| [spikes/](spikes/e9-cordis-kernel/README.md) | Milestone 0 experiments as actually run — configuration, evidence, limits |
| [AGENTS.md](AGENTS.md) | Shared working policy for this repository |
| [.agents/skills/](.agents/skills/README.md) | Agent skills: 12 inherited from the scaffold package (left untouched) plus 4 platfolio-specific |
| [docs/MAINTAINING.md](docs/MAINTAINING.md) | This project's change, review and release policy |
| `.research/` | Research scratch corpus; gitignored, safe to delete |

## Working in this repository

```bash
npx -y tsx scripts/vendor-cordis.ts verify          # vendored tree matches its lock (CI gate)
npx -y tsx scripts/vendor-cordis.ts check           # non-zero when an upstream tag is newer
cd spikes/e9-cordis-kernel && npx -y tsx driver.ts  # re-run the E9 experiment
```

There is no application build yet. Two environment facts about the current machine, not project
requirements: its Node (v22.22.1) is built without TypeScript support, so `.ts` tooling runs through
`tsx`; and `npm` needs `npm_config_cache="$PWD/.cache/npm"` because `~/.npm` is read-only here.

Branch flow, review gates and the checks each change owes are in [docs/MAINTAINING.md](docs/MAINTAINING.md).

## Before any of this is buildable

1. **Milestone 0 gate** — experiments E1/E6 must show that a tenant-owned project can be provisioned
   for the tenant ([09 § Milestone 0](docs/design/09-delivery-plan.md)).
2. **Provider answers** — a written position from Railway on the operating model, and from Stripe on
   Agentic Provisioning Protocol orchestration; both held by the maintainer.
3. **OD9 core lineage** — the published plugin ecosystem is built against a forked core; decide whether
   platfolio tracks upstream or the fork ([01 § OD9](docs/design/01-product-and-decisions.md)).
4. **License is granted** — Apache-2.0 at the root (`LICENSE`, `Copyright 2026 Fractal Synapse Labs LCA
   PBC`), decided as D18. It exists on `staging` and must reach `main` before any release tag can pass
   the production license guard. The vendored framework keeps its own MIT license and notice at
   `vendor/cordis/LICENSE`.
5. **Time-critical, independent of platfolio:** Railway's Config as Code (`railway.json`/`railway.toml`)
   **stops being read on 2026-12-01**. Any platform repository still using it needs migrating.

## Origin of this repository

This project began from the [scaffold](https://github.com/fractalsynapse/scaffold) starter package for
project instructions and agent skills. That starter lives in its own repository and is meant to be
adopted afresh for new projects, so its maintenance and validation documents were not carried over
here. The inherited [AGENTS.md](AGENTS.md) and the 12 starter skills remain as they are; platfolio
guidance was added alongside them rather than by editing them.
