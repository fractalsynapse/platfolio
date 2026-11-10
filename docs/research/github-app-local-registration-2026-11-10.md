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
