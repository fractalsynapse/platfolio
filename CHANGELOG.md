# Changelog

Notable changes to the platfolio project. One human-readable entry per user- or developer-visible
change; entries describe merged intent, not aspirations.

## [Unreleased]

### Fixed — Railway reconnection in private installations (#288)

- Show the Railway connection action when the worker can no longer use or refresh its saved grant.
- Offer redeploy for applied environments in the private workspace's hosting panel.
- Keep managed PostgreSQL private when the provider template includes a public TCP proxy.

### Fixed — environment wiring for OCI marketplace installs (#288)

- Validate the bundled environment registry against its Compose recipe and apply its defaults,
  credential names, and database references in the environments it declares.

### Added — gated marketplace artifact delivery (#288)

Publisher teams can publish a deployment bundle with pinned OCI images. Private installations can
prepare the release without publisher source access. Maintenance coverage gates new acquisitions.
Existing receipts retain access to their exact manifests and layers.

### Added — receipt-backed private marketplace installs (#288)

Private installation owners can prepare a named instance from an exact marketplace acquisition.
The private installer verifies the Git commit and the registry manifest digests before image
provisioning. Shared services and hosted applications retain the verified image plan for retries.
Starter templates retain the acquired commit in the customer's repository for the source workflow.

### Added — team-owned platform publications and exact free acquisitions (#288)

Marketplace team owners can publish immutable versions for all three platform variants. Published
versions appear in the classified catalog and an enrolled installation can acquire a version by its
descriptor digest. The buyer's team receives one durable receipt for that release. New listings keep
artifact coordinates behind acquisition. Existing marketplace endpoints and pins remain compatible.

### Added — classified marketplace platform catalog (#288)

The hub exposes a platform listing and release history alongside the existing template endpoints.
Starter Web and Starter Worker are starter templates. Shared Identity is a shared service. A forward
migration assigns stable platform IDs while keeping the original release rows and pins. Legacy catalog
and claim responses keep their existing shape. The hosted-application variant is reserved for the
first publisher-built application release.

