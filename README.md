# platfolio

An open, self-hostable control plane that sells **managed hosting of standalone platforms** — without
reselling compute and without ever holding a tenant's secrets.

**Status: design phase.** The architecture, contracts and delivery plan are written; there is no
application code, no deployed resource, and no written approval from Railway or Stripe yet. The most
recent verified step is the [E9 kernel experiment](spikes/e9-cordis-kernel/README.md), which confirmed
the framework approach and falsified two assumptions.

## What it does

A **team** subscribes to platfolio, then hosts one or more **platforms** (TreeDX, ArcNexus, …) as
isolated projects **in the team's own infrastructure account**. platfolio holds the intent: the
catalog of platforms, the entitlements, the provisioning state machine, the status view and the
operations. The team's own CI holds the privileged credentials and the secrets, so platfolio can
operate the stack without being able to read it — and the team can leave with it running.

Three properties carry the whole design, and everything else follows from them:

| Property | Why it is there |
| --- | --- |
| **Sell management, not compute** | Provider policy forbids reselling capacity, and project ceilings cap a platfolio-owned estate at ~50–100 tenants either way |
| **Never hold a tenant secret or credential** | A platfolio compromise must not yield tenant data; verified implementable via Railway `preserve()`, name-only GitHub Actions secrets, and tenant-held tokens |
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
