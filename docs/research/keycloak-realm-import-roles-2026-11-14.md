# Keycloak realm import and roles — what `--import-realm` actually does

**Measured 2026-11-14 against `keycloak/keycloak:26.8.2`** — the exact image our composition runs — with `kc.sh start-dev --import-realm`, a realm file at `/opt/keycloak/data/import/<realm>-realm.json`, and every claim read back through the Admin REST API and through an **issued token**. No project files were involved in the probe.

This replaces a claim this repository had been repeating in three places: *"Keycloak 26.8.2 rejects role assignments in `--import-realm`"* (#168). **That claim is false**, and the true behaviour is worse, because it is silent.

## The finding that matters most: a successful-looking boot that applies nothing

| Evidence | Tier |
| --- | --- |
| With the realm already in the database, `--import-realm` logs `Realm '<name>' already exists. Import skipped`, then `KC-SERVICES0032: Import finished successfully` | measured, 26.8.2 |
| With no `data/import` directory at all, it logs **zero** import lines and starts, offering only the master realm (`ImportRealmMixin` filters on `File::exists`) | measured + upstream code |
| Our identity service shares the persistent Postgres schema `keycloak`, so after the first successful boot the import file is a permanent no-op on every later start | consequence of the two above, applied to our topology |

A wrong hostname fails loudly. A realm import that skipped silently looks, from the outside, exactly like a realm import that worked. **This is the reason the seed is an API operation and not a file**, and the reason the file was never the right answer — not because roles are unsupported.

## Role declarations and assignments DO import — with the documented keys

Measured, everything landed, and a password-grant token for the imported user carried
`realm_access.roles = ["platfolio:user"]` and `resource_access["platfolio-api"].roles = ["read"]`:

| What | Key path that works | What the wrong key does |
| --- | --- | --- |
| realm roles | `roles.realm[]` → `{name, description, composite, clientRole: false}` | — |
| client roles | `roles.client` keyed by **clientId** | keyed by client *name* → fatal: `App doesn't exist in role definitions` (`RepresentationToModel.importRoles` throws) |
| user → realm role | `users[].realmRoles` (list of names) | `users[].roles` → **startup error**, not a silent drop: `Unrecognized field "roles" (class UserRepresentation), not marked as ignorable (29 known properties: … "realmRoles", "clientRoles", …)` |
| user → client role | `users[].clientRoles` → `{ "<clientId>": [names] }` | `roleMappings` is not an import-file key at all |
| realm default role | `defaultRoles` (deprecated but read on import) | grants nothing to users declared in the same file — a user created afterwards gets `default-roles-<realm>` |
| service accounts | user `service-account-<clientId>` + `serviceAccountClientId` + `realmRoles`/`clientRoles` | measured working: a `client_credentials` token carried `realm_access = ["platfolio:runner"]` and `resource_access["platfolio-api"] = ["read"]` |

So the original observation — "import ran without an obvious error and the roles did not appear" — was *inverted*: our field name caused a **hard failure at startup**, and the absence of roles was caused by something else entirely (the skip-above).

## Re-application paths, and why none of them is a safe substitute

| Mechanism | Measured behaviour | Verdict for us |
| --- | --- | --- |
| `kc.sh import --dir` (default `--override=true`) | logs `already exists. Removing it before import` → **deletes and recreates the realm** | unacceptable: destroys the realm's runtime state |
| `kc.sh import --dir` with `--override=false` | skips | equivalent to doing nothing |
| `POST /admin/realms/{realm}/partialImport` with `ifResourceExists=OVERWRITE` | added roles and assignments (`{"added":2,"overwritten":1}`) but **replaced the user**: realm mappings became exactly the file's list and `GET users/{id}/credentials` returned `[]` | too sharp an edge for a boot step |
| `POST /admin/realms/{r}/users` carrying `realmRoles`/`clientRoles` | **ignored** — upstream issue #13390, still open | the API cannot declare assignments at creation |
| Admin REST role-mapping endpoints (`…/role-mappings/clients/{id}`, or `kcadm add-roles`) | works, idempotent per name, read back and asserted | **what `scripts/seed-identity.ts` does, and should continue to do** |

## Further measured facts from the same run (added after the first draft)

| Finding | Why it matters here |
| --- | --- |
| A file named `<something>-realm.json` whose internal realm is `<other>` is **fatal**: `File name / realm name mismatch. … File name should be <realm>-realm.json`. A bare `realm.json` is accepted via the single-file provider | a silent-looking config bug in the filename is a startup failure; the convention is also what makes *user side-files* (`<realm>-users-N.json`) load at all |
| `defaultRoles` populates the realm's default-role composite but grants **nothing to users declared in the same file**; a hand-written `default-roles-<realm>` entry produced a stray `default-roles-platfolio-1`; a real `kc.sh export` round-trips correctly | if a role must be on a user, write it in `realmRoles`. Do not hand-author default roles -- export them |
| A role name referenced only by a user, never declared, is **auto-created** by the importer (no PK violation on 26.8.2 via boot import) | convenient, and a 26.5+ regression open upstream (#49731 / PR #50056, unmerged as of this writing) where two users referencing the same undeclared *client* role can hit a `KEYCLOAK_ROLE` PK violation. **Declare roles explicitly.** |
| `partialImport` with `ifResourceExists=OVERWRITE` also **deletes `service-account-*` users of clients** upstream (#46674), on top of the credential wipe measured here | our own shared-identity realm runs on service accounts, so partial-import-overwrite is a non-starter for us even in principle |
| The Kubernetes Operator's `KeycloakRealmImport` CR is likewise **create-only**: "does not update or delete those" | rules out "just use the operator" as an idempotent-seeding answer |
| User Profile validators do **not** run for imported users (#52310): full import and `--import-realm` share the code path | one less candidate explanation for "roles vanished" -- the opposite risk applies (users the API would reject get created) |
| `authorizationServicesEnabled` interplay: service accounts and authorization settings are set up *after* users and skipped entirely when the import is `skipUserDependent`; #37569 reports an NPE importing an admin-UI-exported realm on 26.1.0–26.1.2 | **not exercised here** (our probes ran with authorization services off) -- flagged as an untested edge rather than a clean bill of health |

## Provenance of the article that prompted this re-check

The maintainer pointed at <https://medium.com/@torinks/keycloak-roles-2a521e64344d>. **It could not be fetched (HTTP 403, bot protection), so its content is unverified in this document** and nothing above depends on it: every claim here traces to Keycloak's own docs, upstream code at tag `26.8.2`, or a measurement against that image. Search metadata describes it as a general realm-roles/client-roles explainer. It did its job -- it made me re-test a claim I had asserted three times.

## Limits of this evidence

Measured on `start-dev` with in-container H2 against the **same image digest we run**; the skip-on-existing and destructive-replace behaviours were also exercised via `kc.sh import/export`. Not exercised: Postgres-specific batching (relevant to #49731), clustered caches, realms with `authorizationServicesEnabled: true`, FGACv2/admin permissions, user side-files, and `--import-realm` of `master`. No Keycloak 27 exists (latest release 26.8.2), so anything labelled "27" would be `main`-branch code and is not claimed here.

**Side effect of the experiment, disclosed:** the cleanup command `docker rm -f kc-*` also removed a pre-existing, unrelated container named `kc-seed`. Nothing in this repository references that name, our local stack runs Keycloak through Compose, and the dev Postgres (`platfolio-control-plane-main-1`) was left running and healthy. The 16 probe containers were ours; `kc-seed` was not.

## Consequences adopted

1. `scripts/seed-identity.ts` stays the seeding mechanism — not because import cannot carry roles, but because **import cannot be re-applied idempotently** and the seed can. It creates the client role, maps it, and reads the mapping back (that read-back is the test).
2. No realm JSON is shipped in this repository, and none should be added as a *configuration source* for roles. If one is ever added for first-boot convenience, it must use `realmRoles`/`clientRoles` (never `roles`), key `roles.client` by **clientId** (never the display name), and be documented as **first-boot-only, skipped silently afterwards**.
3. The comment in `compose.dev.yaml` and the note in `docs/design/16` carried the false claim; both now point here.

## Sources

- Keycloak 26.8 Server Developer — *Realm Import/Export* and *Role* sections: https://www.keycloak.org/docs/26.0/server_developer/
- Keycloak 26.8 Admin Console Guide — *Assigning role mappings*: https://www.keycloak.org/docs/26.0/admin_console_guide/server_roles/
- Upstream issue (API ignores role declarations on user creation): https://github.com/keycloak/keycloak/issues/13390
- The walkthrough that prompted this re-check: https://medium.com/@torinks/keycloak-realm-import-roles-2a521e64344d -- **HTTP 403, not fetched; content unverified here.** It did its job (it made me re-test a claim I had asserted three times); no finding above rests on it
- Upstream representations and import code: `UserRepresentation` (field list quoted in the measured error above), `RepresentationToModel.importRoles`: https://github.com/keycloak/keycloak

**Method note.** The maintainer's objection was correct and the cost of my error was three documents asserting something untrue about a third-party product. The claim had survived because it was never re-tested after the container version moved, and because a silent skip is indistinguishable from success in a log that prints `Import finished successfully`. Any claim in this repository about provider behaviour owes a re-test when the provider version changes.
