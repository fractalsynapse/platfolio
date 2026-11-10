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
