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
3. Publish an image and report it. A `build:` service takes its digest from
   `POST /api/v1/instances/{id}/artifacts` (D54), which is why no fork needs a `compose.prod.yaml`, a registry
   lookup script, or CI that writes files back into itself. Commit a digest for a third-party `image:` instead.
 An unverifiable host never fails; it waits forever for DNS that
   will not arrive, which reads as a stuck deploy and is not one.
4. Run `pnpm run test` — `packages/manifest/test/templates.test.ts` parses, validates, and builds a plan for
   every template here, so an unparseable or unhostable scaffold fails CI rather than a tenant's first
   deployment.

## Where these live, and what each one is for

Three names in this repository look interchangeable and are not — worth stating, because the fourth was a
special case that made platfolio's own hosting architecture differ from the templates' (D50) and has been
removed, and because a directory that no longer exists was described here for a whole release:

| Path | Is | Changes when |
| --- | --- | --- |
| `templates/` | **the three reference platforms and the source a team forks**: `starter-web` (web/API), `starter-worker` (background worker), `shared-identity` (shared service), published into their own repositories by `pnpm run templates:publish` | the scaffold stops being a good starting point, or the manifest format changes — `packages/manifest/test/templates.test.ts` parses, validates and plans every one of them, so an unhostable scaffold fails CI rather than a tenant's first deployment |
| root `compose.yaml`, `compose.prod.yaml`, `.platfolio/` | **platfolio hosting itself** — the same three kinds of file a tenant repository has, in the same place (D50) | the control plane's own topology changes; `pnpm run platform:plan` is how you find out before a provider call does |
| `.agents/skills/` | agent procedures, inherited from the starter scaffold and left identical to their source | almost never, and never by editing them here |
| ~~`platforms/`, `platform-templates/`, `samples/`, `selfhost/`~~ | **deleted** (Nov 2026) — see the CHANGELOG | a catalog that duplicated `templates/`, fixtures that lived outside the test tree, and a special-case hosting description |

The templates are also the test targets (D49): what platfolio hosts is what platfolio is tested against, plus
itself. That is why there is no `platforms/` catalog any more — a second copy of the same three manifests, kept
in step by hand, was the bug.
