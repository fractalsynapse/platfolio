---
name: platform-manifest
description: Use when adding a hosted platform to the platfolio catalog, changing the Platform Manifest schema or renderers, or wiring TreeDX/ArcNexus-class services for managed hosting.
---

# Author a manifest that renders everywhere

Apply the [project instructions](../../../AGENTS.md). Canonical specification:
[03 — Platform Manifest](../../../docs/design/03-manifest-spec.md). Do not restate field meanings
here; if a field is unclear, the specification needs the fix, and both files get updated.

Adding a platform is a **data change**, not a code release (decision D9). If it requires control-plane
code, that is a schema change and needs its own review.

## Procedure

1. **Write the platform description in the platform's own repository.** A hosted platform is not a directory
   under `templates/` -- that is gone (D60): `compose.yaml` with its `x-platfolio` block and its own
   `environment.yaml` registry at the same root (D58) live where the platform lives, and they enter platfolio as
   tenant data with `templateRef` pinned to a commit (D29, D45). A new *template* is a published repository plus
   one entry in `packages/manifest/src/template-catalog.ts`; parse fixtures for the schema and the renderers
   belong in `packages/manifest/test/fixtures/`, and the published templates are validated against the real
   repositories by `packages/manifest/test/templates.test.ts`. Declare `apiVersion` (schema) and
   `metadata.version` (platform release) separately, plus `requires.platfolio`.
2. **Declare `kind` and `mode`, then override.** `api-service` or `full-stack-web` supply defaults and
   validation rules. Short manifests are the goal; a manifest that restates every default hides drift.
3. **Secrets are names.** Every secret is `{ valueFrom: secret, source: … }` with a `value_source`
   from the closed enum. No field may hold a value; the secret-name lint must reject attempts rather
   than warn. Record required secrets so the connect checklist can list them and verify behaviorally.
4. **Declare resources and limits** the platform actually needs — database, cache, bucket, volumes,
   per-environment replicas and ceilings. Missing limits are a tenant cost and safety problem, not an
   optimization detail.
5. **Render and check both targets.** `railway config plan` for the IaC rendering and a compose
   bring-up smoke test for the local one, from the same intermediate. A manifest that only works on
   Railway is not portable and breaks the eject promise.
6. **Check domain rules.** CNAME plus TXT verification per host; apex only where CNAME flattening is
   possible; wildcard/subdomain overlap is rejected by validation, not at deploy time.
7. **Identity is a declared dependency.** Set `identity.mode` (`none`, `byo-oidc`, `hosted-realm`) and
   let redirect URIs derive from `domains[]`. Never hard-code an issuer; changing a domain is an
   identity-affecting change that re-applies the client config.
8. **Migration hooks ride the pre-deploy command**, forward-only, with the migration version recorded
   per release so rollback is honest about the database.
9. **Eject list must match reality.** `lifecycle.onEject` names artifacts the renderers actually
   produce; a promise nothing generates is worse than no promise.

## Verification, in this order

Schema validation → secret-name lint → domain conflict check → `railway config plan` on the scratch
project → compose smoke test → the eject-to-Compose test for the kind. All are CI gates, so
"the manifest merges" means "it renders", not "it parses".

## Exclusions

Provider capability interfaces belong to [capability-seams](../capability-seams/SKILL.md). Billing
SKUs and entitlement keys belong to
[06](../../../docs/design/06-billing-and-lifecycle.md).
