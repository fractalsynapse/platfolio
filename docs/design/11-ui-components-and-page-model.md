# platfolio — UI framework: the component, layout, and page specification

> **Authority, so this document and its rules do not become two descriptions of one fact:**
> [docs/ui-architecture.md](../ui-architecture.md) is **normative** for the six UI architecture rules and the
> gate that enforces each. **This document is the design rationale, the full contracts and the history those
> rules are drawn from.** Read this for *why* and for the shape of a contract; read that file for *what a
> reviewer fails a screen on*. Neither restates the other.

Implements D10 and D14, extended by the maintainer's direction of this revision: **React with pluggable
reusable components and layouts, built from the ground up for real-time communication, mobile first with
progressive enhancement as the screen widens, one signals bus between components, one data path through a
pluggable API SDK — a UI framework that can later unify mobile web, desktop web, mobile apps and desktop
apps.** Read with [07 interfaces](07-interfaces-api-mcp-mobile.md),
[10 extension seams](10-cordis-kernel-and-extension-seams.md) and the decisions cited inline.

This is a **specification, not a proposal**: every section ends in acceptance that a reviewer or a CI gate
can run against one screen and fail it on named criteria (§9). Status tags used throughout:

- **measured** — verified against this working tree, at this revision;
- **specified** — this document is the contract; nothing implements it yet;
- **proposed** — needs work or a decision before it is a contract;
- **absent** — the capability does not exist, including where the UX would need the backend to have it (§4).

## Short answer

- **The framework is React, and the unit of reuse is the component contract (§1), not the component file.**
  A screen is legal only if every part of it satisfies §§1–3 and passes §9; that is what makes the same
  pages render in a phone, a browser tab and (later) a native shell.
- **Responsive is a property of layouts, not of components.** Layout primitives size containers; components
  react to their *container* via container queries, never the window (§2). This is the mechanical reason
  single-column mobile and multi-column desktop share a component set instead of forking it.
- **Components talk to the backend only through the SDK (§6), and to each other only through the typed
  signals registry (§3).** No `fetch` in a component, no stringly-typed event bus, no second client beside
  the spec — #247's lesson, enforced by gates, not by convention.
