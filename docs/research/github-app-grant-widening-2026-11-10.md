# Widening the app's grants: environments and tenant repositories (2026-11-10, D35)

**The decision.** platfolio must be able to create a tenant's `production` and `staging` environments and to
create tenant repositories in an organization from a platform template. The alternative — "the tenant clicks
this in GitHub" — contradicts the product promise that platfolio is the management interface, with external
OAuth consent as the only out-of-band step. So the app asks for `administration: write`.

**What was measured rather than assumed:**

| Probe | Result |
| --- | --- |
| `PUT /repos/{repo}/environments/production` with an `environments: write` token | **403** `Resource not accessible by integration` |
| Same, requesting `administration: write` at mint time | **422** `The permissions requested are not granted to this installation.` |
| `GET /app/installations/{id}` with the app JWT | lists the granted set — `contents`, `workflows`, `environments`, `secrets`, `pull_requests`, `checks`, `statuses`, `actions`, `metadata` — and **no `administration`** |
| `repository_creation: write` at mint time | **422**, identical text to an unknown permission name (`definitely_not_a_permission: write` → same 422) |

Two conclusions, and they pull in opposite directions:

1. **`administration: write` is the only working door for environments.** Documented in GitHub's own
   guidance: "If your app only needs 'Administration' permission to create repositories, request the
   'Repository creation' permission instead" — but that narrower permission is for *repository creation*, and
   environments still need administration.
2. **The 422 cannot distinguish an invalid permission name from an ungranted one**, so `repository_creation`
   is not requested yet. Putting an unproven key into the manifest risks a registration that fails for a
   reason we cannot read. The narrowing attempt is filed as a follow-up against a live registration, not
   guessed into the defaults.

## The honest cost, stated where a reader will meet it

`administration: write` is full control of a repository's settings and integrations. What limits the blast
radius is not the grant but how it is used: **runtime tokens are minted per operation with the narrowest
subset that works** — measured, asking for `contents · workflows · pull_requests` yields exactly that — and
are revoked at the end of the call. `app:check` now prints the installation's granted set, because a widened
manifest does not mean a widened installation: GitHub asks the account owner to approve new permissions, and
until that happens the token silently lacks them. Reading beats assuming.

## A leak from my own probe, recorded

The permission-name probe printed `await r.text()` on **every** response, including the 201 that contained a
live installation token — so a credential value appeared in operator-visible output. It is scoped to one
repository, expires within the hour, and was not stored anywhere; the fix is that error-detail printing is now
restricted to failed responses (which the write path already does) and probes print status plus a truncated
body, never a success payload. This is the same class of mistake as logging a resolved variable "for
debugging", and it is written down rather than quietly avoided in future.

## Still unverified, and not faked

- Whether an **installation token** may generate a repository from a template at all (community reports say
  the endpoint is user-oriented), and which grant suffices.
- Whether **required reviewers** can be attached through the API. `wait_timer` is settable; the reviewer gate
  may be UI-only, which would mean platfolio creates the environment and the tenant sets the gate — a real
  exception to "everything in platfolio", and better named than discovered.

Both are open checks against the next registration, listed in the plan of record rather than answered in code.
