# platfolio — UI: component library, page schema, and (later) mobile

Answers the maintainer's two questions: **is Cordis suited to the frontend?** and **can pages just be
configuration?** Read with [07 interfaces](07-interfaces-api-mcp-mobile.md) and
[10 extension seams](10-cordis-kernel-and-extension-seams.md). Status: proposal.

## Short answer

- **Component library: yes, build it, and treat it as the real product surface.** It is the highest-value,
  lowest-risk part of the frontend ask, and it is what makes the mobile app cheap.
- **Pages as configuration: yes for *composition*, no for *logic*.** A declarative page/scene schema
  rendered by a fixed component set gets most of the benefit (dynamic forms, dashboards, onboarding
  steps, per-platform screens) with none of the escape-hatch pain. Anything that needs conditional
  logic, async coordination, or optimistic UI becomes a **registered component**, not a page document.
- **Cordis in the browser: possible, but not for v1.** Core is runtime-agnostic enough for it
  (`logger-console` ships `lib/browser.js`; deps are `cosmokit` + `@standard-schema/spec`), and
  `@deepseek-ai/dsh-client-ui-cordis` proves the pattern exists — but it peers onto harness-specific
  client packages, so nothing there is reusable, and hot-loaded React components inside a session-
  bearing admin UI is a capability the security model in
  [10](10-cordis-kernel-and-extension-seams.md) explicitly refuses (Tier 2 code must not run in the
  same trust domain as a user's session).

## Layers

```
packages/tokens      design tokens (color/space/type), light+dark, no framework deps
packages/ui          React component library  ← the durable asset
packages/page-schema page/scene document schema (StandardSchema) ← shared with mobile
packages/api-client  generated from OpenAPI   ← single data path
apps/site            Astro + islands: renders page documents with packages/ui
apps/mobile (later)  Expo/React Native: renders the SAME page documents with a native component map
```

### `packages/ui` rules (these are what make portability real, so they are testable)

- **No data fetching inside components.** Props or the generated client only. A component that calls
  `fetch` is a component that cannot be reused natively.
- **No DOM/global assumptions in presentational components.** Behavior lives in framework-level hooks;
  anything touching `document`/`window` is quarantined in a `web/` subpath with a lint rule that fails
  CI if imported from a presentational component. This is the check that keeps the promise instead of
  the intention.
- **Styling via tokens, not utility-only strings**, so a native theme can map onto them.
- **Every component has a headless variant** where behavior matters (tables, forms, steppers, command
  palette), so native can re-skin without re-implementing logic.
- **Navigation is a route table**, not `<a href>` assumptions, so mobile can reinterpret it.
- **Forms are generated from the same schema layer** as the manifest (`packages/manifest`) — one
  validation implementation for the API, the server, the web form, and the mobile form.
- Documented a11y contract per component (keyboard, focus, labels); this is also what makes an
  accessibility statement sellable to teams.

### Page document (`packages/page-schema`)

A page is data when it is: a dashboard, a detail view, a wizard/onboarding flow, a form, a list with
filters, a status page. Each is a bounded, well-understood shape that platfolio needs dozens of —
per platform, per provider, per plan — and a component library renders them all.

```
Page {
  id, title, permissions[], dataQueries[]        // server-defined queries via the API contract
  layout: { sections: [ { component, props, when?, bind? } ] }
  actions: [ { intent, target, confirm?, disabledWhen? } ]   // intent = API operation name
  i18n: { keys, fallback }
}
```

Deliberately **not Turing-complete**: `when`/`disabledWhen` are expression-limited predicates over
query results, actions are named API intents with declared confirmation semantics, and there is no
`!!js`-style escape hatch (contrast [R5 in 10](10-cordis-kernel-and-extension-seams.md): config that
is code must stay trusted-input-only — the same discipline applies to UI documents, which are
server-supplied and tenant-visible).

Why this is the right size of ambition: it turns "add a hosted platform" (D9) into a **data change**
— a manifest plus page documents — instead of a frontend release, and it makes the same screens appear
on web and mobile without writing them twice. When a screen genuinely needs custom logic, it is
registered as a component in the map and the page document references it; that is the escape hatch,
and it is compile-time, not runtime.

### Server-driven, not code-down

The API returns **intents and descriptors**, the client owns execution:

- Server: page documents, component-registry allowlist, action intents + required confirmation,
  entitlement-filtered visibility.
- Client: which component renders what, transitions, optimistic updates, form state, error surfaces.

This keeps a mobile binary meaningful in App Store review (behavior is data-driven content, not
downloaded executable code), and keeps the security boundary honest: nothing downloaded at runtime can
run with the user's session beyond the allowlisted component set.

## Secrets panel (D21) — implemented as data

`packages/page-schema` implements the panel as a validated page tree, not as markup: a component
registry (`page`, `heading`, `notice`, `badge`, `secret-group`, `secret-field`, `link-field`,
`instructions`, `action-button`) with strict prop schemas, `buildSecretsPanel(manifest, instance,
capabilities)` producing it from a Platform Manifest plus instance state, and a plain-text projection
that the SDK, an MCP tool response and a mobile client can consume without a browser.

The write-only guarantee is enforced in three places, because one of them will eventually be
misunderstood by someone: the `secret-field` prop schema has no `value` key (so a caller that tries to
carry one fails with `unrecognized_keys` naming it), `findValueBearingProps()` walks the finished tree
rejecting any value-shaped key, and the builder runs both before returning — a malformed panel cannot
be built, only failed to build. Capability state changes the *components*, not just the copy: without
`sealedVariables` there is no input field at all, only a deep link and a warning notice; strict custody
renders instructions routed to the tenant CI. D23 filtering is visible in the output — a
production-only external service has no staging rows, and the group says why.

A React/Astro renderer over this schema is still to come (it lands with E12's framework wiring); what
exists is the definition, the builder, the projection and the tests.



Where a tenant sets a platform's secrets is the instance's project/environment view, not a separate
ritual: one field per declared secret, labelled with the name from the manifest, grouped by service and
environment, and filtered so a production-only external service (D23) shows no staging rows.

Write-only by construction: the component takes no value prop to render, never displays a current value,
and its success state is a receipt naming the secret and the environment rather than echoing anything
back. The provider's `sealed-variables` capability decides the copy — *stored, sealed, cannot be read
back* — and when the capability is absent the panel offers the `tenant-side` deep link instead. That is a
**E18 measured `sealedVariables: false` for Railway** (no seal setter exists in the API, and sealing
cannot be verified), so the panel today renders deep links and no input fields at all: the gating is
load-bearing, not decorative. It is also why the flag must come from provider measurement rather than
from a manifest author's hope. That is a
visible choice, never a silent downgrade to writing an unsealed secret.

## Mobile (D10)

Scope and sequencing, deliberately small:

- **v1 mobile** = read-mostly ops surface: instance list and status, recent releases, health, incident
  notices, approvals (`required-reviewer` gates and `NEEDS_APPROVAL`), and redeploy with the
  plan-hash confirmation flow from [04](04-execution-plane-github-workflows.md). Push notifications
  ride on lifecycle events, never polling. Last-known state always shows its age.
- **Auth**: OAuth 2.1 with the device-authorization grant and secure storage
  ([07](07-interfaces-api-mcp-mobile.md)); scopes capability-shaped, so the mobile app asks for less
  than the web dashboard.
- **Store prerequisites that are schedule items, not afterthoughts**: Apple Developer program ($99/yr,
  and notarization applies to the installer too — [08](08-distribution-and-licensing.md)), Play
  console, app privacy declarations (what tenant data the app can display), account deletion requirement
  (App Store policy demands in-app account deletion, which is exactly the flow
  [06](06-billing-and-lifecycle.md) already specifies — so build it server-side first and the store
  rule is free), 2FA support, and a support/contact URL.
- **Native modules to avoid for v1**: push-heavy background work, offline edit, biometric-gated
  infrastructure writes. None of them are needed to deliver value, and each is a review surface.

## What the plugin idea does *not* mean here

Two things the framing could be read as asking for, both rejected on purpose:

1. **Third-party React components loaded into the admin UI.** Rejected: cross-tenant XSS and session
   theft. Third-party extension reaches the UI through **page documents referencing the allowlisted
   component map**, or through its own app using the public API/MCP — which is the same contract
   surface an agent uses ([07](07-interfaces-api-mcp-mobile.md)).
2. **A page builder product.** Rejected as scope creep: platfolio is a hosting control plane. The page
   schema is an internal rendering mechanism plus, at most, tenant-facing dashboards — not a marketing
   site builder ([01 non-goals](01-product-and-decisions.md)).

## Consequences for the plan

- `packages/ui` + `packages/page-schema` become M1-adjacent, not a polish phase: every later feature
  is authored against them, and retrofitting a component library after four screens exist is the
  expensive version of this task.
- The [07](07-interfaces-api-mcp-mobile.md) rule stands and gets teeth: **the API is the only way
  anything works**, so the UI is a client of record and mobile/CLI/agents inherit it for free.
- Add to M0: E9 — render one page document from the schema in both Astro and a React Native harness
  (proves portability before it becomes a bet); E10 — vendor/build check that Cordis core runs under
  our own toolchain and Node pin without `--expose-internals`.
