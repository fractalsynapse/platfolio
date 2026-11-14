# Starter web service

A UI and a JSON API in one container, with a managed Postgres attached. It is a starting point, not a
framework: three routes, no build step, no dependencies.

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build   # local, builds from source
```

| Route | Purpose |
| --- | --- |
| `/` | The page. Replace it with your app. |
| `/api/ping` | JSON, proves the service is reachable through the platform's host. |
| `/healthz` | What platfolio's healthcheck calls. **Keep this route.** |

## What platfolio does with it

  `compose.yaml` plus the `x-platfolio` block is the whole hosting description: the service is public, the
  database is provisioned and its URL arrives as `DATABASE_URL` -- wiring platfolio resolves, never something a
  teammate pastes into a settings screen.

  `environment.yaml` at the root of this repository is the registry (D58): one entry per variable this platform
  reads or deploys, saying whether it is a `secret` (a custody claim -- platfolio delivers it into your provider
  and cannot read it back), a `value` with a `default`, or `reference`/`output` wiring the platform resolves.
  This template declares two entries -- `DATABASE_URL` (wiring) and `UI_BRAND` (a default) -- and NO secrets at
  all: there is no session signing here, so the earlier version of this paragraph promising you
  `APP_SESSION_KEY` described a feature that does not exist. When your app needs a credential, add its name
  here; `pnpm run environment:registry` refuses to let the file claim an obligation nothing reads.

No custom domain is declared. Attaching a host whose DNS you do not yet control does not fail — it sticks at
`applying` with no certificate, which looks like progress and is not. Add `domains:` under `x-platfolio` on
the `web` service once the zone is yours.

## First changes worth making

1. Delete the page markup, keep the route.
2. Add your own table to the migration in `src/`, then read `DATABASE_URL` once at startup.
  3. Change `UI_BRAND`'s `default` in `environment.yaml`, or move it into `x-platfolio.services.web.environmentValues.staging` so staging and production differ inside the platform description rather than across two deployments (D56).
