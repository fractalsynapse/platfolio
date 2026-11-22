# Registering platfolio's GitHub App from a laptop (2026-11-10)

The first M2 step said "open this link and create the app", and it failed on the spot: GitHub's form wants
URLs, and platfolio was running locally with none. It can be done locally — GitHub documents it — so this
record is the shape of the flow plus the two things that made the previous attempt not work.

## What is documented, and where

- [Registering a GitHub App from a manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) — the three-step handshake: redirect a user to `github.com/settings/apps/new`, GitHub returns to `redirect_url` with a one-time `code`, then `POST /app-manifests/{code}/conversions` returns `id`, `pem` and `webhook_secret`. **All three steps must finish within an hour.**
- [Building a "Login with GitHub" button with a GitHub App](https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-login-with-github-button-with-a-github-app) — GitHub's own tutorial sets the callback to `http://localhost:4567/github/callback` and says to change it only before deployment. So a localhost registration is not a workaround; it is the documented development path.
- [Testing webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks) and [smee.io](https://smee.io/) — the forwarder for when deliveries *are* wanted. v1 of platfolio polls installations instead, so no forwarder is required.

## The two mistakes in the earlier attempt

1. **A GET link instead of a POST.** The docs say to provide a link that *sends a POST* to `settings/apps/new` with the manifest as a form field. The helper emitted `?manifest=<base64>` on a GET, which is not the flow and produced a form that complained about missing pieces. `scripts/github-app-local.ts` now serves a page that POSTs an auto-submitting form.
2. **A webhook URL pointed at a public host that has no such route.** `hook_attributes.url` is documented as required *within* the object, so the fix is to **omit `hook_attributes` entirely** (or point it at a smee channel and leave it inactive). Registering an app with a webhook that cannot answer means failed deliveries against the tenant's events from the first minute.

## One inference, flagged

The exchange endpoint is documented as the step that *creates* the app's credentials, so it cannot sensibly
require credentials of its own, and third-party implementations post it unauthenticated. GitHub does not say
so in the imperative. The script treats a 401 as the falsification it would be and reports it plainly.

## How the local flow runs

```
pnpm run app:local:check      # print the manifest and the POST target; no network
pnpm run app:local             # listen on :8077, open http://localhost:8077
```

The page POSTs the manifest; GitHub redirects back to `http://localhost:8077/platfolio/callback` with `code`
and `state`. The script refuses a `state` mismatch, exchanges the code, and writes
`appId/slug/clientId/clientSecret/webhookSecret/privateKeyPem` to `.secrets/platfolio-app.json` with mode
**0600**. **No credential value is ever printed.** It then polls `GET /app/installations` with an RS256 JWT
signed by the new key (max ten minutes, per GitHub's limit — longer is refused locally because GitHub
rejects it anyway, which otherwise surfaces as an anonymous 401) and records `installationId` when the
repository appears. A bad callback keeps the listener alive: the operator's fix is a second click, not a new
run with a new state.

## Verified here

`--check` prints the manifest; the running server was probed for POST shape, auto-submit, wrong state (400),
missing code (400), unknown path (404), and that it is **still listening** afterwards (200). The JWT test
verifies the signature against its own public key rather than asserting a shape. The exchange endpoint and
the browser leg are **not yet exercised** — that is the step this hands over.

## Update, same day: the manifest was full of invented fields

The first real attempt was rejected by GitHub with:

> Error "single_file_permissions" is not a permitted key.

That key — plus `request_verification`, `webhook_active`, and a `permissions` map next to
`default_permissions: 'read'` — came from the offline seam, written before any of it had been checked against
the manifest schema. **`default_permissions` is documented as an object of permission-name to access level; we
sent the string `'read'`.** The tests passed because they asserted the fields we had invented, in the shapes we
had invented them — the same failure family as a mock with a fabricated `serviceInstances` field, one layer
further out.

Two properties of this failure worth writing down:

- **GitHub names only the first offending key.** Fixing one and retrying would have produced a second error,
  then a third. So the schema below rejects *all* unknown keys locally and lists the permitted set in the
  message, which is the only way the operator sees the whole problem at once.
- **The docs page is the schema.** `MANIFEST_KEYS` is transcribed from it, and a test asserts every key either
  emitter produces is in that list — so a future invention fails CI rather than a browser session.

The flow itself is also wrong in the earlier helper: it emitted `?manifest=<base64>` on a GET. The documented
flow posts the manifest as a form field, which is what `app:local` does; `registrationUrl` now returns only
the POST target plus `state`, and a test asserts the manifest is *absent* from the URL — otherwise the test
cannot distinguish the two flows.

## Second live attempt: the manifest passed, the exchange answered, my validation lost the run

The maintainer got past the form this time — so `MANIFEST_KEYS` was right — and the script reported:

> Manifest exchange failed: manifest exchange response missing webhook_secret

**GitHub's documentation says the exchange response "will include the `id`, `pem`, and `webhook_secret`."** In
practice, an app registered **without** `hook_attributes` — which is what the local flow does on purpose —
returns no `webhook_secret` at all. My required-field list treated the docs' sentence as a schema and the run
failed on a field that cannot exist.

The cost was real and worth naming: **the manifest code is single-use.** The HTTP call succeeded, so the app
was created and the code was consumed; validation threw *after* that, which means the credentials arrived and
were discarded. The app now exists in the account with a key nobody holds. Recovery is to delete it (or leave
it) and run the flow again — the second run will succeed, and that is the point of the fix.

Two changes, then:

- `webhookSecret` is optional in the result. Not defaulted to `''`, because an empty secret would later pass a
  signature check that should have failed loudly.
- A failure now lists the **key names that arrived** (never values), because a mismatch discovered after the
  code is spent is otherwise undiagnosable from the error text alone.

Lessons kept: a documented response description is evidence about a shape, not the shape; and a one-shot
credential exchange has to validate *after* reading and *before* discarding, with enough in the error to
reconstruct what happened.

## Third attempt: registered, and the app key authenticates

The flow completed after the response-shape fix. `pnpm run app:check` (which exists so this is
re-checkable rather than remembered) reports:

```
  file: .secrets/platfolio-app.json          (-rw------- , gitignored by .secrets/)
  fields present: appId, clientId, clientSecret, privateKeyPem, registeredAt, slug
  GET /app (app JWT): 200 as "platfolio-local"
  GET /app/installations: 200 -> 0 installation(s)
```

What that establishes, precisely:

- **The manifest shape is GitHub-accepted** and the **exchange endpoint works unauthenticated** -- the one
  inference in this design is now evidence rather than reasoning, and the `webhook_secret` absence was real,
  not a truncated response.
- **`createAppJwt` is correct against the live API.** `GET /app` under app authentication is the strictest
  easy test of it: a wrong signature, a bad `iss`, or an expired token all answer 401. It answered 200 and
  identified the app by slug. Until this run, that function had only ever been verified against its own
  public key -- which proves the signature, not that GitHub's expectations were met.
- **The credentials file is a 0600 untracked file with no value in any log line.** The check script prints
  identifiers (app id, slug) and never the key, client secret or webhook secret.
- **`0 installation(s)` is the honest current state**, not a failure: the app exists, nobody has installed it
  yet. That distinction is the whole reason the check reports the two endpoints separately.

App id `5693967`, slug `platfolio-local` -- identifiers, safe to record. The next step is installation, which
only the maintainer's browser can do.

## Registration succeeded, and the app could not be installed anywhere useful

The flow completed: `platfolio-local`, app id 5693967, credentials in a `0600` file, `GET /app` under an app
JWT answering **200** — so the manifest, the unauthenticated exchange and `createAppJwt` are all now evidence
rather than reasoning. Then installation failed in a way that looked like a permissions problem:

> can install only on `adrianwebb` repositories; cannot install on any `fractalsynapse` repository

It is not permissions, and no grant would fix it. [GitHub's visibility
documentation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)
states the rule twice, and it is the operative constraint:

> If you set your GitHub App registration to private, **it can only be installed on the account that owns the
> app**. … Private GitHub Apps can only be installed on the user or organization account of the app owner.

The manifest we generate says `public: false` — deliberately, because a development app holding `contents:
write` and `secrets: write` must not have a public Install button. It was registered through
`github.com/settings/apps/new`, so its owner is the **personal** account (`GET /app` confirms
`owner.type = "User"`). Private + personal-owned ⇒ org repositories are not installable targets. There is no
middle setting: making it public would put a write-capable dev app on a public landing page.

**The fix is the ownership, not the visibility: register under the organization.** `pnpm run app:local --
--org fractalsynapse` posts the same manifest to
`https://github.com/organizations/fractalsynapse/settings/apps/new`, producing an org-owned private app whose
install targets are that organization's repositories — which is also what the self-hosting test needs, since
the tenant repository lives in the org.

Two artifacts of this discovery, both worth keeping:

- `app:check` now prints the rule when it applies. The symptom (an install page with no org in the list) gives
  no hint of the cause, and the cause is a one-sentence documentation fact.
- `pnpm run <script>` does **not** forward flags without a bare `--`, so `pnpm run app:local --org x` silently
  registered under the personal account while looking like it had used the org. The script now strips a
  leading `--` and the docs write the command with it. A flag that is quietly dropped is worse than one that
  errors, and this is the same class as the mock's option whitelist dropping `keepProjectAfterDelete`.

The personal-account app should be deleted once the org app exists; it holds credentials that are unusable
for the only target that matters, and leaving a write-capable app installed nowhere is just a wider surface.

## Step 2 done: an org-owned app, installed on the tenant repository, verified by the API

```
Registered: platfolio-local (app id 5694176)
Installed: installation 180457153 on fractalsynapse
installation token minted: expires 2026-11-10T09:56:20Z, selection selected (value not printed)
GET /installation/repositories (installation token): 200 -> 1 repository(ies)
  fractalsynapse/platfolio
installation token revoked after the read
```

**`selection: "selected"` and exactly one repository is the point.** The installation was scoped to
`fractalsynapse/platfolio`, and the token minted for it can see nothing else — D25's least-privilege claim is
now a measured property rather than a design intention. The token was deleted immediately after the read.

`GET /installation/repositories` answered **401 with the app JWT**, and 200 with an installation token. That is
a credential-type error wearing the costume of a permissions error, and it is worth recording because the two
have completely different fixes: the app JWT authorizes *requests about the app*, and repository operations
require a token minted from an installation. `createInstallationAccessToken` / `revokeInstallationAccessToken`
are now in the SCM seam, scoping to `repository_names` and narrowed `permissions` when asked, and an
unscoped request sends `{}` rather than `null` because GitHub treats those differently.

Nothing from this run prints a credential: the token value never left the process, and the private key stays
in the `0600` file.
