# Shared identity (Keycloak)

One OIDC issuer for a team's web services, workers and shared services. Close to stock Keycloak on purpose:
every deviation from upstream is a thing a future Keycloak upgrade has to survive, and this service is the one
other applications depend on.

## What it publishes

```yaml
provides:
  name: identity
  outputs: [issuer, jwks_uri, client_id, client_secret]
```

Consumers say `capabilities: [{capability: identity, as: [OIDC_ISSUER]}]` — a **capability**, not an instance
id — so the team can move identity providers without editing every application. `client_secret` is a
generated credential relayed once: platfolio keeps nothing, which is why losing it has exactly one recovery
path (re-issue) and replay is impossible by construction rather than by convention (D32).

Binding records the generation of what was published, so a rotated issuer shows as *"this consumer still
points at the previous one"* rather than as a mystery 401 at three in the morning.

## Before you use it in production

1. **Create a realm per team, never use `master`.** The bootstrap admin password exists to do that once.
2. Set `KC_HOSTNAME` after your DNS is delegated; until then the generated `*.up.railway.app` host works, and
   an unverifiable custom host will sit at `applying` forever without failing.
3. Rotate `KEYCLOAK_ADMIN_PASSWORD` out of use, and prefer a service account per consumer over shared
   credentials.
4. `onEject` includes `realm-export`: identity is the one thing a tenant must be able to walk away with.
