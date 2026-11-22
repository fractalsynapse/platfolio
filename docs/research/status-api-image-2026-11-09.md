# M1 step 6 — platfolio's own image: what is built, what is blocked (2026-11-09)

## Working, verified by running

`apps/status-api` is the first component of platfolio's own stack: `/healthz` (stable payload), `/readyz`
(honest about having no dependencies yet), `/version` (commit, build time, **provider contract**). It reads
no secrets and holds no tenant data, so the container can be built, deployed and restarted without touching
anything a tenant owns.

`apps/status-api/Dockerfile` + `.github/workflows/image.yml`: PRs get a build and a **container smoke test**;
pushes to `staging`/`main` additionally publish `sha-<short>` and the branch tag, taking the digest from the
push output because a plan pins a digest and never a mutable tag.

From the runner on `staging` (build `b3804e7c…`):

```
healthz:  {"status":"ok","livenessToken":"e5efa4bf551e9d3d"}
version:  {"name":"status-api","version":"staging","commit":"b3804e7c260d9199b28356a7bada9f789d047bc4",
           "buildTime":"ci","providerContract":{"name":"infra.provider","version":"1.0.0"}}
pinned digest: sha256:f26eea4352a70516e46c6d95e7d2de0a53e749c403affeab36d632387c5289b4
```

Locally: 404 on unknown paths, 405 with `Allow: GET, HEAD` on POST, and the image's own `HEALTHCHECK`
reporting healthy. Zero deployments consumed — none of this touches Railway.

## Four defects `docker build` could not see

| Defect | Symptom | Fix |
| --- | --- | --- |
| `USER node` over root-owned files | `Cannot find module '/app/apps/status-api/src/index.ts'`, not `EACCES` | `chown -R node:node /app` before the user drop |
| Two-stage build re-copied sources over installed workspace links | `node_modules/@platfolio/contracts` absent at runtime | single stage, sources copied after the install |
| pnpm's default symlink farm does not survive stage copies | `Cannot find package 'tsx' imported from /app/` | `node-linker=hoisted`; and `tsx` turned out unnecessary — the image's Node 22.23 strips types natively, so `CMD node apps/.../index.ts` |
| Step-level `packages: write` exceeding the workflow grant | run **fails before producing any log** | permissions declared once at workflow level |

That last one cost three debugging rounds because a permissions rejection with no logs looks like
infrastructure flakiness rather than a mistake of mine.

## Two repository gates that ignored `apps/`

- root `test` script globbed `packages/*/test/*.test.ts` — the service's five tests never ran;
- root `tsconfig.json` included `packages/*` only — the service was never typechecked.

Both were widened; `pnpm run lock:check` separately caught that `pnpm install` had reported
"already up to date" while the new importer was missing from the lockfile. A gate that cannot see the new
directory is not a gate.

## What is blocked, and why it is not a code problem

Railway cannot pull the image: the GHCR package for a private repository is private, and setting visibility
requires org admin, which I don't have. Two ways forward, both maintainer actions:

1. **Make `platfolio-status-api` public on GHCR** — it contains no secret, only build identity — then
   Railway deploys by digest.
2. **Link this repository to Railway's GitHub app** so Railway builds from the Dockerfile — no public
   package, at the cost of Railway needing source access.

The option I rejected: giving platfolio a registry credential inside a tenant-side project. That is exactly
the credential shape this project decided not to hold, and it would trade one deploy for a permanent
custodianship problem.

## Still open in step 6

Deployment of platfolio's own stack to a staging Railway environment (blocked as above), and the
companion `railway.json`/manifest for the service itself (M1 step 7), which now has a real pinned image to
point at once the visibility question is settled.


## Closed: public pull, provider deploy, external proof

The maintainer made `platfolio-status-api` public through the repository's Packages UI — "how most users
might do it" — which is the shape of the action we ask tenants for, and the reason the provider's hint has
to describe a console, not an API. Two verification notes from getting here, both mine:

- my first two pull tests were wrong for different reasons: a `HOME` override for docker also hid `gh`'s
  credentials, and a manifest `GET` without an `Accept` header returns 404 from ghcr even for a public
  image. The correct anonymous probe is `docker manifest inspect` or a GET carrying the OCI/Docker manifest
  content types; then `staging` returned **200** and the digest resolved.
- `403 DENIED` and `404 Not Found` from the package APIs meant "this token cannot see it" (scopes: no
  `read:packages`), not "does not exist" — which is also why the org-scoped visibility endpoint appeared to
  404 while the package lived at **repository** scope.

`applyPlan` was then called with a plan carrying `ghcr.io/fractalsynapse/platfolio-status-api:staging` and
the resolved digest, one service, one generated domain, no databases or buckets. Provider output:

```
verified: true   services: [["status","live"]]   failures: []
domains: [{"host":"<generated-railway-host>","dnsStatus":"verified",
          "certificateStatus":"issued","targetService":"status"}]
```

Reached from outside the platform:

```
GET https://<generated-railway-host>/healthz -> {"status":"ok","livenessToken":"492fdecb32aea42b"}
GET .../version -> {"name":"status-api","version":"staging","commit":"f546d785bb4c0695b744272c17181d6cc8fb2107",
                    "buildTime":"2026-11-09T18:33:32Z","providerContract":{"name":"infra.provider","version":"1.0.0"}}
GET .../nope    -> 404      TLS: issuer=Let's Encrypt, subject=CN=*.up.railway.app
```

`certificateStatus: issued` came from reading `syncStatus: ACTIVE` back through the provider, not from
inferring it from the hostname — which is the behaviour #64 pinned. A second `applyPlan` of the same plan
reported the same host with no redeploy, so idempotency holds on a service that came from a public
registry image rather than the conformance fixture.

**Deployments consumed by this step: two** (initial deploy, and the image's own provisioning build). No
quota rejection at any point; the daily ceiling remains unmeasured from the API side, as documented.
