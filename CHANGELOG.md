# Changelog

Notable changes to the platfolio project. One human-readable entry per user- or developer-visible
change; entries describe merged intent, not aspirations.

"## [Unreleased]

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
  warning ("this is development, not a deployment"), which is what [selfhost/compose.yaml](selfhost/compose.yaml)
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
  `live` instance at `status-production-54d3.up.railway.app`, HTTPS with a Let's Encrypt certificate,
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