- Show the four-color Platfolio logo in the site and workspace headers, and use it as the browser tab icon (#332).

- Save the private owner’s temporary password before launch and show it when the installation is ready, so an expired first sign-in can be restarted without redeploying (#288).

- Redeploy Shared Identity at its installed release from the staging Deployments page, and restore it without replacing its Keycloak credentials or database (#288).

- Public template pages show the latest published versions and source pins from the hub catalog (#288).

- The hub can publish new versions of its free templates without a Platfolio release. Connected private installations refresh the catalog and keep the release approved for each app when resuming, restoring, or redeploying it (#288).

- Install and redeploy Starter Worker from a private Platfolio. The worker runs in its own staging project with persistent storage and no public ingress (#288).

- Private installations discover the hub’s three pinned templates and can deploy Shared Identity with Keycloak and private PostgreSQL in a dedicated Railway staging project (#288).

- Show Starter Web’s verified wipe receipt directly on Manage app (#288).

- Confirm Starter Web removal after Railway stops listing the project. Retrying a wipe can confirm an earlier deletion without sending it again (#288).

- Update one private Platfolio environment or remove its entire installation from Connections. Both actions reauthorize the recorded workspace and verify the result before closing the journal (#288).

- Apply the mockup’s shared page spacing, account layout, resource rows, and deployment history across the workspace. Browse the published templates on Astro pages and manage an installed Starter Web app from its own management page (#288).

- Match the Your teams page to the mockup, including team instance counts and the pending invitation card. The existing Starter Web launch links share one screen (#288).
- Bring the Keycloak theme, team and account pages, activity and notification panels, invitations, and template picker closer to the approved workspace mockup (#288).
- Keep private installation progress across hub restarts. Owners can reauthorize and resume setup or add an environment in the same project without modifying previously installed environments (#288).
- Launch private Platfolio from Connections. Choose an approved workspace, name the project, and deploy staging, production, or both through the hosting provider API. Download the first sign-in password and a separate troubleshooting report (#288).
- Show the provider-neutral hosting controls on each app's management page. Starter Web and planned instances share verified keep-data and wipe-data controls, and the Starter release runner uses an injected source deployment adapter (#288).
- Verify that workloads stop and storage remains for keep-data removal. Wipe requires confirmed project deletion and provider read-back (#288).
- Resolve hosting from the instance's registered provider. Private worker and workflow execution use the infrastructure contract, and repository plans can target staging, production, or both (#288).
- Compose workspace routes with shared page, navigation, field, action, and layout components. Profile edits update the avatar from the same confirmed account response (#288).
- Fresh private Platfolio realms can offer themed password recovery using the owner's STARTTLS relay. Password reset links expire after 15 minutes (#288).
- Private installation owners get the mockup's connection cards for secret storage, Railway, and the marketplace. A fresh private Keycloak can start with the owner account alone, and the launcher can verify an exact staging project when names repeat (#288).
- Fresh private vaults let owners restore the launcher policy with two recovery shares using OpenBao's authenticated recovery API (#288).
- The private identity image can create its operator realm and initial sign-in on first boot using installation-local inputs (#288).
- Private installations can register their own Railway callback after OpenBao is ready. A new Starter Web launch configured for the marketplace uses a saved claim, including after hub disconnection (#288).
- Hub team owners can create one-time marketplace connection codes, see when their private installations enroll, and revoke marketplace access from Connections (#288).

## [0.6.0]

Release baseline `0.5.0..4ceb67c`. The candidate includes the themed Keycloak image and the
React workspace. The shared public Keycloak host keeps separate staging and production realms.

- Starter Web staging owners can update the public header label from Configuration. Platfolio confirms the value on the running app and keeps its existing Railway project and database (#288).
- Starter Web staging owners can attach or detach a custom hostname and get DNS records and certificate status from Railway (#288).
- Operators can opt in to email for their notification rules using their installation's verified primary account address (#288).
- Private owners can connect to the marketplace from their workspace and acquire the pinned starter using a registry credential held in their OpenBao (#288).
- Owners can rebuild the pinned Starter Web release from Deployments while retaining its Railway project and database (#288).
- Added personal in-app notification rules for failed deployments, outages, and environment secret updates, scoped to current team memberships (#288).
- Added private availability checks and an outage timeline for hosted Starter Web. Planned stops remain visible separately from outages (#288).
- Show verified deployments and hosting activity in each team workspace, with links to deployment evidence and app management (#288).
- Added team tabs for the owner roster and private installation connections and added management links to hosted Starter Web. Owners can update teammate roles or remove members (#288).
- Verified Starter Web launches appear in the team workspace. The staging environment records the Railway project, deployment, and verified storage lifecycle state (#288).
- Added private browser launch setup for Starter Web with owner-encrypted OpenBao recovery, Railway OAuth, and a persistent customer worker (#288).

- Added environment tabs for deployment reports, configuration presence, and planned domains. The workspace only shows name and presence for app secrets (#288).
- Added the Platfolio Account page for username and display-name edits, sign-in email status, and access to the themed password change flow (#288).
- Added the pinned free Starter Web template picker and a launch route scoped to the active team (#288).
- Authorize private installations with a one-use hub enrollment code and let them claim the pinned Starter Web release with a revocable registry credential stored in their own OpenBao (#288).
- Create teams and manage or accept invitations from the workspace. Team owners can distinguish active invitations from history and see whether email was sent (#288).

- Added a Platfolio theme for Keycloak authentication and included the themed identity image in release candidates.

- Added the React team workspace with direct app and environment links, a shared team selector and navigation, and return to the original workspace page after Keycloak sign-in.

- Added a browser launch pilot for the pinned Starter Web release with progress and a downloadable troubleshooting report.
- Placed private Platfolio and hosted apps in separate Railway projects. App removal has explicit options to retain storage for restore or schedule storage deletion.
- Fixed browser sign-in to preserve the in-memory session through the Keycloak callback.

The private Railway launcher is a Starter Web pilot. First-time hosted provisioning, hosted
marketplace enrollment with the private vault, general app settings, and public status publishing
remain under [#288](https://github.com/fractalsynapse/platfolio/issues/288). The provider contract
advances from `5.1.0` to `5.13.0` with additive changes.

## [0.5.0]

Release baseline: `0.4.0..36442bc`. The hosted API and site at that baseline passed the live Railway
smoke in staging and production, including build identity, database readiness, both `/status` probes,
site routes and PKCE sign-in.

- Platfolio now hosts its own OpenAPI-validated control plane and static site. The first dashboard lists
  instances for the signed-in user's teams, and the API supports self-service teams and invitations.
- Instances use `team/name` addresses, carry a template reference, and report state per environment.
  Providers provision each environment independently. The platform description carries per-environment
  configuration and domains, and the environment registry records secret and wiring obligations.
- The API can plan from a repository, record released artifacts by digest, and deliver secrets to the
  provider. Secret reads report presence. The GitHub App driver dispatches workflows, and the Git driver
  supports reading repositories over HTTPS or SSH.
- CI publishes the API and site images as one candidate manifest. The self-host planner reuses its
  recorded digests across environments. An untagged deployment reports `version: null`. Tagged
  deployments report the SemVer tag that the planner verifies against the candidate commit.

The old `apps/status-api` service was retired. Integrations should use the control plane at
`api.platfolio.dev`. Templates are sourced from their published repositories. The provider contract at
this baseline is `5.1.0`.

The tenant-template cutover and install PR verification are tracked in
[#172](https://github.com/fractalsynapse/platfolio/issues/172). The destroy API records
deprovisioning and checks for dependent instances. Provider teardown remains pending.

### Fixed — probe the site and API at `/status` (#274)

Both services return a small, fixed liveness response at `/status`. The Compose health checks,
Railway plans and hosted smoke now use that endpoint.

### Fixed — report the exact release tag in `/version` (#272)

Untagged builds report `version: null`. A candidate deployment can supply a SemVer release tag that
points to the candidate commit, while reusing the images by digest.

### Added — the hosted site joins the release candidate (#267)

CI builds and smoke-tests the static site container and records the published image alongside the API in the
same candidate. The platform and development compositions now include the site. The hosted smoke checks the
candidate's staging deployment and its browser sign-in configuration.

### Added — replay first-party release candidates from CI (#233)

The Image workflow records its published image digest and exact source commit. The self-host planner accepts
that record and produces a plan without consulting a moving registry tag. Bootstrap domain options now feed
the plan hash before it is computed.

### Changed — six maintainer decisions about the shell; five landed, one is blocked (#267)

The maintainer decided six open items about `apps/site` and its surroundings. Five are implemented; the sixth is
reported blocked with its evidence, because landing it needed a digest no pipeline has produced — and a gate edited
into silence is the failure this repository has spent a day eradicating, so nothing was weakened to make an item
close.

**`sharp`'s build script is decided `false` (item 6).** `pnpm-workspace.yaml` carried pnpm's own placeholder
(`sharp: set this to true or false`), which is not a decision: an undecided entry leaves the package under
default-deny and keeps it in the install report. `sharp@0.34.5` arrives only as an *optional* dependency of
`astro@6.4.8` and nothing consumes it — no `astro:assets` import anywhere in `apps/site/src`, no image in
`public/`, and a real `site:build` emits no `_images/` directory. Measured on the command that reported it
(`pnpm install --frozen-lockfile --force`): the notice went from `esbuild@0.25.8, esbuild@0.27.7, esbuild@0.28.2,
sharp@0.34.5` to naming only the three esbuild versions. `esbuild`'s own placeholder is left as pnpm wrote it —
same class, different item, and `ignoredBuiltDependencies` already refuses that script.

**Node 22.22.1 is the runtime baseline, and it has one owner (item 2, D66).** `astro@7.4.12` and
`@astrojs/react@7.1.9` each declare `engines.node >=22.23.4`; the installed `astro@6.4.8` and `@astrojs/react@6.0.6`
declare `>=22.12.0`; `node --version` answers `v22.22.1`. The runtime is not upgraded from inside a repository that
cannot verify a runtime, so Astro 6.4.8 is accepted as the baseline and written where tooling reads it: `.nvmrc`
(created — there was none) holds `22.22.1`, and all eight `actions/setup-node` steps in the three workflows read
`node-version-file` instead of the moving `'22'` (seven) or a lone hardcoded patch (one). `check-project.ts` now
refuses a second spelling: a literal `node-version`, a setup-node step without `node-version-file`, a missing
`.nvmrc`, or one that is not an exact `X.Y.Z` — each falsified by planting it and reading the named failure
(exit 1 in all three cases), restored byte-exact. Tenants are untouched, measured: `render-install.ts` declares no
Node version at all, so the workflow a fork receives does not change. `package.json engines.node` stays `">=22"`;
the highest floor in the installed graph is `undici@8.12.4`'s `>=22.19.0`, and raising the claim to a number nobody
has run would trade one unverified statement for another.

**The PKCE verifier's storage is now the policy's decision, not the flow's (item 4, D67).** `TOKEN_STORAGE`
enumerated access/refresh/idToken as inMemory-only and said nothing about the pair that must survive the redirect,
so `web/browser-auth.ts` had decided `sessionStorage` in a comment. Shipped behaviour is accepted as the decision —
`sessionStorage`, read-once, dropped before the exchange, and the cost (a reload signs the person in again)
is named rather than discovered. The cookie alternative was refused on the current code: the transport never emits
`access-control-allow-credentials` and that refusal is argued in `packages/kernel/src/cors.ts` — *not* in
`apps/control-plane/src/cors.ts`, which owns the origin list (the instruction named the wrong file) — and both
sides of the seam test it (`packages/kernel/test/cors.test.ts`, `apps/control-plane/test/cors.test.ts`). Made
durable as data: `HANDOFF_KEYS`/`HANDOFF_STORAGE` in the policy module, imported by the flow instead of restated,
re-exported by the operator script, and asserted by new cases in `browser-auth-parity.test.ts` — including the
reload modelled on a shared store, which is *not* the sentence "a reload discards the verifier": `sessionStorage`
survives a reload, so what a reload loses is the module-scope bag, and a spent handoff answers `no-handoff` without
reaching the token endpoint. Removing the read-once drop makes two tests fail; widening `cookie` to `true` makes one
fail; both are permanent falsifications.

**`apps/site` declares its UI dependency (item 1).** `"@platfolio/ui": "workspace:*"` in `apps/site/package.json`,
`version: link:../../packages/ui` in `pnpm-lock.yaml`, and the `astro.config.mjs` alias plus the `apps/site/tsconfig.json`
`paths` that stood in for the edge are deleted. The claim was proved rather than asserted: from a scratch copy of the
pre-edge tree, the filtered install failed inside the image with
`Rollup failed to resolve import "@platfolio/page-schema/page" from "/app/packages/ui/src/contract.ts"` (reproduced,
exit 1); with the edge it exits 0 at `Scope: 6 of 8 workspace projects`, and `docker run` serves `/` with 0
`<script>` and `createShellContext` in exactly one chunk. Resolution was proved to be real (`tsc` refuses an
undefined export from `@platfolio/ui` with TS2305), and `checkTypecheckCoverage()` was read first — it claims files
by each project's `include` lists, not by what a program reaches through imports, so the edge cannot make a file
double-claimed: 238 files, 238 claimed, unchanged. The Dockerfile now uses the filtered install. One deliberate
exception stays a relative path, and the reason is measured: `render-runtime-config.ts` runs under plain node at
container start, where the barrel is not loadable (`ERR_UNKNOWN_FILE_EXTENSION` on `.tsx` inside the built image).

**Content layout is a primitive, and app CSS owns no breakpoint (item 5).** `packages/ui/src/layout/content.ts`
declares `ui-prose` and `ui-columns` as data (required `containerType`, threshold and tracks as fields) with
`renderContentCss()` as the only writer, emitted to `content.css`, exported as `@platfolio/ui/content.css`, and
audited by §9.3 — which now asserts four generated sheets rather than accepting three. `MEASURE.content` (`68ch`)
moves into `tokens.ts` as the one line length in the tree. `apps/site` imports the sheet, `<main>` carries
`ui-prose` and the three-point row carries `ui-columns`, and the hand-rolled `@container`, `container-type` and
`68ch` are gone. The gap was measured before it was fixed: the pre-change §D65 reported PASS, exit 0, on the
committed stylesheet that contained a real width query — **DID NOT BITE** — so §D65 gained the refusal and
`gates-falsify.test.ts` gained the three planted shapes plus the compliant cases (`prefers-*` and a bare `rem`) that
must stay green; 41 falsification tests, 41 pass.

**A `site` service in `compose.yaml` — BLOCKED (item 3).** The entry was written and measured, then reverted;
`compose.yaml` is byte-identical to how it was found and every gate returned to exit 0. Two independent blockers,
recorded with their commands and quoted messages in
[docs/ui-architecture.md § Open gaps](docs/ui-architecture.md#open-gaps-this-file-refuses-to-paper-over):
`platform:plan` exits 1 with `services.site.image: no-artifact` (a first-party `build:` service with no reported
digest — the resolver exists on the server path, `capabilities.ts:488-490`, but there is no artifact to resolve, and
committing a digest by hand is the defect `compose.prod.yaml` has already carried once), and D62's staging origin is
not derivable: `stagingHost("platfolio.dev", "staging-")` yields `staging-platfolio.dev`, while the composition
already states staging's UI origin as `https://preview.platfolio.dev` — so the entry would have put two staging
hostnames in one platform description. What the publishing workflow must produce, and the composition-model change
that has to come with it, are written there.

### Fixed — a security assertion that refused the truth 11% of the time

Re-running this branch's gates three times surfaced a failure with nothing changed: `browser-auth-parity.test.ts`'s
storage-hygiene case reported `a token-shaped value was persisted under platfolio.pkce.verifier`. The assertion was
the defect. It refused any value matching `^eyJ` or two 20-character base64url runs around a dot, on the theory
that a token is recognizable by shape -- but `createVerifierWith` draws its verifier from the **RFC 7636 unreserved
set**, and that set contains the dot. Measured over 2,000 drawn verifiers: 1,084 contained a dot, and **222 matched
the old rule** while being entirely valid (for example `R.ets_BImSC3NzWd1XybK8YMRirkdi-GI683lwkAGH2fwr.X4t9ZjNEuFTTT2Yjy`)
-- an ~11% false-refusal rate on the flow's own happy path. A first attempt to fix it by requiring three segments
was measured and rejected as *worse*: 319 of 2,000. Shape cannot answer this question.

The guard is by identity instead: the handoff may hold only the two `HANDOFF_KEYS`, what sits under the verifier key
must satisfy `isPkceVerifier`, what sits under the state key must be the opaque base64url the authorize URL carried,
and no persisted value may equal a token the issuer handed back. The residual limit is unchanged and stated in the
test -- a dot-free opaque token is indistinguishable from a verifier by shape -- which is why `TOKEN_STORAGE`
(inMemory, all three kinds) is the invariant and the spy is the tripwire beside it, not the argument. The flake is
pinned by a case that draws 2,000 verifiers and requires the *old* rule to mis-fire on at least some of them, so a
shape guard reintroduced here fails on purpose rather than on a Wednesday. No value-shape predicate was left in the
policy module: the one drafted during this fix is the mistake the paragraph documents, and it was deleted instead of
tuned until the suite went quiet. Determinism proof: 40 consecutive runs of the parity file, 0 failures; 25 more
after the type widening, 0 failures; `gates-falsify` 41/41; all three type-check projects 0.

Why this is a fix and not a re-run: an assertion that fails at random is the flipped-signature defect in mirror
image -- that one was green and tested nothing, this one was red sometimes and refused something real -- and both
come from asking a shape to settle a question of identity. AGENTS.md's rule is to prefer the evidence tier a claim
actually holds; a suite whose verdict depends on `Math.random` holds none.

### Added — `apps/site`: the D65 shell, built, and the package boundaries it forced

D65 closed UI-OD1 on 2026-11-16 — Astro for the web shell, the dashboard as one React island — and this is that
shell: `apps/site`, an Astro 6 static site with `@astrojs/react`, three routes, and one screen mounted.
`astro build` exits 0 and the claims are read out of `dist/`, not inferred from configuration: `/index.html` carries
zero `<script>` elements and zero island markers (that is what Astro was chosen *for*), `/dashboard/index.html` and
`/callback/index.html` each carry exactly one `<astro-island>`, and across every emitted chunk exactly one `polled` and one
`createShellContext`. The one literal `fetch(` that survives minification is the shell's own issuer token request; the
SDK transport reaches the network through `config.fetchImpl ?? fetch`, which the bundler renames, so the artifact
count is not quoted as proof that a single connection exists. No browser ran. There is no service in `compose.yaml` and no origin that
resolves, so this is built-and-gated, not deployed — the fourth platform per D62 is deliberately the next change's
work, because a composition entry needs a *generated* digest and `compose.prod.yaml` is generated.

**The island, and what "exactly once" was made mean.** `packages/ui/src/web/shell.tsx` owns `createShellContext`:
one `PollTransport` over the base URL the deploy supplies (never a route table — `ENDPOINTS` is generated, #258), one
`SignalBus`, one in-memory token bag, and `wrap()` handing both React contexts to the island. It is memoised on its
configuration, so a double hydration is harmless, and it throws `ShellContextConflict` naming both origins if a
second call disagrees — because the failure D65 prices is two registries and two token stores, and the visible
symptom of that is a screen that quietly disagrees with itself. Three checks hold the sentence, at three different
tiers: `ui:check` §D65 over the source (one `client:*` per page, `createShellContext` only under `src/islands/`, no
page building a transport, bus or bag), `apps/site/test/build-output.test.ts` over the artifact, and
`packages/ui/test/shell-context-singleton.test.ts` over the runtime property. Every rule was falsified by planting
it: 35 distinct violations against the gate — 20 over the shell's own sources, 14 over the built artifact (island
counts per page, a script tag on the landing route, each bundle marker, and the operator script's path), and one by
moving `apps/site` out of the tree to read the gate's `NOT RUN` branch. Two more went against the site's own
artifact test and their disagreement is the useful part: a **reachable** second `fetch(` (a mount effect calling
`fetch('/ping-me-')`) makes the bundle count fail, and was restored byte-for-byte to make it pass; a **dead** one
(`export const secondDoor = () => fetch(…)`, nobody importing it) does not, because the bundler removes what nothing
calls and the artifact then genuinely holds one call. That is not a hole — it is the difference between what a
browser downloads and what a file says, and the dead case belongs to the source rules (§D65 and
`island-singleton.test.ts`), which refuse a `fetch(` outside `lib/browser-capabilities.ts` regardless of whether it
would ever have shipped. Three of the twenty source plants **DID NOT BITE** on the first
pass, because they read comment- and string-blanked text where the violation lives *inside* a string: a
`client:load` attribute, a module specifier, a quoted `/api/v1/…`. Those three were re-planted after their rules
were widened, and the artifact set was re-planted after every later change to the gate (the marker rewrite, then
the renderer moving into the app); 35 named failures and 35 byte-verified restores came out of it. That is
the §9.2 hole from #259 recurring one file over, and it is written into 11 §9 rather than buried. Two more mistakes
came out of the artifact pass and are recorded in the gate's own comment: `PGPASSWORD` sat in a marker list and
`check-environment-registry.ts` duly reported that the UI gate *references a credential* (it scans `scripts/` for
quoted uppercase names), and `pool` matched inside React's own runtime, so the gate was red on a compliant build.
A gate that fires on the compliant artifact is a gate somebody switches off; every surviving marker was grepped
against the real chunks before it was kept.

**Two package boundaries moved, because the first honest browser bundle said they had to.** `packages/ui` had never
been bundled for a browser, so nothing had ever tested what its imports drag along:

- **`@platfolio/page-schema` gained a `./page` subpath export**, and `contract.ts`/`signals.ts` now import
  `isValueBearingKey` from it. The package index also exports the panel builders, which import `@platfolio/manifest`
  and `@platfolio/contracts` — so the predicate behind rule 4 was pulling `pg`, `pgpass` and `node:crypto` into
  every island bundle, and Vite refused the build outright (`"createHash" is not exported by
  "__vite-browser-external"`, with six "Module `stream`/`util`/`fs` has been externalized for browser
  compatibility" warnings beside it). The index stays as it was for every existing importer. Worth stating because
  it is a size fact people will ask about: the island chunk is 130 KB and the React client runtime 215 KB, and
  neither number is caused by this — the chain was a build *error*, not a bundle that used to be smaller.
- **The browser's authentication policy moved to `packages/ui/src/web/browser-auth-policy.ts`** and
  `scripts/browser-auth.ts` now imports and re-exports it. Its header had always said *"nothing a deployed service
  imports may depend on this file"* and had never been tested against a deployed UI: the dependency now points the
  way it always should, a script depending on a package rather than a bundle depending on a script. One definition
  per fact survives the move — `WEB_CLIENT_ID`, `REQUIRED_SCOPE`, `CALLBACK_PATH`, `PKCE_METHOD`, `TOKEN_STORAGE`,
  `RECOMMENDED_STORE`, `LOGOUT_CLEAR`, `refreshSkewSeconds`, `refreshAt`, `endSessionUrl`, `isPkceVerifier`,
  `isTokenShapedName` — and the seeder, the smoke script and
  [packages/contracts/test/browser-auth.test.ts](packages/contracts/test/browser-auth.test.ts) keep reading those
  names from where they always did. On the browser side the seam is `web/browser-auth.ts`: the PKCE flow with digest,
  entropy, requester and handoff store all injected, so no `fetch` appears in the package outside the transport
  driver (§9.2 stays whole), the verifier is read once and dropped before the exchange, `state` is compared before
  anything is redeemed, and a token goes nowhere except memory — which is what `TOKEN_STORAGE` says, and what it
  costs is stated in the file: a reload signs in again.

**Configuration, not constants (D47, D58).** `PLATFOLIO_SITE_ORIGIN`, `PLATFOLIO_URL`, `PLATFOLIO_IDENTITY_ISSUER`,
`PLATFOLIO_WEB_CLIENT_ID`: two of those names already existed and are *reused* rather than respelled, and the two
new ones are declared in the HUMAN table of
[scripts/check-environment-registry.ts](scripts/check-environment-registry.ts) with `environment.yaml` regenerated by
`--emit` (88 variables, all referenced). `apps/site/src/tools/render-runtime-config.ts` renders the runtime overlay from the
environment at container start; the tracked `apps/site/public/config.js` is a comment and nothing else, because a
value in it would be a committed endpoint. A build with a required name unset fails by naming it, and `https:/api` is
refused — measured: `new URL` parses that as a valid URL whose host is the single label `api`, so a mistyped
`--url` would have aimed every request at a machine nobody owns and the dashboard would have rendered an empty list
as an outage.

**Type-checking, per the arrangement root `tsconfig.json` already documented.** `apps/site/tsconfig.json` carries
`jsx`, `DOM` and `astro/client`; the root program excludes `apps/site` so no file is claimed twice; `typecheck` runs
three projects. Coverage: 238 source files in the universe, 238 claimed, 5 JSX, one owner each. Two consequences
are reported rather than smoothed over: `ui:check` is 21 gates (18 pass, 3 NOT RUN), and
[packages/ui/test/typecheck-coverage.test.ts](packages/ui/test/typecheck-coverage.test.ts) still asserts the literal
`2 project(s)` — seven of its eight cases pass, that one fails, and fixing it belongs to whoever owns that file, not
to a change that was told not to touch it.

### Fixed — falsification by mutation no longer shares one working tree by accident

`ui:check` and `typecheck` are proved to bite by tests that edit tracked source in place and then run the gate.
They did that in a tree that `node --test` gives to several files at once: `gates-falsify.test.ts` was appending a
violation to `packages/ui/src/contract.ts` while `typecheck-coverage.test.ts` was asserting that the clean tree is
green — an assertion whose own failure message says the results "would be meaningless", which was true of a tree it
did not own. [packages/ui/test/mutation-sandbox.ts](packages/ui/test/mutation-sandbox.ts) now serialises exactly the
part that needs serialising, and self-heals a run that dies mid-mutation.

**The lock.** A critical section is `sandbox.exclusive(label, fn)`: a queue ticket, then a test-and-set on a `lock`
directory under `.tmp/mutation-sandbox/<root>/` — which must *not* be created up front, a mistake whose symptom was
every section timing out against a lock nobody held. A waiter never proceeds past a lock it cannot account for: it
reclaims one whose writer is provably gone and otherwise fails after a bounded 180 s wait with
`MUTATION_LOCK_TIMEOUT`, naming the holder's pid, label, age and the evidence used. Nothing is skipped on that path,
because a lock that quietly opts out of serialisation looks like a fix and is not one. Proving a writer gone took
two rounds: `kill(pid, 0)` was not enough in a container that reissues low pids within minutes — a dead run's lock
was read back as "pid 40 is running", and the suite waited it out — so each record now carries the writer's
`/proc` start time **and** a per-process run id, and the deciding rule is the invariant that a mutation only exists
while its writer holds the tree. Sections that waited say so in the output — running the two mutating suites side by
side prints fifteen-odd `waited 10.6s for the working tree` lines, which makes the interleaving visible instead of
inferred; with `--test-concurrency=1` in place the suites never meet, and those lines are what will show that #263's
replacement is doing its job.

**The sidecar, which is what a killed run cannot have.** Every mutation computes the bytes it is about to write,
records the record (meta, original, planted) in a fresh directory, `rename`s it into place, and only then touches
the file. `SIGKILL` — what `timeout -k`, a CI step deadline and an escalating runner deliver — runs no handler in
the process that receives it, so teardown cannot be the answer on its own; measured directly, a `SIGTERM` arriving
while a suite is blocked in `execFileSync` does not reach its handler either. The next process to open a sandbox
replays records whose writer is gone, at module load, before it reads the tree. Measured: `kill -9` on the mutating
child of each suite leaves the planted bytes in the tree *and* the sidecar beside them, and the next run prints
`self-healed packages/ui/src/contract.ts … its sidecar put the bytes back`, reclaims the dead holder's lock, and
passes with the tree byte-identical afterwards. Restoration compares current bytes against both records and refuses
to write over a third state: if somebody edited a file while it carried a planted violation, that is
`MUTATION_SIDECAR_CONFLICT`, named, with the record left standing for a human. Nothing here uses `git checkout`,
`restore`, `stash`, `clean` or `reset`.

**What this does not fix, and why that is not a detail.** The lock serialises processes that mutate. It cannot
protect a process that merely *imports* something the mutators change: by the time a test file's code runs, its whole
static import graph has already been evaluated in whatever bytes the tree held. Reproduced with the mutation
provably in flight, [packages/ui/test/layout.test.ts](packages/ui/test/layout.test.ts) failed three assertions —
including `stack declares "size"` — while `gates-falsify.test.ts` sat inside its container-type weakening, in a
suite that touches no file. [packages/ui/test/components.test.ts](packages/ui/test/components.test.ts) had the same
failure against the invalid-prop-set fixture, and is fixed properly: that fixture is read through `importQuietly()`,
which waits for the tree and then evaluates the module *fresh*, since a cached import keeps whatever bytes the first
evaluation saw. The same treatment cannot be given to `layout.test.ts` or the screens and registry suites by editing
them — a cache-busted entry module still resolves its own imports to the already-cached instances, so a consistent
quiet read of `packages/ui/src/**` needs the whole graph loaded under the lock. Five consecutive full runs of
`pnpm run test` with `--test-concurrency=1` removed came out green (845 tests, nothing left modified) — the sample
did not hit it, while the forced experiment above hits it every time, which is the difference between an exposure
and an absence. So **the concurrency flag stays, and it is load-bearing for correctness rather than performance
tuning**: removing it requires the copy-based mutation sandbox first, which is
[#263](https://github.com/fractalsynapse/platfolio/issues/263) — filed with both reproduced failures, the import-graph
mechanism, what `scripts/check-ui.ts` would have to give up (its location-derived root *and* its static imports of
the tree it audits), and the acceptance test that decides whether it landed. What the sandbox does close for good is
the interruption hazard: with the flag doing the serialising, the lock and the sidecar are what keep a killed or
timed-out run from leaving a planted violation for the next person to commit.

Proved by [packages/ui/test/mutation-sandbox.test.ts](packages/ui/test/mutation-sandbox.test.ts), which kills real
child processes rather than asserting in prose: `SIGKILL` mid-mutation, `SIGKILL` mid-creation, `SIGKILL` while
holding the lock, `process.exit()` inside a section, a live holder driving a waiter to the named timeout, a recycled
pid refused as a holder, two contenders whose timed sections never overlap, a nested section refused instead of
hanging, and a recovery that refuses to clobber somebody else's bytes.

### Added — #258: the generated contract carries the routes, and the SDK reads them

`packages/api-contract/src/generated/types.ts` now exports a runtime table beside its type maps, emitted by the
same parse and gated by the same command:

```ts
export const ENDPOINTS = {
  listInstances: { method: 'get', path: '/api/v1/instances' },
  // …one entry per operationId…
} as const satisfies Record<OperationId, Endpoint>;
```

The `satisfies` guard is the rule rather than a style: an operation the document declares and the table lacks
does not compile (TS1360), and a route whose operation has left the document does not compile either (TS2353) —
both measured by compiling mutated copies outside the tree (`packages/api-contract/test/generated-endpoints.test.ts`).
Completeness is not fillability, so the same pass emits a second guard: `PathParamsOf<O>` reads the `{holes}`
out of the table's own template literals and `ROUTES_ARE_FILLABLE` asserts each is a **required** parameter of
that operation. Measured: renaming `{instanceId}` to `{id}` and making `instanceId` optional are both refused
there, naming the hole; a drifted path (`/api/v1/instancez`) is legal `string` and stays `api:types:check`'s
business. The emitter also now refuses what it cannot honour: a templated `{hole}` no parameter declares as a
required `in: path` parameter, and a component named after one of the emitter's own declarations.
`scripts/gen-api-types.ts` reports such a refusal as a finding instead of leaking a stack trace — the same
correction `api:check` received on 2026-11-15, applied where this script had the same shape.

`PollTransport` stops taking a route table someone hand-assembles. `PollTransportConfig.endpoints` remains
injectable and remains total — `Readonly<Record<OperationId, Endpoint>>`, so a partial table is a compile error
(`packages/ui/test/fixtures/route-table-partial.negative.ts`, paired with the control that compiles) — and
defaults to `ENDPOINTS`. The shell supplies an origin and nothing else, which is D47 read from this side:
**paths are generated, base URLs are configuration.** No hostname was added anywhere; `check-project.ts`'s
endpoint rule still exits 0, and the new tests use loopback or a reserved `.test` domain.

The path stays **templated**, and the one rule that fills it — `encodeURIComponent` on the whole value, refuse
rather than leave a hole — lives in `packages/ui/src/sdk/poll.ts` beside the driver. It lives there because
`packages/api-contract` has no parameter-to-URL code to reuse (measured: it types parameters and validates
bodies, and never serialises one) and 11 §6 acceptance (c) forbids parsing `openapi.yaml` inside
`packages/ui`, so gate §9.2's one permitted URL-builder is the only honest home.

Evidence, by tier: **static** — the table equals the document entry for entry, both directions.
**In-process fake over a socket** — `packages/ui/test/transport-request.test.ts` runs the driver's default
`fetch` against a loopback `node:http` server, so method, encoded single segment, query assembly, bearer
header, JSON body and a declared 204 are seen by a server rather than by a recorded call. **Local stack** — not
exercised: the Compose stack was not running, and a read-only pass does not bring one up. What none of the
tiers reach is the *server's* behaviour on those paths; that stays `api:check`'s route-manifest comparison, and
a live check remains a live check.

Nothing moved off `ui:check`'s NOT RUN list: §9.7, §9.8 and §9.9 need a browser, a layout engine and the draft
store, and a route table supplies none of them. The three D41 gaps the document still has — no team-scoped
instance list, no team slug on `InstanceResponse`, an unbounded `environment` where an enum belongs — are
**unchanged**, because closing them means adding operations to `openapi.yaml`, which is not this change's to
make.

### Added — #259: `.tsx` is type-checked in CI, and the first screens land in `packages/ui`

Two changes, deliberately separate, because the first is what made the second honest.

**The wiring.** `packages/ui/tsconfig.json` now exists, carrying `jsx: react-jsx` and `lib` with `DOM`, and
`pnpm run typecheck` runs **two** explicit `tsc --noEmit -p` projects: the root one (the server tree, still
`lib: ["ES2023"]`, still no `DOM`) and the UI one. `packages/ui` and the three `scripts/` files that audit it
(`check-ui.ts`, `gen-ui-css.ts`, `ui-source-scan.ts`) are excluded from the root project by file list, not by
flag, because TypeScript follows imports out of an `exclude`d directory — measured as TS6142
(`--jsx is not set`) once a `.tsx` was reachable from a gate script, and the tempting fix (adding `jsx` and
`DOM` to the root config) is the trade #259 refuses to make: a stray `document` in `packages/contracts` or
`apps/control-plane` stays a compile error, re-measured as TS2584/TS2304. `tsc -b` with `composite` was tried
first and rejected on measurement: a composite `packages/ui` refuses its own
`test/source-scan.test.ts` for importing `scripts/ui-source-scan.ts` outside its rootDir (TS6059 + TS6307),
which would have meant moving a gate's source into the package or leaving a file unchecked. So: two
invocations, no emitted artifacts, no build order.

**The coverage rule.** A split like that rots quietly, so `scripts/check-project.ts` gained
`checkTypecheckCoverage`: every per-package `tsconfig.json` on disk must be named by the `typecheck` script
and every named project must exist and parse; every source file under `scripts/`,
`packages/*/src|test`, `apps/*/src|test` must be claimed by exactly one project's include list; a `.tsx` must
be claimed by a project that declares `jsx`; and the root project must still resolve no `DOM` and claim no
`.tsx`. It reads the **disk**, not `git ls-files` — the first falsification run showed the difference: an
uncommitted `packages/contracts/src/probe.tsx` was invisible to a tracked-files rule, so the gate reported a
clean tree over a file that was compiling as nothing. `packages/ui/test/typecheck-coverage.test.ts` mutates
seven ways (a type error in a screen, `document` in the server tree, a missing project config, an unclaimed
`.tsx`, a `.tsx` in a `jsx`-free project, an unwired `tsconfig.json`) and each must bite.

**The screens.** Six registered components (`context.switcher`, `freshness.label`, `instance.detail`,
`instance.list`, `instance.row`, `instance.state`) in `packages/ui/src/components/instances.tsx`, one screen
document and its container in `packages/ui/src/screens/`, a `SignalsProvider`/`useSignalValue`/`useEmit` seam
(`signals-context.ts`) so context selection reaches a render without an ambient bus, and a generated
`components.css` whose only job is to reference the 44/24/8 px tokens so 11 §8's hit-target floor is a
stylesheet fact. Data arrives only through the SDK seam; `reads` names four real generated operations
(`listInstances`, `listTeams`, `getInstance`, `getLatestAttestation`). No site, no service, no `apps/*`
change: UI-OD1 (Astro islands vs a plain React mount) is still the maintainer's, and nothing mounts these.

**§9.11 became runnable by promoting 11 §2's prose to data.** Each layout primitive now declares
`floorSlots` — where its content lands when the container is at the floor width (`split` → stack or pushed
sheet, `popout-sidebar` → sheet). The parity gate walks each `ScreenDocument`'s placements against each
component's declared `slots` and compares the `OperationId` sets at the two widths, so "a capability that
exists only when wide" is a build failure that names the component and the operation. `instance.detail`
appears twice in the document, once in the wide detail track and once as the pushed sheet: one component, two
homes, no fork.

**Two gate defects found by the new gates' own falsification, both recorded rather than smoothed over.**
§9.2's source filter still read `rel.endsWith('.ts')` after the walk was widened to `.tsx`, so a `fetch`
planted in a screen was invisible to the gate whose job is to find it — the mutation said PASS, and that is the
finding, not the failure of the test. And gate §R5's state-word search fired on `aria-live`, the attribute
11 §8 mandates for a signal-driven region: the pattern now refuses the word in copy and permits that attribute,
and `test/gates-falsify.test.ts` asserts **both** directions (a `"live"` label still fails). Neither widening
accommodates a violation; one is a hole closed, the other a false positive on the compliant case.

**Three shipped-code defects the first components exposed.** `contract.ts` seeded its known signal ids from
`src/index.ts`, on the stated belief that importing `signals.ts` would close a cycle — it does not, and the
first component declaring `consumes` threw `ContractViolation` for naming a signal that was in the registry all
along, because `scripts/check-ui.ts` imports `registry.ts` directly and never runs the barrel.
`AnyComponentContract = ComponentContract<object>` could not have held a single real component: `render` is a
property, so `strictFunctionTypes` checks its parameter contravariantly and every concrete contract failed with
TS2375 (measured) — an empty registry could never discover that, which is the general lesson. And zod cannot
represent `z.custom` in JSON Schema, so a `z.custom` field poisons `jsonSchema.input()` for the whole object —
which is exactly the view 11 §8's derived labels and rule 4's `draftable` check read.

**Three spec questions this change raises and did not decide (D41).** (1) No team-scoped list operation:
`GET /api/v1/instances` takes no `teamId`, so `team/name` scoping is a client-side join against
`listTeams`, and the screen says so out loud; the operation is the owner's call. (2) The contract's
`environment` is an unbounded string (and `redeployInstance` accepts `preview`) while 11 §3's
`context.switched` payload enumerates three, so a preview environment is one the context cannot name;
`unservedEnvironments()` reports it and `enums.ts` derives the selector's list from the signal instead of
restating it. (3) Enumerated fields validate their *kind*, not their membership, because the authoritative
runtime enumerations live in `@platfolio/contracts` (a workspace edge this package does not declare) and one
state token collides with rule 5's grep; gate §9.5 names the two prop sets that are accepted and wrong.

**Measured on this tree:** `npm run typecheck` 0 (both projects); `ui:check` 20 gates — 17 passed, 0 failed,
3 NOT RUN (§9.7 browser containers, §9.8 axe + layout engine, §9.9 no draft store); `check-project` 0;
`spec:check`/`api:check`/`api:types:check`/`contracts:check`/`ui:css:check` all 0; full suite 796 tests —
792 pass, 0 fail, 4 skipped (live-forge and `PLATFOLIO_DB_URL`-gated, unchanged in kind and in number). No commit, no push,
no live mutation; `pnpm-lock.yaml` untouched.


### Changed — three maintainer decisions recorded: one UI package (D63), a required real-time capability (D64), and the admin-rotation runbook he asked for

The maintainer answered three standing open questions on 2026-11-15, and this change is the record — no code,
no `packages/ui` scaffold, no live mutations.

**D63** *(closing UI-OD6):* *"Go would rather have a packages/ui package that contains ALL reusable UI
components, colors, spacing, font sizes (CSS), etc..."* One package owns everything reusable; design tokens
ship as CSS custom properties from `packages/ui`, and there is no `packages/tokens`. Every layer table that
listed `packages/tokens` now says so ([11](docs/design/11-ui-components-and-page-model.md),
[the rules doc](docs/ui-architecture.md), [AGENTS.md](AGENTS.md), the
[ui-architecture skill](.agents/skills/ui-architecture/SKILL.md)) — with the honesty convention intact:
D63 decided *contents*, not *delivery*, and `packages/ui` still does not exist. UI-OD6 moved to 11's new
**§ Closed UI-OD decisions** with the date and the reason rather than vanishing.

**D64** *(answering UI-OD2):* *"Yes, the UI should show live updates when it makes sense. I just want to make
sure we are capable of real-time like interface even if we have to start out polling the API when needed."*
Design the push capability, ship polling first. Decided: one SDK freshness primitive whose transport is
swappable at build time, every server-derived render carries its age, and no surface may imply liveness it
does not have. Required work: the control plane has **no** push channel — re-measured on this tree, 31 paths
and 36 operations, the grep for a push mechanism still finds nothing — so 11 §4's event stream and ticketed
connection must be designed in `openapi.yaml` first (D41), a contracts MINOR bump, by the sessions that own
it. Implementing any of it was explicitly out of scope here.

**The runbook** *(answering "leave it alone for now, but tell me what I need to do"):*
[05 § Rotating the temporary Keycloak admin](docs/design/05-identity.md#rotating-the-temporary-keycloak-admin-runbook)
records the maintainer's decision to keep the temporary master-realm admin, plus the step-by-step rotation
path (create permanent → grant the `admin` realm role → verify → *only then* delete the temporary one), the
stopped-nodes `bootstrap-admin user` recovery with its honest downtime, the credential-handling rules D4
implies for ourselves, where the credential lives afterwards — including the footgun that
`.secrets/platfolio-keycloak-admin` carries the 25.x-style key names while the composition correctly
declares the 26.x pair — and the DNS half: `platfolio.dev` / `preview.platfolio.dev` configured as origins,
read back in both hosted realms, not resolving, ready-for-DNS meaning a UI service in `compose.yaml` per
D62. Every step is tiered: what was measured read-only today (token grant 200; one master-realm user,
created 2026-11-12, `is_temporary_admin=true`, with the `admin` realm-role grant shape read back), what is
measured-and-recorded from `scripts/seed-identity.ts` (the 26.8.2 `reset-password` 404; the
PUT-with-`credentials` convergence asserting 204), what is upstream-documented, and what is **specified but
not exercised** — which is the entire mutation sequence. [MAINTAINING](docs/MAINTAINING.md) links the
runbook instead of restating it. This entry changes only prose and registers; no behavior moved, so the
`verify` gates are unchanged and re-run to prove it.

### Changed — the shared OpenAPI components are a build artifact (#247)

`apps/control-plane/openapi.yaml` is now generated, for the shapes a capability contract already defines, from
those definitions. `pnpm run spec:gen` writes them; `pnpm run spec:check` fails the build when the committed
document is not what the schemas produce, naming the component and the first differing line. `verify` runs the
gate between `api:check` and `api:types:check`, so a spec edit that was not generated now fails the way a stale
generated type file does — which is the lesson that made `api:types:check` exist.

The change is the one issue #247 was raised about: nine of the document's eighteen components restated, by hand,
what a zod definition in `packages/contracts` already says, and a gate compared the two descriptions and filed
what it found. Comparison was the intermediate step. Generation is the rule AGENTS.md states — *the StandardSchema
definition stays the source and the spec is generated or compared against it, never re-invented* — and it turns
the drift from a thing measured into a thing that cannot be written.

**The ledger emptied itself.** `KNOWN_DRIFT` held one entry, `Instance.environments`: the spec's `Instance` was
the assembled response (`{ ...record, environments }`, `apps/control-plane/src/capabilities.ts:259, :348`) while
`InstanceSchema` is the stored row. Adding the column to the record would have made the store lie, so the
response got its own component: **`InstanceResponse`**, composed from `InstanceSchema` plus
`InstanceEnvironmentStateSchema` — its fields, its required list and its `additionalProperties: false` all come
out of the two definitions, and the only hand-written fact is the property name the handler uses. Because the
ledger fails the build when a listed difference stops existing, deleting the entry was forced rather than chosen.
`api:check` now also refuses any component that matches a definition by name but is *not* generated, which closes
the direction the drift escaped through. `createInstance` still returns `Instance` — measured, it sends
`created.value`, a record with no environment rows — so the split is the document telling the truth about three
operations that used to share one name.

**Prose lives in code now: `packages/api-contract/src/spec-annotations.ts`, keyed by component and property
path.** Not `.describe()` on the schemas, for two reasons measured before deciding. The API's prose is about the
wire, not the row — `Instance.state` documented as "the rollup, not the truth" is a fact for whoever reads
`GET /api/v1/instances`, and putting it in `packages/contracts` would drop hosting commentary into the module the
database driver imports. And part of what the document knows cannot be expressed in zod at all:
`format: date-time` sits on timestamp fields defined as `z.string().min(1)`, and it is *enforced*, because
`validateResponse` runs Ajv with `ajv-formats` against this document — so switching those fields to
`z.iso.datetime()` to carry the format would have changed what the store admits. One sidecar for both kinds, with
the rule the generator enforces: **it may say what the definition does not, and may never contradict it.** An
annotation whose path no longer exists is a refusal, the same design as the ledger. A composed response inherits
its base's annotations rather than repeating them, so no sentence is written twice.

**Nothing here imports `zod`, so the lockfile does not move.** `toJSONSchema` is a method on the schema value, and
so are `extend` and `array`; the values arrive from `packages/contracts`, which declares `zod@^4.6.7` properly,
reached by path the way `scripts/check-api.ts` has always reached it. A declared devDependency was tried first and
rejected on measurement: a bare `zod` specifier resolves from `packages/api-contract` and `scripts/` only via
`/home/adrian/node_modules/zod` — outside the repository — so it would pass on a laptop and fail in CI, and a
dependency edge is exactly what makes that invisible. The guard test asserts both halves: no `zod` import appears
in the package or in `scripts/`, AND that resolution genuinely does escape the repo today, so the rule cannot
quietly become decoration.

**What the document now says differently, which is the point of the change.** `Instance.name` allowed 80 characters
and a 41-character pattern in the spec while `SLUG_PATTERN` and the database `CHECK` enforce 40 — the
disagreement the parity layer had been counting as "a form that validates and a server that refuses". It now says
40. `Attestation.resources[].kind` and `.status` declared no enum while the definitions do, so the document was
quieter than the code it describes. `planHash` was `^[0-9a-f]{64}$` in the spec and `^[a-f0-9]{16,64}$` in the
definition; the definition wins, because a response that satisfies the code must satisfy the document. `provider`
gained `default: railway` and `Invitation.state` `default: pending`, because that is what the definitions emit.
Where the schema states nothing and the API still promises something — the 64-hex plan-hash patterns,
`DispatchIntent.nonce` bounded to 64 characters — the sidecar says it, and Ajv enforces it at the boundary.
The measured count of constraint disagreements written two different ways went from 5 to 0, because there is no
longer a second description to disagree with.

**Two gates added against the failure class that bit twice in one day.** A malformed scalar in the document made
`api:check` die with a `YAMLParseError` stack trace, hiding every other finding in `verify` behind it; and two
quoting shapes parse *cleanly* while meaning something else — `description: Names # prose` yields `"Names"`, and
`{ description: Names, because English, minLength: 3 }` yields a truncated description plus a new `because
English` keyword that non-strict Ajv accepts. `spec-source.ts` now reports the first as a finding with a line and
column instead of a crash, and flags the other two as hazards in the source text, the only layer where the quoting
decision still exists. Both rules were measured against the shipped document and find nothing in it, which is what
makes them findings rather than noise; the suite feeds each malformed shape on purpose and asserts the tool says
so, because a guard that has never been falsified is not a guard.

`packages/contracts` is untouched by this change: no new export, no `.describe()`, no baseline refresh.

Measured on the change's own surface: `api:check` 0 (36 operations, 10 compared, 10 generated, **empty drift
ledger**), `spec:check` 0 (10 generated components byte-for-byte, 9 hand-written), `api:types:check` 0, `check` 0,
`lock:check` 0, `environment:registry` 0, `graphql:check` 0 · `tsc` 0 errors in every file this change adds or
edits · `packages/api-contract/test` 54 tests / 54 pass / 0 fail · the four control-plane suites that validate
live responses against this document (`api`, `bindings`, `invitations`, `teams-destroy`) 26/26 — which is the run
that matters most here, because it is `validateResponse` executing Ajv with `ajv-formats` against YAML the
generator wrote, not against YAML a person typed.

`pnpm-lock.yaml` is byte-unchanged (`cmp` against the pre-work copy), so `lock:check` and `install:check` pass
with no new dependency anywhere.

### Changed — platfolio's UI hostnames, and one variable that says them (D52, D56)

The maintainer settled the two UI hosts: **production is `https://platfolio.dev`, staging is
`https://preview.platfolio.dev`**. The hostnames an earlier session proposed -- `app.platfolio.dev` and
`staging-app.platfolio.dev` -- are retired and were removed wherever they were asserted, including the CORS and
browser-auth tests that had been using them as their example origins. `api.platfolio.dev` and
`auth.platfolio.dev` are untouched: they are the API and identity hosts (#199 verified and issued those two), and
the UI is a third host, which is precisely why the API has to be *told* the UI's origin instead of deriving it.

**One variable now feeds both consumers.** `PLATFOLIO_ALLOWED_ORIGINS` -- the CORS allow-list the control plane
parses at boot -- is the single carrier of "the origins this environment's UI is served from", and
`scripts/seed-identity.ts` reads that same name to write the public `platfolio-web` client's exact `<origin>/callback`
redirect URIs and `webOrigins`. `PLATFOLIO_UI_ORIGIN` is deleted, and with it the registry row: a hosted realm's
origins are looked up in `compose.yaml`, by matching the realm being seeded against the issuer that file declares
per environment. The ownership went this way rather than the other because the value has to live in the platform
description for staging to differ from production in the plan hash (D56), and the API side is the enforced side:
it canonicalises the list, refuses `*`, and refuses to start on a malformed entry. Two names for one fact were the
old shape, and each file was internally consistent while the pair could still disagree -- a realm redirecting to a
page the API refuses to answer, or an API admitting a page no realm will send a code to. Nothing in this repository
could see that.

Values now declared: `compose.yaml` base `https://platfolio.dev`, `x-platfolio…environmentValues.staging`
`https://preview.platfolio.dev` (the third name that changes with the issuer and JWKS URIs), and
`compose.dev.yaml` `http://localhost:5173` -- the same string the seed and the PKCE smoke fall back to on loopback,
which `packages/contracts/test/browser-auth.test.ts` now checks rather than trusts. The seed prints which origins
it used and which line they came from, and still refuses to invent one for a realm the description does not place.

**Correct, not exercised.** Neither hostname resolves: there is no DNS record, no Railway domain and no certificate
for `platfolio.dev` or `preview.platfolio.dev`, and no UI service in this composition to serve either. Whether the
page becomes a fourth platform inside this plan -- the way `identity` is hosted, which would be the honest
dogfooding -- or a static host outside it is an open decision for the maintainer, and so is one naming question
raised by this change rather than answered by it: `preview.platfolio.dev` is **staging**'s UI host, while
`environments.preview` in the same file is **pull-request previews** (declared, disabled) and staging's API host
follows the `staging-` prefix as `staging-api.platfolio.dev`. Three senses of one word, one of them new. The
composition says which is which where it matters, and `docs/MAINTAINING.md` records the collision as unresolved;
renaming a hostname is not something configuration work gets to decide quietly.

### Changed — the templates are repositories, and this repository reads them (D60); the toolchain is TypeScript (D61)

**`templates/` is deleted.** The three published repositories are the source of a template now, and platfolio
consumes them the same way it consumes a tenant's platform — through its own source-control seam. This is not a
reorganisation, it is the removal of a defect class: a bundled copy and a published copy of the same three
platforms had to be kept in step by hand, and they were not. The registry consolidation (D58) deleted
`.platfolio/environment.yaml` from the bundled tree while all three published repositories kept it, where
`applyInventory` merges whatever it finds into the plan — so a fork carried two registries describing one
platform, and every offline gate stayed green because nothing in `verify` touched the network. One copy needs no
publisher.

The maintainer's ruling, 2026-11-14: *"These template repositories are currently and will ALWAYS be public and
open source so there is no need for credentials to clone them and they are small so there is not a size
bottleneck. I still favor removing the hardcoded templates and using and aligning the REAL templates that people
actually use. This tests the core Platfolio platform and the basic templates, so it is a double win with very
little cost."* Supersedes **D38**; recorded as [D60](docs/design/01-product-and-decisions.md).

- **`pnpm run templates:publish` and `pnpm run templates:check` no longer exist**, with
  `scripts/publish-templates.ts`, `scripts/check-template-publication.ts` and
  `scripts/template-manifest.ts`. The parity gate is deleted **because its subject is gone, not because drift
  was accepted**: it compared a bundled copy to a published copy, and there is no bundled copy to compare. The
  retirement list (`RETIRED_PATHS`) left with it, since a declared retirement only means something beside a
  publisher that could forget it.
- **New: `packages/manifest/src/template-catalog.ts`** is the catalog — which repository *is* which template, at
  which ref, and which files of it platfolio reads. It reaches the forge through `GitScm` (the `git` driver
  behind `ctx.scm.readFile` in `POST …/plan/from-repository`), so there is exactly one way to read a repository
  here. The `sourcePaths` per entry are a declaration, not a listing: the seam reads one file at one ref and no
  tree-walking workaround was added, so a template that gains a source file fails the acceptance test by name
  rather than passing on content nobody looked at — the coupling errs in the loud direction.
- **`packages/manifest/test/templates.test.ts` is now the real-template acceptance.** It parses, validates,
  plans and cross-checks the three published repositories on every run, keeps the rule it enforced before
  (every obligation declared by a tenant-compiled service must be referenced by that repository's own text),
  and adds the two checks that left the offline gates with the directory: the dev-overlay pairing (D50) and the
  registry obligation schema (D58), the latter through `packages/manifest/src/registry-obligations.ts` — one
  predicate, now shared with `check-environment-registry.ts` rather than spelled twice. **A repository it cannot
  read is a failure, never a skip**: every test awaits the same read and reports the driver's own reason.
  Measured falsifications — a ref that does not exist (`ref-not-found`), a repository that does not exist
  (`kind=forbidden`), and a catalog entry naming a source the repository does not have — each fail the named
  tests; removing the template's source text from the scan set fails the orphan-obligation rule by name.
- **`open-install-pr.ts` no longer reads a maintainer's filesystem.** `--platform <dir>` is gone; the platform
  description is fetched from a repository at a ref through the seam (`--template=<name>` for a catalog
  template, otherwise the repository the PR lands in at its base branch). This closes the D48 defect at its
  source. **The rendered pull request is unchanged**: rendering the same commit both ways produced identical
  file contents (`sha256 313c3af5edcf52d5` for the file set), identical secret *names*, identical permission
  keys and the same action pin, and the manifest itself hashed equal. The action-pin check moved to the seam
  too — it was a second reader (`gh api`) of the same fact. Credentials are still required, and only for the
  write; `--apply` still mints an installation token and revokes it.
- **These repositories were private until this change.** The ruling's premise was checked rather than assumed,
  and all three answered `401` to an unauthenticated fetch (while `fractalsynapse/platfolio` itself was already
  public); with the credential helper disabled — exactly `GitScm`'s conditions — the read failed with
  `kind=forbidden`. The stated fact was therefore made true (`PATCH /repos/… {"private": false}`, full-history
  secret scan clean, re-verified anonymously with a public control repo as the comparison) instead of being
  documented as a ruling the tests would have had to disbelieve. An acceptance test that needs a token is a
  finding, not a configuration. The consequence of going public is worth stating: the templates' `README.md` and
  `environment.yaml` are now the tenant-facing contract in the strongest sense, which is why the
  orphan-obligation rule above is an acceptance test and not advice.
- **`scan set` consequences, measured:** `check-environment-registry.ts` no longer discovers from template
  composition or source, which is the point — a template's variables were never ours to declare (D58) — and it
  is how `QUEUE_URL` had entered our registry in the first place, through a bundled dev overlay. Its scan set
  now holds 82 of the 83 declared names, so `pnpm run environment:registry` fails with *"environment.yaml
  declares QUEUE_URL, which nothing in configuration references any more"* until the generated file is
  re-emitted (**not emitted here**: `environment.yaml` is the orchestrator's artifact). The five `note:` fields
  that cite `templates/...` paths are `--emit`-preserved text and will not self-heal; they are stale claims
  about where a variable is read.
- **`check-project.ts`:** the D58 rule retargeted (`.platfolio/` may not return; our own registry must exist and
  declare rows — the zero-row vacuity guard now says so directly instead of via 82 misleading "undeclared"
  lines; and **no code or configuration may reach for a bundled `templates/` path**, which is how "nothing still
  expects a local copy" stays enforced rather than asserted once). The template dev-overlay pairs left with the
  files. Measured against the tree: the reach-for-a-bundled-path rule caught a stale error message in
  `build-plan.test.ts` that claimed a fixture was at `templates/<name>` when it has always been a fixture; the
  patterns were then tightened after two false positives were measured (`"referenced by …, templates/…"` in a
  generated note, and `ghcr.io/railwayapp-templates/…`, the provider's image namespace, which is not a template).
- **D61: this repository is TypeScript.** A tracked `*.py` fails the build, as does an interpreter or package
  installer invoked from a tracked file under `scripts/`, `docs/`, `.github/workflows/` or `package.json`;
  ad-hoc scripting belongs in `tsx` under `.tmp/`. Measured: 0 tracked `.py` files, and the command-shape
  pattern finds 0 invocations where a bare case-insensitive word match finds 5 — all of them evidence about
  other projects' stacks (Railway IaC's Python/Go beta note, Authentik's Python/Django), which dated research
  notes exist to hold. Falsified both ways: a `git add -N` file made the tracked-file rule fail, and a temporary
  workflow running `python3 -m http.server` / `pip install` made the invocation rule fail at both lines; the
  probe paths were then removed index-only and `git status` was verified byte-identical to before, because this
  tree is shared with two other agents.


### Changed — service names are declared, not observed, and misfit rows are renamed (D57)

The Railway provider's physical-name rule is now **`{name}-{environment}`** for every environment, with no
exceptions: `physicalServiceName(logical, environment)` takes two arguments and consults nothing else. Production
is `api-production`, `identity-production` and `main-production` exactly as staging is `api-staging` and
`main-staging`. The compose definition's service key **is** the base name -- no field was added for it, and
nothing is parsed from a provider project description.

The rule it replaced read the project first and returned the bare name when no service held it or when it already
ran in this environment. That existed only to preserve the bare production names created before per-environment
provisioning, on the argument that preserving them was the alternative to deleting the services that hold live
data. The maintainer ruled the preservation was not worth an observational rule, and the premise was wrong:
`serviceUpdate(id, input: {name})` renames a service **in place** (the name is a `Service` field;
`ServiceInstanceUpdateInput` has no name), and the volume, its data, the environment instances, the attached
domains and the private network all follow the service id. So the services that do not fit the convention are
**moved into it**, not destroyed -- which makes this a rename migration, not a delete-and-reprovision one.

- **Deleted, not left behind**: `resolvePlacement`, `previewPlacement`, `placementCollisions` and
  `ServicePlacement` -- the one `project.services` plus one `environment.serviceInstances` read per environment
  that existed to decide a name. `platform-deploy --dry-run` renders from the same function the provider applies,
  so a preview and an apply cannot disagree, and the `->` bare-name branches went out with the observation that
  produced them.
- **The collision guard moved rather than vanished.** Under a deterministic rule two *different* logical names can
  never resolve to one service, so the only way left to ask for the same service twice is a plan declaring the same
  logical name twice -- and `InfraPlan.services` is an array, which is exactly what the API and
  `plan/from-repository` hand a provider. `planIssues` now refuses that (`duplicate-service`,
  `duplicate-database`). The assumption that the manifest schema already covered it was checked rather than
  accepted: it holds for `spec.services` (a keyed map) and did not hold at the plan boundary.
- **New reported outcomes**: `legacy-service-renamed` / `legacy-database-renamed` (old id, new name, and for a
  database the plain statement that its volume and data were not destroyed), `legacy-service-ambiguous` (a row two
  environments run at once -- refused, renamed by neither, naming the service id),
  `legacy-row-belongs-to-another-environment`, `legacy-row-left-unplaced`, `legacy-service-rename-failed` and
  `legacy-reference-redeploy-required`.
- **Ownership without a marker.** A row is a rename candidate only when its current name is a logical name THIS
  plan declares, so a foreign or hand-made service in a shared project is untouchable by construction.
  Description-parsing was ruled out, and the project marker (`platfolio:plan=`, which identifies a project and its
  last plan hash -- not a row) is deliberately not used for this. Residual risk, stated rather than implied away:
  ownership is inferred from the one-project-per-instance layout plus the plan's declared names, so a hand-made
  service inside a tenant's own platfolio project that happens to share a logical name is the one case this
  provider can mistake for its own legacy row -- and the worst outcome of that mistake is a rename an operator can
  undo (#243).
- **Deletion is no longer reachable for a row this plan declares.** An interrupted-apply residue (a row with no
  instance in any environment) is now **left alone and reported in full** rather than reclaimed: renaming it would
  install the name with nothing behind it and block the only placer (the captured schema has no
  `serviceInstanceCreate`), and deleting it could orphan a disk that is still billing. Deleting belongs to the
  operator's destroy path (D36/D43), never to a successful apply.
- **A reference expression is only as good as its target at the moment it is written.** Railway expands
  `${{Service.VAR}}` at write time, so a rename is followed -- in the same apply, and asserted by operation order
  rather than argued -- by a rewrite of every expression spelling the old name. The running containers still hold
  the value expanded from the old name until they are redeployed, and the apply now names each of those services
  and the command that redeploys it. This corrects #242's diagnosis on the way: staging's empty
  `PLATFOLIO_DB_URL` was not a boot-order race over a variable nobody had written -- the variable was written, and
  expanded to *nothing* because `main-staging` did not exist yet at the moment of the write. That is why the name
  was present, why `verified` was confidently wrong, and why a redeploy fixed it.
- Secret delivery and its read-back (`serviceInEnvironment`) resolve the deterministic name and nothing else; a
  legacy row that has not been renamed yet answers `not-found`, naming the name the rule produces. Guessing the
  bare name would write a credential onto a service the plan does not name and report it as delivered.

Covered by 28 tests in `packages/contracts/test/railway-placement.test.ts`, falsified by 18 mutations of the
implementation, each requiring the *named* test to fail -- including "someone swaps `serviceUpdate` for
`serviceDelete`", "someone rewrites the reference before the rename", "someone trusts the rename's 2xx instead of
the name it returns", and "someone reaches for `serviceDelete` to tidy the residue row away".

**Operator consequence**: this changes every production service name, so the live migration is one apply that
renames `api`→`api-production`, `identity`→`identity-production` and `main`→`main-production`, then a redeploy of
each service that reads the database reference, then measurement against the public URLs. No infrastructure was
touched to land this change; `--apply` was never run.

### Changed — the infra contract version is derived, and it says 2.0.0 (D59)

`CONTRACT_VERSION` is **gone as a literal**. The maintainer's rule -- "contracts should have a derived
MAJOR version; we should never specify a version on contracts" -- now holds where it counted least and
was therefore easy to break: the drift gate already derived a bump from the public-surface diff it
gates, printed it once into a terminal, and threw it away, while `packages/contracts/src/infra.ts`
went on declaring `1.0.0` and `platform-deploy --dry-run` went on printing `contract 1.0.0` after the
contract had in fact broken (the plan schema lost `cloneFrom` under D57, and `contractVersion` with it).

The record now lives where the measurement is: `packages/contracts/api.md` gained a `Version:` header
line beside the `Digest:` line, plus a `Bump:` line saying what moved it. `check-contracts.ts --update`
computes both; the verify pass reproduces
`packages/contracts/src/generated/contract-version.ts` from them **byte-for-byte or fails loudly** --
there is no fallback default anywhere in the chain. Every consumer reads the generated value:
`buildPlan` stamps it into plans, the fake provider and the conformance defaults claim it,
`/version` reports it, the deploy dry-run prints it.

Two decisions worth their provenance. The starting version was **seeded, not typed**: the baseline
predated version tracking, so the tool replayed the one diff a declared version was ever honestly
made against -- the surface at the commit that introduced the literal (extracted with `git archive`
and emitted through today's checker, so the checker's own format evolution cannot masquerade as
contract removals) against the surface since -- which said MAJOR: 1.0.0 -> **2.0.0**. And the
generated constant is typed `string` rather than `'2.0.0' as const` deliberately: a literal type
would publish the version into the emitted declaration surface, so every future bump would read as a
removed declaration and the gate would demand a breaking ack for its own arithmetic.

Stored plans stay readable: `InfraPlanSchema.contract` is an unconstrained string, so a plan made
under 1.0.0 parses as the historical fact it is; it is the **provider** that refuses to apply a plan
whose version it does not speak. Proofs are in `packages/contracts/test/contract-version.test.ts` --
removed declaration -> major, added -> minor, widened -> major, reordered -> **nothing** -- each
falsified by mutating the classifier and watching the named test fail.

### Changed — every environment is provisioned; a database belongs to one environment (D57)

`EnvironmentPlanSchema.cloneFrom` is **gone**, and with it the mechanism it described. A second environment
used to be created by duplicating the first (`environmentCreate` with a `sourceEnvironmentId`), which was
measured against the live API on our own project and produced a staging whose `api` and `main` carried
**production's service ids** — so staging's api read production's DSN and answered `connect ETIMEDOUT` on a
database it did not own. A cloned database is not an isolated one, so no configuration layered on a copy could
have fixed it (D56 gave staging its own values; this gives it its own data).

Now each environment is provisioned from its own declaration, by the same path production's services were
created by: `serviceCreate` for an image service, the template deploy for a database. Because Railway service
names are unique **per project** (measured: `A service named "api" already exists in this project`) and the
captured schema offers no way to place an existing service into a further environment (`serviceInstanceUpdate`
on an unplaced instance returns `true` and changes nothing — E25), the provider resolves a **physical** name per
environment: the declared name if nobody holds it or if that service already runs here, otherwise
`<name>-<environment>`. Production therefore keeps `api`, `identity` and `main` — renaming them would mean
deleting the services that hold live data — and a new environment gets `api-staging` and its own `main-staging`.
The asymmetry is history, not a special case: whichever environment is provisioned first keeps the bare names,
and `platform-deploy --dry-run` now prints the resolved names before anything is sent.

Also in this change, because the naming rule makes them observable: reference expressions spell the
environment's own database service, secret delivery addresses the environment's own service (a `PUT …/secrets`
for `api` in staging can no longer land on production's), teardown claims only the placements that existed,
coverage verification (D55) checks each environment's own services, and a service row that runs nowhere is
reclaimed so a half-finished apply can converge — while a row that runs in another environment is reported,
never deleted to free a name.

**Live state, measured:** the broken staging environment was deleted from platfolio's Railway project as part of
this work, and **production was left running and re-verified afterwards** — `readyz` returned
`{"status":"ready","checks":[{"name":"identity","status":"ok"},{"name":"database","status":"ok"}]}`. Nothing was
re-created live; the new provisioning path is tested against the double, and its first live run is this
repository's next apply. Removing a schema field also changes every rendered plan, so every stored idempotency
marker is stale exactly once: the next apply resumes instead of reporting `noop`, which is the path D55 governs.

### Added — releases are reported, secrets are delivered, and the templates need one file less

Three API operations (32 → 35, spec written before the handlers), one store record, and two provider verbs:

| Operation | What it replaces |
| --- | --- |
| `POST /api/v1/instances/{id}/artifacts` | `compose.prod.yaml` as a required file, and with it the whole stale-pin class of bug (#217 closed) |
| `PUT /api/v1/instances/{id}/secrets/{name}` | a maintainer typing credentials into a provider console — including for platfolio's own deployment (D53) |
| `GET /api/v1/instances/{id}/secrets` | `grep`ing a provider UI to find out whether an install is finished |

**D54, the release artifact.** A service declared with `build:` is compiled by the platform's own pipeline, so
its digest arrives by report: newest-per-service replaces the previous one, a malformed digest is refused at the
store, and a platform that has never reported one is refused with the **pipeline named** — `publish one (POST
…/artifacts) and the plan resolves` — not "invalid document". Third-party images still require a committed
digest, because nobody's pipeline produces them. D30 law 1 is untouched: platfolio deploys on the report and
then proves the provider's own state, and the plan hash derived from the artifact is what an attestation must
match, so a stale report **moves the hash** instead of deploying quietly.

**D53, delivery not custody.** `putSecretValue` writes through to the provider and keeps nothing;
`secretPresence` answers `set | missing | unverifiable`. The success response is **204 with no body**, and the
value is asserted absent from the read-back *and* from the audit row — the audit trail is a leak surface like
any other. Writing a credential is owner-only; reading presence is not.

**Presence has three states, and the test proves it.** Before anything is applied, presence is
`unverifiable` — the provider has no such instance. Two states would have let platfolio answer "the credential
is missing" about a project it never touched, which is the same overclaim as calling a certificate issued
because a hostname exists.

**Provider verbs come from one list.** `RailwayInfraProvider.describe().operations` was a hand-copied array;
it now derives from the shared `OPERATIONS` constant (`[...OPERATIONS]`, copied so a driver cannot mutate the
shared tuple). The old list was accurate; it was just free to drift, and drift there is silent.

### Fixed — the memory store accepted digests the Postgres store refused

Found while writing the shared suite, and the reason the suite exists: `putArtifact` on the double validated
nothing, so `digest: 'latest'` passed there and would have failed against Postgres. Validation now happens in
both drivers, four malformed shapes are refused (`latest`, a wrong alphabet, a wrong algorithm, a short hex
string), and the artifact cases run against both through `store-conformance`.

### Changed — `check-contracts` can now tell a widening from a removal

Forced by an embarrassment worth keeping in the log: I ran `--update --ack-breaking="additive…"`, the tool
answered `2 line(s) removed -> MAJOR`, and both statements were defensible while neither was useful. What had
actually happened is that `OPERATIONS` grew two members, so the *same declaration* was re-emitted with a larger
body — line-diffing counts that as a removal. The classifier now splits the two and reports them separately:

```
BREAKING accepted: 0 removed, 2 widened -> derived bump MAJOR. Reason: …
```

Requiring an ack for a widening is deliberate. A widened output union breaks anyone switching exhaustively even
though nothing was withdrawn, and "minor, nobody was harmed" would be a claim about other people's code that the
diff cannot support.

### Added — the dev-overlay pairing gate (D50, and the answer to "isn't this duplication?")

The objection was fair: `compose.yaml` and `compose.dev.yaml` look like the same thing written twice. The
distinction the files actually carry is that the dev overlay answers a question the platform description
deliberately does not: **what runs on a laptop** — containers for what a provider would provision, published
ports, loopback credentials. `platform:plan` never reads it.

So the pairing is enforced rather than trusted. `check-project.ts` now fails when:

- a platform service has **no dev entry** — local `up` would run half the platform and call it whole;
- the overlay **adds** a service not declared in its own `x-platfolio.devOnlyServices` — an undeclared container
  is a fact about the platform nobody wrote down;
- the overlay invents **domains or secrets** the platform file does not declare — a hostname that will never be
  issued, or a credential requirement that exists in only one place.

Falsified by renaming `api` → `apii` in the dev file: two problems (missing dev entry, undeclared extra), exit
1. Restored: exit 0. The very first run caught three undeclared `db`/`mailpit` containers I had added, which is
the gate doing its job on its author.

393 tests, 392 pass, 1 explicitly skipped (the live forge check, gated on `PLATFOLIO_LIVE_GIT=1`); 35
operations checked in both directions; both store drivers run the same suite, now including artifacts.

### Fixed — an undeclared dependency that only the production build could see

`capabilities.ts` needed a zod error formatter, so I wrote `import { z } from 'zod'`. Every local gate went
green: `tsx` resolves zod from the hoisted workspace root, where it is present because some other package
declares it. The control-plane image installs each app's **declared** dependencies, and there the import is
`ERR_MODULE_NOT_FOUND` at startup -- before the fail-closed check could print its own refusal.

CI's "Build the control-plane image" job caught it, on the step that runs the built container with no identity
config and asserts it refuses to start. That assertion is the cheapest thing in this repository, and it is the
only one that tests the artifact a tenant actually receives rather than the source I edited.

The file's existing style was already correct -- `input.error.issues.map(...)` needs no zod import, because the
schema's error type carries the issues. Fixed by deleting the import and matching the neighbours.

**Rule recorded:** when a check can be run against the built artifact, running it against source does not
establish the claim. AGENTS.md already said this ("fake-only tests do not establish that wiring works"); this
is the cost of reading past it.

### Fixed — the published templates were not the templates, and nothing could tell us

The registry consolidation (D58) deleted `.platfolio/environment.yaml` from `templates/` and stopped at the
repository boundary. All three **published** template repositories still served it, and `applyInventory` merges
whatever is there -- so a fork on that day would have carried two registries describing one platform, the exact
defect D58 was raised to remove, surviving in the one place tenants actually touch. Found only because the
maintainer asked whether the published repos had been updated. They had not.

This is a structural gap, not a slip: every gate in `verify` runs offline, so nothing in the normal path ever
looks at the published copy.

- **`pnpm run templates:check`** compares, per template, the blob SHA of every local file against the same path in
  the published repository, and reports `STALE` / `MISSING` / `ORPHAN`. A blob SHA is computed identically on both
  sides, so a match is evidence rather than an opinion. It found the two stale READMEs immediately, and reported
  in sync after the republish.
- **Retiring a published path** is now expressible at all: the publisher accepts `deletePaths`, and the writer
  emits `sha: null` tree entries. Two measured lessons -- a tree built on `base_tree` only adds and replaces, and
  GitHub rejects a null-sha entry for a path that is not in the base commit (`GitRPC::BadObjectState`, 422), so
  re-publishing a repository that already moved on used to fail the whole commit. Retirements are now filtered
  against the base tree and reported as `retired` vs `alreadyAbsent`, because those are different facts.
- **Retirement is declared, never derived.** A publisher that deleted "anything not in the source" would eat a
  fork's own files, so `RETIRED_PATHS` in the new `scripts/template-manifest.ts` is explicit -- and
  `templates:check` flags any published file that is neither shipped nor declared retired, so an incomplete list
  cannot pass silently.
- **Publisher and checker share that one manifest**, so they cannot disagree about what should be published.
- **`check-project.ts` gained the offline half** (a platform directory without a registry, a shipped path under
  the retired prefix, or a shipped path that is also declared retired), because `templates:check` needs
  credentials and network. Verified by breaking it both ways.
- The templates' own documentation was two layers stale: `templates/starter-web/README.md` promised a secret
  (`APP_SESSION_KEY`) that the template removed in #238 and pointed at the retired `.platfolio/` path, and
  `shared-identity`'s told tenants to rotate `KEYCLOAK_ADMIN_PASSWORD`, a variable 26.x does not read. Both
  corrected; `docs/design/03`, `13` and `14`'s normative path references updated.

Stated plainly, because the maintainer's objection deserves an answer rather than a gate: **bundling the templates
with the core platform is what makes this drift possible**, and `templates:check` closes the detection gap, not
the design one. Separating them is a real option and is recorded as a decision to take, not as work done.

### Fixed — the identity smoke was forging a token that wasn't forged, and the cross-issuer proof moved off the master admin

Two defects surfaced while working #248, and the first is the one that should worry us.

**`a flipped signature is refused with 401` had been passing without testing anything.** The check flipped the
*last character* of the compact JWT. An RS256 signature is 256 bytes, which is 342 base64url characters: the
final character carries two significant bits and padding bits that decoders discard, so for many signatures
changing it decodes to the **same bytes** -- the token remains genuinely valid. Measured on today's Keycloak:
one mint produced a last-character flip that decoded differently (the API correctly answered `401`), another
decoded identically, and the staging run reported `200` for what it called a forged token. Same code, opposite
results, on nothing but luck. The check was neither reliably detecting a broken verifier nor reliably proving
the verifier worked -- it was a coin flip in a security assertion.

Now the forgery mutates a character in the **middle** of the signature segment, where every bit is significant,
and it decodes both signatures first: if the bytes did not change, the check reports that it did not run rather
than passing. Measured: production and staging each **11/11**, and six consecutive production runs all passed --
with `401 unauthenticated:signature` naming the key id, in both realms.

**The cross-issuer check no longer depends on an operator credential.** It used to mint a *master-realm admin*
token as the foreign token. That was always a weak stand-in for the real invariant -- the threat is not an
administrator's credential arriving at a tenant endpoint, it is **one tenant's credential arriving at another
tenant's control plane** -- and it made a D4 proof depend on a credential we might not be able to obtain. So it
now uses the **peer realm**: platfolio runs one hosted Keycloak with a realm per environment (D56), so
`platfolio` and `platfolio-staging` are same-server, different-issuer, different-key-set neighbours, which is
exactly the cross-tenant shape. Both directions are covered, refused as `unknown-key`, and the only thing needed
is the peer realm's own client secret and user password. `KC_PEER_REALM` unset is a **failure, not a skip**.

**Why #248 is not fully closed, and what that costs.** The reason the old check broke was that production's
master-realm admin credential cannot be authenticated any more (`400 invalid_grant`). The 26.8 documentation is
explicit that `KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD` create the admin *"only during the initial start of the
Keycloak server when the master realm doesn't exist yet"* -- which means (a) my planned fix for #248 would not
have worked, (b) the admin we used to have was created at first provisioning, and (c) recovery is
`kc.sh bootstrap-admin user`, which requires **all Keycloak nodes stopped** and yields a *temporary* admin that
must then be replaced and removed. Our `compose.yaml` currently declares `KEYCLOAK_ADMIN` /
`KEYCLOAK_ADMIN_PASSWORD` -- the 25.x names, which 26.8 does not read at all.

I deliberately did **not** change those names in the composition as part of this commit. Declaring the
bootstrap pair makes the plan's custody claims honest and matters for every *new* hosted-identity deployment,
but it cannot recover a realm that already exists -- and it does change what the next `--apply` demands of
production (two newly required shared variables, reported missing until delivered). That belongs in one
maintenance window with the admin recovery, which is an operator decision with downtime attached, not a
drive-by edit in a session that has already damaged content once today.

### Measured — the production rename ran: every service in every environment now follows `{name}-{environment}`

Executed through platfolio's own implementation (`platform-deploy --apply`, then `--redeploy` per the write-time
expansion rule), not the provider console. The manifest was **not** edited, and that matters: the rule appends the
environment, so writing `api-production` into `compose.yaml` would have produced `api-production-production`. The
logical names stay; the physical names are derived.

Provider state, read back after the apply:

```
services: main-staging, api-production, identity-production, main-production, api-staging   (no bare rows remain)
note services.api-production@production:   legacy-service-renamed   "api" (258c8da7) -> "api-production"
note services.identity-production@production: legacy-service-renamed "identity" (6bacf3ed) -> "identity-production"
note databases.main@production:            legacy-database-renamed  "main" (9308eb5e) -> "main-production"
note databases.main@production:            legacy-reference-redeploy-required -- 6 expressions rewritten
```

Nothing was deleted. The volume, its data, the environment instances, the private network and the domains all
followed the service id, which is why the rename replaced the delete-and-reprovision plan. **No DNS changes were
needed and none were made**: the provider's shared hostnames already carried the environment
(the host form carries the environment name), so the published CNAMEs for `api.platfolio.dev` and
`auth.platfolio.dev` kept matching after the rename. Measured before and after, not assumed.

Second apply: `verified=true noop=true` -- converged, and it did not re-rename. `--dry-run` shows no `legacy-*`
notes, so there is no residue left to migrate.

Endpoints after rename -> rewrite -> redeploy of `identity-production` and `api-production`:

| Check | Result |
| --- | --- |
| `https://api.platfolio.dev/readyz` | `{"status":"ready","checks":[{"identity":"ok"},{"database":"ok"}]}` |
| `https://staging-api.platfolio.dev/readyz` | same, unaffected throughout |
| `identity:smoke` staging realm | **11/11** |
| `identity:smoke` production realm | **10/11** -- see below |
| all gates | tsc 0 · 450 tests / 446 pass / 0 fail / 4 skipped · contracts 3.0.0 · registry 82 · api:check 35 · bundle 0 · graphql 37/697 |

**One check no longer runs, and I am not calling it a pass.** The cross-issuer refusal -- a master-realm admin
token presented to a tenant endpoint, refused as `unknown-key`, the strongest D4 proof we had -- now fails to
*acquire* its foreign token: Keycloak answers `400 invalid_grant / Invalid user credentials` for the recorded
master admin. Names-only inspection (values never read, D4) says why a reboot would be the trigger point but not
what changed: `identity-production` still has `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD`, and has **neither**
`KC_BOOTSTRAP_ADMIN_USERNAME` nor `KC_BOOTSTRAP_ADMIN_PASSWORD` -- the 26.x names. So this boot had no bootstrap
admin credential at all, and the password we hold does not match the one in the database.

**Cause not established, stated as such.** The variables were not touched by the rename (they were already in that
state when the same smoke passed 11/11 hours earlier), so the honest candidates are: the Keycloak restart changed
the admin user, or our recorded credential was already stale and the earlier 11/11 used a still-running container
whose admin predated it. I re-ran the smoke between two of my own redeploys and got **8/11**, then 10/11 -- a
measurement moving under repeated restarts, which is why I stopped restarting and reported the varying numbers
rather than the flattest one. #248 records it: production's cross-issuer claim is currently unverified, the fix is
to set the `KC_BOOTSTRAP_ADMIN_*` pair deliberately (as the shared-identity template already does) and re-run.

### Changed — the contracts baseline is structured data, not prose that a test regex-parses

`packages/contracts/api.md` is now `packages/contracts/api.json`:

```json
{ "schema": 1, "version": "3.0.0", "bump": "MAJOR 2.0.0 -> 3.0.0 (…)", "digest": "448cfa1167a4e06d",
  "declarations": [ "attestation.d.ts: action: z.ZodEnum<{", … ] }
```

The maintainer asked why a deterministic test was reading a markdown file, and there was no good answer.
`check-contracts.ts` recovered the header with three regexes (`Version:`, `Bump:`, `Digest:`) and lifted 4,324
declaration lines out of a fenced block, so the gate's correctness depended on heading text and fence
characters. Change the writer, or let a heading wrap, and the reader sees **zero** declarations and reports
"no drift" -- the sixth vacuity failure of this session, in the one file whose entire job is detecting drift.

**The migration was proven rather than eyeballed.** Extracting the fence and re-joining the declarations
produces a surface whose digest is `448cfa1167a4e06d` -- identical to the digest the markdown recorded -- and the
derived version stays 3.0.0 on a zero-size diff (0 removed / 0 widened / 0 added / 0 reordered). The committed
file was then compared against the tool's own `renderBaseline()` output, not against my migration script's
bytes: identical, 4,333 lines.

Three guards ship with the format, each asserted by mutating the **parsed object** rather than regex-replacing a
string:

- `schema` mismatch -> a named refusal, not a parse into nonsense;
- **zero declarations -> refused outright**, because an empty surface agrees with everything;
- absent or non-semver `version`, malformed `digest` -> refused, never defaulted.

That choice came from being caught: the existing tamper cases regex-replaced markdown header lines, and after
the format change two of them silently matched nothing -- a "tamper" that is a no-op, asserting against an
untouched file. The test failed loudly and the suite earned its keep. Rewritten as object mutations they cannot
miss, and coverage went from four tamper checks to seven.

The explanatory prose that headed the file moved into the code comment above the parser, where a reader of the
format will actually meet it. `docs/design/01`, `docs/design/03` and the AGENTS layout row now name `api.json`;
the dated research files that mention `api.md` are left alone as records of what existed then.

Measured: version gate 8/8 · tsc 0 errors · 450 tests / 446 pass / 0 fail / 4 skipped · `check-contracts`
reports `4324 exported declarations, derived Version: 3.0.0` · docs, `api:check` and `environment:registry`
all exit 0.

### Changed — the last two declared versions now derive too (D59 completed)

`IDENTITY_CONTRACT_VERSION` and `STORE_CONTRACT_VERSION` were the remaining hand-authored version literals in
the contracts package, both `1.0.0`. They are now `CONTRACT_VERSION` — the value derived from the public-surface
baseline — so no version string in the codebase is typed by hand.

Calling them "duplicates" would undersell it. They were **stale by construction**: nothing bumped them when the
package surface changed, so `identity-conformance` was comparing an implementation against `1.0.0` while the
contracts had already moved to 2.0.0 today. A version that cannot move is not a compatibility claim; it is a
fossil, and it was being used as a gate.

The derived bump is **MAJOR 2.0.0 → 3.0.0**, and correctly so: both were *literal types* (`= "1.0.0"`), which
publishes a version into the emitted surface, so retiring them removes three surface lines. Same trap D59 found
the first time, and the reason both are now typed `string` — future version moves will cause no surface churn at
all, and the gate can never again flag its own arithmetic as breaking. No external implementer exists (no
tenants), so this costs nothing today.

`pnpm run contracts:check` now reports `4324 exported declarations, derived Version: 3.0.0`.

### Changed — one environment registry per platform. `.platfolio/` is gone (D58)

Two files named `environment.yaml`, two schemas, one set of variables. The registry is now the only one, and the
platform inventory's facts moved into it as fields: `kind` (`value | secret | reference | output`), `service`,
`required`, `default`, `enum`, `rotate`, `database`, `output`, `from` -- beside the custody fields (`secret`,
`environments`, `deployedTo`, `note`). Our 16 obligations were re-homed in the checker's `HUMAN` table so
`--emit` regenerates them instead of losing them; each template's inventory became
`templates/<name>/environment.yaml`; `.platfolio/` was deleted everywhere.

`kind` survived because it is the field that decides what an operator is asked to do: `value`/`secret` are
obligations, `reference`/`output` are wiring the platform resolves and must never appear on a panel asking a
tenant to type (D33). Dropping it would have quietly deleted a rule while appearing to simplify a file.

Also fixed, in the same change:

- **The dependency was backwards.** The registry scanned the inventory for names, so a hand-authored list -- one
  with a documented history of naming variables nothing reads -- fed the derived authority. Excluding it and
  re-running lost nothing, which is the proof it was pure duplication. Now **no registry file is ever a
  discovery source**: a registry that feeds the derivation producing it is a loop, not a check.
- **The cross-check compared the wrong namespaces.** It asked whether a *template's* names appeared in *our*
  registry -- `KC_DB_URL` on the identity platform is not a variable this control plane reads, and forcing it in
  would have recreated the duplication the change exists to prevent. What generalises across registries is the
  obligation schema, so that is now what is checked, per platform file.
- **A vacuity guard**, added because the first version of that check parsed zero rows from the new envelope and
  reported green. Third time today a check could pass by checking nothing (`git cherry -q` printing nothing; a
  malformed appended inventory yielding no entries; this). It now fails when a registry declares no variables,
  naming both possible causes.

Verified by falsification, five rules: `kind: secret` with `secret: false`, a secret with a `default`, a
`reference` with no `database`, wiring marked `required`, an unknown `kind`, and the vacuity case -- each exits
1, and the restored tree exits 0. Two of the first probes were bogus and I redid them: one mutated the file into
invalid YAML (proving the parser works, not the rule), the other aimed `required:` at a `value` row, where it is
meaningless -- **an anchor that does not match is now reported as `ANCHOR MISSING` instead of being counted as a
pass**, because a silent no-op probe is how a check gets a certificate it never earned.

Two self-inflicted errors recorded in the commit: I added the 16 rows to the `HUMAN` table without noticing
three names were already there (duplicate object keys -- TypeScript caught what I had just written a rule
about), and my first pass left the cross-check reading an envelope name that no longer existed.

### Fixed — the templates were shipping obligations nobody reads, and the registry was being fed by them

Two related cleanups, both prompted by the maintainer noticing that `.platfolio/environment.yaml` and
`environment.yaml` looked like a duplicate. They are not the same thing -- one is the platform **inventory**
(D33, merged into the plan by `applyInventory`), the other the central **registry** (D52, derived from code and
composition) -- but they were *duplicated plumbing*: the registry scanned the inventory for names.

**The experiment first:** exclude `.platfolio/` from the scanner and re-run -- 82 variables, all still
referenced, nothing lost. The inventory contributed zero unique facts. Keeping it as a source meant the registry
inherited the inventory's staleness, and the inventory's own header already records a version that named
`SESSION_SIGNING_KEY` and `PUBLIC_ORIGIN` (nothing reads either) and called `KEYCLOAK_ISSUER` optional when the
control plane refuses to start without it.

Then the dependency was reversed and made a gate: inventory names in our namespace must be declared in the
registry, and the two must agree about custody in **both** directions -- an inventory calling something a secret
while the registry says `secret: false`, or the reverse, fails the build. Understating custody in an
operator-facing file is how a credential gets pasted into a support ticket.

**What the new rule caught, immediately and for real:**

| Template | Declared | Read by |
| --- | --- | --- |
| starter-web | `APP_SESSION_KEY` as `kind: secret, required: true` | nothing -- the template has no sessions |
| starter-web | `LOG_LEVEL` | nothing |
| starter-worker | `QUEUE_DRIVER`, `STATE_ENCRYPTION_KEY` | nothing |
| shared-identity | `KEYCLOAK_ADMIN_PASSWORD` | nothing -- 26.x reads `KC_BOOTSTRAP_ADMIN_PASSWORD`, and the template's compose still set the deprecated `KEYCLOAK_ADMIN` username |

Because `applyInventory` merges the inventory into the plan, these were not stale comments: each `required: true`
secret became a blocking obligation on every tenant who forks the template -- a deploy that never goes healthy
over a credential with no consumer. `templates.test.ts` asserted `APP_SESSION_KEY` by name, which is how a
fiction gets frozen: the assertion was protecting the bug. It now asserts the rule.

The exemption is structural rather than a convenience: for a `build:` service the consumer is source we can
grep; for a third-party image (Keycloak) the consumer is that image's documented configuration, and demanding a
local mention there would only teach people to write fake mentions.

**And the falsification that caught a hole in my own gate:** my first attempt to prove the rule appended a
malformed line, the inventory failed to parse to zero entries, the loop iterated over nothing, and the test
reported **green**. The rule now asserts its inventory parsed to more than zero entries. I had shipped two
gates this session that could pass by checking nothing, and this one was found only because I tried to break it
before believing it.

Templates' `KC_BOOTSTRAP_ADMIN_*` names are now discovered by the registry (they match the `KC_` prefix) and
declared; `shared-identity`'s compose uses the bootstrap pair its dev overlay already used, so the template and
the platform stopped disagreeing about how to create the same admin.

### Corrected — an entry in this file described work that was not in the repository

The entry below was merged as PR #228, which contained **three documentation files and no code**: CHANGELOG,
MAINTAINING and the decision register. Its commit message described two provider calls, a contracts helper,
environment scope in the double, a conformance case and four tests -- none of which existed. CI passed,
correctly, because it was testing a docs-only diff.

The cause was mine and it is worth naming precisely: after merging #227 I ran
`git checkout staging && git reset --hard origin/staging` to synchronise while that work was still uncommitted,
and `reset --hard` deleted it. I then wrote the commit message from my account of the session instead of from
the diff -- the same failure class as the Keycloak claim this file corrected days earlier, and exactly why
AGENTS.md says to match evidence to the artifact. **The code is in the tree now**, in the change that follows,
so the entry below reads as a description rather than a promise. #225 was reopened with the inventory, and PR
#228 carries a comment stating what it does and does not contain rather than being quietly rewritten.

### Fixed — `check-contracts` called a reordered union a removal and demanded a breaking ack

TypeScript prints an inline union in inference order, so `"database" | "service" | …` becoming
`"service" | "database" | …` is, in a text diff, one line deleted and another added. The gate classified that as
`genuinely REMOVED -> MAJOR` and required `--ack-breaking`; I very nearly accepted a major bump for a type that
had not changed, and had typed an ack before I stopped to check what was actually missing.

Classification now pairs lines by **declaration head plus sorted member set**. Same members, different order:
reported as a reordering and excluded from `breaking`. Two attempts were wrong first -- slicing at the first `|`
swallowed the first member, and keying the head on `keyOf` matched nothing because a union line contains no
bracket at all. Verified in both directions: the real reorder now reports `additive only -> MINOR` with no ack,
while withdrawing `"volume"` from one baseline line still exits 1 as a genuine removal.

### Added — shared-variable delivery, and the platform description decides where a credential lands (D53, closes #225)

`putSecretValue` gained a `source` argument, and the value is not the caller's to choose: it is read from the
registered plan's own `secrets` entry for that service in that environment. `source: shared-variable` means
**two provider calls** -- `variableUpsert` with no `serviceId` (environment scope), then
`sharedVariableConfigure` with `enabledServiceIds` (attachment). That second call is not ceremony: the captured
provider schema shows `SharedVariableConfigureInput` carries `enabledServiceIds` / `disabledServiceIds` and **no
value field whatsoever**, so it cannot create the variable -- and a value written at environment scope without
attachment is invisible to the service that declared it, while still existing in the environment. `verified`
therefore means "the declaring service can read this name", not "a value is somewhere".

`secretWriteScope(source)` now lives in contracts and is the ONE narrowing both the API handler and the deploy
script call. The first draft duplicated the mapping in the script; TypeScript refused the wider plan enum, and
the fix was to make it single-sourced rather than to cast.

A name the description never declared is refused with `secret-not-declared`, and a service the environment does
not contain is refused the same way: platfolio will not invent a custody location for someone, and an undeclared
variable is one no deployment was told to read. Presence and delivery agree because both consult the same entry.

First-party path (landed with the correction above, not in #228): `platform-deploy --deliver-secrets` delivers every credential this composition declares,
through the provider seam rather than the hand-written GraphQL that `--bootstrap-vars` uses. Finding that gap
required staging to exist -- it was created, then immediately failed `secret-unavailable` in both environments,
which is the plan check working, not the deploy being broken.

Evidence: conformance gained a case that delivers at BOTH scopes and reads presence, so both drivers must
implement the distinction; two Railway-specific tests prove the environment-scoped write lands at environment
scope, that the attachment names exactly the declaring service, and -- the load-bearing one -- that undoing the
attachment flips presence back to `missing`, which is what stops `verified` meaning "we hope". Default-scope
delivery is asserted NOT to write at environment scope.

230 tests in the contracts+control-plane pair, 0 failures; `check-contracts` classified the change **additive
(4 lines, MINOR)** on its own -- the breaking ack I had prepared was unnecessary, which is the improved gate
being right rather than me being right.

### Added — configuration is scoped per environment inside the platform description (D56)

`x-platfolio.services.<name>.environmentValues.<env>.<NAME>`, composed by `buildPlan` into the effective
environment map for that environment alone. Three refusals come with it: an override naming an environment the
service is not placed in (`environment-values-unplaced-environment` -- dead configuration that reads like a
decision), an empty override value (`environment-value-empty` -- delete the entry or mean it), and a
**credential-shaped name** in a value map (`environment-value-is-secret-name` -- D4 has no exception for the
staging copy of a value, so the NAME is refused whatever it holds).

This closes a gap I flagged rather than hide, and it was the last structural duplication in the composition:
`mode: development` promised a staging environment and delivered a copy, because the only difference between the
environments was what the provider injected. platfolio's own staging control plane was therefore pointed at the
production Keycloak realm.

Resolved the way the maintainer directed: **one identity service, one domain, one certificate, two realms.** The
staging api now deploys with `issuer = https://auth.platfolio.dev/realms/platfolio-staging` and the matching JWKS
path, both declared in `compose.yaml`, and both differences move the plan hash -- configuration is part of the
version decision, not a detail applied later.

What was NOT duplicated, and why it matters: no second Keycloak. `identity` is `mode: hosted` (D51), so it does
not earn a development environment; staging borrows the deployment and isolates by realm. A staging token is
refused by production on issuer as well as audience, and the reverse holds -- which is the isolation the shared
host was never asked to provide. The local stack's Keycloak container stays, and is a different thing: an offline
test double (D49), not a deployed environment.

Three tests in `build-plan.test.ts`: the override reaches only the environment it names, production keeps the
base value, an override changes the plan hash, and both refusals fire. Verified against the real composition:
`platform-deploy --dry-run` now prints `realms/platfolio` for production and `realms/platfolio-staging` for
staging.

### Fixed — a marker that promised a plan the provider never got (D55)

`applyPlan` short-circuited whenever the project description carried the plan's hash, returning `noop: true,
verified: true` after checking only that *every service in the project is live*. That question cannot see
absence: a service never placed in an environment is not in the list it inspects, and an environment that was
never created contributes no services at all.

This was not hypothetical — it happened to us. An apply was interrupted between writing the marker (which E26
requires to happen **before** the first mutation, so a failed retry does not redeploy the world) and creating
the staging environment. Every subsequent apply reported success; staging did not exist.

Now a matching marker earns a **coverage check** instead of a certificate: each declared environment must
exist, each declared service must be placed in it, each declared domain must be bound. On any gap the apply
resumes and says so — `marker-without-state`, with the missing things named — instead of answering quietly.

Two host kinds, checked differently, because they are different claims:

| Declared domain | Check | Why |
| --- | --- | --- |
| `api.platfolio.dev` (ours) | exact host must be bound in that environment | a custom hostname is our assertion; anything else is a broken install |
| `api.up.railway.app` (provider-assigned) | the service has **some** domain bound in that environment | Railway names generated hosts itself; demanding the literal would report a correctly applied plan as unfinished forever — and a check with permanent false positives gets ignored |

Three tests in `railway-idempotency.test.ts`, the first of which **failed against the shipped code before the
fix** (reproduced, then repaired): an interrupted apply resumes and recreates the environment; a genuinely
applied plan still short-circuits and mutates nothing; a missing domain binding is a coverage failure too.

Things the new tests got wrong first, recorded because they are the interesting kind of wrong: the assertion
looked for an operation named `environmentCreate` while the mock records `environmentCreate:workspace`; and the
reduced-scope conformance plan declares hosts of the generated form, which made my first coverage check report
a successfully applied plan as unfinished — caught by the suite rather than by me.

### Corrected — three documents asserted something false about Keycloak, and it was never true

`compose.dev.yaml`, `docs/design/16` and issue #168 all repeated: *"Keycloak 26.8.2's import format rejected
role assignments in every shape tried."* Measured against the exact image we run, with everything read back
through the Admin REST API and through an issued token
([docs/research/keycloak-realm-import-roles-2026-11-14.md](docs/research/keycloak-realm-import-roles-2026-11-14.md)):

- **Realm roles, client roles and user assignments all import** — via `roles.realm[]`, `roles.client` keyed by
  **clientId**, and `users[].realmRoles` / `users[].clientRoles`. A token for an imported user carried
  `realm_access.roles=["platfolio:user"]` and `resource_access["platfolio-api"].roles=["read"]`.
- **Our observation was inverted.** The key we used (`users[].roles`) is not silently dropped: it aborts the
  import and the **server fails to start**, naming the field and listing the 29 valid ones. Same for keying
  `roles.client` by display name — fatal, `App doesn't exist in role definitions`.
- **What actually happened is the part that matters:** once the realm exists in the shared Postgres schema,
  `--import-realm` logs `already exists. Import skipped` and then **`Import finished successfully`** — a boot
  that looks like it seeded and seeded nothing. A missing directory produces no import log line at all.
- Re-application is the real reason the API seed stays: `kc.sh import` **deletes and recreates** the realm by
  default; `partialImport` with `OVERWRITE` wiped an imported user's credentials; and `POST …/users` ignores
  `realmRoles`/`clientRoles` (upstream #13390, still open). `seed-identity.ts` is idempotent and reads back what
  it wrote.

Consequences: `compose.dev.yaml`'s comment now states the measured behaviour and links the research; the
sentence in `docs/design/16` is **kept with the correction attached** rather than rewritten, because it is what
I believed and wrote at the time; #168 is closed with the evidence. No realm JSON is shipped — and if one ever
is, it is first-boot-only and must be labelled as such.

**Why this is in the changelog rather than quietly fixed:** a provider claim that was never re-tested after the
version moved survived into three places and an issue title, and it was confident enough that a maintainer had
to tell me I was wrong. Re-testing provider behaviour when the provider version changes is now stated as owed
work, not a nicety.

### Changed — the registry's environment field: three words, one spelling of everywhere

`appliesTo` became **`environments`**, valued `development | staging | production`, or `all`. The old vocabulary had six words -- adding `ci`, `test`, `local` -- and in practice one meaning was spelled four different ways across 81 entries: `[development, staging, production]`, `[development, staging, production, test, local]`, `[staging, production, ci, test, local]`, `[test, local]`. A registry whose synonymous sets differ by spelling cannot be searched ("does this variable reach production?"), diffed, or trusted. That was the maintainer's objection, and it was right.

Five rules now enforced by the same script, each falsified by mutating the file and reading the failure:

| Mutation | What the gate said |
| --- | --- |
| the old field name | `CONTROL_PLANE_BASE: appliesTo is retired -- the field is environments` |
| full set not written as `all` | `DATABASE_URL: list all three environments as environments: all -- the same set must not have two spellings` |
| `ci` as an environment | `environments: ci is not an environment -- a runner is the development environment; where its value lives belongs in deployedTo` |
| an environment twice in one entry | `KC_HTTP_ENABLED: environments lists the same environment twice` |
| the same variable defined twice | `environment.yaml defines CONTROL_PLANE_BASE more than once -- one variable, one definition` |

`ci`, `test` and `local` were not discarded: they describe **where a value lives**, which was always `deployedTo`'s claim (`ci:secret`, `ci:env`, `local:compose-overlay`, `host:shell`), so the information moved to the field that already owned it. **Eight spellings became three** (`[development]` 37, `all` 34, `[staging, production]` 10).

`--emit` carries the migration -- a curated `appliesTo` list is mapped to the new field rather than trusted -- so regenerating cannot reintroduce the synonyms.

**And a probe failure worth recording:** my first attempt at the falsifications above reported five rules as *not caught*, which would have made me "fix" a gate that was already working. The mutations had not been applied: I used six-space indentation against a four-space file. Every probe now asserts the file's checksum changed before it trusts a result.

### Fixed — staging's history was an orphan snapshot with no parents

`origin/staging` began at root commit `d4a2dc8` ("Merge of PR #214") with **no parents**: the integration line
had been recreated on 2026-11-13 from a working-tree snapshot whose tree is byte-identical to PR #214's head
commit `7a9aa029`. Consequence: ~270 commits -- every merge from #99 to #213 -- were unreachable from staging,
so `git log` reported a project that had begun last Friday, and `git blame` could not reach the commits that
wrote most of the code.

Repaired with two `git merge -s ours` commits (`c529012`, `0e0f711`): the snapshot's source and `main`'s three
integration merges become ancestors, tree byte-identical before and after, verified by comparing tree objects
and by an empty `git diff --stat` against the previous tip. Staging now reaches **346 commits back to
`50fe8c2 Initial commit` (2026-10-23)**.

Deliberately **not** done: rebuilding the ~20 snapshot commits so `d4a2dc8` stops being a second root. That
needs a force-push to a shared branch and would renumber every commit from PR #215 onward, breaking the
association between each GitHub PR page and the commit actually merged. Two roots, documented, beat a
cosmetically clean line bought by destroying traceability.

The repair also invalidated the documentation I had written an hour earlier, which asserted the history was
disconnected -- corrected in the same push rather than left as a confident falsehood. `docs/MAINTAINING.md` now
records the four ways I mis-measured "is this merged?" (`git cherry -q` prints *nothing*, so my grep counted an
empty stream and reported a clean result), because the next agent will ask the same question.

### Removed — the repository's stale branches

Remote heads went from 13 to 2 (`main`, `staging`): 10 deleted, each first shown contained in staging or
superseded. `docs/182-object-model` was not contained -- it is the earlier draft of the object-model document
whose successor landed as PR #182 from the sibling branch `docs/183-object-model`; its unique lines are the
pre-#176 state ("no user row", "bindings absent") that staging has since corrected. 112 stale local
remote-tracking refs pruned; one worktree; local branches 15 → 2. All 145 refs bundled to
`.archive/` before anything was deleted.

### Added — the central environment registry, `environment.yaml` (D52)

One machine-readable file at the repository root declaring every variable this project reads or deploys: whether
it carries a credential, which environments apply, and where the value actually lives. **81 variables, 16 of
them credentials**, each with its provenance recorded. Enforced both directions by `pnpm run
environment:registry`, wired into `check` and so into `verify`.

Why this is the secrets foundation rather than a documentation nicety: custody cannot be audited from a name.
`PLATFOLIO_DB_URL` reads like a URL and carries a password in its userinfo; `KEYCLOAK_ADMIN` reads like a secret
and is a username. Before this file, D4 ("platfolio stores no secret values") was a claim about intent with no
place to check it.

Things the registry caught while being built, all of them real:

- **`KC_DB_URL` is not a secret.** My first pass marked it one because it is a JDBC URL; the dev-overlay rule --
  which checks the *userinfo inside the URL* rather than pattern-matching friendly strings -- reported that it
  contains no credential at all. Marking a hostname a secret trains nobody to trust the registry.
- **A whitelist of "obviously fake" values is not a rule.** The first dev-overlay check accepted anything on a
  list; it now permits a development overlay only when the embedded credential is dev-shaped, and rejects a
  production-shaped one. A value whitelist is how a leak becomes blessed.
- **`CR_PAT` was classified `secret: false`** by the derivation because the name says "PAT" and the emitter does
  not know what a GitHub Packages push token is. It is now in the `HUMAN` table -- a judgement call in code, not
  hand-edited into a generated file, because the next `--emit` would silently drop it.
- **`PLATFOLIO_GITHUB_PRIVATE_KEY` had three spellings** (`_KEY`, `_KEY_PEM`, `_KEY_PATH`) for one credential.
  Two are gone: one name, contents, delivered as one registry entry. A second way to supply the same secret is a
  second thing to audit, and `readFileSync` left the composition root with it.

### Removed — every legacy shim, because we have not released

The maintainer's rule: no migration junk before a release unless our own deployment needs it. Deleted:

- **the `archetype` translation layer** (added hours earlier in D51): the IIFE that inferred `kind` from a legacy
  label, the `mode` inference from environment flags, the `legacy-archetype` warning, `metadata.legacyShape`, the
  validator gate that skipped rules for legacy documents, and the test asserting all of it. A document that still
  declares `archetype` now fails as an unrecognized key. **An unexercised compatibility shim is behaviour nobody
  has tested** -- and the shim had already been documented in three places as though it were permanent.
- **`PLATFOLIO_GITHUB_PRIVATE_KEY_PATH` and `..._PEM`**: aliases with no consumer outside our own repo.
- **`docs/design/03`'s archetype sections**, which still taught `api-service`/`full-stack-web` defaults, a
  "1-2 services" rule set, and `.env.example` as the variable list. Now: kind/mode defaults and rules, why
  counts were deleted (they described TreeDX and ArcNexus, our examples, not the platform), and the registry in
  place of `.env.example`. Dated research notes and the delivery plan keep their wording -- they are records.

### Changed — `PLATFOLIO_AUDIENCE` → `PLATFOLIO_OIDC_AUDIENCE`

Two similarly-named variables doing different jobs is a 401 that costs an hour: `PLATFOLIO_IDENTITY_AUDIENCE` is
who an *access* token must be addressed to for the API to accept it; the runner's *identity* token audience had
inherited the shorter name. Renamed at the reader, with both defined at the site.

### Changed — a platform is described by `kind` and `mode`, not by an archetype (D51)

The four labels `api-service | full-stack-web | worker | shared-service` were retired as authored input. Each
problem with them was concrete:

- **`shared-service` was a relationship wearing a shape.** A shared identity provider is a `web` platform in
  `hosted` mode that declares `spec.provides` — and D34 already modelled the offering. Keeping it as a fourth
  kind made the taxonomy a place where two different facts could hide.
- **`api-service` and `full-stack-web` encoded service *counts*** ("at most 2", "at least 2"). Those described
  our example manifests, not the platform, and they would have refused a tenant's legitimate third worker while
  passing a badly-shaped two-service mess.
- **The templates that are meant to be *changed* shipped with staging disabled.** starter-web and
  starter-worker are starting points, and a fork whose only environment is production has nowhere to put a
  change before it reaches users. That was reachable at all because nothing in the schema said
  "development implies staging".

What the schema says now:

| Field | Values | What it decides |
| --- | --- | --- |
| `metadata.kind` | `web` \| `worker` | direction. `web` must expose at least one host; `worker` must publish none |
| `metadata.mode` | `development` \| `hosted` | lifecycle. `development` requires staging; `hosted` forbids it |
| `spec.provides` | present \| absent | whether other platforms can bind to it — and it requires `kind: web` |

Rules that survive are about direction and lifecycle; the counts are gone. A `worker` that names a hostname is
refused; a `web` platform with no reachable service is refused (it would report live while nobody could connect);
`mode: development` without staging is refused with the reason in the message.

**Migration, not breakage:** a document that still declares `archetype` is *translated* (kind from the label,
mode inferred from the environments it declares), warned with `legacy-archetype`, and **the new rules do not
bind it** — recorded as `metadata.legacyShape`. Without that gate, renaming a field would have made every
existing manifest invalid on the version bump that introduced the new name, which is a migration that punishes
the tenant for the platform's change of mind.

**Templates aligned with platfolio (the architecture point behind the request):** starter-web and
starter-worker gained `compose.dev.yaml` overlays — local database, published ports, loopback credentials — so
a fork develops the way the platform itself does (`docker compose -f compose.yaml -f compose.dev.yaml up`). The
worker overlay **publishes no port**, because a dev file that exposed one would be the first place the kind
rule got quietly violated. shared-identity gets `kind: web, mode: hosted` and no dev overlay: nobody is
developing Keycloak in a fork, and a staging Keycloak is a second bill for no signal.

**Recorded as the gap it is, not fixed by improvisation:** the templates ship no image-publishing workflow, so
a fork cannot generate the `compose.prod.yaml` pin that `platform:plan` and the install path require. platfolio
has that mechanism (`.github/workflows/image.yml` plus `scripts/render-platform-overlay.ts`); the templates do
not. Filed as #217 rather than writing CI for three repositories in a commit that was already about the schema.

#### Measured: the flagship operation, on the real forge, through the git driver

`POST /api/v1/instances/{id}/plan/from-repository` was run against a live control plane reading
`fractalsynapse/platfolio` at a pushed commit:

```
status 200
planHash ba8a56216f38c9a44e5662af04d8ed935c15299d384975c0ea334799405ca606
  compose.yaml         blobSha=26aa66b27e0f317c189557079dfeed27aa90d93d  size=11752
  compose.prod.yaml    blobSha=ffb06d6313bdb270220d59b8fe71e41e6df5d197  size=863
instance state=pending  desiredPlanHash=ba8a56216f38c9a4…  templateRef repo=fractalsynapse/platfolio
```

Each blob SHA equals `git cat-file blob <sha>:<path> | git hash-object --stdin` computed locally, so the
identity the API cites is the content, not a provider artefact. The credential in the remote URL appeared in
the failure path as `https://[credential-redacted]@github.com/…` -- the masking held under a real attempt.

**Three wiring defects existed only in the gap between components, and the suite could not see any of them:**
`boot()` computed `config.scm` and never passed it to `createKernel`; the create-instance handler rejected the
`templateRef` the OpenAPI document declares and this operation requires; and the shipped image had no git
binary, so the driver's own classifier dressed a packaging problem up as a permissions problem. All three were
found by calling the endpoint. The lesson is recorded at each site, and the boundary test now asserts the whole
round trip so the pair cannot drift again.


### Changed — platfolio is described exactly like a tenant (D50), and `selfhost/` is gone

`selfhost/` was allowed to exist for one reason: to keep a hosted platform description from disturbing local
development. That reason outlived its validity. The cost was architectural — platfolio's own deployment used a
set of paths no tenant repository has, `open-install-pr.ts` defaulted `--platform selfhost` (which is how a dry
run against an unrelated tenant reported platfolio's own platform), and the templates' shape was never the shape
we actually ran. The project's first tenant is meant to be platfolio itself (09), and a tenant described
differently is not that tenant.

**Moved, with the same contents and the same semantics:**

| Before | After |
| --- | --- |
| `selfhost/compose.yaml` | `compose.yaml` (root) — build context `../../` → `.` |
| `selfhost/compose.prod.yaml` | `compose.prod.yaml` |
| `selfhost/.platfolio/environment.yaml` | `.platfolio/environment.yaml` |
| `docker-compose.yml` (root, an unrelated local stack) | `compose.dev.yaml` — now an **overlay** on the platform description |
| `scripts/selfhost-deploy.ts`, `render-selfhost-overlay.ts` | `platform-deploy.ts`, `render-platform-overlay.ts` |
| `pnpm run selfhost:plan / apply / overlay / overlay:check` | `pnpm run platform:…` |
| `open-install-pr.ts --platform selfhost` | `--platform .` |

The four platforms — the three templates and platfolio — now have **the same architecture**: `compose.yaml` +
`compose.prod.yaml` + `.platfolio/`. Development is a layer on top (`-f compose.yaml -f compose.dev.yaml`),
which is also the first time the overlay semantics the tenant guides describe have been exercised on our own
service: the dev file resets `KC_HOSTNAME`, `KC_HEALTH_ENABLED` and `KC_PROXY_HEADERS` with `!reset` rather than
leaving hosted values in the local topology, and adds the database container under the resource's own name
(`main`), so the platform file's `references` resolve without rewriting.

Recorded rather than smoothed over:

- **I typed `postgres:17.11@sha256:8s` into the dev file** — a garbage digest that `docker compose config`
  accepted syntactically. Caught by reading my own output before running it. A tag is correct there: the dev
  overlay is never deployed, and #84's pin rule is about what platfolio ships.
- **`instanceId: 'selfhost'` stays**, because it is not a path — the provider derives the Railway project name
  `platfolio-selfhost` from it, and that is the live project. Explained at the call site so the next cleanup
  does not "fix" it and start looking for a different project.
- The instance id and the directory name being the same string was itself part of the confusion. D50 breaks the
  coincidence; the comment records which one is load-bearing.
- `templates/README.md` was rewritten after finding it documented `platforms/` — a directory deleted earlier
  today — and listed `templates/` twice with contradictory meanings. That is what stale docs are for.

**Verified, not assumed:** `docker compose -f compose.yaml -f compose.dev.yaml config` resolves (reset keys gone,
commands and localhost env correct), the dev stack runs from the overlay, the smoke suites pass against it, and
`platform:plan` builds the same hosted plan it did before the move.

### Changed — testing happens on real projects, and the throwaway tenant is gone (D49)

The maintainer's rule, written into [AGENTS.md](AGENTS.md) and recorded as **D49**: every test that exercises a
deployed platform runs against `platfolio-starter-web`, `platfolio-starter-worker`, `platfolio-shared-identity`
or **`platfolio` itself** -- the three project types platfolio supports, plus the platform managing itself.
Extra projects were not merely untidy: a probe repository that works because it was hand-fitted proves nothing
about a fork, and every hour spent on it is an hour the real templates spend drifting.

- **`fractalsynapse/platfolio-e2e-tenant` is on its way out** (created ~2 hours earlier by me, for the install
  run). It turns out to have been unnecessary: the watched install can target `platfolio` itself, which is
  already in the App's installation selection and already carries the managed workflow -- so the answer to "what
  can't we do with the four we have?" is, measured: nothing so far. **The deletion has not happened yet.**
  `gh repo delete` was refused: *This API operation needs the "delete_repo" scope*, and the local CLI is not
  authorised for it. Outstanding until either the scope is granted (`gh auth refresh -h github.com -s
  delete_repo`) or the repository is removed in the UI. Writing "deleted" here would have been the exact habit
  this project keeps having to correct itself for.
- **Synthetic names no longer squat the publishing org.** Eight lines across
  `packages/contracts/{src/conformance.ts,test/github-writes.test.ts}` and
  `packages/manifest/test/fixtures/*` used `fractalsynapse/widgets`, `fractalsynapse/platfolio-template-web`
  and `ghcr.io/fractalsynapse/example-*` for things that never existed. A fixture indistinguishable from an
  asset is the worst of both: it looks maintainable and is nothing. They are `platfolio-fixtures/…` now, and one
  test needed its org, template and tenant owner made consistently distinct -- which caught that the fake
  template and the fake tenant had been the *same* org.
- **`checkCommittedProjects`** in `check-project.ts` fails the build when executable files (apps, packages,
  scripts, selfhost, templates, db, .github) name an org repository outside the four projects plus the two
  published image repositories. Falsified both directions: adding a stray project name gives exit 1 and one
  finding; the `platfolio-fixtures` pattern gives exit 0.
  The gate caught its own source comment first. I reworded the comment rather than add a self-exemption -- an
  allow-list that starts with "except the checker itself" is how a gate quietly stops meaning anything.
- **Prose is exempt, deliberately and by argument.** CHANGELOG and dated research notes still name probes that
  were deleted (`platfolio-probe-template`, `platfolio-status-api`). Rewriting history to satisfy a present-day
  rule trades one kind of drift for a worse kind: a record that flatters the current design.

Test *doubles* are untouched and the rule says why: `railway-mock`, `MemoryScm`, the fake provider, the
in-memory Store and the manifest fixtures are the second implementation that keeps a seam from becoming
accidentally provider-shaped (10 § The seams). The distinction the rule draws is **targets vs doubles** --
a real thing that exists only for tests is the defect; an in-process fake that costs nothing to keep honest
is not.


### Added — the missing middle is now an API operation, not a shell step (D48)

Two operations, designed in [apps/control-plane/openapi.yaml](apps/control-plane/openapi.yaml) before their
handlers existed, taking the surface from 30 to **32**:

- **`POST /api/v1/instances/{id}/plan/from-repository`** (`registerPlanFromRepository`) reads
  `compose.yaml` (plus `compose.prod.yaml`, if present) from the commit the instance already cites, parses it
  with the same manifest package the CLI and tests use, builds the plan, and records it. It cites the blob SHA
  GitHub reported for every file that contributed, so an operator can confirm the plan came from the bytes they
  pushed. Refusals keep their source: an unpinned first-party image comes back quoting the renderer (#84), a
  repository outside the installation's selection is **403** and a missing path is **400** -- #130's two
  failures, finally distinguishable at the boundary.
- **`POST /api/v1/instances/{id}/dispatches/{dispatchId}/trigger`** (`triggerDispatch`) asks GitHub to run the
  tenant's own workflow with the six inputs the rendered workflow requires, forwarding the provider's refusal
  because a run that never started leaves no logs anywhere else. A dispatch a runner already fetched cannot be
  triggered: that would send a second runner to collect a plan that is gone.

`ctx.scm` is a kernel service with `driver: 'none'` as its default; the composition root reads
`PLATFOLIO_GITHUB_APP_ID`, `PLATFOLIO_GITHUB_INSTALLATION_ID` and the key (contents or a mounted path), and the
manifest now *declares* those three by name so `selfhost-deploy --apply` refuses until they exist.

**What the design-first order bought, in print.** Between writing the spec and writing the handlers,
`api:check` reported both operations as *"the spec describes an endpoint that does not exist"* -- the direction
that only works if both are checked. Then:

- The renderer **refused my own test fixture** twice: first for omitting `environments.staging` and `preview`
  (the schema requires all three), then for a digest of `a`.repeat(64) -- #84's placeholder check, doing exactly
  its job on a test that wanted a shortcut. The fixture complied; the rule was not bent.
- The stub's first version matched the query string inside `URL.pathname`, which never contains it, so every
  contents read fell through to "unmodelled call" and the API answered 400. A transport stub can be wrong in a
  way that looks like an application bug; this one announced itself.
- `ctx.scm` failed with *`cannot get property "scm" without inject`* in three tests, because `requires` was
  added to the instances descriptor and not the dispatches one. Cordis's declaration discipline caught an
  omission that would otherwise have surfaced as a 500 on a real deployment.
- One assertion message went into `detail` as a template string, and the audit schema is a **record** --
  refusing it is correct: an audit row that must be read by eye is a log line wearing a schema. The nonce is
  asserted *absent* from audit, since it is the runner's single-use credential.

**Not yet done, stated rather than implied:** `open-install-pr.ts` still renders and opens the install PR
itself, still defaults `--platform selfhost`, and still reads a local filesystem. It is now a *client* of the
seam this change added, not the only way to reach a repository, but the D48 deprecation of its logic is open
work. Nothing deployed uses these operations yet -- the deployed control plane has no app credentials
configured, so today it would answer **503**, which is the honest answer rather than a hidden one.

**380 tests (9 new at the HTTP boundary), 0 skipped; `api:check` 32 operations both directions; contracts
baseline unchanged (no public TS surface moved); graphql, lockfile, docs, bundle and compose gates green.**

### Added — platfolio can read a tenant's repository and ask GitHub to run it (the middle of #172)

The control plane has always known how to turn a Compose document into an `InfraPlan`, and the runner has always
known how to apply one. What was missing was the step in between: platfolio could not obtain the document from a
repository it does not own, so "the tenant installed platfolio" reached "platfolio dispatched something" only
through a maintainer's shell, reading the maintainer's filesystem (`open-install-pr.ts --platform selfhost`).
Three operations close that, on the existing source-control seam rather than beside it:

- **`readRepositoryFile`** — one file, at a pinned ref, over the Contents API. It distinguishes the two 404s
  GitHub refuses to distinguish by making the second call (`repositoryVisible`): missing path versus an
  installation that cannot see the repository at all, which is #130's actual failure and was previously a
  guess. It refuses a directory listing, a submodule, and a file past GitHub's inline cutoff rather than
  deploying half a document. Blob SHA is GitHub's own (`sha1("blob <n>\0…")`), so a plan can cite the identity
  of exactly the content read.
- **`dispatchWorkflowRun`** — asks GitHub to run the tenant's managed workflow, with #149's measured property
  modelled: GitHub enumerates workflows from the DEFAULT branch only, so an unmerged install PR and a typo
  return the identical 404, and the message says both causes instead of picking one.
- Both mint a **per-operation installation token with the narrowest permissions that work** and revoke it in a
  `finally` -- D24's least-privilege rule applied to platfolio's own credentials, not only the tenant's.

**`MemoryScm`, `scm-conformance.ts`, and one suite run against both** (seam rule 3). Four things the suite caught
while it was being written, each of which was a bug in the implementation:

1. `constructor(readonly …)` parameter properties -- `erasableSyntaxOnly` refuses them, because these files run
   through Node's type stripping and nothing would have emitted the assignments.
2. **Token minting ignored the injected transport.** Reads were mocked, mints were not, so the "unit" test
   signed a fabricated app id and POSTed it to the real `api.github.com`. Any seam whose helpers can reach the
   network needs the transport threaded through *every* call, or its tests are partly live whether or not
   anyone intended that.
3. Revocation was asserted against the wrong URL. GitHub deletes a token at `DELETE /installation/token` (the
   token removes itself), not at the mint endpoint; the double's stub had invented the latter.
4. **A failure was being swallowed invisibly:** `revoke…().catch(() => undefined)` meant a broken revoke left no
   trace. It is now caught *with stated reasoning* -- the token is scoped and expires within the hour regardless,
   so residual exposure is bounded by construction -- and the lifecycle test is where an endpoint change shows
   up. Silent is not the same as safe.

One limitation recorded rather than papered over: GitHub answers the **same 404 with the same body** for a
missing path and for a ref that does not resolve. An earlier draft matched GitHub wording for "bad ref" that we
have never actually observed and would have reported a distinction the transport does not make. The suite now
only demands that the failed ref is **named in the message**, accepts either classification, and the code says
plainly that the regex is a guess about wording, not evidence.

Contracts: **additive → MINOR** (74 lines, nothing removed or tightened). 371 tests, 0 skipped; api:check 30
operations (unchanged -- no HTTP surface yet); docs gate green. This is the first of two changes: the seam now
exists, the next exposes it as OpenAPI-validated operations.

### Fixed — the install tool verified the action pin in the *tenant's* repository

`open-install-pr.ts` refuses to install unless the commit it is about to pin actually carries
`.github/actions/platfolio-managed/action.yml`. It asked GitHub for that path **in the tenant repository** --
so the check was "does the customer's repository contain platfolio's action file", which no tenant's will. It
therefore refused every real install, advising the operator to "land the action on the repository default
branch" of a repository that ships no actions, while passing on platfolio's own repository: the single case the
tool had ever been run against. Found by doing the thing it was written for -- opening an install PR at a fresh
tenant repository (#172's cutover).

- The pin check and the rendered workflow now read one `ACTION_REPO` constant (overridable by
  `PLATFOLIO_ACTION_REPO`), so they cannot drift to different repositories.
- **Two stale claims in the same file were retired.** It said the managed action "is not implemented yet, so an
  install PR merged today would produce a workflow that cannot run" -- true when written, false for months, and
  still the stated reason for `--draft`. The dry run now reports the pin as *verified*, which is what the check
  above actually establishes.

### Found — the install path cannot yet serve a stranger

The same dry run showed `platform : selfhost -> platfolio-control-plane@0.4.0` while targeting an unrelated
tenant repository: `--platform` defaults to this repository's own `selfhost/` directory and the manifest is read
from the **local filesystem**, never from the tenant repo being installed into. It also requires a generated
`compose.prod.yaml` next to it, so a platform with no published, digest-pinned image cannot be installed at all.
Both are properties of the runbook script, not the API, and they are the reason the first end-to-end install
through `api.platfolio.dev` is being run against a platform whose image we control. Recorded rather than
quietly worked around.


#### The install renderer was the real source of the hardcoded host

D47 started as "the workflow file names a generated Railway hostname", but the file every tenant fork commits
is **rendered** -- `packages/manifest/src/render-install.ts` wrote `platfolio_url: <the origin platfolio was
reached at>` straight into the install PR's workflow and its `PLATFOLIO.md`. So the mistake was not in one
repository's config; it was in the *mechanism that provisions every repository's config*. A template whose
workflow names someone else's deployment is a template nobody else can install.

- The rendered workflow now emits **`platfolio_url: ${{ vars.PLATFOLIO_URL }}`** plus a guard step that fails by
  naming the variable, because "empty URL inside the action" is a worse first message for a self-hosting
  stranger than "set PLATFOLIO_URL".
- The rendered `PLATFOLIO.md` **instructs** (set this variable to the origin given with your install request)
  rather than declaring. The origin itself travels in the install PR's body, which is ephemeral by nature.
- New assertion `commits no host (D47)` checks the variable form, the absence of the host from **every**
  rendered file, the guard step's existence, and that `PLATFOLIO.md` teaches without naming.
- **Worth stating plainly: nothing caught the original change.** An earlier run of this suite passed with the
  literal still being written -- 16 green tests that checked permissions, pins and inputs but never the one line
  that decides whether a fork is portable. The falsification here (restore the literal, watch it fail, restore,
  watch it pass) exists because a test that never went red is not yet evidence.


### Changed — an environment's endpoints are configuration, not committed source (D47)

Tracked files declared **generated Railway hostnames** in two shapes: the managed workflow pointed installs at
`{service}-{environment}-{hash}.up.railway.app`, and a bare routing hash had been copied out of a measured API
response into a test fixture and three research notes. A hostname of that shape identifies **one deployment** --
it changes when the service moves, and it is not something a tenant can be told to rely on -- so it cannot be
how a repository says where its control plane is.

- `.github/workflows/platfolio-managed.yml` reads **`vars.PLATFOLIO_URL`**, behind a guard step that names the
  variable when it is unset (an empty URL failing inside the action is a worse first message).
- `scripts/open-install-pr.ts` has **no default URL**: `--url=` or `PLATFOLIO_URL`, and an error saying both. A
  committed default points every install PR at whoever wrote it -- which is how the first one got there.
- **`checkCommittedEndpoints`** in `check-project.ts` fails on `{service}-{env}-{hash}.up.railway.app` and bare
  `{hash}.up.railway.app` in any tracked file. Falsified both ways: injecting the real host into the workflow
  gives exit 1; appending a bare-hash host to a doc line gives exit 1; removing them returns 0. Synthetic
  sentinels (`verify-target.up.railway.app`) and the provider's `.up.railway.app` **suffix** logic stay allowed
  on purpose -- the rule names a deployment, not the platform's vocabulary.
- Fixtures and research notes keep their structure with the host replaced by `<generated-railway-host>`. None of
  those findings depended on the specific random string, and the live value is one provider read away anyway.
  CHANGELOG entries and dated delivery notes were redacted the same way, not rewritten: history stays honest
  about what happened without carrying an address.
- Recorded as **D47** with a layout row in AGENTS and an operator section in [docs/MAINTAINING.md](docs/MAINTAINING.md).

**Two of my own mistakes, both in the making of this change.** My first "falsification" of the new gate was
worthless: the injection string had 12 spaces where the file has 10, so nothing was injected, exit was 0, and I
nearly recorded a passing test that had never run -- asserting the anchor before mutating is what makes
falsification mean anything. Then restoring a doc with `git checkout` discarded my own uncommitted redactions in
that same file and brought the hostname back, which the gate correctly reported. The tool that caught it was
written ten minutes earlier.


### Added — reference outputs you can trust (#198)

- **`references[].output` is now verified instead of hoped for.** The mechanism already existed — it names
  *which* variable on the database service to point at, which is exactly how a JDBC-style consumer gets host,
  port, database, user and password rather than one `postgresql://` URL. What was missing is that nothing
  checked the name exists, so a typo wrote a reference resolving to nothing and the service failed at boot
  blaming its own configuration. The provider now reads `environment.config` (names only; the API redacts
  values) and refuses with **`reference-output-missing`**, listing what *is* available — an actionable message
  instead of a mystery. Where the list can't be read, a `reference-output-unverified` note is recorded rather
  than the check being silently skipped.
- **The Railway double learned the template's real variable names** (`TEMPLATE_DATABASE_VARIABLES`, read from
  the live service), because a mock with an empty variable set makes the new check either vacuous or wrong.
- **platfolio's own composition now wires Keycloak by components** — `KC_DB_URL_HOST/PORT/DATABASE`,
  `KC_DB_USERNAME`, `KC_DB_PASSWORD` from `PGHOST/PGPORT/POSTGRES_DB/POSTGRES_USER/POSTGRES_PASSWORD` — and the
  step-7 test asserts that shape, including that no service is handed a whole URL it cannot parse.

### Found while making our own identity service start (each one cost a deploy to learn)

- **Railway's start command replaces the image command, it is not appended to an entrypoint.** A Compose
  `command: ['start']` became `/opt/keycloak/bin/kc.sh start`'s missing half: `start` isn't an executable, so
  the container exited instantly **with zero log lines** and looked like an opaque platform failure. Full path
  in the composition, asserted in the plan test.
- **Keycloak will not create the schema it is told to use** — `KC_DB_SCHEMA` produced
  `ERROR: schema "keycloak" does not exist` after a *successful* JDBC connection. The manifest format has no
  "create a schema" concept, so identity shares `public` while the control plane keeps its own schema (our
  migrator creates that one). The gap is real for any tenant whose JVM app wants a private schema and is
  recorded rather than worked around silently.
- **Keycloak's config build was OOM-killed** at Railway's default memory ceiling (`kc.sh: line 170: 82 Killed
  'java'`) before the schema error was ever reachable — now 2 GB via `deploy.resources.limits`.
- **Stale variables survive a changed plan**, by design: the provider never deletes configuration a tenant may
  have set by hand. That made pruning an explicit operator action, so `selfhost-deploy.ts` gained
  `--prune-vars=service.VAR` and `--redeploy=service` — without the redeploy, `applyPlan` is idempotent by
  `planHash` and a variable the plan no longer mentions would sit there winning forever (`KC_DB_URL` did,
  until it was deleted and the service restarted).

**Result, measured:** the identity service reports `SUCCESS` and Keycloak is initializing its schema over the
component DSN; the API service is `live`; `api.platfolio.dev` and `auth.platfolio.dev` now resolve as
unproxied CNAMEs to Railway and are attached, with certificate issuance still pending propagation (#199).
`verified` remains `false` — correctly, because the identity service had not settled healthy at the moment of
that apply and the provider refuses to round up.


### Fixed — a finished deployment was being reported as a running service

`SUCCESS` is a deployment outcome, not a process state, and the Railway provider mapped it to `live`. Found
because the maintainer looked at the Railway console and saw the identity service shown as **"completed"** —
which for a server is never an acceptable steady state. Measured on our own stack: Keycloak's container had
exited, its latest deployment read `FAILED` while an older `SUCCESS` deployment was still listed as active.

- `ServiceStateSchema` gains a **`stopped`** status and an optional **`rawStatus`**, so the normalized value
  ("not running") and the provider's own word ("SUCCESS") are both visible. Without `rawStatus`, an operator
  reading `stopped` cannot tell whether the platform exited cleanly, crashed, or was never deployed — which is
  the difference between a config bug and a crash loop.
- `RailwayInfraProvider` now reads `activeDeployments` and reports `stopped` when a service's last deployment
  succeeded but nothing is running. **`verified` can no longer be earned by a service that has exited**, and
  `applyPlan`'s wait treats it as terminal rather than polling a finished process until it times out.
- A regression the fix itself introduced, caught by checking reality rather than the test output: `applyPlan`'s
  other status query did not select the new field, so a *serving* control plane and its healthy database were
  reported `stopped` while `/healthz` answered 200. Absence of evidence is not evidence of absence — the
  downgrade now requires positive evidence (`activeDeployments` present and empty), and every query that reads
  deployment status selects the field.
- New falsification test (`railway-status.test.ts`): the same plan with nothing running reports every service
  `stopped`, `verified: false`, a failure recorded, and `rawStatus: 'SUCCESS`; with something running it is
  `live` and verified — the healthy path must still be able to say yes, or the fix is only pessimism.
- The Railway double gained a `completedOnly` option precisely because the real API returns this state. A mock
  that always invents an active deployment cannot express the bug, which is how it survived as long as it did.

Contracts classification: **additive → MINOR** (`stopped` and optional `rawStatus` add lines, remove none).
Worth naming as a gate limitation: the same widening applied to a `type X = 'a' | 'b'` union earlier today
classified as **MAJOR**, because that spelling replaces a line. A classification that depends on how a type is
written rather than what it means is a weaker gate than it looks.


### Changed — layout

- **`api/` is gone; each file moved to the thing it describes.** The directory held three unrelated kinds and
  two of them were a mystery to the person reading the tree, which is the definition of a wrong home:
  - `api/control-plane.openapi.yaml` → **`apps/control-plane/openapi.yaml`** -- the contract belongs to the app
    that implements it, and D41's "spec precedes handler" reads better when the spec is the first file next to
    the handlers.
  - `api/contracts.api.md` → **`packages/contracts/api.md`** -- it is that package's generated public surface,
    written by `check-contracts --update`.
  - `api/railway-schema.json` → **`packages/contracts/railway-graphql-schema.json`** -- captured evidence for
    the Railway provider that lives in that package, consumed by `graphql:check`.
- **`samples/` is gone.** Its two manifests were fixtures for the manifest package's tests and for
  [03](docs/design/03-manifest-spec.md), sitting at the top level where a reader reasonably assumes they are
  product surface; they are now `packages/manifest/test/fixtures/{web-app,full-stack}-manifest.yaml`, beside
  the tests that parse them, next to the rejection fixtures that already lived there. The `.platfolio/
  environment.yaml` they carried moved too -- and restoring it is in the "found by the gate" list below,
  because my first pass deleted it.
- **`.tmp/` was committed** (112 files) while debugging the self-host image build -- docker buildx config, npm
  caches, log tails. Untracked, ignored, and the reason recorded in `.gitignore` so nobody wonders whether it
  is load-bearing. This is the same class of mistake as the rest of this session's findings: a thing that exists
  because a tool wrote it there, not because the project chose it.

### Found by the gates, not by reading

- **Deleting `samples/` removed a file I had not noticed**: `web-app/.platfolio/environment.yaml`, an inventory
  fixture the renderer tests parse. Three test files failed on ENOENT within seconds of the move, the file was
  restored from git and relocated, and the episode is worth keeping in the changelog because it is the same
  shape as every other one this session -- a directory looked smaller than its references, and only the
  execution of the tests knew the difference.


### Added — platfolio hosted by platfolio (#172, first run)

- **`scripts/selfhost-deploy.ts`** deploys platfolio's own stack through platfolio's own machinery:
  compose + overlay → manifest → validation → plan → provider. Nothing was typed into the Railway console.
  Phases exist because identity is circular: deploy with Railway-generated hosts, read them back, then set the
  issuer/JWKS/hostname literals from what the provider actually granted. `--dry-run` is the default.
- **`scripts/render-selfhost-overlay.ts`** looks the image digest up from the registry instead of a human
  copying it, with `--check` as a drift gate (#146 for our own service). The overlay now pins
  `platfolio-control-plane:staging@sha256:54ce1c59…`, read from the `docker-content-digest` header.
- The self-host composition grew a second service and a shared database: `api` + `identity` (Keycloak 26.8.2,
  digest-pinned at authoring time) against one provider-managed Postgres, each selecting its own schema, wired
  by `references` -- the same mechanism a tenant uses, applied to us.

### Fixed

- **List-valued Compose `command` was silently dropped on its way to the plan.** `compose.ts` mapped
  `command → start` only `typeof command === 'string'`, so `command: ['start']` produced a service with *no*
  start command: the hosted Keycloak booted with no arguments and printed its own usage text. Found by
  deploying, not by reading -- the provider already had a correct `startCommand` path waiting for a value that
  never arrived. Arrays are now joined (whitespace-bearing elements quoted), asserted in the step-7 test.
- `selfhost/compose.yaml` had Compose-style `${VAR}` values that would have been shipped to the provider as
  literal nine-character strings: the renderer turns `environment:` entries into plan **literals**, so
  placeholders read as configured. Replaced with provider-resolved `references`, declared secret *names*, and
  literals -- and one override path (`--from-state`) that takes values the deployment measured.

### Notes

- **Deployed and verified live**: the control plane answers on a generated Railway host with an issued
  certificate -- `/healthz` ok, **`/readyz` reporting `database: ok`** (its schema was created and migrated by
  its own plan), `/version` reporting `commit: 8f01370` = staging head. `#172` stays open: **Keycloak does not
  boot yet** -- the shared-database `references` wiring yields a `postgresql://…` URL while Keycloak wants a
  `jdbc:postgresql://…`, which is a manifest-format gap (#198), and `api.platfolio.dev` /
  `auth.platfolio.dev` need one CNAME each at the registrar that holds platfolio.dev's zone (#199).
- The self-host step-7 test asserts the **opposite** of what it used to -- it previously proved the composition
  could *not* yet be planned. The inversion is recorded in the file rather than presented as if it had always
  passed.


### Added — **breaking** (team names)

- **Self-service team creation (#195, D44).** `POST /api/v1/teams` and `GET /api/v1/teams`. Until now the only
  way a team existed was a seed script, so D44's "adding a teammate cannot be an admin task" had an unstated
 premise: *creating* the team was an admin task too. The caller becomes **owner** in the same operation, because a
  team nobody owns cannot invite, share, or destroy anything and has no way out of that state. Creation is
  deliberately **not** a row in `POLICY`: that table answers "may this person do this **in that team**", and
  inventing an entry with no team to apply it to would stretch the table past what it means.
- **The destroy route (#196, D43).** `DELETE /api/v1/instances/{instanceId}` — the caller #176's `consumers`
  query and #178's owner-only `instance.destroy` policy were both built for. **409 naming the dependants**
  while anything consumes the instance, not 202-with-a-warning: an API that says yes to a destructive operation
  it knows is unsafe has made the tenant's outage its own. Scope is stated in the document — managed service
  only, never a repository, branch or workflow (D36 extended by D43).
- `30` operations, `api:check` green in both directions; `SLUG_PATTERN` / `normaliseName` live in contracts and
  are used by the schema, both drivers and the OpenAPI document, rather than three hand-copied versions.
- `lifecycle:smoke` grew nine checks: the destroy refusal, the refusal naming the dependant, the accepted 202,
  its "recorded, not executed" wording, team creation, normalisation, collision, non-slug refusal and the
  caller's own team list. **38/38 live.**

### Changed

- **Team names are slugs and platform-unique** (`teams_name_slug_check`, `teams_name_unique` in migration
  `011`). D45 makes `team/name` the address of an instance, so the team half is a URL segment and a CLI
  argument: two teams named `Acme` would make `acme/shop` ambiguous and undo the naming decision one layer
  above the one it was made about. **BREAKING** for a name like `Acme Corp` — tightened on purpose, and
  acknowledged through `check-contracts.ts --ack-breaking` rather than waved through as an additive line.
- The Postgres conformance suite gives each case a unique team name. Its cases share one scratch schema, so a
  literal name now collided with the previous case's row: the uniqueness rule and the fixture isolation had to
  be reconciled deliberately, not by relaxing either.


### Added

- **Invitations (#186, D44), five operations designed in the document before any handler existed** (27
  operations, `api:check` green both directions): an owner invites by address, the invited person discovers
  what is addressed to them by signing in, and acceptance grants the invited role. `invitations` (migration
  `010`) is a record **apart from membership** -- inviting someone creates no person, no identity and no role,
  because "invited" must not be indistinguishable from "allowed".
- **No token in the link.** Acceptance matches the invitation against the address the *identity provider
  asserts* on the caller's token (`email` / `email_verified`, added to `VerifiedClaims` and read from the JWT
  and never from a body field). A forwarded invitation email therefore grants its reader nothing -- and D46's
  root-of-trust problem, "someone received mail at this address", is not reintroduced by the claim flow. An
  identity that asserts no verified address is answered **409 with that reason**, not an empty list: "nobody
  invited you" and "nothing can match you" are different answers and only one is actionable.
- Delivery is a fact on the row, not a log line: `emailReceipt` / `emailError` record what the transport said,
  and `createInvitation` reports creation and delivery separately -- a created invitation whose mail failed is
  still an invitation, and returning 500 for it would destroy the record that makes "we never got it"
  answerable.
- `pnpm run invitations:smoke`: Keycloak issues both tokens, Postgres holds the rows, the control plane
  container speaks SMTP to Mailpit, and the message is read back out of Mailpit to prove the correlation header
  travelled and no capability secret was in the body. **17/17 live.**

### Changed

- **The email capability is now always installed, defaulting to a `none` driver.** The first version installed
  it only when configured, and an extension that declared `email` in `requires` then lost its **routes** -- an
  operator who forgot SMTP got 404 on an endpoint that exists, with nothing in the log. A capability that may
  be absent is a value, never a hole in the route table.
- `normaliseEmail` (trim + case-fold) lives in contracts and is used by both drivers and the acceptance policy.
  The two drivers had each been lower-casing without trimming, and Postgres did not age expired rows on read
  while the double did: the shared suite caught both, and `ageRow` makes the answer identical.
- `invitation.list` and `invitation.revoke` join the owner-only set in `POLICY`, because a pending invitation
  carries an email address and a member-visible list is a people directory nobody asked for. The policy
  tripwire test failed when this was added, which is the intended behaviour of a test that names the decision.


### Added

- **Platform email is a capability seam (#187, D46)**: one `EmailTransport` interface in contracts, three
  drivers chosen by configuration -- `smtp` (a hand-written client over sockets, no new dependency), `mailpit`
  (HTTP), `memory` (the double) -- plus a single conformance suite that both readable drivers run. Nothing in
  the control plane knows which one it is talking to, and an unconfigured control plane has **no sender at
  all** rather than a defaulted one.
- **`MailboxReader` is a separate interface, not a method on the sender.** Mailpit and the double can answer
  "what landed in the mailbox"; a production relay cannot, and `ctx.email.readable` says so. That separation is
  the difference between a seam and a leak: tests may assert on a mailbox, and a deployment cannot acquire the
  same power by picking a driver.
- **Mailpit in the local stack** (`axllent/mailpit:v1.24.0`, UI :8025, SMTP :1025) and `pnpm run email:smoke`,
  which sends through the *real* SMTP client to the *real* server and reads the message back over HTTP --
  subject, body and correlation header all verified as delivered. **9/9 checks pass live.** A CI job now runs
  it on every merge to `staging` and `main`, because a hand-written protocol client is exactly the code that
  should not be proven only against a mock.
- `pnpm run email:smoke` and the eleven email/SMTP/kernel service tests (18 in total across the three files).

### Fixed

- **`SIZE 0` means "no limit", and my client read it as a limit of zero** -- every message was refused as
  `payload-too-large` against the first real server it ever talked to. RFC 1870 is unambiguous; the scripted
  test server advertised a real size, so nothing caught it until it met Mailpit.
- **Mailpit's `query=to:` filter cannot be trusted for correctness** -- it returned unrelated messages, so an
  assertion on "the invitation was sent to this address" would have been reading somebody else's mail.
  Recipients are now filtered locally after parsing.
- **The Mailpit driver was written from an imagined API and rewritten from measurement**: `Email` not `Address`,
  `Text` not `PlainText`, headers as a map, `Reply-To` refused inside `Headers`, `/api/v1/messages` rather than
  v2, no body in the list, no headers in the detail, and the correlation id observable **only** in
  `/api/v1/message/{id}/raw`. The unit fake was rebuilt from the same probe output so it no longer tests an
  invention.
- The email service now augments `Context` like every other kernel service (`ctx.email` is typed, not
  discovered), and its config is an input type so operators can omit the defaults.


### Fixed

- **A container that listened but served nothing.** `apps/control-plane` only installed the Store service when
  `PLATFOLIO_DB_URL` was set; with no database configured the plugin never ran and boot died with
  `required capability "store" is not present` -- true, and useless, because the cause was a missing line of
  configuration, not a missing plugin. The in-memory double is now selected explicitly and announced with a
  warning ("this is development, not a deployment"), which is what [selfhost/compose.yaml](compose.yaml)
  and the docs already claimed happened.
- **The image was missing two runtime directories.** `api/control-plane.openapi.yaml` is read at request time to
  validate responses, and `db/migrations` to migrate; neither was copied, so a built container 500'd with ENOENT
  on the first validated request. Both are copied now, and `image.yml`'s build-context check asserts their
  presence -- because `docker build` succeeds happily without them.
- **`/version` answered 500 on any container run without build args.** The Dockerfile's ARG defaults were
  `unknown`, inherited from the deleted service, while the published schema requires a hex commit and a
  date-time build time -- so the contract was violated by the image's own defaults. They are now epoch-and-zeros:
  unmistakably synthetic, and valid. The OpenAPI gate caught a latent defect that CI had never exercised,
  because CI always passes the args.
- The CI smoke no longer stops at `/healthz`, which only proves a listener: it now asserts `/version` answers
  with build identity and that an unauthenticated data route answers **401** -- a mounted, guarded API. Both of
  the bugs above passed the old smoke.

### Removed

- **`apps/status-api` is deleted: one API, the real one.** It was the first-draft service that predated the
  OpenAPI-validated control plane, and keeping it meant two request paths where only one was checked against
  the specification (D41) -- the duplication the layout rule exists to prevent, with an endpoint surface instead
  of a file. `apps/control-plane` already serves everything the managed action calls (`/api/v1/instances/…/dispatches/{id}`
  and `/api/v1/attestations`, both nonce-bound rather than user-scoped), so nothing in the contract moved.
  **The deployed Railway container keeps running the deleted service's image until #172 replaces it**; that is
  stated rather than glossed, because the end-to-end dispatch loop proven against it cannot be rebuilt from this
  tree anymore, and a reader of this changelog should know which evidence still describes reality.
- The build pipeline moved with it: `image.yml` now builds `apps/control-plane/Dockerfile` (the battle-tested
  single-stage status-api Dockerfile, adapted, with its hard-won comments intact), publishes
  `platfolio-control-plane`, and gained a **fail-closed check** asserting the container refuses to start without
  identity configuration. Its smoke test boots against a shape-only JWKS and proves boot, health and build
  identity -- **not** signature verification, which is proven against a real Keycloak in the Compose stack and
  in the live tenant run.
- `selfhost/.platfolio/environment.yaml` described variables the code never reads (`SESSION_SIGNING_KEY` -- there
  are no platform sessions; `PUBLIC_ORIGIN` -- nothing reads it) and called the JWKS URI optional when the control
  plane refuses to start without it. Rewritten from what `apps/control-plane` actually consumes: a stale inventory
  is worse than none, because an operator trusting it ships something that cannot boot.

### Fixed

- **`selfhost/compose.prod.yaml` was pinning bytes nobody can account for** -- a real digest of the deleted
  service's image. It now carries **no `image:` line**, and the step-7 test asserts the consequence
  (`compose-image-unpinned`, no plan) instead of pretending otherwise, while a separate block proves the
  *format* renders using the SHA-256 of the empty string as an unmistakably synthetic pin. Writing a placeholder
  digest would have been the same mistake in a new costume, and `buildPlan` already refuses them (#84) -- which
  this change discovered by having its own test rejected by its own guard.


### Removed — legacy sweep

- **The repository was carrying dead declarations, and 29 of them are gone.** `noUnusedLocals` and
  `noUnusedParameters` are now **on in the root tsconfig**, so they cannot grow back: an intentionally unused
  parameter is prefixed `_`, which is the convention the compiler honours rather than a comment asserting the
  value is deliberate. Removed: an unused `PoolClient`-based `withClient` helper in the Postgres driver, the
  `StoreFacade` alias (a second name for one thing), `StaticRailwayCredentials` and
  `TEMPLATE_REPO_BODY_CONSTRAINTS` (both unreferenced anywhere, including the workflows and docs), a dead
  `_LABEL` map in the binding panel, an unused `ROOT_FIELD` regex in the schema gate, and a `validateManifest`
  line that stringified its input for a message format that no longer exists.
- **`packages/kernel` declared a dependency on `@platfolio/manifest` and never imported it.** A D15 violation
  sitting in the manifest of the package whose whole rule is that it may not know about manifests. Removed, and
  the lockfile regenerated.
- Four test values were being computed and then **never asserted on** -- worse than dead code, because each one
  looked like coverage. Three are now real assertions (a rotated supplier value must surface on every consumer
  of it; the current-state binding panel is walked as well as the stale one; the republished offer must be the
  same offer). The fourth could not be asserted honestly: `validateManifest(withArchetype('shared-service'))`
  on the *web* template never fires the rule, because that template has a reachable service -- the variable was
  dead precisely because the fixture proved nothing. The real cases for that rule already existed below it, so
  the vacuous fixture is gone with a note explaining why asserting on it would have been wrong rather than
  merely unused.

### Fixed

- During the sweep I dropped a destructured `writes` from a harness call in `github-writes.test.ts` while
  removing a genuinely unused one two lines away; typecheck caught it in the same pass. The lesson is that
  "delete the dead thing" needs the call site read, not the line.


### Changed — **breaking**

- **`Instance.platform` is now `Instance.template` (#180, D45), and instance names are `team/name` slugs.**
  The old field stored a template id under a name that meant three different things in this codebase; the
  rename reaches the public API document, the request body, both store drivers and `InfraPlan.manifestRef`,
  which carried the same collision. An old payload is **refused, not ignored** -- a request still sending
  `platform` fails validation instead of silently dropping a field, which is the difference between a rename
  and a data-loss bug. Names must satisfy the slug pattern declared on `InstanceSchema.name` (lowercase alphanumerics with interior hyphens, 1-80) and are **unique per team**
  (`instances (team_id, name)`), enforced in the schema, in Postgres and in the in-memory double.
  `templateRef: { repo, commitSha }` records where a template came from, with `commitSha` constrained to a
  full lowercase hex commit by both the schema and a database CHECK: a tag or branch is a movable anchor, and
  D30 law 3 says it cannot be stored as a fixed one.
  **Derived contracts bump: MAJOR** (12 public surface lines removed). Accepted now because there is no tenant
  on either service (AGENTS status) and nothing outside this repository consumes the field yet.
- **`Instance.state` is a rollup, not the truth (#179).** Production's state when a production environment
  exists, otherwise the worst among the environments, `pending` when there are none. `GET /api/v1/instances*`
  now returns `environments: [{ environment, state, appliedPlanHash?, attestationId?, updatedAt }]`, so a
  client never has to guess whether the headline number is production's reality or a blend of everything.

### Added

- `instance_environments` (migration `009`), `Store.setInstanceEnvironment` / `getInstanceEnvironment` /
  `listInstanceEnvironments` in both drivers under one conformance case, and `rollupState()` in contracts --
  the rule lives beside the schema rather than inside whichever driver noticed it first.
- **`check-contracts.ts --update` now classifies changes** and refuses to refresh the baseline over a removal
  without `--ack-breaking="<reason>"`, printing the derived bump. Previously it wrote whatever the diff
  contained and exited 0, so this exact breaking rename would have passed as a routine refresh.

### Fixed

- A precedence bug in the in-memory driver's new patch semantics: `a ?? b === undefined` parses as
  `a ?? (b === undefined)`, so the merged field was dropped precisely when the caller *supplied* it. Caught by
  the conformance suite; introduced while fixing a different bug in the same three lines.
- Both drivers had disagreed on upsert semantics (the double replaced the row, Postgres preserved untouched
  columns). One suite, two drivers: the disagreement is the suite doing its job, and preserving provenance is
  the behaviour the rollup depends on.


### Added

- **The policy module (#178, D43).** `packages/contracts/src/policy.ts`: one table mapping each action to its
  minimum role, and one `decide()` that every scoped route asks. Handlers no longer compare roles, so `owner`
  and `member` finally differ -- `capability.share` and `instance.destroy` are owner-only, and the second is
  asserted now even though the destroy route does not exist yet, so it cannot ship looser than the decision.
  Two different answers by design: a non-member gets 404 (existence is not theirs to learn), an under-roled
  member gets 403 naming the role that would suffice -- they can already see the resource, so advice beats a
  mystery.
- A build-time action registry lets a test walk the routes and assert **every operation names an action** and
  **every action in the table is exercised**, so the coverage is over the surface that exists rather than over a
  hand-kept list that drifts.
- **D46** recorded: platform email goes through a configured **remote SMTP provider** in staging/production and
  **Mailpit** in the local Compose stack, with sending asserted through Mailpit's message API in tests
  (#187). Option A stands for identity -- the IdP asserts whether an address is verified, so platfolio does not
  build its own proof-of-ownership flow; an invitation is an offer of membership, not evidence of an address.

### Fixed

- Two actions had no registered route (`instance.create`, `audit.read`) because their handlers resolve a team
  from a body or filter a list instead of going through the wrapper -- caught by the coverage test the change
  itself introduced. Registration first lived inside the handler body, so it only recorded actions whose
  endpoints a test happened to hit: a green assertion that depended on test order.


### Added

- **Persons and identities (#177, D44).** `persons` and `identities (issuer, subject) → person_id`
  (migration `007`), and membership rekeyed from a bare `sub` onto the person. Two realms that mint the same
  subject string are now provably two people: the conformance suite asserts it against **both** drivers, which
  is the only reason the claim means anything. A person may hold several proofs, and unlinking one leaves their
  teams untouched -- removing an SSO connection must not silently revoke membership while another proof stands.
  `kind: 'service'` lets a machine client be a member through the same path as a human, because a second
  authorization scheme for tokens is how a platform grows a back door with different rules.
- `GET /api/v1/me` -- the person behind a verified token, their proofs, and the teams membership grants. The
  CLI's first question, and the issuer comes from the verified claims rather than the request.

### Fixed

- **A migration constraint that silently did not apply, caught by the second driver.** `007` guarded its
  foreign key with an unqualified `pg_constraint` lookup, which matches a constraint of that name in **any**
  schema. The conformance suite migrates into a fresh scratch schema while the application schema already
  exists in the same database, so the guard saw the other schema's constraint, skipped, and Postgres began
  accepting memberships for people who do not exist -- while the in-memory double refused. Both drivers pass one
  suite, and that disagreement is the suite doing its job. The check is now scoped to `current_schema()`.
- **Membership seeding is resolved, not inserted**: `db:seed-dev` derives the person from
  `(issuer, subject)` the same way the request guard does. A membership written against any other key would
  seed cleanly and be invisible at request time.


### Added

- **Capability bindings are records (#176, D42).** `capability_offers`, `capability_shares` and
  `capability_bindings` (migration `006`), `Store` methods for both drivers, and the shared
  `checkBindingPolicy` that gates them -- one function, so no driver can drift on a security decision. Eight
  operations designed in the OpenAPI document before any handler existed (21 operations now, `api:check`
  green in both directions). This makes two previously impossible questions answerable: *what does this
  platform depend on*, and *what breaks if I remove it* -- the latter being the whole reason #106 and #107
  were opened.
- Cross-team sharing is explicit (D42): a capability reachable is not a capability offered. Revoking a share
  ages existing bindings to `stale` instead of deleting them, and withdraws discovery -- a running application
  keeps working while the intent is withdrawn, and the dependency stays visible rather than silently wrong.
- `self-binding refused`, `destinations the provider does not publish refused`, and `unbind answers 204 with
  no body` are now transport behaviour rather than convention: a 204 carrying `null` is a lie clients
  special-case.

### Changed

- **Decisions recorded from the maintainer's answers: D42-D45** -- teams may share services via explicit
  grant; `destroy` is owner-only and destroys the managed service only (never the repository, D36);
  invitations and self-service team creation are in scope for an open SaaS; instances are addressed
  `team/name` with repository-style slugs, unique per team and enforced in the schema.
- Two tests that snapshotted the API's operation list now **derive** it from the document (with a floor rather
  than an equality), because a test that must be edited every time the API grows deliberately is a test that
  gets skipped.


### Added

- **[17 § Object model](docs/design/17-object-model.md)** — the plain-English version of persons → teams →
  instances → templates, and what "shared" actually means (an instance that provides a capability, not a third
  kind of object). Every relationship is labelled **implemented**, **contract-only**, or **absent**, because
  extensibility is only a claim until it is checked against the schema. Added to the AGENTS.md canonical
  locations table so an agent meets it before inventing a fourth entity.
- Six issues from that reading, each executable and sequenced ahead of the first API/CLI release: bindings
  are not records (#177), person identity is a bare `sub` from one issuer (#178), roles exist but nothing
  enforces them (#179), state is per instance while tenants run two environments (#180), `Instance.platform`
  is a template id in a field called platform (#181), and four decisions the model should not answer by
  accident (#176).


### Fixed

- **Audit rows addressed to a dispatch were invisible to authorization.** `dispatch.create` recorded its
  target as the dispatch id, while the audit list filters by instances the caller's teams own — so a
  team member could not see an action their own team had taken. Found by the filter, not by eye: audit
  targets are now the team-owned instance, with the dispatch id in `detail`.
- **A `typecheck errors: 0` reading was false.** It came from grepping the output of a `pnpm run` whose
  wrapper had already died on the sandbox's unwritable engine store, so there were no TS lines to count.
  Measured with `tsc` directly from here on (documented in MAINTAINING).

### Added

- **Team membership and the authorization boundary (#173).** `Store` gains `putTeamMember`, `getTeamMember`,
  `listTeamMembers` and `teamsForSubject` (implemented by both drivers, covered by two new conformance cases);
  migration `005_team_members.sql` keys membership on the IdP's `sub`, not a username or email. In
  `apps/control-plane`, team-scoped routes are built with a `scoped()` wrapper that resolves authentication and
  membership **before** the handler runs — handlers receive a scope or never execute, so forgetting the check
  is not available. Cross-team reads answer **404, not 403**: a 403 confirms the record exists, which is a
  finding an attacker can enumerate. `GET /api/v1/instances` and `/api/v1/audit` are filtered by the caller's
  teams; a caller with no teams sees an empty list, the same shape a member of an empty team sees.
- `db:seed-dev` resolves the subject id from Keycloak rather than hard-coding one, and creates a second team
  with no members so the cross-team refusal can be proven live instead of asserted.
- A route-table-driven test walks every instance-scoped operation and asserts the non-member gets 404, so the
  next such route fails CI if it skips the guard.

### Changed

- **Repository layout, following the duplication through to its cause.** `platform-templates/` is now
  `templates/` (the only thing that is a template, published into the organization's repositories); the two
  illustrative manifests under `templates/example-*` are now `samples/web-app` and `samples/full-stack`
  (inputs for tests and [03](docs/design/03-manifest-spec.md), never templates); platfolio's own deployment
  description moved from `platforms/platfolio/` to `selfhost/`, which is what it always was -- a first-party
  deployment, not a catalog entry with one member.
- **One service definition instead of two.** `apps/status-api/compose.yaml`, `compose.prod.yaml` and
  `compose.dev.yaml` are deleted: the first duplicated `selfhost/compose.yaml` line for line with only its
  comments differing, and the two `compose.prod.yaml` files were **byte-identical**. That duplication is why
  every image pin had to be regenerated in two places, and why a forgotten second file would have quietly
  deployed a superseded digest. The app keeps its Dockerfile and source; deployment shape lives in `selfhost/`.
- **Deleted the dead realm file** `platforms/platfolio/identity/platfolio-realm.json` -- zero references, and
  Keycloak 26.8.2 would not import it (#168). The realm is created by `identity:seed`, which works.
- `examples/` is untouched and remains gitignored: it holds reference clones (the Cordis checkout, a
  scaffold), not platfolio's own material. Earlier entries in this file describe the layout as it was when they
  were written and have deliberately not been rewritten to match.


### Added

- **Slice 2 (#162): the control plane has records, and they are a capability.** `packages/contracts` gains
  `Store` (teams, instances, repo/provider connections, plans, dispatches, attestations, audit), a Postgres
  implementation with migrations under `db/migrations/`, and an in-memory double -- both running the same
  conformance suite, which is what makes "swappable" a tested claim rather than an interface with one driver
  (D15, docs/design/10 OD8). Acceptance policy lives in one pure function, `checkAttestationPolicy`, shared by
  both: a security decision must not be re-implemented per driver.
- **`apps/control-plane` is composed from capability plugins** (`packages/kernel/src/extension.ts`): each
  surface declares its routes and its `requires`, and the kernel turns that data into a fiber. The app never
  imports the framework; D15 holds while "everything is a plugin" stays true rather than aspirational.
- **A controller that consumes attestations.** An accepted `ok`/`noop` moves an instance to `live`, `partial`
  to `degraded`, `failed` to `failed`, and the transition is written to the audit trail with the controller as
  actor. This is the missing caller #123 reported for `runState`.
- **`/readyz` reports `degraded` for an in-memory store even when it answers**, and `not-configured` for a
  dependency that is absent. Neither is a silent green.
- One Postgres instance, two schemas (`platfolio`, `keycloak`) in the local stack: the consolidation asked
  for, without two owners in one namespace, since Keycloak auto-migrates its own tables (D40, docs/design/05).
- `api:check` covers the 13-operation surface; CI runs the Postgres conformance as its own job, so the second
  implementation cannot skip itself.

### Found by the OpenAPI gate, in the request path

- **Postgres timestamps were stringified `Date` objects** (`Wed Nov 11 2026…`), which is not RFC 3339, so
  every instance and dispatch response was refused as `response-violates-spec` -- a bug no fake-store test
  could see, because the double never returns a `Date`. Fixed with one normaliser at the driver boundary.
- **The document was missing the 400 paths** the handlers can legitimately take, and one `allOf` + 
  `additionalProperties: false` composition made a correct response unsatisfiable. Both fixed in the spec.

### Fixed in my own work, worth the listing

- A `createKernel` rewrite **lost the `custody.attachPorts` line**; the kernel test caught it by counting
  provider writes. Restructuring a working function is not free, and the assertion that fails is the one to keep.
- **A failed boot leaked a listening socket and a running controller interval**, which presented as a hung test
  suite rather than an error. `createKernel` now disposes on failure, bounded so teardown cannot mask the
  startup error someone needs to read.
- Capability descriptors under-declared `requires` and the framework refused the property at request time
  (`cannot get property "identity" without inject`) -- correct behaviour, my bug, and the reason dependencies
  are declared per capability rather than assumed globally.
- Root scripts importing `pg` directly re-created the ambient-dependency trap already documented for `ajv`;
  both scripts now go through the store capability, which also makes the persistence check cross-process.

### Verified live

- **Slice 2, 15/15 (`pnpm run lifecycle:smoke`)** against the running stack: real database, real Keycloak
  token, instance created `pending`, plan registered by its own digest, dispatch issued and fetched once
  (second read `409 nonce-consumed`), attestation accepted and unreadable-to-no-one (`202`), duplicate
  refused, **the controller moved the stored row to `live`**, controller attributed in the audit trail, and
  every record read back from a *second process* to prove it is a row and not memory.
- Slice 1's `identity:smoke` still passes 12/12 on the same stack.


### Added

- **Slice 1 (#161, #168): platfolio has a service with real verified identity.** `apps/control-plane` boots on
  the vendored Cordis runtime through `createKernel` — `ctx.identity`, `ctx.server`, `ctx.infra`,
  `ctx.custody` — with `@platfolio/kernel` as the only place that imports the framework. `docker-compose.yml`
  brings up Postgres + Keycloak 26.8.2 + the control plane; `pnpm run identity:seed` creates the realm through
  the Admin API; `pnpm run identity:smoke` asserts the chain live (12/12).
- **`identity.provider` as a Cordis capability**, `requireServices` as a startup assertion, and
  `@platfolio/api-contract` — the OpenAPI document compiled into validators, with `api:check` wired into
  `verify`. Responses are validated in the request path, not only in CI.

### Fixed

- **The API gate could not explain its own rejections.** Ajv's `errors` were captured by destructuring before
  `validate()` ran, so every rejection came back with an empty list; `/version` answered
  `500 {"error":"response-violates-spec","message":"getVersion 200: "}` — a gate that cannot state a reason is
  a gate the next engineer turns off. Errors are read after the call, and a test now demands three reasons
  from a body that is wrong three ways.
- **403 was unreachable because authorization lived inside authentication.** Passing `requiredScope` into the
  verifier made a genuine-but-unscoped token fail as *unauthenticated*, so the spec carried a decorative status
  code. Verify who, then decide whether they may.
- **`PLATFOLIO_COMMIT` in compose was read as a number** — an unquoted all-zero scalar — which failed the
  spec's hex pattern. The fourth YAML-scalar defect in this project; the compose file now quotes it and says
  why.

### Learned about the framework (and corrected)

A missing dependency does **not** produce the silent `PENDING` hang described in the reference-tree research:
the property is absent and `ctx.inject` resolves regardless. `requireServices` therefore asserts *presence*
and states that presence is not ACTIVE. Keycloak's `--import-realm` rejected role mappings in every shape
tried (`clientRoles` on a client, `federated` on a user, realm-level `clientMappings`), and its admin API
`?export=true` returns realm settings without clients or users, so the realm is seeded by script (#168).


### Added

- **The `identity.provider` seam (#161, Slice 1).** `packages/contracts/src/identity.ts` defines a verifier
  whose only job is to turn an untrusted string into verified claims or refuse: exact-issuer match, required
  audience, `exp`/`nbf` with a bounded clock-skew window, non-empty subject, optional scope enforcement, and
  claims that leave the verifier allow-listed — an unknown claim never escapes. The allowed algorithm set is
  checked **before** any key lookup, so `alg: none` and HMAC-with-the-public-key (algorithm confusion) are
  refused structurally rather than by luck. `JwksIdentityProvider` is the production class with a TTL-cached,
  rotation-tolerant key source (`fetch` injected, so the same code runs in CI without network);
  `StaticKeySource` is the conformance double.
- **The identity conformance suite**, run identically against the production provider and the double, with
  **two negative controls**: a provider that only decodes, and one that echoes every claim. Each must fail,
  and the specific cases it must fail are asserted by name — the second control exists because my first draft
  wrongly demanded a leakage failure from a provider that does not leak. Additive surface, so the contracts
  bump is minor (baseline 1063 → 1088).


### Verified live

- **A dispatch launched by GitHub Actions, end to end (#123).** `workflow_dispatch` started a runner in
  environment `production`; the committed action bundle authenticated with the shared dispatch token, carried
  its GitHub-minted OIDC token, fetched the plan, applied it through the real provider, and the attestation
  was **accepted and stored** (`ok`, one resource live, 884 ms) — independently confirmed by a `readState`
  showing the service on the pinned digest. Six defects stood in the way, each found only by running: an
  unparseable action manifest, a workflow aimed at a 404 host, a pin naming a commit without the action,
  composite inputs that never reached the process, a missing provider workspace coordinate, and a control
  plane running a build from before the plan-hash fix.
- Two things this does **not** prove, filed rather than glossed: the runner's identity is recorded and not
  verified (#159), and the attestation's release fields read `0.0.0-dev` because pins still come from a
  laptop, not a release job (#146).


### Fixed

- **`.github/actions/platfolio-managed/action.yml` did not parse.** The `outputs:` values held `${{ … }}`
  unquoted inside a flow mapping, so the brace opened a nested mapping and GitHub's runner died at
  `Set up job` with `Unexpected type '' encountered while reading 'action manifest root'` — an error that
  names neither YAML nor the line. The first dispatch GitHub actually launched failed there. Quoted.
- **`check` never looked at action manifests.** Workflows were linted; `action.yml` was not, so a file the
  runner must parse was outside the only gate that would have caught this. Now validated: parse, required
  keys, `runs.using`, composite steps needing `run`/`shell`, and the same placeholder-balance rules — with the
  failure mode described in the message, since GitHub's own is useless.


### Verified live

- **The dispatch chain runs end to end against the deployed control plane** (#123): plan registered,
  single-use dispatch issued, the committed action bundle fetched it, applied it through the real provider,
  and its attestation was accepted and stored (`result: ok`, 1 live resource, 1080ms, matching plan hash);
  replaying the consumed dispatch returned 409. The control plane now serves the build at `staging`'s head.
  Still unproven: a dispatch actually launched by GitHub Actions, and real OIDC/JWKS verification — the
  runner was executed from a shell with a locally minted stand-in token.


### Fixed

- **The dispatch API had a second, competing plan-hash implementation.** `buildPlan` computes a plan's digest
  once and the plan carries it; `dispatch-api.ts` re-derived its own canonicalization instead. The two
  disagreed, so a runner that applied the right plan and attested honestly was rejected 400 on every
  attempt — found only by running the chain against the live control plane. The API now reads the plan's own
  `planHash` and refuses a plan that arrives without one: one truth, one place.


### Added

- **The dispatch and attestation surface the managed action calls (#123).** Served beside the existing
  liveness routes in `apps/status-api`: `POST /api/v1/instances/{id}/plans`,
  `POST /api/v1/instances/{id}/dispatches`, `GET .../dispatches/{dispatchId}` (single use — a second fetch is
  a 409, because a re-run must not re-apply), `POST /api/v1/attestations`, and
  `GET /api/v1/instances/{id}/latest-attestation`. Attestations are checked for schema, known dispatch,
  nonce match, plan-hash agreement and replay, and are accepted exactly once per dispatch.
  `/api/v1/attestations/capabilities` states what is **not** implemented — OIDC audience, issuer, repository
  binding and signature verification — so the gap is a sentence in the API rather than an absence.
- Fail-closed configuration: with no `PLATFOLIO_DISPATCH_TOKEN` the routes answer 503, so a half-configured
  deployment cannot quietly become an unauthenticated one. Liveness stays GET-only; a test asserts `POST
  /healthz` is still 405, because widening the method guard to the whole server is how that would happen.


### Added

- **The managed action (#123).** A composite action at `.github/actions/platfolio-managed`, referenced by
  path at a pinned commit, with its decisions in `apps/managed-action/src/runner.ts` behind injected
  dependencies: read dispatch inputs → OIDC job identity → fetch the plan → **refuse on a stale hash**
  (nothing applied) → mint nothing itself, call the provider with the workspace token the environment holds →
  **redact then attest**. Refusals are attested rather than thrown, because a red X with no attestation is
  indistinguishable from a runner that never started; a provider call that throws still fails loudly, because
  after mutation the outcome is genuinely unknown.
- **`action:bundle` / `action:check`** — the bundle is a committed artifact regenerated by esbuild and
  compared in `verify`, the same drift rule as a generated Compose prod overlay (D29). No package install at
  run time, and no hand-editable build output.
- **`redactCredentialShaped`** in the contracts seam: a provider error echoing back a token is sanitized on
  the way out, and anything that survives redaction stops the attestation outright.

### Verified by execution

- The committed bundle was run: no OIDC → `no OIDC id token available; the workflow needs id-token: write`;
  plan fetch 500 → `outcome=failed`, attestation posted, `refused: the plan could not be read`. A **real**
  dispatch is still unproven — it needs the control-plane endpoints, which is M4 or #113's self-host.


### Added

- **Three platform templates (`platform-templates/`, D38)** — one per kind of thing platfolio hosts:
  `starter-web` (public UI + API with a managed Postgres, proving domains and provider-resolved
  `DATABASE_URL`), `starter-worker` (no inbound, `retention: survive` on its volume — the hibernate case),
  and `shared-identity` (stock Keycloak declaring `provides: identity`, including a `client_secret` output
  that is relayed and never stored). `pnpm run templates:publish` writes them into tenant repositories, dry
  run by default, and refuses to create or delete a repository (#130, D36).
- **`provides` and `capabilities` are now authorable in Compose** — they reached the manifest only through
  hand-written YAML, which is the path D29 retired.
- **`seedAndCommit` and `repositoryVisible`** in the write seam. Bootstrapping is the interesting part: the
  Git data API refuses to create the first object in an empty repository (409), so the branch is seeded through
  the contents endpoint and the file set follows as one commit. Visibility is now reported as the fact #130
  makes it — a 404 means *not installed*, not *absent*.
- **`pnpm run templates:publish`** put the three templates into `fractalsynapse`: seeded-and-published onto
  `main` for repositories platfolio owns the history of, branch + pull request for anyone else's, dry run by
  default, and it never creates or deletes a repository.
- **`worker` and `shared-service` archetypes** carried their own validation rules from the start.

### Fixed

- **A volume declared in Compose and in `x-platfolio.resources` produced two plan entries**, and the
  mount-derived one had no `retention` — so a disk declared to survive could be deleted by whichever entry
  teardown matched first. The arrays were also the *same object*, so the dedupe was comparing a list against
  itself; declared and derived are now separate, merged on the mount, with the declaration winning.

### Corrected

- **`repository_creation` was an invented permission key, and is reverted.** #125 asked for it on the strength
  of a docs sentence about a feature-flagged "Repository creation"; GitHub's published REST description contains
  **zero** occurrences of the key (against 34 for `administration`), and an unknown manifest permission is what
  made GitHub reject the first registration outright (`single_file_permissions`). Removing it leaves **#130
  open as the real limitation**: the app can create an org repository and cannot see it afterwards, so tenant
  repositories need the installation's repository access set to all repositories, or they are created by the
  tenant. No permission-shaped workaround exists.

### Added

- **The app requests `repository_creation` (#125), deliberately as a test.** With `administration: write`
  alone, platfolio can create an org repository (201) and then cannot see it: `PATCH`, template `generate` and
  `DELETE` all answer 404 because the repository isn't in the installation's selection (#130). GitHub documents
  this permission as also granting "automatic access to repositories it creates", which is the missing piece for
  creating tenant repositories at all. The manifest parameter name cannot be validated from outside a
  registration — GitHub answers the identical 422 for unknown and ungranted permissions — so the app-creation
  page is the test, and the runbook says what to revert if it objects.


### Added

- **Volumes can outlive their service (#137, measured).** `retention: 'instance' | 'survive'` on plan and
  manifest volume entries; `provisionVolume` matches an existing volume **on its mount** and re-attaches it via
  `volumeInstanceUpdate` instead of creating a second disk; `deleteInstance(instanceId, { retainMounts })`
  keeps what it's told to and reports it in `retained`. Mounts rather than names because Railway assigns
  `<service>-volume` itself and the plan's label is a tenant-facing string — my first version matched on the
  label, looked correct, passed review, and could never have fired.
- **Two new archetypes, each with a rule**: `worker` (refuses an exposed host) and `shared-service` (requires
  one, since nothing can bind to an unreachable service).
- **`DeleteResult.retained`** — a third category, distinct from `removed` and `orphans`: kept on purpose.

### Corrected

- **#107's diagnosis was overstated.** Measured: an ordinary service deletes fine with its volume attached;
  only a template-created database refuses. The double enforced the over-generalisation ("any attached volume
  → refuse"), which made the provider's blanket volumes-first ordering look like a requirement rather than a
  caution; now scoped to template services.
- **`volumeDelete` schedules rather than completes** (`isPendingDeletion`, `deletedAt` ~2 days out, volume
  still listed). Anywhere that read the `true` as done — including #111's clean teardown claim — now reports
  what is actually known.

### Measured live

- Volumes survive `serviceDelete`; `volumeInstanceUpdate` re-attaches a survivor (confirmed by read-back);
  project tokens may `volumeCreate` but not `volumeDelete`. Evidence and cleanup:
  [research record](docs/research/railway-volume-lifecycle-2026-11-10.md).


### Added

- **An attestation can report `partial` (D37, #123 protocol half).** `result` was `ok | failed | noop`; a
  three-of-four apply is neither — `ok` hides drift forever, `failed` discards resources that are running and
  makes the next apply try to create them twice. New schema rules: `partial` must carry an `errorCode`, and
  `partial` with nothing landed is rejected as "failed, not partial". Widening a response union tightens any
  consumer switching exhaustively over it; there are none outside this repository yet, which is why it is a
  minor with the widening stated instead of a breaking major.
- **Action-side helpers on the existing contract** (`parseDispatchIntent`, `staleIntent`,
  `attestationFromApply`, `normalizeHash`, `assertAttestationClean`). No new schema: `attestation.ts` already
  owned the trust model, and a parallel shape on the runner side is how two versions of "the same" contract
  drift apart. An attestation now carries the digest of the plan that **ran**, not the one requested, and a
  stale dispatch is refused before anything mutates with both hashes named.
- **The install workflow was given the credential it needs.** The apply step had none at all (plan, identity
  and trigger present; the ability to act absent), and `PLATFOLIO.md` listed platform secrets while omitting
  `RAILWAY_TOKEN` that the step resolves — an install that reads complete and fails on first dispatch. Names
  in the manifest, values resolved by GitHub into the step process.

### Found

- **#135 blocks the runner.** The provider is built around a workspace grant while the tenant-facing document
  promises a per-environment project token; those cannot both be true, so the credential scope is a decision
  with three priced options rather than an implementation detail. The protocol half deliberately imports no
  credential so it can be decided on its own terms.


### Added

- **Required reviewers can be attached when creating an environment (#126, measured live).** `ensureEnvironment`
  now accepts `reviewers: [{type: 'User'|'Team', id}]`; GitHub rejects `type: 'App'` — an app must not approve
  its own deployments — so platfolio can hand a tenant a production environment that already has its human gate
  instead of a half-configured one. `PUT` replaces rather than patches: an omitted `reviewers` leaves the gate
  alone, `reviewers: []` removes it, and both answer 200.

### Found

- **A repository the app creates is invisible to the app.** Org repository creation works (201) with
  `administration: write`, but every follow-up call — `PATCH`, template `generate`, `DELETE` — answers **404**
  even with an unscoped token, because the installation's selection never includes it. That makes GitHub's
  `repository_creation` permission (which "automatically gives access to repositories it creates") load-bearing
  rather than merely narrower, and it is #125's justification. "Not visible" and "does not exist" share a 404.
  Evidence and the cleanup debt this left behind:
  [research record](docs/research/github-environment-and-repo-provisioning-2026-11-10.md).


### Changed

- **The GitHub App now requests `administration: write` (D35), and platfolio provisions environments itself.**
  A tenant must be able to manage everything inside platfolio except granting OAuth consent; creating a
  repository environment is a repository-administration act (measured: 403 with `environments: write` alone),
  so the grant is required rather than chosen. Blast radius is limited by how it is used: tokens are minted
  per operation with the narrowest working subset and revoked immediately, and `app:check` prints the
  installation's **actual** granted set — a widened manifest does not take effect until the account owner
  approves the new permissions. GitHub's narrower `repository_creation` permission is deliberately *not*
  requested yet: its manifest key cannot be validated from outside a registration, because GitHub answers the
  identical 422 for an unknown permission and an ungranted one.

### Added

- **`ensureEnvironment` and `createRepositoryFromTemplate`** in the repository-write seam. Template generation
  and required-reviewer configuration carry explicit PENDING LIVE CHECK notes rather than passing tests.


### Added

- **The install write path (`GithubRepositoryWrites`, `pnpm run install:pr`).** One atomic tree commit over all
  install files on a fresh branch, a reviewable draft pull request, and repository-environment **presence**
  checks. Default is a dry run that prints the file set and refuses to proceed if anything in it looks like a
  credential value; `--apply` is required to write. Installation tokens are minted per operation with the
  narrow grants measured to be necessary (`contents · workflows · pull_requests`) and revoked at the end.

### Verified live

- **Runbook step 3.** platfolio opened its first install PR against a tenant repository: #122, one commit, two
  files, no secret values, token revoked. Three distinct causes behind the same `Resource not accessible by
  integration` message were separated by experiment, including that workflow paths require `workflows: write`,
  and the decision that platfolio does not create environments — creation needs `administration: write`, which
  D25 declines to hold, leaving the production review gate to the human who owns it.


### Added

- **Installation access tokens in the SCM seam.** `createInstallationAccessToken` mints a short-lived,
  repository-scoped token from an installation (the app JWT authorizes the request; it is never used on
  repository endpoints), and `revokeInstallationAccessToken` deletes it when the work finishes. `app:check` now
  uses this pair to list the repositories an installation actually covers, and prints only expiry and selection.

### Verified live

- **Step 2 of the connect flow.** Org-owned app `platfolio-local` (5694176), installation 180457153 on
  `fractalsynapse`, token minted with `repository_selection: "selected"`, `GET /installation/repositories`
  returning exactly `fractalsynapse/platfolio`, then revoked. The least-privilege claim in D25 is now measured
  rather than intended.


### Added

- **`app:local -- --org <ORG>` is now the documented path for tenant repositories, and `app:check` says why.**
  A GitHub App registered as private can only be installed on the account that *owns* it (GitHub's visibility
  docs), so the app created through the personal settings page — `owner.type = "User"`, confirmed via `GET
  /app` — cannot be installed on `fractalsynapse` repositories at all. The install page simply omits the org,
  which reads like a permissions bug and no grant fixes it. Making the app public is not the answer either:
  this is a development app holding `contents: write` and `secrets: write`. `app:check` now prints the rule
  when it detects a private, personally-owned app with zero installations.
- **`pnpm run` flag forwarding footgun closed.** `pnpm run app:local --org x` drops `--org` silently; the
  script tolerates a leading bare `--` and the runbook writes the command with it.

### Verified live

- **The manifest flow, the unauthenticated exchange and `createAppJwt` all work.** App `platfolio-local`
  (id 5693967) registered from a laptop; `GET /app` under our own app JWT answered 200 and returned the slug.


### Added

- **`pnpm run app:check`** — verifies platfolio's GitHub App state from the command line: app-JWT auth against
  `GET /app`, installation count from `/app/installations`, and installed repositories, reporting each
  separately so "app authenticates" and "app is installed" stop being conflated. Prints identifiers only; the
  private key, client secret and webhook secret never reach a log line.

### Verified live

- **The local registration flow works end to end** (#113). App id 5693967 / slug `platfolio-local`, credentials
  in a `0600` untracked file, and `GET /app` under an app JWT returning **200** — the first time `createAppJwt`
  was checked against GitHub rather than only against its own public key, and the point where the
  unauthenticated-exchange inference became evidence. Installation is the remaining human step.


### Fixed

- **The manifest exchange demanded a field GitHub does not send (#113).** The docs say the exchange response
  includes `id`, `pem` and `webhook_secret`; an app registered without `hook_attributes` — which the local flow
  does deliberately — returns no `webhook_secret`. The required-field check treated a sentence as a schema and
  failed the run *after* the code had been consumed, discarding credentials for an app that now exists with no
  key held. `webhookSecret` is now optional (absent, not an empty string that would pass a signature check it
  should fail), and a failure names the keys that arrived — never their values — because a one-shot exchange
  that fails on validation is otherwise undiagnosable.


### Fixed

- **The GitHub App manifest was full of invented fields (#113).** GitHub rejected the first real attempt:
  `single_file_permissions` is not a permitted key — and it was one of four (`request_verification`,
  `webhook_active`, and a `permissions` map beside `default_permissions`, which the docs define as an object
  of access levels and we sent as the string `'read'`). The tests had been asserting the invented shapes, so
  nothing could catch it. Added `AppManifestSchema` + `MANIFEST_KEYS` transcribed from the documentation, with
  `.strict()` so unknown keys fail locally and the error lists **every** offender — GitHub names only the
  first. A test now asserts every emitted key is documented, and `registrationUrl` returns the POST target
  only (no `?manifest=` on a GET, which is not the documented flow).


### Added

- **Local GitHub App registration for M2's first step.** `pnpm run app:local` serves a page that POSTs
  platfolio's manifest to GitHub and receives the one-time code back on `http://localhost:<port>`, then
  exchanges it for the app id, client id and private key into `.secrets/platfolio-app.json` (mode 0600, never
  printed) and polls installations with a short-lived RS256 app JWT to record the installation id by itself.
  `localDevManifest`, `exchangeManifestCode` and `createAppJwt` are in the SCM seam; `app:local:check` shows
  the manifest without touching the network. This replaces the earlier GET link with the manifest encoded,
  which is not the documented flow, and drops the webhook block instead of pointing it at a host with no such
  route. A bad callback no longer kills the run — the operator's fix is a second click, not a new state.
  [Research record](docs/research/github-app-local-registration-2026-11-10.md), including the one inference
  (the exchange endpoint needs no credentials) and what remains unexercised.


### Fixed

- **Teardown now accounts for what it actually did (#111).** The survivor sweep ran *after* `projectDelete`,
  so with the project unreadable nothing could be distinguished — the first tenant-shaped run reported
  `orphans: []` while its database appeared in neither list. `deleteInstance` snapshots every resource before
  removing anything and classifies each one: `removed` (deleted individually), `releasedWithProject` (existed,
  not individually deleted, now unreachable — every bucket lands here, since no bucket delete mutation
  exists), or `orphans` (**still reachable** after `projectDelete` — the only case that earns the word).
  Refusals still record their reason in `failures`, so #80's guarantee is unchanged and only the label moved.
  Verified live: service `removed`, bucket `released`, `orphans: []` as a probed claim. Two test-harness bugs
  surfaced: the double answered reads for a deleted project (making correct code look wrong), and the mock's
  option whitelist silently dropped a new flag — the recurrence that once made a test vacuous.


### Added

- **platfolio described as a platform (#113, offline half).** `platforms/platfolio/` is a Compose document
  with `x-platfolio`, its own `.platfolio/environment.yaml` inventory, and a generated prod overlay pinned to
  the digest CI published. It round-trips through `parseCompose → applyInventory → buildPlan → validatePlan`
  with zero issues, the overlay regenerates byte-identically (D29's drift gate), and the plan carries secret
  *names* only. First-party and deliberately outside the catalog, which stays identity-free (D28).
- **First connect runbook** ([14](docs/design/14-first-connect-runbook.md)): the ordered M2 steps with the
  two that need a human at a browser marked, and the assumption each one is meant to falsify.


### Fixed

- **Teardown order, and what it actually was (#107).** A template-created database that still owned a volume
  was refused by `serviceDelete`; a volume-less one deleted cleanly. The provider deleted services first and
  volumes second, so the refusal was guaranteed on every run. Volumes are now released first, and the double
  enforces the rule — it previously enforced neither, which is how a full live run passed unnoticed.
- **Bucket teardown reported truthfully (#106).** There is no bucket delete mutation on this API at all
  (the mutation list was enumerated to check), so `projectDelete` is the only mechanism. A bucket is now
  named in `removed` as released with the project rather than counted as an orphan before the project is
  gone — accurate but misleading, which is a distinction this project has kept having to learn.
- **A new accounting gap found while proving the fix (#111).** The survivor sweep runs *after*
  `projectDelete`, so an empty orphan list can't distinguish "everything was removed" from "everything is
  now unreachable": the provisioned database appeared in neither list. Accounting must snapshot before the
  project goes and then re-check against unreachability.


### Added

- **First tenant-shaped live run (2026-11-10).** A reference platform manifest drove `buildPlan` →
  `applyPlan` against Railway: two services `live`, managed database `live`, volume attached, bucket created,
  generated domain with certificate read back as `issued`. `verified` stayed **false** for the correct
  reason — an unmet tenant obligation, named with environment and service — which is the point: a green here
  would have meant deploying without a signing key. Teardown exposed two gaps now filed (#106 buckets are
  never deleted, #107 `serviceDelete` refuses a template-created database that owns a volume). The image
  was platfolio's own published build in place of the templates' placeholder digests, so this proves the
  hosting mechanism, not a real platform boot — said in the record as well as here.


### Added

- **Execution split, trigger half (C5, D30).** `GithubWorkflowRunner` dispatches a curated workflow with ref
  and inputs, normalises run state from status **and** conclusion (neither alone is trusted — `completed`
  with no conclusion proves nothing), correlates a run to its head commit so a stale green cannot be read as
  current, and classifies drift in curated files by git blob hash. `classifyDrift` keeps `unknown` distinct
  from `missing`, because a failed read is not a tenant edit and the two ask for opposite responses.
  **There is no log access at any layer**: no method on the interface, and a test asserting no request it
  makes can reach a logs or artifacts path — workflow logs routinely contain resolved environment values, so
  a log reader would be a secret reader wearing a costume.


### Added

- **Binding panel for the page model (#94 UI half).** `buildBindingPanel(bindings, { providers, instanceId })`
  renders capability counts ("2 of 3 need attention"), per-consumer status, and rebind / re-issue actions —
  using only components the registry already defines, so no renderer or SDK has to grow. It emits no `value`
  field for a secret output and never a `secret-field` input, and the tests assert that structurally: a label
  reading `client_secret: needs re-issue` looks like a leak to a text search and is not one, so the previous
  assertion proved nothing. Rebind is offered rather than applied, because rewriting where a running platform
  points is the tenant's call.


## [0.4.0] - 2026-11-10

Range reviewed: `0.3.0..staging`, 8 commits closing #92, #93, #94 (planned work from D32–D34).
**Minor, derived:** the contract diff against `0.3.0` is 104 added declarations and **zero removals** — new
capability surface only (`binding`, `secret-writer`), so no consumer narrows against anything that changed.
Had a refactor widened a literal as it nearly did before `0.3.0`, this number would have been `1.0.0`.

**Shipped and verified live.** The write-once secret path: a repository secret was placed, presence moved
`missing → set`, a `GET` returned only `name, created_at, updated_at` with the value appearing in no
response, a second write rotated, and removal returned it to `missing`. The writer exposes no read method
and a test asserts that shape rather than trusting GitHub's write-only API.

**Shipped as logic, exercised by the catalog.** The environment inventory (typed obligations versus wiring,
with named refusals and an idempotent fold into the service model) and cross-instance capability binding
(requires-by-name, generation-tracked drift, secret outputs representable only as state). Both reference
templates now declare the two halves of one capability so the shape is not fixture-only.

**Not claimed.** No binding or inventory screen exists yet; the execution split (C5) is decided but not
implemented; no tenant has been hosted; there is still no full-scope live conformance pass; and the daily
deploy ceiling remains unreadable from the API, so the dashboard is the only authority on it.


### Added

- **Cross-instance outputs and binding (D34, #94).** `packages/contracts/src/binding.ts`: dependents
  `require` a **capability** rather than an instance id, so a team can move its identity provider without
  editing every consumer; resolution picks the supplier, records the **generation** of what was published,
  and reports drift as `rebind-required` instead of silently rewriting a running platform. Secret outputs
  (`client_secret`) exist only as state — the `values` type cannot represent a secret, so the binding
  record a database would hold is not a secret store, and a lost credential's only path is
  `re-issue-required`, never replay. No supplier is a state (`awaiting-provider`) rather than an error,
  since teams bind consumers before the provider exists; two suppliers is refused rather than guessed.
  `summarise` answers "how many consumers still point at the old issuer" in one call, which is what the UI
  needs to avoid an operator clicking through instances. The reference templates now describe both halves
  of the same capability.


### Added

- **Environment inventory (D33, #92).** `.platfolio/environment.yaml` declares what a platform needs — typed
  `reference` / `secret` / `value` / `output` entries with defaults, applicability and descriptions — and
  `deriveObligations` splits **what a tenant must supply** from **what the provider resolves**, so a
  provider-wired `DATABASE_URL` can never appear on the checklist asking a tenant to type it.
  `applyInventory` folds entries into the service model (idempotent, because install can be re-run), so the
  plan builder and provider are untouched. Refusals are named, not generic: a secret entry carrying a value,
  a missing `kind`, an unknown service or environment, a reference to an undeclared database, and a
  credential-shaped default on a `value` entry. The generic reference template now ships one, so the
  document format is exercised by the catalog.


### Added

- **Write-once secret path (D32, #93).** `GithubActionsSecretWriter` places a secret the tenant just
  supplied, checks presence (`set` / `missing` / `unverifiable`), and rotates by delete-and-reissue. It has
  no read method, and a test asserts that absence rather than trusting GitHub's write-only API. Verified
  live: `missing → write → set`, `GET` returns `name, created_at, updated_at` and the value appears in no
  response, a second write rotates, `remove → missing`.
  [Research record](docs/research/github-actions-secret-write-2026-11-09.md) — three base64 and endpoint
  details that cost time, and the two ways my own test double was more forgiving than the real API.


## [0.3.0] - 2026-11-09

Range reviewed: `0.2.0..staging`, 40 commits, closing #69, #70, #71, #72, #75, #77, #78, #80, #82–#91.
**Minor, derived not chosen:** comparing the contract surface against `0.2.0` leaves only additions —
`registryPullHint`, `DeleteResult.failures`, `DomainState.records`, template-provisioning options — plus one
declaration that renders differently (`= "1.0.0"` → `: "1.0.0"`) with an identical inferred type. Had
`#88`'s refactor been left as written it would have widened that field to `string` and made this a major, so
the bump was checked at the point where a wrong one becomes permanent.

**Shipped and proven.** Managed **databases created and deployed by the provider** against the live API
(template path, asynchronous provisioning observed rather than assumed), then **deleted** with the instance —
`orphans=[]` — after #82 fixed the real cause, which was a 25-second request deadline, not a permission
problem. Per-environment placement now verified instead of inferred (#64): `serviceInstanceUpdate` on an
unplaced environment answers `true` while doing nothing, and that silence used to be reported as success.
Domain and certificate state is read back from the provider, including the finding that Railway's
`dnsRecords` never lists the ownership TXT that is the only thing blocking a certificate. Volumes are
provisioned and attached. `0.2.0`'s tag annotation carried claims this release retracts, and tags are not
rewritten.

**Shipped as design, not capability.** Compose-first authoring and the actor/executor split
([13](docs/design/13-compose-first-and-execution.md), D29–D34). The adapter works — platfolio's own service is
now authored in Compose, its prod overlay generated and pinned to the digest CI built, and applying that plan
against the running instance was a verified no-op — but the importer report, the generated-overlay wiring into
the release job, and C7–C9 (#92, #93, #94: inventory, secret write path, cross-instance binding) are open
work with issues, not features.

**Not claimed.** No tenant has been hosted; no full-scope live conformance pass (databases provision, but the
end-to-end platform run with a real tenant image is still ahead); `graphql:check` validates queries against a
snapshot, not behaviour; and the daily deploy ceiling remains unreadable from the API, so the limit you track
is the dashboard's.


### Changed

- **D30's first law was overstated and is corrected (D32): secrets are written once, not never.** platfolio is
  the sole management interface, so it must set a workflow secret from a value the tenant just supplied; what
  must be impossible is keeping or re-fetching it. GitHub's write-only API enforces the read side for us;
  Railway's readable variables do not, which is why the provider's keys-only rule stays behavioural and
  test-enforced. Consequence for the product: re-apply cannot re-deliver a lost secret, so the action offered
  is rotate-and-rebind.

### Added

- **Environment inventory (D33) and cross-instance output binding (D34)** designed in
  [13](docs/design/13-compose-first-and-execution.md): typed entries carrying defaults and applicability
  without ever carrying secret values, and `provides`/`requires` resolved by capability so a team can swap
  its identity provider without editing every consumer. Generated credentials are re-issued rather than
  replayed, and a binding records the supplier generation it was satisfied against. Plan of record gains
  C7-C9.


### Added

- **Architecture: Compose-first authoring and the actor/executor split (D29–D31,
  [13](docs/design/13-compose-first-and-execution.md)).** A hosted platform is described by a Compose
  document plus an `x-platfolio` block, with dev and prod as overlays where **the prod file is generated by
  the release pipeline and never hand-maintained** — regenerate-and-compare is the drift gate. We accept a
  documented subset and refuse the rest by name, because a silently dropped field produces a system that
  differs from the file the tenant read; `env_file` and top-level `secrets` are refused on principle rather
  than implemented badly, since Compose's convenience is values arriving from a file and platfolio's
  invariant is that a secret is a name with a declared source. Execution splits: platfolio decides and
  observes and enforces lifecycle, the tenant's curated workflows apply app deployments, joined by
  `workflow_dispatch` so the tenant's pipeline stays the path of record. Four laws follow from measurements
  already taken: never write a tenant secret (presence checks only), never read workflow logs, a pinned
  digest must be one the release job built, and curated workflows ship as PRs with SHA-pinned actions.
  No platfolio-run runner fleet under any circumstances — a runner holds the tenant's checkout and secrets —
  with an in-tenant-account managed runner allowed as an optional, never-depended-on service.

### Changed

- **[03](docs/design/03-manifest-spec.md) is now the intermediate model rather than the authoring format.**
  The existing schema stays authoritative as what a Compose adapter lands on, so validators, renderers,
  `buildPlan` and the provider all keep working; what changes is that no human writes that YAML directly.
  Step 7 is re-pointed to author `apps/status-api` — already deployed by the provider — in Compose, so the
  format is tested against a system we actually operate rather than a specimen built to flatter it.


### Added

- **M1 step 6 closed: platfolio's own stack deployed by the provider and serving publicly.**
  `applyPlan` with `ghcr.io/fractalsynapse/platfolio-status-api:staging` + resolved digest produced a
  `live` instance at `<generated-railway-host>`, HTTPS with a Let's Encrypt certificate,
  `/version` reporting the deployed commit and the provider contract, and a re-apply that changed nothing.
  The certificate state came from reading `syncStatus` back, not from hostname inference. Sequence and the
  two pull-verification mistakes I made getting there are in
  [research/status-api-image-2026-11-09.md](docs/research/status-api-image-2026-11-09.md).


### Added

- **Private images and private registries are the normal case, and the credential stays the tenant's.**
  `registryPullHint` attaches a named next action to a *real* deployment failure when the image comes from
  a registry that routinely holds private repositories (`image-pull-authorization-hint`): the tenant
  attaches a read-only registry credential in their own Railway project. platfolio cannot verify
  pullability (it holds no registry credential by design) and must not read Railway build logs, which
  contain resolved environment values — so this is a hint phrased as a likely cause, never a claimed
  diagnosis, and a public `docker.io` image gets no nagging. Documented in [04](docs/design/04-execution-plane-github-workflows.md).


### Added

- **`apps/status-api` and the control-plane image (M1 step 6, build half).** `/healthz`, `/readyz`,
  `/version` (commit, build time, provider contract); no secrets read, no tenant data held.
  `.github/workflows/image.yml` builds and **runs the container** on PRs, and publishes
  `sha-<short>` plus the branch tag on push, taking the digest from the push output — a plan pins a
  digest, never a mutable tag. First digest and the four defects a green build hid are recorded in
  [research/status-api-image-2026-11-09.md](docs/research/status-api-image-2026-11-09.md).

### Fixed

- **Two repository gates that could not see `apps/`.** The root test glob was `packages/*/test/*.test.ts`
  and `tsconfig.json` included only `packages/*`, so the service was neither tested nor typechecked until
  both were widened. The lockfile gate separately caught `pnpm install` claiming "already up to date"
  with the importer missing from the lock.


### Added

- **Manifest→plan translation, and a way to express database wiring (#84).**
  `buildPlan(manifest, { instanceId, teamId, images })` turns a platform manifest into the plan a provider
  applies: environment placement (staging as `cloneFrom`, replicas pinned to 1), databases, buckets, volumes
  (`sizeGB` → `sizeMB`), public-only domains with staging derivation, secret **names** only, and the new
  `references` field. Until now nothing generated a plan — every live provider test hand-built one in a
  script, which is why "provisioned and deleted a database live" was true while "hosted a platform" was not.
- **`services[].references` in the manifest schema** — wiring from a declared database into a service
  variable, kept out of `secrets[]` on purpose (a reference is resolved by the provider and its name is
  public; the secrets panel exists for what only the tenant can supply). `templates/example-web-app`
  declares one.
- **A placeholder digest is refused at build time.** Templates ship `sha256:1111…` as documentation and the
  plan schema accepts that shape, so an example image would otherwise become a tenant's broken deploy;
  pinning belongs to the release pipeline, and the failure is now explicit.


### Changed

- **`serviceDelete` is retried, because the database orphan was a deadline (#80).** Measured live: deleting a
  template-created database exceeded the 25s request timeout (`TimeoutError`) while ordinary services deleted
  inside the window — not `Bad Access`, which is what the double modelled and what I would have written as the
  cause. One retry with a short pause, and if both attempts fail the reason still reaches
  `DeleteResult.failures`. Covered in both directions offline: one injected timeout → no orphan, resource
  reported removed; five → orphan **with** its reason.
- **Live evidence gathered while fixing it:** the provider provisioned the template database and read it back
  as `live`, created the attached volume (Railway names it `api-volume`), and the app service reached `live` in
  ~35s — which weakens, without dismissing, the theory that #79's 300s `deploying` was the tenant's daily
  ceiling queueing.


### Changed

- **A refused delete now says why (#80).** `deleteInstance`'s empty `catch` swallowed every `serviceDelete`
  error, so absence and refusal were indistinguishable and a surviving database was reported as a bare orphan.
  Placement is checked with an environment token (best-effort: the read itself must not become the failure it
  reports), and `DeleteResult.failures` (additive, optional) carries the provider's reason. Volumes are
  removed before services, since a volume holds its service.
- **`database-provision-timeout` is tested in both directions (#79).** The double's constructor whitelists its
  options and had been silently dropping `templateNeverReveals`, so an earlier version of this test asserted
  nothing; with normalization fixed, one plan verifies when the service appears and yields the timeout code
  when it never does.


### Changed

- **The catalog is generic (D28): no platform identities in code or templates.** `templates/treedx` and
  `templates/arcnexus` became `templates/example-web-app` and `templates/example-full-stack` — still the two
  shapes that exercise the renderer, but carrying no tenant's product name. Scrubbed from code, fixtures and
  scripts: sample plans, conformance expectations, secrets-panel and environment-policy tests, the E9 spike
  driver, `render:example`/`manifest:example` scripts. Platform names stay in documentation where they
  illustrate a real case (TreeDX's blob mount, ArcNexus's external Keycloak), and the design docs' template
  paths were updated so nothing points at a renamed directory. D9's first-party-entry exception is marked
  superseded rather than deleted, since the reasoning behind it still applies.

### Added

- **OD13: a private PostgreSQL created and deployed through the API.** `templateDeployV2` with
  `templateId` **plus a caller-supplied `serializedConfig` read from the template** reached `SUCCESS` on the
  real service image, asynchronously (`operationId`/`workflowId`). The argument type is
  `TemplateDeployV2Input` — the similarly named `TemplateDeployInput` is a different type, and aiming at it
  is what made the earlier probes look like a capability limit. Remaining: plan-controlled naming (it
  arrived as the template's own `Postgres`), password seeding, `${{Service.VAR}}` wiring, and modelling
  deploy as a job.

### Changed

- **"Databases cannot be created" is retracted -- they can, and the provider has to do it.**
  `serviceCreate(input: { projectId, environmentId, name, templateId })` created a PostgreSQL service from
  Railway's own template against the live API (`treedx-db`), after two rounds of maintainer pushback that I
  answered by probing the wrong endpoints: `templateDeployV2` and the change-set API are not how a database
  is made, and their silence is not a capability limit. What is now open is implementation, not
  possibility: getting the created service to deploy (`serviceConnect`, `serviceInstanceDeployV2`, or
  seeding variables first) and wiring its URL through Railway's `${{Service.VAR}}` reference syntax so the
  value never crosses platfolio. Tracked as **OD13**, with the provider's `database-not-provisioned`
  comment rewritten to say exactly that. This is the top priority: without it TreeDX and ArcNexus cannot
  run, and "discover and wire, never create" was the wrong shape to propose.
- **D26 and D27 recorded, OD12 closed.** One Railway project per platform instance, teams holding multiple
  platforms; domains live in the platform's own repository, which retires the shared-catalog assumption the
  host-pattern redesign was built on. `MAINTAINING` corrected: the licences already reached `main` in
  `0.1.0`/`0.2.0`, so the "next production integration" note was stale.

## [0.2.0] - 2026-11-09

First release since `0.1.0`, and **a minor bump rather than the patch `0.1.1` that was requested**:
diffing the contract surface from `0.1.0` to this candidate gives 671 added declarations and no
removals — the two lines that look like deletions are widenings (`runConformance` gained an optional
third parameter, and the `RailwayInfraProvider` export gained a companion type), both callable exactly
as before. Project policy is that additive means minor, and under 0.x a patch number signals
fixes-only, which this is not: it carries a working provider, three new contracts, and a CI gate that
did not exist.

**Scope actually shipped.** The contracts layer (transport, provider, credential broker, secret
delivery, SCM seam, attestation, conformance), the manifest renderer's environment model, the page
schema's secrets panel, the credential-hygiene and lockfile gates, and `graphql:check` against a
committed Railway schema snapshot. Corrected claims are part of this release too — several findings
from the `0.1.0` era were wrong in ways that would have reached a tenant.

**Scope deliberately not claimed.** M1 step 6 (Docker build and staging deployment of platfolio's own
stack) and step 7 (its manifest) are open; M2's live half (OAuth connect, install PR, real dispatch,
runner claims, JWKS) has not been exercised; databases and volumes are unimplemented; the manifest
host-pattern change is **OD12**; and no control-plane service exists yet, so nothing here is deployed
or reachable. See [09](docs/design/09-delivery-plan.md) for the honest state of each milestone.

### Added

- **The Railway provider is real now.** `packages/contracts/src/railway-transport.ts` carries the
  credential model the measurements forced: a workspace grant for project/environment/token creation, an
  environment-scoped token for service work, and the `Project-Access-Token` header chosen by credential
  **kind** rather than by the caller. It also holds `HttpRailwayTransport` — Railway answers
  authorization denials as HTTP 200 with `errors[]`, so anything that is not `data` is treated as an error
  — and `MintingRailwayCredentials`, which mints per-environment tokens and can revoke what it created.
  `RailwayInfraProvider` implements `applyPlan` / `readState` / `deleteInstance`: idempotent by
  `planHash` through a marker in the project description, per-environment instance placement, service and
  custom domains with certificate state reported as the provider sees it, configuration written with
  `skipDeploys` so a variable write never triggers an unintended redeploy, secrets verified by **name
  presence** through the value-redacting `Environment.config` and never through `variables()` (which is
  the call that would actually return them), ceilings applied via `serviceInstanceLimitsUpdate`, and a
  hard per-instance deploy budget reflecting the tenant's daily ceiling. `packages/kernel` wires the
  selection through the Cordis boundary and refuses to boot a Railway provider with no workspace or
  credential source.
- **`ApplyResult.notes`**, so an observation cannot masquerade as a failure: the first revision recorded a
  placement fallback as a failure and made a correct apply report itself unverified. The conformance suite
  gained a **`scope`** field (`full` / `reduced`) plus a guard that rejects a reduced plan too small to
  exercise the surface, so a reduced run can never be quoted as conformance.

### Added

- **The full domain lifecycle was run against a real tenant domain, and it is documented with timings.**
  Attach with no DNS → `CREATING`/`REQUIRES_UPDATE`; CNAME published → `ACTIVE`/`PROPAGATED` but still
  unverified; ownership TXT published → `verified: true` after a measured **~11–12 minute** provider
  verification cadence, then `certificateStatus: VALID` and a Let's Encrypt leaf (90-day) served at the edge
  for `probe.fractalsynapse.com`. Cost: zero deployments. Two design points settled by evidence: the
  ownership record never appears in `dnsRecords`, so a checklist built from that array is provably
  incomplete; and the resolver-vs-provider disagreement window is real, which is what justifies the
  `dns.probe` seam as advisory-only. `ACME_DNS01_CHALLENGE` was never required here, so the provider's
  `challenge` mapping is forward-compatible handling rather than exercised behaviour.

### Added

- **Domains and DNS have a design, based on measurement (D25, [12](docs/design/12-domains-and-dns.md)).**
  Attaching before the tenant publishes anything works on a real zone — my earlier "refused" note came from a
  nonexistent zone — and the created object returns the authoritative record set (`requiredValue` vs
  `currentValue`, `PROPAGATED`/`REQUIRES_UPDATE`, plus a `verificationDnsHost`/`verificationToken` TXT pair).
  So the flow is availability-check → attach → render *Railway's* records → tenant publishes → poll, with
  infrastructure health and domain health kept as separate axes. The CNAME target is Railway's routing host, not
  derivable from the service hostname, and `ACME_DNS01_CHALLENGE` proves the record set can grow after attach —
  hence re-read every poll. **OD12** opens the manifest change: hosts become patterns, root domains become
  instance config; [03](docs/design/03-manifest-spec.md) marks its literal hosts provisional.
- **Domain availability is checked before attaching, and required records reach tenant-facing state.**
  `customDomainAvailable(domain)` is the only source of a human-readable reason, so an unclaimable host fails
  with `domain-not-available` and the provider's own text instead of Railway's "please try again", and the create
  call is skipped. `StateSnapshot.domains[].records` carries provider-returned records — host, FQDN, zone, type,
  required value, observed value, status, purpose — plus the ownership TXT derived from
  `verificationDnsHost`/`verificationToken`, which is what makes "expected versus observed" renderable.

### Added

- **Domain state is read, not inferred, and failed certificates can be nudged.** Generated service
  domains now report `syncStatus` (CREATING reads as pending even for a `*.up.railway.app` host, which the
  previous hostname inference would have called issued) and custom domains report
  `status.verified`/`certificateStatus` (VALID / ISSUING / VALIDATING_OWNERSHIP / ISSUE_FAILED). Apply-time
  domain status re-reads the provider instead of assuming issuance follows creation, since a custom domain
  waits on DNS the tenant still owns. `retryCertificate(domainId)` calls `customDomainIssueCertificate`
  using the id Railway issued — kept outside the five-operation contract deliberately, so no provider can
  be assumed to have it.

### Added

- **`graphql:check` — every GraphQL document we write is validated against Railway's live schema**
  (committed introspection snapshot, 697 types) and runs in all three CI tiers. It catches the four bug
  classes we hit this week by name: a root field that doesn't exist, a guessed input-type name, an
  object-returning field with no sub-selection, and a wrong argument name. Negative-tested by injecting
  each one. This is the mechanical answer to an API that answers unknown fields with a runtime error and
  unknown payloads with `applied`.

### Changed

- **`environmentApplyChangeSet` is a trap, and the provider now stays away from it.** Three requests — the
  CLI's own `desiredGraph`, that plus `variablePolicy`, and a hand-written `changes` array — all returned
  `status: applied`, `changes: []`, `diagnostics: []`, and created nothing: the endpoint treats the input as
  an opaque blob and reports success regardless of content, while the CLI computes the diff locally. An
  endpoint that answers "applied" to anything is the most dangerous kind to automate, because a typo
  becomes a silent no-op that reports success. Per-resource mutations remain the applied path (proven end to
  end); the captured graph stays as a state-model reference and a fixture. Also confirmed: **the daily deploy
  limit is not observable through the API** — `MetricMeasurement` covers resources only, and the only limits
  ever surfaced in errors were the 1-project-per-30s and 1-environment-per-30s creation throttles.
- **Plan contract extended to match the graph, and the renderer's domain bug fixed (E24b/E24c).**
  `ServicePlanSchema.references` and `EnvironmentPlan.volumes` now exist (optional, so every existing plan
  stays valid), validated across fields, and emitted by the change-set builder as reference variables,
  volume nodes and `volumeAttachments`. A reference to an undeclared database throws instead of producing a
  dangling link. Meanwhile `.railway/railway.ts` no longer declares `domains:` — Railway's CLI rejects
  custom-domain registration in configuration — and the hosts are recorded as a comment only for the
  environments the service is actually placed in, because a production-only service must not gain a staging
  host even in prose.
- **E24: the config-as-code payload is captured, not guessed.** `railway config plan --json` output is
  committed as a fixture and the new change-set builder is shape-tested against it — `{ project,
  resources }` with a fixed 15-key node, managed databases as Railway template images, variables in three
  forms (`literal` / `preserve` / `reference`), and **no custom domains in IaC**, which exposes a renderer
  bug (we emit `domains:` today) and confirms the secret-custody design: `preserve()` is the provider's own
  primitive. `environmentPreviewChangeSet` gives a zero-side-effect way to check a payload, replacing the
  loop that produced nothing but silent `applied` results. Not applied live yet: the reference form needs a
  field on `ServicePlanSchema` first, and the tenant deploy ceiling should reset before spending deploys.
- **"Databases are unsupported" was wrong, and the correction is a rule, not a one-off.** One failed
  mutation was reported as a provider limit; the maintainer's pushback was right. Follow-up found
  `railway/iac`'s first-class `type: "database", engine: "postgres"` resource and
  `CompileResult.desiredConfig: EnvironmentConfig`, so managed databases are created through the
  config-as-code change set — the E24 path. Every shape this build tried is answered `applied` with
  `changes: []`, *including a deliberately invalid resource type*, while a missing or string `version`
  errors outright: the version is validated and nothing after it is, so the payload is deserialising to
  empty. Status is now "not implemented, mechanism identified, `plan --json` needed", which is also what
  E28's row and the provider's own failure message say.
- **E25 and E28 measured, and both changed the provider.** Placement into a second environment happens
  **only** by duplicating the environment, and the duplicate is a snapshot — `serviceInstanceUpdate` on an
  environment without the service returns `true` and does nothing, which is precisely the kind of success
  a mock will happily reproduce in the wrong direction. The provider now verifies instance placement and
  reports `instance-missing-in-environment` instead of continuing. `bucketCreate` works but only with the
  workspace grant (project token: "Bad Access") and accepts no region, so a region in a plan is now
  disclosed rather than assumed; private databases remain unreachable through `templateDeployV2`
  ("Problem processing request"), so full-scope conformance still fails deliberately. Measured: **1
  environment per 30 seconds**, a second throttle beside the project one. The mock's clone also had to be
  corrected to mint fresh instance ids — reusing the source's made readState report two services with one
  identity, which the conformance suite rightly called a duplicate.
- **E26 confirming run: the provider passes reduced-scope conformance against the live Railway API** — 9/9
  in 95 seconds, including a re-apply that is a real no-op (no second deployment, no second hostname) and a
  delete that reports orphans honestly. A zero-deploy probe confirmed secret presence is checked by name
  against the real `Environment.config`, and the deploy budget refused without deploying. Because the run
  was single-environment, **E25 stays open**, and full-scope conformance still fails until databases and
  buckets exist (E28).
- **E27: the overlapping-deploy theory was wrong, and the truth was smaller and worse.** Back-to-back
  `serviceInstanceDeploy` calls coalesce into one deployment on Railway; the stack of `FAILED`
  deployments was mine — `projectUpdate` returns `Project!` and my call had no sub-selection, so the plan
  marker was never written and every apply re-deployed the world. Fixed: the selection, the marker written
  **before** mutating (a partially-applied plan must not make its own retry destructive), and a hostname
  check because `serviceDomainCreate` is not idempotent. The mock had agreed with the bug; it now rejects
  selection-less mutations — and the first version of *that* guard matched the wrong parentheses and could
  never fail, caught only by breaking a query on purpose and watching the suite stay green.
- **E26 ran the conformance suite against the live Railway API, and it overturned four assumptions the
  mock had been happily agreeing to.** A tagless `repo@sha256:…` reference is accepted and then
  **never deploys** (20+ minutes in `DEPLOYING`; the tagged `repo:tag@sha256:…` form reached `SUCCESS` in
  ~20s), so `image` now requires a tag alongside the digest in both validators. `CustomDomain.status` is
  an object, not a string. There is no root `serviceInstances` query — instances hang off `Environment`.
  A workspace allows **one project creation per 30 seconds**, which bounds onboarding throughput and had
  to be respected in the runner. And an HTTP request with no deadline hung a whole run, so the transport
  aborts at 25s by default. `DeploymentStatus` was mapped exhaustively from introspection, which exposed
  that `NEEDS_APPROVAL` — the state that must reach a tenant as an action — was missing. Repeated
  overlapping deploys produced `FAILED` with `diagnosis: null`, recorded as **E27** rather than guessed
  at, along with the design lesson that an idempotency marker has to be written *before* the mutating
  call. Evidence: [research record](docs/research/railway-token-and-sealing-2026-11-08.md).
- **Two claims corrected, both generalized from the wrong artifact.** Resource ceilings are not
  un-settable in Railway — they are unexpressible in the **IaC graph**, and the API sets them, so the
  provider now does ([03](docs/design/03-manifest-spec.md)). And Railway services are project-level while
  the deployed thing is the per-environment **instance**: an apply that updated without ensuring placement
  silently stopped configuring the second environment, and readState must report instance identity while
  domain calls take service identity. Which call the real API wants for cross-environment placement is
  now **E25**, with **E26** running the conformance suite live.

## [0.1.0] - 2026-11-08

First tagged release. It is the **contract layer**, not a running product: versioned capability
contracts and a conformance suite, the Platform Manifest with validation and renderers, the
framework-facing kernel, the secrets panel as validated page data, and the CI gates that hold all of
them. Provider behaviour is recorded with its evidence, including where measurement contradicted this
repository's earlier claims. The production workflow proves this release identity and deliberately
stops short of publishing it; the root `package.json` carries the version, while the private workspace
packages stay at `0.0.0` because nothing is distributed from them.

### Changed

- **D24 — custody decided: managed by default, self-custody as an option, and no platfolio-run runner
  fleet** ([#38](https://github.com/fractalsynapse/platfolio/issues/38)). The deciding argument was not UX:
  a machine that runs a tenant's job can read that tenant's credential, so operating runners for tenants
  would forfeit the self-custody tier's whole purpose while scattering the managed tier's single auditable
  boundary across N hosts. Mechanism settled by measurement: workspace grant → minted per-environment
  project tokens → deploy, with the account token needed only by the Railway CLI, which demotes rendered
  IaC to an ejection/handover artifact. Every sentence in README, AGENTS.md, [01](docs/design/01-product-and-decisions.md)
  and [02](docs/design/02-architecture.md) that claimed platfolio holds no tenant credential was corrected
  the same day — the claim was about secret *values* and read as if it were about *credentials*, which after
  E18/E22 we can no longer make.
- **OD11 opened: team services as a role, not an ownership class.** The identity promise in
  [05](docs/design/05-identity.md) ("one realm per team") and the ArcNexus fixture (Keycloak *inside* the
  instance, `OIDC_ISSUER` a placeholder string) contradict the current model, which gives every service one
  owning instance and no way to reference another. S2 is preferred: an ordinary provider instance declaring
  typed `provides`, consumers declaring `requires`, a new `team-service` value source, plan-time resolution,
  ordering, reference-counted deletion and "provider degraded" as a health state. Ownership stays uniform —
  everything belongs to the team; only the role differs.
- **Placeholder literals are now rejected by manifest validation.** `placeholder…`, `TODO`, `changeme`,
  `replace_me` and `xxx` in an env value fail at parse with a located message, so an unresolved reference
  cannot reach a plan. The ArcNexus fixture carries a real issuer URL, marked manually supplied until OD11.
- **Measured against a live Railway workspace (E15/E18/E21), and the design corrected the same day.**
  Variable sealing has no API surface at all — no input field accepts it and `Variable.isSealed` is
  unreachable — so D21's `relay-sealed` is unimplementable on Railway and the shipped default is
  `tenant-side`; invariant 1 now says managed mode *"will not read"* rather than borrowing sealing to
  claim *"cannot"*. A workspace grant creates projects, environments and project tokens but cannot
  create services, so provisioning is a two-grant sequence; and a project token authenticates only in
  the `Project-Access-Token` header, which explains the long-standing "tokens are finicky" experience.
  The Railway CLI (5.71.0) rejects both non-account tokens, so config-as-code must be driven through
  `environmentApplyChangeSet` instead — filed as E22. Evidence:
  [research/railway-token-and-sealing-2026-11-08.md](docs/research/railway-token-and-sealing-2026-11-08.md).

### Added

- **`packages/page-schema` — the secrets panel as validated data.** A component registry with strict
  prop schemas, `buildSecretsPanel()` driven by manifest + instance state + provider capabilities, and
  a plain-text projection for SDK/MCP/mobile consumers. Write-only is enforced three ways: no `value`
  key exists on a secret field, `findValueBearingProps()` scans the finished tree, and the builder
  validates its own output before returning. Capability gaps change the components rather than the
  copy — no sealing support means deep links and a warning, never an input that writes unsealed.
- **Credential-hygiene gate.** `pnpm run check` now inspects the git index and fails if a
  `.secrets/` path, a `*.token` file or a non-example `.env` is ever tracked — force-add included,
  since that is the failure being prevented. Verified to bite.
- **Custody, delivery and placement (D20–D23).** `credential-broker` gives managed mode one grant per
  tenant that refuses the five secret-reading operations before they reach the transport, with an audit
  trail and revocation, while strict mode holds nothing — both held to `runBrokerConformance()`.
  `secret-delivery` implements the four modes; a relayed value reaches exactly one place (the provider
  port), receipts and log surfaces are asserted value-free, and a provider without sealed-variable
  support gets a visible refusal instead of an unsealed write. `scm-github` builds the App manifest,
  registration URL with an unguessable state, state-checked callback and install link, with a PAT
  provider behind the same interface. Manifests gain `ownership` and per-service `environments`, host
  overlap is judged per environment, staging hosts are derived and never reused, and production-only
  services are declared but attached only where they exist.
- **M2 preparation.** The attestation contract (`DispatchIntent`, `Attestation`, `RunnerClaims`) with
  `verifyAttestation()` enforcing audience, issuer, repository, dispatch/instance/action/plan-hash and
  nonce binding, expiry, single-use replay, unknown-environment and production-environment gating;
  strict schemas refuse unknown keys so no secret value can ride along. The install pull request is
  generated and tested for minimal `permissions:`, per-dispatch GitHub environments, SHA-pinned
  actions, architecture-appropriate runners, a documented removal path, and the absence of empty
  expression placeholders (the bug that invalidated our own workflow file).
- **M1 contract layer.** `packages/contracts` defines the `infra.provider` capability with a
  conformance suite, an in-memory test double and a deliberately-incomplete Railway implementation;
  `packages/manifest` implements the Platform Manifest as a zod/StandardSchema definition with
  archetype and semantic validation (secrets by name only, wildcard/subdomain overlap, digest
  pinning, provider region allowlist, renderer version window) plus Compose and Railway IaC renderers
  exercised by two real platform fixtures and five negative fixtures; `packages/kernel` resolves the
  capability through the vendored framework by name and refuses to boot on an unsatisfiable contract
  range. `pnpm run verify` now covers all of it, including a contract-drift baseline in
  `api/contracts.api.md`.
- `docs/design/00-target-architecture.md` — the timeline-independent goal: end-state capabilities, the
  invariants that hold at every stage (including the zero-secret rule and "security and exit are never
  paid features"), deferrals with explicit build conditions, and what is out of the goal entirely.
  Capabilities only; business and go-to-market material stays outside this repository. Index and
  `AGENTS.md` point to it as the check before implementing.
- Three-stage CI/CD gating: `development.yml` (feature branches, PRs to `staging`),
  `integration.yml` (pushes to `staging`, PRs to `main`, adds the E9 experiment) and
  `production.yml` (pushes to `main` plus tags, enforcing that a release tag's commit already passed
  production on `main`). Shared checks live in `scripts/check-project.ts` so the tiers do not
  duplicate logic.
- Root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`: repository tooling (tsx,
  typescript, @types/node) with `pnpm run verify` as the one gate command that CI and local runs share,
  pnpm selected through corepack, and no dependency build script permitted to execute.
- Design document set under `docs/design/`: product definition and decision register, architecture,
  Platform Manifest specification, execution plane (customer GitHub workflows), identity, billing and
  tenant lifecycle, interfaces (API/MCP/mobile), distribution and licensing, the Cordis kernel and
  extension seams, the UI component and page model, and the Milestone 0–6 delivery plan.
- `docs/platfolio-feasibility.md` and `docs/research/` — verified provider constraints and the
  primary-source evidence behind them (Railway API surface read from its public GraphQL schema; Stripe
  Billing, Entitlements, tax and licensing comparisons; distribution options).
- Cordis vendored at `vendor/cordis` (`v4.0.0-rc.12`, MIT notice preserved), with
  `vendor/CORDIS.md` and `vendor/cordis.lock.json`.
- `scripts/vendor-cordis.ts` — vendor management tool (`adopt | verify | check | list | plan | apply`)
  with recorded-patch replay, boundary-file reporting, refusal on unrecorded local edits, and atomic
  replace. `verify` is the CI gate.
- `spikes/e9-cordis-kernel/` — Milestone 0 experiment E9: the kernel boots without
  `--expose-internals` and selects the infrastructure provider by configuration alone.
- Four project-specific agent skills — `capability-seams`, `platform-manifest`, `tenant-safety-check`,
  `vendored-dependencies` — plus `.agents/skills/README.md` distinguishing them from the inherited set.

### Changed

- **Release tags are bare semver** (`0.1.0`, not `v0.1.0`) per D19. `production.yml` triggers on every
  tag push and classifies it with one tested rule: valid release tags proceed, `v1.2.3`-style tags fail
  loudly rather than silently skipping, unrelated tags are noted and ignored. Provenance now derives the
  "previous release" from bare semver tags.
- **OD2 decided (D18): Apache-2.0** for platfolio code and documents, with the root `LICENSE` added on
  `staging`. `package.json` declares the SPDX id; the delivery policy and design set stop asserting that
  no license exists, and record the three details still open inside the decision (full license text,
  the `/proprietary` boundary, the trademark policy).
- Delivery policy clarified: `staging` is integration work that an agent may merge once the applicable
  checks and required review pass; `main` is a production boundary that only a human crosses unless the
  agent holds express permission for that specific release; publication stays with the maintainer.
- Repository identity: this is the platfolio project. `README.md` and `docs/MAINTAINING.md` were
  rewritten for it, and the starter package's maintenance, validation and configuration documents were
  removed; that material is maintained in [scaffold](https://github.com/fractalsynapse/scaffold).
- Architecture direction accepted by the maintainer: sell management rather than compute;
  tenant-owned infrastructure with bring-your-own credentials; the tenant unit is a team hosting many
  platforms; hosted platforms' users stay separate from platfolio's own users; no tenant secret ever
  crosses platfolio; and the control plane is built on Cordis with interface contracts at every seam.
- HTTP transport moved to a kernel-owned adapter after E9 showed the published
  `@cordisjs/plugin-server@1.7.0` targets a forked core and fails at route definition against the
  vendored upstream release.

### Open decisions

- **OD2 — decided 2026-11-08: Apache-2.0** at the root `LICENSE` (D18); the narrower items inside it remain.
- Release tags standardized on bare `<major>.<minor>.<patch>` (D19); `production.yml` now classifies tags and rejects the retired `v` prefix loudly instead of skipping it.
- **OD9** — core lineage: upstream `cordiverse/cordis` versus the fork the published plugins expect.

### Earlier history

Commits before the platform work began carry this repository's origin as the `scaffold` starter
package. The starter's own change history is maintained upstream, not here.

### Fixed — the secret-value predicate caught five names and missed every credential (2026-11-15)

`docs/ui-architecture.md` rule 4 says overlay drafts can never hold a secret value, enforced "mechanically" by
`findValueBearingProps`. Measured, that citation was false twice over. The name referred to **two functions with
one definition**: the exported one matched a closed list of five exact keys (`value`, `currentValue`,
`defaultValue`, `secretValue`, `plaintext`), while a private copy in `secrets-panel.ts` matched any key containing
`value` with two exemptions. Neither reading covered the other, and **neither rejected `token`, `apiKey`,
`clientSecret` or `passphrase`** — the commonest secret field names in the language, returning an empty list. One
fact, two spellings, no gate able to see the disagreement: the duplication rule, applying to a security predicate.

Now one exported implementation (`isValueBearingKey` plus the walk), the **union** of both previous behaviours so
nothing formerly caught is let through, plus credential-shaped names. Pinned by a test that fails if the duplicate
returns, if the list narrows, or if a benign key starts being rejected — measured 19/19 credential names caught,
14/14 benign keys ignored. Falsified by reverting to the old closed list: the test fails naming `token`.

**The residual limit is not closable and is stated rather than glossed**: this is a NAME test. A credential under a
neutral key (`note`, `text`) is invisible to it. Rule 4 holds because `PageSchema` gives a secret no legal place to
sit and the builders are checked by their own tests — not because this walk is sufficient. A name is not a custody
claim (D52) in either direction.

### Fixed — the zod guard asserted my laptop, not the repository (2026-11-15)

CI failed *"the hazard is real: zod does NOT resolve from this package on its own"* because the assertion measured
a maintainer-machine accident (`/home/adrian/node_modules/zod`) while CI resolves zod inside the repo. The rule it
protected was sound; the check was an environment-dependent claim dressed as an invariant. Replaced with a premise
true everywhere: zod is undeclared in `packages/api-contract/package.json`, so nothing can import it and install
cleanly. Falsified by declaring it — the guard fails by name and says to delete the declaration or the rule, not
keep both.

### Fixed — a workflow trigger that assumed a push could carry a dispatch (#252 #253, 2026-11-15)

`platfolio check` failed in ~500ms on both open PRs: `managed action: required input instance_id is missing`. Cause
was my own change the same day — I added `on.push` / `on.pull_request` triggers so PRs run `pnpm run verify`, and
set the action by event name, while assuming a non-dispatch event could supply `instance_id`, `dispatch_id`,
`nonce` and `plan_hash`. It cannot: the nonce is issued per dispatch precisely because it makes an attestation
non-replayable, so the action's refusal was correct and my trigger was the bug — on platfolio's checks and on every
tenant's install PR. The managed job is now conditional and the `tests` job stays unconditional, so PR verification
keeps happening; falsified by deleting the guard line, which fails the new test with `got undefined`.

**This is a stopgap, not the deploy-on-push capability the maintainer asked for** — see #254, which needs the runner
to request a dispatch using the OIDC token GitHub already mints. The rejected shortcuts are recorded there: a
self-issued nonce, a committed instance id without a nonce, and a relaxed guard each delete the attestation's
meaning to make a check go green.

### Corrected — the record on #248, and AGENTS.md said it wrong until now (2026-11-15)

Production's master-realm admin was never unreachable: `400 invalid_grant` appeared only when an operator script
fell back to its loopback default password against a live host. `AGENTS.md` still asserted the original false
diagnosis — "unrecoverable by environment variables… recovery needs `bootstrap-admin user` with all nodes stopped"
— which is the first thing an agent reads, and the paragraph above it even warns that stale prose is why that
paragraph was rewritten once already. Corrected in place with the measured cause, the refusal now implemented in
`scripts/identity-credentials.ts`, the framing that the 26.x bootstrap rename is declaration correctness for new
deployments only, and the note that `platfolio.dev` / `preview.platfolio.dev` do not resolve yet so browser auth is
configured and read back, **not exercised against a live UI**. The 11 §9 gate list also gained the eleventh gate it
had been citing but never contained.