- **"Built for real-time" is now a requirement (D64, 2026-11-15), and it is half buildable today.** In-page
  signals and conditional-GET freshness are client work; a server push channel is **absent** —
  `apps/control-plane/openapi.yaml` has 31 paths and 36 operations, all request/response, no event stream of
  any kind (re-measured 2026-11-15; prefer re-measuring, per the rules doc's own note on stale counts).
  D64 answers UI-OD2: *design the push capability, ship polling first*. §4 names the operations the design
  now requires and the UI still must not ship a "live" UX before they exist
  ([07 § The rule](07-interfaces-api-mcp-mobile.md#the-rule)).
- **Mobile overlays preserve in-progress work across push/pop, backgrounding, and reload — client-side,
  never server-side, and never for secret values** (§5), because D4/D53 do not bend for convenience.
- **The native vehicle is the maintainer's open decision, and this spec is what makes waiting cheap** (§7):
  every fork in that table costs the same money — the contracts in §§1–3 — only if those contracts are
  enforced by CI before the first screen ships.

## The security line, restated and not moved

**"Pluggable" here means swappable at build time behind a versioned registry, never loadable at runtime.**
[10's Tier 2 boundary](10-cordis-kernel-and-extension-seams.md#the-seams-capability-names-not-implementations),
D13 and D14 stand unchanged: no third-party React component is ever loaded into the session-bearing admin
UI, because an in-process extension shares the heap of the user's session and that is cross-tenant XSS with
a nicer name. The UI seam of
[10's capability table](10-cordis-kernel-and-extension-seams.md#the-seams-capability-names-not-implementations)
(`ui.registry`) stays a Tier 1, first-party, code-reviewed registry. Third parties reach the interface
through page documents referencing the allowlisted component map, or through their own app on the public
API/MCP — which is the same contract surface an agent uses ([07](07-interfaces-api-mcp-mobile.md)). A
reviewer who reads "pluggable components" in this document and sees a runtime plugin loader has
misread it, and the §9.6 gate rejects the misreading. This revision adds **no** new code-execution
surface: overlays, signals and drafts move data, never code.

## What exists, what does not (measured this revision)

| Path | State |
| --- | --- |
| `apps/control-plane/openapi.yaml` | real — 31 paths, 36 operations (re-measured 2026-11-15; the previous revision said 34, which is exactly the drift the rules doc prices), validated both directions by `api:check`; **no** SSE/WebSocket/event path, no ETag/304 cache semantics declared anywhere in it |
| `packages/api-contract/src/generated/types.ts` | real, 894 lines (re-measured 2026-11-15; 830 last revision) — exports `Instance`, `Attestation`, `Error`, `OperationId`, `ParamsOf`, `RequestBodyOf`, `ResponseOf`, `SuccessOf`; byte-for-byte gated by `api:types:check` |
| `packages/page-schema` | real — `page.ts`, `secrets-panel.ts` (`buildSecretsPanel`, `findValueBearingProps`), `binding-panel.ts` (`buildBindingPanel`), `project-text.ts` (`projectToText`), with tests |
| `packages/ui` (per D63: all reusable components **and** design tokens as CSS custom properties — no separate tokens package) — **exists since 2026-11-15** with contracts, tokens, primitives, signals, the SDK seam and gates, **and no screens**; `packages/api-client`, `apps/site`, any web UI | **do not exist** — everything in §§1–8 that names them is `specified`. D63 decided what `packages/ui` will contain; it did not make it exist |
| a UI service in `compose.yaml`; `platfolio.dev` / `preview.platfolio.dev` resolving | **absent** — D62 has decided the hosts, the DNS records, certificate and service do not yet exist; the API side is already prepared (`PLATFOLIO_ALLOWED_ORIGINS` feeds CORS and the `platfolio-web` PKCE client's `<origin>/callback` redirect URIs) |

So the honest baseline is: **the contract exists, the panel builders exist, the UI does not.** That is the
best possible position to write a specification from — no screen exists that can lobby to be exempt.

## 1. Component contract

A component is a **registered contract**, not a file that returns JSX. The registration is the thing §9
checks; the JSX is incidental.

```ts
// packages/ui/src/contract.ts — SHIPPED 2026-11-15 (the package exists; no screens do yet).
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OperationId } from '@platfolio/api-contract/generated/types';
import type { SignalId } from './signals.ts';           // §3
import type { LayoutSlot } from './layout.ts';          // §2

export interface ComponentContract<P extends object> {
  /** The only handle a page document has on the component. Stable across releases:
   *  a stored page document either renders or fails loudly, never silently drifts. */
  readonly id: string;
  /** Prop schema in the same StandardSchemaV1 mechanism as the manifest and the API
   *  ([07 § Web and mobile portability](07-interfaces-api-mcp-mobile.md#web-astro-and-mobile-portability)):
   *  one validation implementation for server, web form, mobile form. */
  readonly props: StandardSchemaV1<unknown, P>;
  /** The API operations whose results this component may render. Entity types come from the
   *  generated contract — `Instance`, not a re-declared shape. */
  readonly reads?: readonly OperationId[];
  /** Signals (§3). Declaring is required to use: an undeclared `emit` or `subscribe`
   *  fails type-check at registration, not at runtime. */
  readonly consumes?: readonly SignalId[];
  readonly produces?: readonly SignalId[];
  /** Layouts the component promises to behave inside (§2). Unlisted slot = contract
   *  violation, not ugliness. */
  readonly slots: readonly LayoutSlot[];
  /** Draft persistence is an ALLOWLIST (§5). A field is never drafted unless named here,
   *  and the registry rejects a `draftable` entry whose prop path is value-bearing. */
  readonly draftable?: readonly string[];
  /** Pure render: no `fetch`, no storage, no `document`/`window` in the presentational
   *  part — web-only behavior lives beside it in `packages/ui/src/web/`, per the 07 rule. */
  readonly render: (props: P) => React.ReactNode;
}
```

Rules, each with the gate that enforces it (all in §9):

1. **Props are typed from the generated SDK contract.** A component prop carrying server data is typed by
   importing `@platfolio/api-contract/generated/types`; declaring a local interface with the same fields is
   the #247 bug wearing a `.tsx` extension. The only sanctioned local types are view-models explicitly
   derived (`Pick`, `Readonly`, unions of discriminants) and reviewed as such.
2. **No direct `fetch`.** No transport, no URL building, no headers in a component. Data arrives as props
   from an island's container, or through the SDK hook layer (§6) — the maintainer's "components
   communicate with the backend directly through the SDK" is implemented as *through the SDK, never around
   it*; [07](07-interfaces-api-mcp-mobile.md) already permits "props or the generated SDK client plus one
   state layer".
3. **No own storage.** A component does not write `localStorage`/`sessionStorage`/IndexedDB itself.
   Persistence goes through the draft store (§5), opted in via `draftable`, so the security review has one
   place to look.
4. **Signals in/out are declared.** §3.
5. **Every component that carries behavior has a headless variant** (kept from the prior proposal): tables,
   forms, steppers, the overlay stack, the command surface. A native renderer re-skins without
   re-implementing logic (§7).
6. **Navigation is a route-table intent**, never `<a href>` assumptions (kept; it is what lets a native
   shell reinterpret routes).
7. **Forms generate from the manifest/schema layer** the way `buildSecretsPanel` already does (measured:
   the builder exists; the React renderer does not).

**Acceptance.** (a) A `packages/ui` export that is not a registered `ComponentContract` fails the build.
(b) The fixture suite renders every registered component from a props object validated by its own schema —
an unvalidatable prop set is a failed test, not a runtime surprise. (c) `grep` gates: no `fetch(`,
`XMLHttpRequest`, storage APIs, `window.`/`document.` in presentational sources (gate §9.2). (d) The
secrets panel renders through this contract using the real `buildSecretsPanel` output; a `secret-field`
whose schema gains a `value` key fails `findValueBearingProps` today, and must keep failing it (measured
mechanism, specified continuation).

## 2. Layout contract

**Layout-driven responsive means the layout primitive chooses, the component reacts, and the unit of
"responsive" is the container, not the window.** The primitives set `container-type: inline-size` and own
their tracks; components query that container:

```css
/* packages/ui/src/layout/layout.css — SHIPPED 2026-11-15, generated from primitives.ts and byte-checked by `ui:css:check`. The primitive owns the container. */
.ui-layout { container-type: inline-size; }
@container (min-width: 48rem) { .ui-split { display: grid; grid-template-columns: 24rem 1fr; } }
```

Why this — and not `@media` — is what makes mobile and desktop share components: a window breakpoint tells
a component what *device* it is on, so every component eventually grows an `isMobile` fork and the two
forks drift. A container query tells a component how much *room it has*, so the same component behaves
like the phone version when dropped into a 320 px popout sidebar on a 1920 px desktop, and like the desktop
version when the phone rotates. The fork disappears because the knowledge moves up: **layouts decide
composition; components only ever implement the narrow case.** Progressive enhancement is then exact, not
vibes: at 360 px every capability is present in one column; wider screens add *simultaneity* (split,
sidebar, hover-revealed detail), never *capability*. A feature that exists only on wide layouts is a spec
violation (§9.11), because it means some component forked — or a screen was built desktop-first.

### The primitives

| Primitive | What it is | Mobile (stack model) | Desktop / wide |
| --- | --- | --- | --- |
| `stack` | Single ordered column, the default and the floor. | The whole page. | A column inside `split` or a sheet body. |
| `split` | Two tracks: master + detail. | Never two-up; degrades to stack + push (`overlay-sheet`). | List left, detail right; the detail track may host a sheet or a stack. |
| `popout-sidebar` | Contextual column that floats over the edge at mid widths, occupies a track at wide. | Becomes a bottom sheet. | Persistent detail rail (instance context, activity). |
| `overlay-sheet` | The mobile "stack" entry: bottom sheet pushed onto the stack; renders as a centered dialog (mid) or right rail (wide) — **same component, one contract, three homes**. | Full-width bottom sheet, swipe/Esc to pop. | Dialog or rail, per available width of its *container*. |
| `full-page` | Route-level document; the only primitive that survives a reload as itself. | Same. | Same. |

Containment rules (which components may appear in which) — declared by `ComponentContract.slots`:

| Primitive | May contain | May not contain |
| --- | --- | --- |
| `stack` | Any registered component; at most one nested layout (a stack inside a `split` cell). | An `overlay-sheet` — a sheet is pushed onto the page-level stack, never embedded in a column (that is what "stack-like" means: there is exactly one sheet discipline per page). |
| `split` | `stack` in each track; a `popout-sidebar` as the detail track at wide widths. | A second `split` — two-up inside two-up is a dashboard product, and D14's non-goal list already says no page builder. |
| `popout-sidebar` | One context panel plus its stack; read-mostly components. | A second `popout-sidebar`; destructive actions that lack their confirmation surface (§4 of [04](04-execution-plane-github-workflows.md): plan-hash confirmation has no condensed form). |
| `overlay-sheet` | Forms (including the write-only secret form), wizards, row detail; depth ≤ 2 sheets. | A third nested sheet; another sheet in the same stack entry. |
| `full-page` | Anything. | — |

**Acceptance.** (a) No `@media (width…)` / `min-width` / `max-width` query in `packages/ui` presentational
sources — `prefers-*` media queries (motion, color, contrast) are the only window-level input any component
may read (gate §9.3). (b) No prop named `isMobile`, `compact`, `desktop` or sibling: width behavior comes
from container queries only (gate §9.3). (c) The *same-slot test*: every registered component renders in
every slot its contract lists, at 320 px and 1280 px container widths, in one Playwright matrix, with no
variant fork in its source. (d) Capability parity: for every screen, the set of API operations reachable
from its components at 360 px viewport equals the set reachable at 1920 px (derived from `reads`
declarations; gate §9.11).

## 3. Signals registry

Components must react to each other (context selection is the canonical case: change instance, every
panel reloads) without importing each other. That is a **typed signal table**, held by the UI framework,
processes no tenant data to the server, and is emphatically not an event bus of strings:

```ts
// packages/ui/src/signals.ts — SHIPPED 2026-11-15 (no screens yet).
import type { OperationId } from '@platfolio/api-contract/generated/types';

export type Retention = 'replay' | 'transient';

export interface PlatformSignals {
  /** THE context selection (D56: state is per environment, so the environment is part of
   *  the context, not a detail inside it). */
  'context.switched': {
    payload: { teamSlug: string; instanceId: string | null;
               environment: 'development' | 'staging' | 'production' };
    retention: 'replay';
  };
  /** Fires from §4's poller today; from the event stream when §4's dependency lands. */
  'instance.state-changed': {
    payload: { instanceId: string; environment: string; from: string; to: string };
    retention: 'transient';
  };
  /** Names only — never the value that was saved (D53: presence, not contents). */
  'secrets.saved': {
    payload: { instanceId: string; name: string; environment: string };
    retention: 'transient';
  };
  'refresh.requested': { payload: { operation: OperationId } | null; retention: 'transient' };
  /** The overlay stack itself is a signal: pages and drafts key on it (§5). */
  'overlay.changed': { payload: { stack: readonly string[] }; retention: 'replay' };
}

export type SignalId = keyof PlatformSignals;

export interface SignalBus {
  emit<I extends SignalId>(id: I, payload: PlatformSignals[I]['payload']): void;
  /** A late subscriber is synchronously handed the stored value first — iff the signal's
   *  declared retention is 'replay'. There is no default: declaring a signal without its
   *  retention does not compile. */
  subscribe<I extends SignalId>(
    id: I,
    handler: (payload: PlatformSignals[I]['payload'], meta: { seq: number; replayed: boolean }) => void,
  ): () => void;
}
```

### The hard question: does a late-mounting component replay?

**Yes, for signals marked `replay`, from a value the registry itself stores. Default recommendation:
replay-from-store.** The alternative — future-only delivery — sounds simpler and is not: a component
mounted *after* the context changed (a sheet opened later, a lazily hydrated island, a screen re-entered in
a native shell) would render with no context, and the only fixes are "re-emitter hacks" from some long-lived
parent or every component refetching its own context — the second violates §6's one-data-path rule and the
first recreates the ad-hoc prop drilling this registry exists to kill. The maintainer's own example —
"respond to signals from other components (like a context selection)" — is exactly the signal that must
replay, because "current context" is a fact, not a moment.

The costs, stated, because they are why retention is a declared choice per signal and never a default:

1. **A replayed value is a stale value with confidence.** Mitigation: the monotonic `seq` plus the
   subscriber's obligation — anything *about the server* still comes from the SDK; replay tells you which
   query to run, not the answer.
2. **Replay re-fires side effects.** A transient-by-nature signal (a toast request, a confirmation intent,
   anything credentialed) replayed is a bug worse than staleness: it is an action happening twice or a
   value surviving in memory after its moment. Hence: **`transient` is mandatory for any signal whose
   payload could re-trigger a mutation or carries a value-shaped key.**
3. **The store is memory + a serialization surface.** It holds refs and ids only; a reviewer can enumerate
   every replayed signal because the table is one file.

**Acceptance.** (a) `emit('context.switched', { teamSlug: 1 })` fails to compile — the fixture suite keeps
a deliberately broken call as a negative test. (b) Grep gate (§9.4): no `window.dispatchEvent`, no custom
`EventTarget`, no `.on('string')` outside the registry implementation; adding a signal requires a table
entry, which is where the review happens. (c) Registry test: every `replay` signal's payload passes a
`findValueBearingProps`-style walk (the mechanism is real today in `packages/page-schema`) and contains no
key matching the secret/token/value shapes. (d) The **late-mount test**: fire `context.switched`, *then*
mount a subscribing component; its first render shows the selected context. And its inverse: fire a
`transient` signal, mount late, assert silence. (e) Every `produces`/`consumes` list is non-empty-checked
against actual use: a declared-but-unused signal fails, so the table cannot silt up.

## 4. Real-time

"Built from the ground up for real-time communication" is now a decided requirement, not an aspiration:
D64 (2026-11-15, answering UI-OD2) says the UI must be capable of a real-time interface even though it
starts out polling. Against the control plane **as it exists today** (re-measured 2026-11-15: `openapi.yaml`
has 31 paths, 36 operations, zero push endpoints, zero cache validators — no `ETag`, no `304`, no
`text/event-stream` anywhere in it) the requirement decomposes into three fabrics, and they have very
different statuses:

1. **In-page real-time — buildable now (specified).** The §3 bus plus one state layer means one poller or
   one user action updates every subscribed panel without refetching the world. This is the half the
   maintainer's brief can have immediately.
2. **Freshness from the server — buildable now at polling cost (specified).** Conditional GETs with
   `ETag`/`304` on the list/read operations, held entirely in the SDK transport (§6), give per-operation
   freshness without new endpoints — but note honestly: the server does not emit `ETag` headers today
   (absent), so even this is a small server change, not a client-only one.
3. **Server push — required by the design (D64), does not exist yet (absent). The UI is built as if it
   will, and must not pretend.** What §4 names below is therefore **required work, not optional** — the
   record of that answer, with no implementation in this document.

### The mechanism table

| Mechanism | What it costs the platform | Verdict for this spec |
| --- | --- | --- |
| **Polling with ETag/304** | Nothing new in lifecycle or auth; freshness = poll interval; the server must emit validators on the existing operations (absent today, a header-semantics change on paths that already exist). | **What the spec assumes for MVP.** The §3 signals fan a single poll result out to every panel, so the UX is "live-ish" with one connection per page. |
| **SSE** (`GET …/events`) | One long-lived connection per open tab behind the Railway service; browser `EventSource` cannot send an `Authorization` header, so it needs a ticketed-URL auth path — a real identity change beside the endpoint; an event store to cursor into; connection accounting to keep "live" meaningful for a host with no long-lived process (the D62 consequence note). | **The target, and required by D64 rather than optional.** Unidirectional is exactly what this product needs; it is the same shape the 07 webhooks-out rule already implies, pointed at our own UI. Design it in the spec first (§ The dependency, below); ship polling until it exists. |
| **WebSocket** | Everything SSE costs, plus framing, heartbeats, re-auth on reconnect, and a request path that `api:check` does not validate the way REST is validated (D41) — a second transport with weaker gates. | **Rejected for v1** unless a client→server stream appears; none does. Instance ops are HTTP mutations with idempotency keys ([07 § Public API](07-interfaces-api-mcp-mobile.md#public-api)); they do not need a socket. |
| **Webhook-to-server-then-push** | The ingest half genuinely exists — attestations *are* inbound lifecycle events, and `postAttestation` / `getLatestAttestation` / `listAudit` are real (measured). The fan-out half (attestation row → connected browser) is SSE plus a cursor; the tenant-facing webhooks themselves are specified in 07 and not built. | **The eventual composite**: attestations already give platfolio a live event log; the missing piece is a way to tell subscribed clients about new rows. |

### The dependency, named, and labelled as not existing

D64 made taking the push channel up **required work**, not a conditional: the capability must be built,
even though MVP ships on polling. What follows is therefore a dependency to be paid, not an option to be
weighed. These are **API operations that must be designed in `openapi.yaml` first (D41), by the sessions
that own that file and `packages/contracts` — this document does not add them, and implementing them here
is out of scope by rule**:

- `GET /api/v1/teams/{teamId}/events` — team-scoped SSE stream; `text/event-stream`; cursor via
  `Last-Event-ID` mapped to an event sequence; payloads are refs and state transitions only (never secret
  material, upholding D4/D53 by construction — the same reason §3's replay table is value-free).
  **absent — not in the spec, not implemented.**
- `POST /api/v1/teams/{teamId}/events/ticket` — short-TTL one-time ticket so a browser `EventSource` can
  authenticate at all: the browser API sends no `Authorization` header, and a bearer token cannot be put in
  the stream URL, so without this ticket the stream is an authentication hole, not a feature. Touches the
  Keycloak realm setup (D56), so it is an identity decision as much as an endpoint. **absent.**
- Whatever event rows the stream cursors over. Today the closest real facts are attestations and audit
  entries (measured: `getLatestAttestation`, `listAudit` exist); a *stream* implies a persisted, ordered
  event entity that the Store does not have. That is a contracts-surface change (minor bump, D41/10's
  versioning rule), not a header on an existing table.

**Acceptance.** (a) No component contains the word "live" or an unlabelled spinner: every state render
carries its source and age — a `lastKnownAt` field from the attestation, per the 07 rule that last-known
state *shows its age*, never a stale "healthy". (b) The SDK exposes exactly one freshness primitive
(`subscribe`/`poll`, transport-chosen), so swapping conditional-GET for SSE touches §6's transport and
nothing else — a component that polls with its own timer is a §9.2 failure. (c) Until the operations above
exist and pass `api:check`, no UI screen may present push-backed behavior; a reviewer greps the UI for
`EventSource`/`WebSocket` and finds none.

## 5. Overlay state preservation

"Stack-like overlay displays that preserve your work on each page without disruption" has three distinct
failure modes, and conflating them is how apps lose forms. The contract, per mode:

| # | Failure mode | Where state lives | Recovery guarantee |
| --- | --- | --- | --- |
| a | Overlay push/pop **within a session** (open sheet B over sheet A, pop B) | The page's in-memory overlay stack (the `overlay.changed` signal *is* its serialization); popped-but-unmounted sheets hand their draft to the store on pop and take it back on reopen — **unmount + snapshot, not hidden-keep-alive**: memory on a phone is not free, and the snapshot path is shared with (b) anyway. | Reopening A shows its exact prior values, scroll position and focus, **before first paint** — an empty-form flash is a fail (§9.9). |
| b | App **backgrounded / process killed** (OS discards the tab or webview) | IndexedDB draft store (survives both a discard-reload and a tab close; `sessionStorage` survives neither the second reliably). Flush triggers: debounce (~300 ms), and unconditionally on `visibilitychange → hidden`. | Reload restores every open sheet's draft; keystrokes lost across a kill are bounded by one debounce window — stated as the guarantee because "none" is not achievable and "unknowable" is not a spec. |
| c | **Page reload** (user pull-to-refresh, F5) | Same store as (b). | Same. |

The store (specified; `packages/ui/src/web/drafts.ts` does not exist):

- **Key:** `personSub | teamSlug/environment | pageId | overlayId` — which is why `context.switched` and the
  overlay stack are signals: drafts key on exactly what the registry already knows.
- **Contents:** form input for fields named in the component's `draftable` allowlist. Not server data, not
  responses, not anything fetched.
- **Retention rule:** deleted on successful submit; TTL 7 days; cleared wholesale on sign-out; per-draft and
  global size caps with oldest-first eviction. Never leaves the device — no sync, no server copy.
- **The secret boundary, loudly:** a secret field is **never draftable**. `secret-field`'s prop schema has
  no `value` key (measured today in `packages/page-schema`), and the registry rejects any `draftable`
  declaration whose prop path is value-bearing — the same `findValueBearingProps` predicate that already
  blocks a value-carrying panel, extended to block a value-carrying draft. A half-typed secret surviving an
  OS kill in local storage would be platfolio persisting a tenant credential against D4's spirit and
  D53's letter ("a value that exists in no read-back"): there is no read-back of a draft either, on any
  device but the one holding it. This is a **known accepted cost of the design, not a discovered loophole**:
  losing half-typed secret input on a process kill is the correct behavior.
- **Honest scope note on the Store's contract version:** keeping drafts client-only is also the reason no
  `packages/contracts` surface changes for this section. Server-side draft persistence — if anyone proposes
  it later for cross-device continuity — is a new persisted entity, a contracts minor bump under 10's
  versioning rule, and an audit question (a draft of an instance rename is tenant content in platfolio's
  database); it is out of this spec's scope, not deferred inside it.

**Acceptance.** (a) The **push-pop test**: open sheet A, type, push sheet B, type, pop B, reopen A —
values, scroll, focus exact, and the reopen's *first* render contains the draft. (b) The **reload test**:
same, then `location.reload()` — restored from IndexedDB. (c) The **secret test**: type into `secret-field`,
trigger (a) and (b), then introspect the drafts store: the test fails the build if any record contains a
value-shaped key — reusing the page-schema predicate, not a new regex. (d) The **sign-out test**: sign out
→ no draft records remain. (e) A registered component may not call storage APIs directly (§1 rule 3; gate
§9.2) — persistence in the UI has exactly one door.

## 6. The pluggable API SDK

One data path, and the path is: **OpenAPI spec → generated types → SDK → components.** The generated layer
is real (measured): `packages/api-contract/src/generated/types.ts`, byte-for-byte gated by
`api:types:check`, already exports the operation table (`OperationId`, `ParamsOf`, `RequestBodyOf`,
`SuccessOf`) that makes a *derived* client possible rather than a hand-typed one.

The layer above it, `packages/api-client`, does not exist (measured) and is specified here:

```ts
// packages/api-client/src/index.ts — SPECIFIED.
import type { OperationId, ParamsOf, RequestBodyOf, SuccessOf }
  from '@platfolio/api-contract/generated/types';

/** Transport is the pluggable seam: REST is the driver today, push/offline drivers are drivers later.
 *  Nothing above this interface knows which. */
export interface Transport {
  call<O extends OperationId>(
    op: O, input: { params: ParamsOf<O>; body?: RequestBodyOf<O> },
    auth: AuthSource,
  ): Promise<Result<SuccessOf<O>>>;      // Result carries the stable error `code`, per 07
  freshness?<K extends string>(key: K): FreshnessSource;  // poll-or-stream; §4. Components never see which.
}

export interface AuthSource { token(): Promise<string>; }  // browser PKCE today; device flow for native (§7)

/** The component-facing surface is hooks over operations, keyed by OperationId. */
export function useOperation<O extends OperationId>(
  op: O, params: ParamsOf<O>,
): { data?: SuccessOf<O>; error?: ApiError; age?: string /* lastKnownAt, per §4 */ };
```

Rules:

1. **A hand-written client beside the spec is forbidden.** The generated file's own header says every line
   reproduces from the specification; the same rule extends upward: `packages/api-client` may export only
   things *derived* from the generated table (`useOperation<'listInstances'>` infers its data type; no file
   in the package declares a response shape by writing its fields out). #247's lesson, at its higher
   altitude: the repo has already paid for two definitions of one API validating each other; a third,
   hand-typed, living in the UI, would fail every gate silently because the gates compare the two they know
   about. The check is mechanical (§9.1): a type-level test asserts every exported query's data type is
   assignable from `SuccessOf<O>` and nothing else.
2. **Transport swap does not touch components.** Conditional GET/ETag (§4.2), then SSE (§4.3), then an
   offline queue with `Idempotency-Key` replay (07 mandates the header on mutations) are each a new
   `Transport`, conformance-tested against the same suite — the rule-of-two from
   [10 § The seams](10-cordis-kernel-and-extension-seams.md#the-seams-capability-names-not-implementations)
   applied to the UI's own plumbing. A test double transport (in-memory, canned responses) is the second
   implementation that proves the seam is not REST-shaped.
3. **Auth is injected, never ambient** — the same reason the mobile app asks for fewer scopes than the web
   dashboard ([07 § Auth for clients](07-interfaces-api-mcp-mobile.md#auth-for-clients)): the SDK takes an
   `AuthSource`; the shell (web island, native app) supplies it.
4. **The API base URL is configuration** (D47): injected via the shell's build/runtime env, never a
   committed literal — the `platfolio.dev` / `preview.platfolio.dev` pair (D62) arrives the way every
   endpoint does, through the platform description, and `checkCommittedEndpoints` keeps it that way.

**Acceptance.** (a) `pnpm run api:types:check` stays the floor for the whole UI stack: if the spec moves
and the UI's types have not, the build fails — the UI inherits the contract gate, it does not own one.
(b) Zero URL literals outside the transport driver (grep). (c) Components import from
`@platfolio/api-contract/generated/types` and the SDK only; importing `openapi.yaml` parsing utilities into
`packages/ui` is a §9.2 failure. (d) The SDK ships with its transport conformance suite run against both
the REST driver and the in-memory double (specified; this is the same discipline the email and store seams
already follow).

## 7. Cross-platform reuse — the fork table

The goal, from the maintainer: the same framework pages, layouts and components powering mobile web,
desktop web, mobile apps, desktop apps. That goal is a **bill paid now** (the §§1–3 contracts and their CI
gates) or **paid later, at higher interest** (a rewrite). Which native vehicle to buy later is the
maintainer's decision, not this document's; here is the honest table.

| Vehicle | Cost | Ceiling | What it does to the contracts above |
| --- | --- | --- | --- |
| **Web only until MVP ships** | Zero now. | No store presence, no native push, no offline-kill resilience beyond the browser's own (§5b depends on the OS not eating IndexedDB). | Contracts stay *untested by a second renderer* — the risk is that §§1–3 drift into web-only assumptions quietly, and the "cheap native later" claim becomes the thing that was expensive. Mitigated only by actually running §9 in CI from the first commit. |
| **React Native (Expo)** | A native renderer for the five layout primitives, a native `SignalBus` implementation, a native `AuthSource` (device flow, 07), and the hard one: enforcing presentational purity becomes load-bearing rather than tidy. Days-to-weeks per panel today; the prior proposal's "the mobile app is a renderer, not a rewrite" is the claim being bought. | Highest: real stores, real push, background persistence that is genuinely first-class. | **Nothing breaks — but nothing forgives either.** `slots`/`consumes`/`produces` map directly; container queries do not exist in RN, so the layout engine passes width as a *prop from the primitive* — which is why §2 forbids components from reading the window: the reinterpretation is only legal because they don't. |
| **Webview wrapper (Capacitor)** | Lowest native effort: the existing bundle runs inside a shell; the draft store, signals and container queries all work because it is the same browser engine. Native plugins for push/secure storage add the parts the webview lacks. | The ceiling is the webview: per-store reviews increasingly resist it; performance on low-end devices; everything *feels* like the site with a splash screen. | Contracts untouched — deliberately, because Capacitor is the baseline every other vehicle must beat, and the day the app moves off it, §5's IndexedDB keys and §3's table are the migration. |
| **Native shell over the same web bundle (Tauri, desktop-first)** | Moderate, desktop side: the web stack runs whole; Tauri 2 extends to mobile shells with the same engine caveat as Capacitor, less mature. | Desktop-class: real windows, tray, notifications, one bundle shared with the web deploy (D62's service is literally the same build). | Same as Capacitor for the web core; desktop gets the `split`/`popout-sidebar` path (§2) as its native composition, which is the strongest argument that *layout primitives*, not windows, define the responsive contract. |

**Recommendation (not a choice, and not taken):** ship **web-only until the MVP ships**, with §9's gates
enforced from the first commit of `packages/ui`, and decide the vehicle when there is a tenant to hold it.
It can wait because there is no store account, no app privacy declaration and no push certificate to buy
yet (the prior proposal's store-prerequisites list still stands; [08](08-distribution-and-licensing.md)
carries the notarization/$99 facts); it must **not** wait past the first native screen, because the entire
cross-platform claim rests on the gates having been on before someone made a component that only works in
a browser. **OPEN → UI-OD3.**

## 8. Accessibility and touch minimums

Mobile-first is a claim on paper until hit targets, focus order and screen-reader semantics are specified,
so they are, as pass/fail criteria:

- **Touch:** primary interactive targets ≥ 44×44 CSS px in touch layouts; secondary targets ≥ 24 px with
  ≥ 8 px spacing. (WCAG 2.2 §2.5.8 sets 24 as the floor; this spec chooses 44 for primary targets because
  the primary surface *is* the phone.) Measured by a component-level geometry audit at a 360 px container,
  not by review vibes.
- **Focus:** overlays (`overlay-sheet`, dialogs) trap focus, close on Escape at the topmost sheet only,
  and return focus to the element that opened them; pop preserves the previous sheet's focus (ties to §5a).
  Tab order equals visual stack order in every layout — container queries must not reorder DOM.
- **Screen readers:** every sheet is `role="dialog"` + `aria-modal="true"` + `aria-labelledby` its title;
  sheet open/pop is announced; signal-driven region updates (`instance.state-changed`, §3/§4) land in
  `aria-live="polite"` regions, never assertive; every form field's label and error association derive from
  the StandardSchema props (§1) — a generated field that cannot produce an `aria-describedby` link fails
  the fixture suite; errors are text, never color alone.
- **Contrast/motion/type:** tokens ship AA contrast for text and 3:1 for non-text indicators; overlay
  transitions respect `prefers-reduced-motion`; layouts hold at 200 % text scaling and at 320 px width.
- **Keyboard parity:** every capability reachable by pointer is reachable by keyboard — which is the same
  invariant as 07's "no feature ships in a UI first" at screen level: an intent with no focusable control
  is the button-shaped form of a capability only reachable by clicking.

**Acceptance.** axe-core runs in CI over every rendered page-document fixture at a 360 px and a 1280 px
container with **zero** AA violations; the focus behaviors above are automated testing-library tests (trap,
Esc-topmost-only, restore-on-pop); the target-size audit is a script, not a checklist a human forgets on a
Friday.

## 9. The conformance checklist

The deliverable the maintainer asked for: any screen, any reviewer, fail it on named criteria. Split into
CI gates (mechanical, block merge) and the reviewer pass (one screen, ten questions, each has a method).

### CI gates — every one is a grep, a type test, or a browser test

1. **Contract floor.** `api:types:check` and `api:check` green — the UI's types are the spec's types
   (§6.1). *Method: existing gates.*
2. **No rogue data or storage.** Zero `fetch(`, `XMLHttpRequest`, `localStorage`, `sessionStorage`,
   `indexedDB`, `window.`, `document.` in `packages/ui` presentational sources outside `web/` and the SDK's
   transport driver; zero timer-based polling outside the freshness primitive. *Method: lint rule.*
3. **Layout discipline.** Zero `@media` width queries and zero `isMobile`-style props in `packages/ui`;
   every layout primitive declares `container-type`. *Method: grep gate in the build.*
4. **Typed signals only.** Zero raw `EventTarget`/`dispatchEvent`/string-event subscriptions outside
   `signals.ts`; every signal in the table has an explicit `retention`; every `replay` payload passes the
   value-bearing walk. *Method: lint rule + registry unit tests (§3 acceptance).*
5. **Registration.** Every export used by a page document resolves in the component registry with a props
   schema; rendering a stored page document with an unknown component id or an invalid prop set fails
   *loudly*, at validation, not as an empty div. *Method: fixture that re-renders yesterday's document.*
6. **No runtime-loaded code.** The registry is build-time; `packages/ui` has no dynamic import of
   non-first-party URLs; page documents contain data, never expressions-that-evaluate. *Method: grep + the
   page-schema validation that already refuses value-bearing keys.* (This is gate #247 for the security
   line at the top.)
7. **Same-slot matrix.** Every component renders clean in every slot its contract declares, 320 px and
   1280 px. *Method: Playwright.*
8. **a11y floor.** axe AA zero violations on every fixture at both container widths; focus tests pass;
   target-size audit passes at 360 px. *Method: §8's suites.*
9. **Draft contract.** push→pop→reopen restores before first paint; reload restores from IndexedDB; the
   store contains no value-bearing record for any secret field; sign-out empties it. *Method: §5's tests.*
10. **Freshness honesty.** Every server-derived render carries `lastKnownAt`; no screen renders a state
    without its age; no `EventSource`/`WebSocket` exists while §4's operations remain absent.
    *Method: type-level — the data hook's result includes age by construction — plus grep.*
11. **Capability parity across widths.** For every screen, the set of API operations reachable from its
    components at a 360 px container equals the set reachable at 1920 px, derived mechanically from the
    components' declared `reads` (§2 acceptance (d)) — not from a screenshot, and not from a reviewer's
    impression. A capability that exists only on wide layouts is the failure this gate exists to make
    unfashionable: it means someone forked a component or built a screen desktop-first, and mobile users
    silently get a smaller product. *Specified, cannot run today: needs `packages/ui`, so like gates 2–5 and
    7–9 it is **not run**, never **passed**. Adding it after screens exist audits nothing, which is the same
    reason gate 1 must land with the first commit.*

### The reviewer pass — look at one screen, fail it on these

| # | Question | Fail when |
| --- | --- | --- |
| R1 | Open it at 360 px: is every capability reachable? | Anything exists only at wider widths (§2 parity). |
| R2 | Push two sheets, rotate/resize/reload: is the half-typed form still there, identically? | Any of the §5 modes loses input beyond one debounce. |
| R3 | Where did each number on this screen come from? | Any data not traceable to an `OperationId` in the generated table. |
| R4 | Escape/Tab through the whole task, keyboard only. | Any pointer-only action; focus not restored on pop. |
| R5 | Turn on reduce-motion / 200 % text. | Transition ignores the preference; layout clips. |
| R6 | Read the component's registration: slots, consumes, produces, draftable. | A behavior exists that the declaration does not cover. |
| R7 | Find the state word on the screen ("live", "healthy", "up to date"). | Present without an age; present when §4's push is absent. |
| R8 | Type a secret, refresh, inspect local storage. | Any value-bearing record persisted (D4/D53 — this one stops the release). |
| R9 | Would this screen's components survive `import` from a native shell unedited? | It imports from `web/`, reads the window, or knows its slot. |
| R10 | Delete the server: what does the screen show? | A spinner forever instead of last-known state with age, or (worse) a fabricated optimistic success. |

A screen ships when gates 1–10 are green **and** R1–R10 pass on review. There is no "mostly" tier; that is
the difference between a specification and an aspiration.

## Kept and superseded from the prior proposal

**Kept and extended** (the prior decisions survive this revision because the maintainer's direction does
not contradict them, and a framework spec is what "make it testable" needed):

- **Layers** — tokens/ui/page-schema/api-client/site, now with existence status at top. **The tokens layer
  was folded into `packages/ui` by D63 on 2026-11-15: no separate tokens package; tokens are CSS custom
  properties that ship with the components.** `packages/ui` rules (props-not-fetch, quarantined `web/`,
  tokens-not-utility-only, headless variants, route table, schema-generated forms) became §1's contract
  with named gates.
- **Pages as composition with registered components; page documents deliberately not Turing-complete** —
  unchanged; §9.5–9.6 are its enforcement now.
- **Server-driven, not code-down** — unchanged, and restated loudly as *the security line*, because
  "pluggable components" is exactly the phrase a future reader will mis-expand into hot-loaded third-party
  React. [10's Tier 2 boundary](10-cordis-kernel-and-extension-seams.md#the-collision-and-the-resolution),
  D13 and D14 are not reversed anywhere in this document.
- **The secrets panel as data** — kept as the spec's *first real client* of §§1/5/6: `buildSecretsPanel`,
  `findValueBearingProps` and the text projection are measured-real; the React renderer is still to come.
- **Mobile v1 scope, auth, store prerequisites** — moved under §7 as the native vehicle's obligations,
  unchanged in substance.
- **Astro + islands as the web shell** ([07 § Web](07-interfaces-api-mcp-mobile.md#web-astro-and-mobile-portability))
  — **kept with a disclosed tension**: if every interactive region is an island, the shell is a router
  detail, not architecture. Whether the dashboard stays under the Astro shell or becomes a plain React
  mount inside the D62 service is **OPEN → UI-OD1**; either satisfies D62, and the choice changes only the
  `apps/site` build, not §§1–8.

**Superseded:**

- The old "No data fetching inside components" line, read as *props only* — replaced by the explicit two
  sanctioned doors (props from a container, or the SDK hook layer), because the maintainer's brief says
  components communicate with the backend *directly through the SDK*, and 07 already permitted it
  ("props or the generated SDK client plus one state layer"). This is a clarification the old rules already
  allowed, now with the transport seam defined (§6).
- "Push notifications ride on lifecycle events, never polling" (07's line, echoed in the old mobile scope)
  — **as applied to the web UI this is currently impossible** (no push channel exists, §4), so this spec
  assumes conditional-GET polling *labeled by age* until the operations in §4 exist. The sentence survives
  as the target, not as today's behavior; a doc that recited it now would be describing planned behavior as
  delivered.
- The old consequences section's "Add to M0: E9/E10" — stale on arrival: [09](09-delivery-plan.md) records
  E9 as **done (measured: passed, 2026-11-07)** and E10 as contract-versioning, not a frontend check. The
  next experiment for *this* document is proposed below, and 09's owners decide whether to take it.

## Open decisions

Five remain open. UI-OD2 (push channel) and UI-OD6 (design tokens) were **answered by the maintainer on
2026-11-15** and moved, with his reasons, to [§ Closed UI-OD decisions](#closed-ui-od-decisions) — kept,
not deleted, because an open decision that vanishes looks like an oversight.

| ID | Decision the maintainer must make | What it blocks |
| --- | --- | --- |
| **UI-OD1** | Web shell: Astro islands (07's choice) vs plain React mount for the dashboard, both under the D62 Railway service. | The `apps/site` build and first-island wiring; nothing else — §2's layout contract is shell-agnostic. |
| **UI-OD3** | Native vehicle (§7 table): RN / Capacitor / Tauri / web-only — deliberately **not chosen here**. | Only the first native app; the decision must not be made *before* §9's gates exist, or the cost asymmetry that makes all four options viable is destroyed. |
| **UI-OD4** | Draft retention rule as specified (7-day TTL, local-only, sign-out wipe, never secrets) vs a stricter/looser variant. | §5's implementation and the app-store privacy declarations; it is tenant working data at rest on user devices — the maintainer should own that posture. |
| **UI-OD5** | Replay-from-store as the default for context signals (§3), with mandatory-transient for side-effecting signals. | The signals registry code shape; cheap to decide, expensive to flip after components lean on replay. |
| **UI-OD7** | Who authors per-platform screens: builder-generated from the manifest (the D21 `buildSecretsPanel` pattern, extended) vs page documents versioned in the template repositories themselves (D60: a template *is* a repository). | The "adding a hosted platform is a data change, not a frontend release" claim (D9): both shapes satisfy it; only the second decides where a template's screens live — and under D60 that is the template repo's root, beside `environment.yaml`. |

## Closed UI-OD decisions

Answered by the maintainer; recorded here with the date and the reason, then linked from the register
rather than restated. Nothing in this section is implemented — it is the decision of record, and the
work it names belongs to whichever change owns the file that must change.

| ID | Closed | The maintainer's reason | What it decided, and what it does not |
| --- | --- | --- | --- |
| **UI-OD2** | 2026-11-15, recorded as **D64** | *"Yes, the UI should show live updates when it makes sense. I just want to make sure we are capable of real-time like interface even if we have to start out polling the API when needed."* | Decided: **design the push capability, ship polling first.** One SDK freshness primitive whose transport is swappable at build time (`poll` today, `events` later); every server-derived render carries its age; no UI surface may imply a liveness the contract does not serve. Required work, not optional: §4's operations (`GET …/events`, `POST …/events/ticket`, the event entity) are **API operations designed in `openapi.yaml` first** (D41) — measured absent as of 2026-11-15 (`grep -n "text/event-stream\|websocket\|EventSource\|WebSocket" apps/control-plane/openapi.yaml` → no match, all 36 operations request/response), landing them is a contracts MINOR bump. It does **not** authorize implementing any of it from here. |
| **UI-OD6** | 2026-11-15, recorded as **D63** | *"Go would rather have a packages/ui package that contains ALL reusable UI components, colors, spacing, font sizes (CSS), etc..."* | Decided: **one package owns everything reusable.** `packages/ui` carries the components **and** the design tokens, tokens delivered as CSS custom properties from that package; there is no separate `packages/tokens` (superseded wherever it appeared in the layer tables). What the first `packages/ui` commit may contain is now unblocked — but the package still **does not exist**, and "tokens are CSS custom properties" does not change what it will contain, only where. |

## Consequences for the plan

- **The first `packages/ui` commit is the contract package, not a screen**: `contract.ts`, `layout.ts`,
  `signals.ts` and gates §9.2–§9.6 land together, because a gate added after four screens exist audits
  nothing (the prior proposal's warning, still exactly right, and now checkable).
- Proposed for [09](09-delivery-plan.md)'s owners (this document does not edit 09): **E15** — render one
  real page document (the existing `buildSecretsPanel` output, measured code) through this contract at 360
  px and 1280 px containers, with §5's push/pop/reload tests and §8's axe pass green, **and** in a second
  container technology (a bare React mount and an Astro island both rendering the same registry proves the
  shell question UI-OD1 is really open and §9.7 is satisfiable). It proves portability before it becomes a
  bet, which was the old E9-line's intent, pointed at the right experiment number this time.
- §4's operations are now **required work** (UI-OD2 answered 2026-11-15 as D64: design the push
  capability, ship polling first), and they remain **API operations first** — designed in
  `apps/control-plane/openapi.yaml` (owned elsewhere, D41), type-generated, `api:check`-green, a contracts
  MINOR bump — before any screen touches `EventSource`. The UI spec deliberately contains no UX the backend
  cannot serve today, and says so section by section.
- The numbering question, answered: this stays document **11**; it is the canonical UI framework spec and a
  second file would recreate the two-definitions-of-one-thing failure this whole project keeps paying for.
