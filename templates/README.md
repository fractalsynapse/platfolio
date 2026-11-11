# Platform templates

Three starting points, one per kind of thing platfolio hosts. Each is a **scaffold to fork**, not a demo to
admire: small enough that the first change a team makes is deleting something.

| Template | Shape | What it exists to prove |
| --- | --- | --- |
| `starter-web` | public UI + JSON API, managed Postgres | domains, TLS, and a database whose `DATABASE_URL` arrives as provider-resolved **wiring**, never as something a teammate pastes |
| `starter-worker` | scaled background processing, no inbound | a **volume that outlives its service** (`retention: survive`), which is how an idle platform stops paying for compute |
| `shared-identity` | stock Keycloak on Postgres | publishing a **capability** others bind to (`provides: identity`), including a `client_secret` that is relayed once and cannot be replayed |

Each directory is the same three things: `compose.yaml` with an `x-platfolio` block, `.platfolio/environment.yaml`
declaring obligations, and the smallest possible source.

## Adding a fourth

1. Copy a directory, rename it, change `metadata` and the service.
2. Keep `/healthz` — it is the one contract between the container and the platform.
3. Do not add a custom domain to the spec. An unverifiable host never fails; it waits forever for DNS that
   will not arrive, which reads as a stuck deploy and is not one.
4. Run `pnpm run test` — `packages/manifest/test/templates.test.ts` parses, validates, and builds a plan for
   every template here, so an unparseable or unhostable scaffold fails CI rather than a tenant's first
   deployment.

## Where this differs from the other template directories

Three similar-looking paths, three different jobs — worth stating because they will be confused otherwise:

| Path | Is | Changes when |
| --- | --- | --- |
| `templates/` | **source code a team forks**, published into repositories by `pnpm run templates:publish` | the scaffold stops being a good starting point |
| `templates/` | **reference platform manifests** shipped with platfolio's catalog (D28), used as test fixtures | the manifest format changes |
| `selfhost/` | **platfolio hosting itself** — a deployment description, not something a tenant forks | the control plane's own topology changes |

Only the first leaves this repository as source. The catalog (second) is generic on purpose and contains no
platform identities; the third is deliberately excluded from it.
