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
database is provisioned and its URL arrives as `DATABASE_URL` — wiring platfolio resolves, never something a
teammate pastes into a settings screen. Secrets are in `.platfolio/environment.yaml` as **names**: `APP_SESSION_KEY`
is written into your execution plane once and is not readable by platfolio afterwards (D32).

No custom domain is declared. Attaching a host whose DNS you do not yet control does not fail — it sticks at
`applying` with no certificate, which looks like progress and is not. Add `domains:` under `x-platfolio` on
the `web` service once the zone is yours.

## First changes worth making

1. Delete the page markup, keep the route.
2. Add your own table to the migration in `src/`, then read `DATABASE_URL` once at startup.
3. Set `UI_BRAND` per environment instead of editing the source.
