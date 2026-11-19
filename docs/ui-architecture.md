# platfolio — UI architecture: the six rules

**Normative, and only for this.** This file states the rules a UI change must satisfy and the check that
enforces each one. It is not a design document and does not restate one: the rationale, history, full
contracts, the eleven CI gates and the ten-question reviewer pass live in
[11 — UI framework specification](design/11-ui-components-and-page-model.md). Where this file and 11 differ,
11 explains *why* and this file states *what a reviewer fails*. That split is deliberate — this repository
has paid repeatedly for two descriptions of one fact (issue #247, [CHANGELOG](../CHANGELOG.md)), so neither
file restates the other.

| To answer | Read |
| --- | --- |
| Why a rule exists; the component/layout/signal contracts in full; gates §9.1–§9.11; reviewer pass R1–R10; the native-vehicle fork table | [11](design/11-ui-components-and-page-model.md) |
| How a client may reach the API at all (props or the generated SDK), auth for clients, the compatibility promise | [07 — interfaces](design/07-interfaces-api-mcp-mobile.md) |
| What "pluggable" may mean (Tier 1 vs Tier 2, and why runtime-loaded code is refused) | [10 — kernel and extension seams](design/10-cordis-kernel-and-extension-seams.md) |
| Procedure for an agent building or reviewing a screen | [ui-architecture skill](../.agents/skills/ui-architecture/SKILL.md) |
| The HTTP contract every UI data path resolves to | [apps/control-plane/openapi.yaml](../apps/control-plane/openapi.yaml) — spec first, then the handler (D41) |

The six rules are not invented here. They are the maintainer's decisions — D10, D13, D14, D41, D47, D53, D62,
and since 2026-11-15 **D63** (one `packages/ui` owns components and design tokens) and **D64** (the UI is
built to be real-time-capable, polling first) — restated as rules an agent meets before writing UI code,
because the implementation must not be allowed to drift back into an architecture that breaks them.

## What exists (measured, this revision)

Everything below is labelled, because half of what these rules constrain is a package that is not in the tree
yet. Re-run the commands in [§ Enforcement](#enforcement-measured-this-revision) rather than trusting this
table for long.

| Path | State |
| --- | --- |
| `apps/control-plane/openapi.yaml` | **real** — the single API contract; request/response operations only. Re-check for a push channel with the command in rule 5; there was none when this file was written |
| `packages/api-contract/src/generated/types.ts` | **real** — generated from that spec, byte-for-byte gated by `api:types:check`. Exports the type maps *and*, since #258, the route table `ENDPOINTS` (method + templated path per operationId), which is what lets the SDK's transport driver turn an operation id into a request without anyone writing the URL down a second time |
| `packages/page-schema/` (`page.ts`, `secrets-panel.ts`, `binding-panel.ts`, `project-text.ts`) | **real** — pages as data, the build-time component registry, `findValueBearingProps`, with tests |
| browser-auth plumbing beside the API | **real** — `PLATFOLIO_ALLOWED_ORIGINS` feeds CORS and the `platfolio-web` PKCE client's `<origin>/callback` redirect URIs, tested by `apps/control-plane/test/cors.test.ts`. So rule 1's "the endpoint is configuration, not a literal" already has a gate on the server half |
| `packages/ui` — **exists since 2026-11-15** (component contract, design tokens per D63 as CSS custom properties with `tokens.css` generated from `tokens.ts`, the five layout primitives, the signals registry, the SDK seam) and **since #259 has its first screens**: six registered `.tsx` components, one screen document, `packages/ui/tsconfig.json` with `jsx` + `DOM`; `ui:check` is 21 gates, 18 pass, 3 NOT RUN. Its `src/web/` boundary now holds shipped code, not only prose: the browser's `AuthSource` (`browser-auth.ts`) and the one page-context door (`shell.tsx`), with the policy half split into `web/browser-auth-policy.ts` because a client bundle may not reach `scripts/` | **exists since 2026-11-17:** `apps/site` is the D65 shell, and it mounts a screen — `/` with no client JavaScript, `/dashboard` with one island, `/callback` with none rendered. `packages/api-client` | **still does not exist**, and 11 §6 says it should not be created: the SDK is `packages/ui/src/sdk/`, not a separate package |
| what the shell does *not* deliver | **no service in `compose.yaml`, no origin that resolves, no browser observation, no drafts.** It builds, it is type-checked, it is gated, and nothing deploys it: the fourth platform per D62 is the follow-on step, and it needs a generated digest, a composition entry, CORS origins that include it, and DNS that answers (§ Open gaps, item 6). Gate §9.7 (containers at 320/1280 px), §9.8 (axe, focus, targets) and §9.9 (the draft store) remain NOT RUN, and the shell's own §D65 says in its PASS line which of its halves did not execute |

So the enforcement story per rule is always two halves: the gate that bites today, and the gate that is
written when the package it audits exists. Claiming the second half is protecting anything is the exact
mistake this project keeps naming — a check that cannot run must not look like a check that passed
([MAINTAINING](MAINTAINING.md)).

## Rule 1 — One data path

**Invariant.** The specification is the only description of the API; components reach it through the
generated types and the SDK, and nothing else.

- **MUST** type every server-derived value by importing from the generated contract
  (`@platfolio/api-contract/generated/types`), whose emitter is `scripts/gen-api-types.ts` and whose source is
  `apps/control-plane/openapi.yaml`.
- **MUST** route every request through the SDK's transport seam (11 §6), so a driver change — conditional GET,
  then SSE — touches transport and no component. A component receives data as **props from its container** or
  through the SDK hook layer: those are 11 §1's two sanctioned doors, and the invariant is that neither of them
  is a transport.
- **MUST** take the method and the path from the generated `ENDPOINTS` table (11 §6, #258) — the same parse of
  the same document that produces `ParamsOf` and `SuccessOf`, under the same byte-for-byte gate. A route written
  out in UI code is a second owner of one fact, and `packages/ui/test/transport-table.test.ts` refuses it.
- **MUST NOT** hand-write a client, hand-copy a DTO, declare a local interface with the same fields as a
  server type, or assemble an operation-to-endpoint table by hand. The only sanctioned local types are
  view-models derived from generated ones (`Pick`, `Readonly`, discriminant unions).
- **MUST NOT** call `fetch`/`XMLHttpRequest` from a component, build a URL in one, or commit an API base URL
  (D47: an endpoint is configuration).

**Enforced by.** Today: `spec:check` (the committed document reproduces from the schema definitions),
`api:check` (routes and spec agree in both directions, and spec shapes agree with the StandardSchema
definitions), `api:types:check` (the generated file reproduces from the spec byte-for-byte), plus
`packages/api-contract/test/spec-generation.test.ts`, `schema-parity.test.ts`, `generated-types.test.ts` and
`spec.test.ts`. The component-side half — no `fetch`, no re-declared shape in `packages/ui` — was **specified**
as 11 §9.1–§9.2 while `packages/ui` did not exist; it runs today (`ui:check` §9.1, §9.2, and the type fixtures
§9.1b compiles), and that sentence was a slice of work out of date before this revision corrected it.
#258 added the route half:
`packages/api-contract/test/generated-endpoints.test.ts` compiles mutated copies of the generated table outside
the tree and requires the compiler to refuse a missing entry, an extra entry, a stale entry, a route whose
templated hole no required parameter names, and a verb spelled the way HTTP spells it rather than the way the
document does — with the unmutated copy compiled as the control that makes those refusals mean something.
`packages/ui/test/transport-table.test.ts` requires `ENDPOINTS` to be read by the transport driver alone,
requires every operation a component or screen names to have a route, and proves a hand-assembled route table
does not compile.

**What breaking it costs.** #247: nine of eighteen components in the committed spec restated, by hand, what a
zod definition already said, and the gate that compared the two *filed the difference instead of preventing
it* — so the drift was measured, not impossible (CHANGELOG, *"the shared OpenAPI components are a build
artifact (#247)"*, line 16). One consequence was the stale `Instance.name` bound: the document allowed 80
characters and a 41-character pattern while `SLUG_PATTERN` and the database `CHECK` enforced 40 — "a form that
validates and a server that refuses" (CHANGELOG line 55). In a UI that is not a typo, it is the user typing 60
characters and getting a rejection no screen can explain. 11 §1 puts it sharply: a re-declared shape in a
`.tsx` file is the #247 bug wearing a `.tsx` extension, and it would pass silently, because the gates compare
only the two descriptions they know about.

## Rule 2 — Layout-driven responsive, mobile-first

**Invariant.** A layout primitive decides composition; a component reacts to its container and never to the
window; and a narrow screen is missing nothing but simultaneity.

- **MUST** use the five primitives (`stack`, `split`, `popout-sidebar`, `overlay-sheet`, `full-page`) and the
  containment matrix in 11 §2, declared per component in `ComponentContract.slots`.
- **MUST** set `container-type: inline-size` in the primitive and query the *container*.
- **MUST** take a *document's* composition from the content primitives too — `ui-prose` (the readable line, whose
  length is the `--ui-measure-content` token, plus the block rhythm) and `ui-columns` (one column at the floor, N
  tracks when its container has room), both declared in `packages/ui/src/layout/content.ts` and emitted to
  `content.css` (11 §2 content layout, #267 item 5). A page names the class; it does not write the rule.
- **MUST** make every capability reachable in the single-column layout; wider screens add columns, rails and
  hover detail, never features.
- **MUST NOT** use `@media (width …)` for component behavior (`prefers-*` is the only window input a component
  may read), and **MUST NOT** carry an `isMobile` / `compact` / `desktop` prop.
- **MUST NOT** write a width `@media`/`@container` query, or a `container-type` declaration, in an app stylesheet:
  a breakpoint in `apps/site` is a second owner of one composition decision, and §D65 refuses it by name (the rule
  was added *because* the committed stylesheet contained exactly that and every gate passed).

**Enforced by.** `ui:check` §9.3 runs today, over `.ts` **and** `.tsx` and over all **four** generated stylesheets
(tokens, layout, content, components — the count is an assertion in the gate, so a sheet added to the package and
forgotten by the gate fails the build rather than going unaudited). §9.11 runs today per screen document: the floor
degradation is a `floorSlots` field on each primitive, so "the set of `OperationId`s reachable from a screen's
components at 360 px equals the set reachable at 1920 px" is arithmetic over declared `reads`, and it names the
component and the operation when they differ. §9.7 (each component rendered in each declared slot at 320 px and
1280 px, in a browser) is **NOT RUN** — the components exist now, the containers do not. A reviewer's interim check
stays behavioral: open the screen at 360 px and confirm nothing is absent (R1).

**Content layout, stated once above and expanded here only where the rule needs its referents.** The five slots
compose a *screen*; a *document* needs a readable line, a block rhythm, and a group of blocks that is one column at
the floor and three when its container has room. Those are `CONTENT_TABLE` in
`packages/ui/src/layout/content.ts` — `ui-prose` and `ui-columns`, each with `containerType: 'inline-size'`, its
gap steps and (for `columns`) its `wideFromRem`/`tracks` as data — emitted into
`packages/ui/src/layout/content.css` and exported as `@platfolio/ui/content.css`, which the shell imports through the
workspace edge (#267 item 1) rather than through an alias. The line length is `MEASURE.content` in `tokens.ts`
(`--ui-measure-content: 68ch`), because a value three files could each type is a value nobody owns. Adding a fourth
content primitive means a row in that table -- a diff, a review, and the §9.3 check that the sheet covers exactly the
table -- not a rule in a stylesheet beside it.

**What that half cost, and the falsification that found it.** Before this change `apps/site/src/styles/site.css`
carried a real `@container (min-width: 48rem)` and a `68ch` measure, and `ui:check` exited 0 over it — measured
directly, by running the pre-change §D65 against the pre-change stylesheet: **DID NOT BITE**, exit 0, because every
width-query rule in the gate set lives in §9.3, which reads the package's sheets and has never looked at an app. The
refusal was therefore missing, not mis-tuned; it is in §D65 now and `packages/ui/test/gates-falsify.test.ts` plants
all three shapes (`@container`, a width `@media`, a hand-declared `container-type`) and requires each to be named by
file, plus the compliant case (`prefers-reduced-motion`, and a `rem` with no token behind it) to stay green. That
record matters more than the rule: a gate added *after* the violation shipped is how this project describes every
other incident it has paid for.

**What breaking it costs.** No UI screen exists yet, so there is no incident in this repository's UI history
— say so plainly rather than borrowing one. The mechanism that breaks is documented in 11 §2: a window
breakpoint tells a component what *device* it is on, so every component eventually grows an `isMobile` fork
and the two forks drift. This repository has paid that cost twice over in other media: platfolio's own hosting
was described in `selfhost/` beside the tenant's shape, and the overlay forgot to follow — it carried *a real
digest of the deleted service's image, which every check passed* (CHANGELOG line 1585); and a bundled
`templates/` drifted from the three published repositories until D60 deleted it (commit `3bcf050`: *"the
published repositories were not the templates, and no gate could see it"*). One description of one thing, in
markup or in a `.tsx`: an `isMobile` prop is that defect with a render path on each side.

## Rule 3 — Typed signals, declared retention

**Invariant.** Components react to each other only through the signals registry, and every signal says out
loud whether a late subscriber is handed its last value.

- **MUST** declare every signal in one table with a name, a payload schema and an explicit `retention`:
  `'replay' | 'transient'`. **No default.** A signal declared without its retention does not compile.
- **MUST** mark `transient` any signal whose payload could re-fire a mutation or carries a value-shaped key
  (a toast request, a confirmation intent, anything credentialed).
- **MUST** name the emitter: in 11 §3 the table holds name/payload/retention and the *component contract*
  holds `produces`/`consumes`, which is where a reviewer looks for who emits what.
- **MUST** test the late-mount case in both directions: fire then mount → the subscriber sees the value
  (`replay`); fire then mount → the subscriber stays silent (`transient`).
- **MUST NOT** run a stringly-typed event bus: no `window.dispatchEvent`, no ad-hoc `EventTarget`, no
  `.on('some-string')` outside the registry implementation.
- **MUST NOT** put tenant data in a replayed payload. Registry refs and ids only — 11 §3 cost 3 is the reason
  the table is enumerable by one reviewer in one file.

**Enforced by.** Specified as 11 §9.4 (lint rule: no raw event mechanism outside `signals.ts`; every signal
has an explicit retention; every `replay` payload passes the value-bearing walk) plus the registry unit tests
in 11 §3 acceptance (a)–(e), including the negative fixture: `emit('context.switched', { teamSlug: 1 })` must
fail to compile. **The registry and its gates run today** (`packages/ui/src/signals.ts`, `ui:check` §9.4); what does not run is anything needing a rendered screen. What exists today and
must keep passing is the type-level discipline the registry will inherit: `api:types:check` and
`packages/api-contract/test/generated-types.test.ts`.

**What breaking it costs.** Two named incidents. First, the double that lied: `FakeInfraProvider({ without })`
filtered only `describe().operations` and left the method working, so it "claimed not to support an operation
and then performed it", and the honest 501 path was untestable
([packages/contracts/src/fake-provider.ts](../packages/contracts/src/fake-provider.ts), line 60). A `retention`
declaration that is a comment rather than a compiled constraint is that same lie in a UI key: the component
that replays a confirmation intent performs the action twice while the table says it cannot. Second, the
coin flip: `a flipped signature is refused with 401` had been passing without testing anything, because
flipping the last base64url character of an RS256 signature often decodes to identical bytes — "a coin flip in
a security assertion" (CHANGELOG line 479; commit `6e56fc3`). A late-mount test that asserts only one direction
is that: green, meaningless, and quietly load-bearing.

## Rule 4 — Drafts are local, bounded, and never secret-bearing

**Invariant.** In-progress form input survives push/pop, backgrounding and reload — three separately specified
failure modes — from client-only storage, and a secret value never enters it.

- **MUST** implement 11 §5's three modes separately: (a) in-session push/pop from the page's overlay stack
  (unmount + snapshot, restored **before first paint**), (b) backgrounded/killed process from IndexedDB,
  (c) reload from the same store.
- **MUST** key drafts on `personSub | teamSlug/environment | pageId | overlayId`, TTL them (11 §5 specifies 7
  days, pending UI-OD4), evict oldest-first under a size cap, delete on successful submit, and wipe wholesale
  on sign-out.
- **MUST** persist only fields named in the component's `draftable` allowlist — an allowlist, never a denylist.
- **MUST** exclude secret-bearing fields **mechanically**, by reusing the value-bearing walk that already
  refuses a value-carrying panel — see the gap note in [§ Open gaps](#open-gaps-this-file-refuses-to-paper-over).
- **MUST NOT** sync a draft anywhere: no server copy, no cross-device continuity, no platfolio row.
  **MUST NOT** let a component touch `localStorage` / `sessionStorage` / IndexedDB directly; the draft store is
  the one door (11 §1 rule 3).

**The one exception, and it is decided rather than discovered (D67).** PKCE cannot work without
`code_verifier` surviving the redirect to the issuer and back, and no in-memory value survives a navigation. The
maintainer's answer, 2026-11-17: **the shipped behaviour is the decision** — the verifier and `state` go to
`sessionStorage`, are read **once**, and are dropped **before the exchange is attempted**; nothing else in the
auth path is persisted, at any lifetime, anywhere. The cost is accepted in the open: a person who reloads signs in
again. That is one extra round trip, not a security regression, because the value that persists grants nothing
without the single-use code that arrives beside it, and the code is spent in the same request.

- **MUST** keep the handoff single-use and delete it on read, in `web/browser-auth.ts`'s `complete`, and **MUST**
  name the permitted location in `web/browser-auth-policy.ts` as data (`HANDOFF_KEYS`, `HANDOFF_STORAGE`) rather
  than as a comment beside the code that decided it — the policy module used to enumerate access, refresh and id
  tokens and be silent about the verifier, and that silence was the defect D67 closes.
- **MUST NOT** move the pair to a cookie. `access-control-allow-credentials` is never emitted by the transport
  (`packages/kernel/src/cors.ts`, refused on purpose in both `packages/kernel/test/cors.test.ts` and
  `apps/control-plane/test/cors.test.ts`), so a cookie plan would be asking the platform to loosen a CORS posture
  to buy the UI a convenience — and `access_token`/`refresh_token` in any browser-persisted store collides with
  `TOKEN_STORAGE`, which is the invariant, not a default.
- **MUST NOT** move the pair to `localStorage`. It outlives the tab that minted it, and a single-use value in a
  store that survives its session is a replayable constant.
- **MUST** state the residual limit, because `sessionStorage` is browser-persistent state: anything that can run
  script on this origin can read the pair before it is spent. This choice bounds lifetime and kind, not a
  compromised page — the mitigation for that is rule 6, and it is not a storage class.

**Enforced by (the handoff half).** `packages/ui/test/browser-auth-parity.test.ts`: the policy data is asserted
not to widen (a `cookie: true` there fails the build, measured), a completed exchange leaves the tab holding
**nothing**, a replayed callback after that answers `no-handoff` without reaching the token endpoint, and the
mid-flow reload finishes the exchange exactly once with the verifier the tab was holding. `ui:check` §D65 reads
the shell for the same rule: `sessionStorage` appears in `apps/site` only in `src/lib/browser-capabilities.ts`,
the one injected door, and `localStorage`/`indexedDB`/`document.cookie` appear nowhere in its source.

**Enforced by.** Today, the mechanism is real and gated: `buildSecretsPanel` refuses its own output if
`findValueBearingProps` finds a value-bearing property, and
`packages/page-schema/test/secrets-panel.test.ts` asserts "the built page carries no value-bearing property
anywhere" and "a `secret-field` schema refuses a value prop outright". Specified as 11 §9.9 plus 11 §5
acceptance (a)–(e), including the secret test that introspects the drafts store after each failure mode and
fails the build on a value-shaped key. The draft store itself (`packages/ui/src/web/drafts.ts`) does not
exist.

**What breaking it costs.** D4 (platfolio never reaches a tenant's secrets) and D53 (secrets are delivered,
never held; a value appears in no read-back). 11 §5 is blunt about the shape of the failure: a half-typed
secret surviving an OS kill in local storage is platfolio persisting a tenant credential on a device it does
not administer, with no read-back and no audit row. This is a **known accepted cost of the design, not a
discovered loophole** — losing half-typed secret input on a process kill is correct behavior, and a
convenience-first implementation that "temporarily" caches the value is a secret store with better UI. The
precedent that naming conventions do not hold is in the contract itself: `PLATFOLIO_DB_URL` carries a password
in its userinfo, which is why D52 refuses to let a name be a custody claim.

## Rule 5 — Real-time is honest about what exists

**Invariant.** The UI shows what it knows, where it got it, and how old it is; it never implies a liveness the
contract cannot serve. D64 (2026-11-15, answering UI-OD2) makes the *capability* a requirement: the design must
be real-time-capable — a single SDK freshness primitive whose transport is swappable at build time, `poll`
today, `events` when the operations land — while **polling remains an acceptable way to ship it**, so long as
no surface presents polled data as live.

- **MUST** render every server-derived state with its source and age (`lastKnownAt`), per 11 §4 acceptance (a)
  and 07's offline posture ("last-known attested state with an age indicator, never a stale healthy").
- **MUST** obtain freshness from exactly one primitive in the SDK (`subscribe`/`poll`, transport-chosen), so a
  component never owns a timer. The transport swap is the point of D64: `poll` → `events` changes the SDK
  transport driver and no component.
- **MUST** label what the user is looking at as polled/aged while the push operations are absent — the age
  label is the honesty mechanism, not decoration.
- **MUST NOT** ship or style a push-backed UX (`EventSource`, a WebSocket, a "live" pill, an unlabelled
  spinner, a fabricated optimistic success) until the event entity and its operations exist in
  `openapi.yaml` and pass `api:check`. **MUST NOT** describe polling as push in copy, a component name, or a
  commit message.
- **MUST** design the push channel as API operations first (D41, D48), by the sessions that own
  `openapi.yaml` and `packages/contracts` — under D64 this is **required work, not an option to weigh**:
  today the control plane has **no** push channel (measured 2026-11-15: `grep -n
  "text/event-stream\|websocket\|EventSource\|WebSocket" apps/control-plane/openapi.yaml` → no matches;
  36 operations, all request/response), and 11 §4 names what must be added there — a team-scoped event
  stream and a short-lived ticketed connection, because a browser cannot put a bearer token in an
  `EventSource` URL — as a contracts MINOR bump. This file implements none of it and adds no operation.

**Enforced by.** Today, mechanically: `api:check` validates the spec both directions, so a "push operation"
cannot exist undocumented, and the honest negative check is one command:

```
grep -n "text/event-stream\|websocket\|events/stream\|EventSource" apps/control-plane/openapi.yaml
```

which found nothing in this document when this file was written (36 request/response operations, no
`ETag`/`304` cache validator anywhere in it). Specified as 11 §9.10 (type-level: the data hook's result
carries age by construction; plus grep: no `EventSource`/`WebSocket` while §4's operations are absent) and
reviewer question R7.

**What breaking it costs.** The pattern this rule refuses already shipped once here in API form: the destroy
endpoint that would have said "destroyed" while provider teardown was not wired — "a tenant reading
'destroyed' would reclaim their own compute" (AGENTS.md), and it still records `deprovisioning` and returns 202
because that is the truth. And #202's follow-up: a service that *finished* was being reported as a service
that *runs*, until `stopped` plus `rawStatus` made the normalized value and the provider's own word both
visible (CHANGELOG; commit `ee2fd5c`). A green "live" pill over a 4-minute-old poll is the same defect on the
side where a human acts on it.

## Rule 6 — Pluggable means build-time, never runtime-loaded

**Invariant.** Every swappable thing is chosen when the bundle is built; nothing fetches code to run.

- **MUST** resolve components through the build-time registry — the same shape
  `COMPONENT_REGISTRY` + a strict `PageSchema` already use today, which refuses an unknown component at
  validation rather than rendering an empty div.
- **MUST** keep page documents data: no expressions-that-evaluate, no inline functions, no template strings
  reaching a runtime compiler.
- **MUST** treat third-party and tenant-authored extension as Tier 2 — out of process, same contract over
  RPC, pinned by digest (10).
- **MUST NOT** dynamically import UI code from a URL, fetch a component registry at runtime, or load
  third-party React into the session-bearing admin UI. Not "preferably not": **not**.
- **MUST NOT** "generalize" the registry to accept remote module specifiers for convenience. The Tier 2
  boundary is a security property, not a style preference (D13, D14).

**Enforced by.** Today, real: `packages/page-schema`'s strict schemas and closed component union —
`packages/page-schema/test/secrets-panel.test.ts` asserts "unknown components are refused by the page schema"
and "the registry covers every declared component name and nothing else", and a page that tries to carry a
secret value fails validation instead of rendering it. Both §9.5 and §9.6 **run today** as of #259: §9.6 audits
the build-time registry (no mutator export, no dynamic import, no remote specifier, no compiled-at-runtime code),
and §9.5 resolves six real ids, re-validates a stored page document, and refuses five invalid prop sets. Two
invalid prop sets are **named-accepted** and reported in the gate's own output, because props validation checks
the *kind* of an enumerated field and not its membership — `components/props.ts` states the three routes that led
there and the two that would close it. What §9.5 still cannot do is re-render a document from a previous
*release*: this registry has had none, so the load-bearing half is the refusal path, and the gate says so rather
than counting the fixture as proof. 11 §9.6 calls itself "gate #247 for the security line at the top".

**What breaking it costs.** An in-process extension shares the heap of the user's session; 11 names it exactly
("cross-tenant XSS with a nicer name") and 10 § The collision gives the arithmetic: a runtime-hot-loading
design "would make platfolio's own compromise equivalent to compromising every tenant it can dispatch to",
which would undo D4 and the trust boundaries in 04. There is no cheaper way for one convenience in a
registry to cost the product's central claim. This revision of the UI spec added **no** new code-execution
surface — overlays, signals and drafts move data, never code (11, the security line).

## Contract essentials (TypeScript)

Condensed from 11 §§1–3, 5–6. 11 is the authority on the full shape; this is the shape a reviewer holds a
diff against. **Every file named here is specified — none exists.**

```ts
// packages/ui/src/contract.ts — SHIPPED 2026-11-15 (11 §1)
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OperationId } from '@platfolio/api-contract/generated/types'; // rule 1: generated, never copied
import type { SignalId } from './signals.ts';                               // rule 3
import type { LayoutSlot } from './layout.ts';                              // rule 2

export interface ComponentContract<P extends object> {
  readonly id: string;                       // the only handle a page document has; stable across releases
  readonly props: StandardSchemaV1<unknown, P>;
  readonly reads?: readonly OperationId[];   // what this component may render => capability parity, rule 2
  readonly consumes?: readonly SignalId[];   // declaring is required to use: undeclared emit fails type-check
  readonly produces?: readonly SignalId[];   // rule 3: the emitter lives on the component, not on a string
  readonly slots: readonly LayoutSlot[];     // unlisted slot = contract violation, not ugliness
  readonly draftable?: readonly string[];    // rule 4: ALLOWLIST; a value-bearing path is rejected at registration
  readonly render: (props: P) => React.ReactNode; // pure: no fetch, no storage, no window/document (11 §1)
}
```

```ts
// packages/ui/src/layout/primitives.ts — SHIPPED 2026-11-15 (11 §2). Five primitives; the matrix is data, not comment.
export type LayoutSlot = 'stack' | 'split' | 'popout-sidebar' | 'overlay-sheet' | 'full-page';
// stack            -> any component; never an embedded overlay-sheet
// split            -> a stack per track, or a popout-sidebar as the detail track; never a second split
// popout-sidebar   -> one context panel + its stack, read-mostly; never a nested sidebar, never a
//                     destructive action without its plan-hash confirmation surface
// overlay-sheet    -> forms/wizards/row detail, depth <= 2; never a third nested sheet
// full-page        -> anything; the only primitive that survives a reload as itself
// Primitives set `container-type: inline-size`. Components query the container. No width @media, no isMobile.
```

```ts
// packages/ui/src/signals.ts — SHIPPED 2026-11-15 (11 §3)
export type Retention = 'replay' | 'transient';

export interface PlatformSignals {
  // Each entry: payload schema + EXPLICIT retention. There is no default; omitting it does not compile.
  'context.switched':      { payload: { teamSlug: string; instanceId: string | null;
                                        environment: 'development' | 'staging' | 'production' };
                             retention: 'replay' };
  'instance.state-changed':{ payload: { instanceId: string; environment: string; from: string; to: string };
                             retention: 'transient' };
  'secrets.saved':         { payload: { instanceId: string; name: string; environment: string };
                             retention: 'transient' };  // names only, never the value (D53)
  'refresh.requested':     { payload: { operation: OperationId } | null; retention: 'transient' };
  'overlay.changed':       { payload: { stack: readonly string[] }; retention: 'replay' };
}

export interface SignalBus {
  emit<I extends keyof PlatformSignals>(id: I, payload: PlatformSignals[I]['payload']): void;
  /** A late subscriber is handed the stored value first iff the signal's declared retention is 'replay'. */
  subscribe<I extends keyof PlatformSignals>(
    id: I,
    handler: (payload: PlatformSignals[I]['payload'], meta: { seq: number; replayed: boolean }) => void,
  ): () => void;
}
```

```ts
// packages/api-client/src/index.ts — SPECIFIED (11 §6). Rule 1 and rule 5 meet here.
import type { OperationId, ParamsOf, RequestBodyOf, SuccessOf }
  from '@platfolio/api-contract/generated/types';

export interface Transport {
  call<O extends OperationId>(op: O, input: { params: ParamsOf<O>; body?: RequestBodyOf<O> },
                              auth: AuthSource): Promise<Result<SuccessOf<O>>>;
  freshness?<K extends string>(key: K): FreshnessSource;  // poll-or-stream; components never see which
}
export interface AuthSource { token(): Promise<string>; } // injected by the shell, never ambient (07)

export function useOperation<O extends OperationId>(op: O, params: ParamsOf<O>): {
  data?: SuccessOf<O>; error?: ApiError; age?: string;    // `age` by construction => rule 5 is a type, not a habit
};
// No file in this package writes out a response shape by hand. Only a Transport swap (GET -> SSE) is allowed
// to change how freshness arrives; a second driver means a conformance suite run against both (10's rule of two).
```

```ts
// packages/ui/src/web/drafts.ts — SPECIFIED (11 §5). Rule 4's only door to storage.
export interface DraftKey {                    // personSub | teamSlug/environment | pageId | overlayId
  personSub: string; teamSlug: string; environment: 'development' | 'staging' | 'production';
  pageId: string; overlayId: string;
}
export interface DraftRecord {
  key: DraftKey;
  fields: Record<string, string>;              // only paths named in `draftable`; never server data
  storedAt: string; ttlDays: 7;                // UI-OD4 pending
}
// IndexedDB only. Wiped on sign-out and on successful submit. Oldest-first eviction under a size cap.
// NEVER synced. A `draftable` path that the value-bearing walk rejects is a registration error, not a warning.
```

## Per-screen conformance checklist

The mechanical gates (11 §9.1–§9.11) run in CI and block merge; the questions below are what a reviewer does
with one screen open. Order matters: steps 1–3 are runnable in this tree today, 4–9 are the behavioral
equivalents of gates that cannot run until `packages/ui` exists — record them as *not run* when the code they
need is absent, never as passed.

1. **Contract floor.** `npx -y tsx scripts/gen-api-types.ts --check` and `npx -y tsx scripts/check-api.ts`
   green. If the UI's types are not the spec's types, stop here.
2. **No push fiction.** `grep -n "text/event-stream\|websocket\|EventSource\|WebSocket" apps/control-plane/openapi.yaml`
   → no hits, and none in the UI diff. If both are empty and the screen says "live", it is lying.
3. **No value in page data.** `npx -y tsx --test packages/page-schema/test/secrets-panel.test.ts` green — the
   panel the UI renders is the panel that test already audits.
4. **Data provenance (R3).** Point at each number on the screen and name its `OperationId`. No answer, or a
   local interface that repeats a server shape → rule 1 fail.
5. **360 px capability parity (R1, 11 §2 acceptance d).** Every capability present at 1920 px is present at
   360 px. Extra columns are fine; extra *features* are a fail.
6. **Overlay survival (R2, 11 §5).** Type in sheet A, push B, pop B, reopen A → values, scroll, focus, on the
   **first** render. Then reload. Then background and return. Three checks, three failure modes.
7. **The secret test (R8, stops the release).** Type a secret, refresh, inspect local storage: no
   value-bearing record may exist. This one blocks regardless of schedule.
8. **Signals only (R6).** Read the registration: slots, `consumes`, `produces`, `draftable`, retention. Any
   behavior the declaration does not cover is a fail, including a nice-to-have `dispatchEvent`.
9. **Delete the server (R10).** What does the screen show? Last-known state with an age = pass. An eternal
   spinner or a fabricated optimistic success = fail.

## Enforcement, measured this revision

Run from the repository root with `TMPDIR="$PWD/.tmp" npm_config_cache="$PWD/.cache/npm"`. Each row was
executed on 2026-11-15 against this working tree; exit codes are the tool's, not a summary. One measurement
moved while this file was being written, and it is worth keeping as evidence for the rule about numbers:
`npx -y tsc --noEmit -p tsconfig.json` returned 2 earlier in the session (another agent's in-flight edit to
`packages/manifest/test/install.test.ts`) and 0 on the final pass. Re-measure; do not quote a table.

| Command | Exit | What it actually proves |
| --- | --- | --- |
| `npx -y tsx scripts/check-project.ts` | 0 | every local link and anchor in 88 markdown files resolves; 17 skill directories have frontmatter whose `name` matches the directory, a `description` under 400 chars, and resolving references; workflow/action YAML lint; credential, endpoint (D47), test-target (D49), overlay (D50), registry (D58) and toolchain rules |
| `npx -y tsx scripts/gen-api-spec.ts --check` | 0 | `openapi.yaml` reproduces byte-for-byte from 10 generated components (2219 lines) — rule 1's spec half |
| `npx -y tsx scripts/check-api.ts` | 0 | 36 operations, route manifest and document agree both directions, schema parity 10 compared / 10 generated — rule 1's server half, rule 5's "no push operation" witness |
| `npx -y tsx scripts/gen-api-types.ts --check` | 0 | `packages/api-contract/src/generated/types.ts` reproduces from the spec byte-for-byte — the file a UI must import from |
| `npx -y tsx --test packages/api-contract/test/generated-types.test.ts` | 0 | the committed types reproduce, no placeholders, every operation reaches the file, unexpressed keywords reported |
| `npx -y tsx --test packages/api-contract/test/schema-parity.test.ts packages/api-contract/test/spec-generation.test.ts packages/api-contract/test/spec.test.ts` | 0 | the drift ledger is empty and the machinery still bites; a generated block that was hand-edited is refused; a spec that has become fiction is refused one mutation at a time |
| `npx -y tsx --test packages/page-schema/test/secrets-panel.test.ts packages/page-schema/test/binding-panel.test.ts` | 0 | no value-bearing property in built pages; `secret-field` refuses a value prop; unknown components refused; registry covers every name and nothing else |
| `npx -y tsx --test apps/control-plane/test/cors.test.ts` | 0 | the browser half of rule 1's boundary: the origin allow-list is configuration (`PLATFOLIO_ALLOWED_ORIGINS`, D62/D47), a listed origin reaches the real API over a socket, a stranger does not — so no UI can smuggle a committed endpoint past this |
| `npx -y tsx scripts/check-contracts.ts` | 0 | contracts surface matches baseline (4353 declarations, derived 5.1.0) — a UI cannot quietly widen the shape it renders |
| `npx -y tsc --noEmit -p tsconfig.json` | 0 | the tree type-checks (it exited 2 earlier in this same session on another agent's in-flight test edit — see the note above, and [§ Open gaps](#open-gaps-this-file-refuses-to-paper-over) item 4 on why numbers age) |
| `npx -y tsc --noEmit -p apps/site/tsconfig.json` | 0 | the shell compiles under its own project: `jsx`, `DOM` and `astro/client`, while the root program stays DOM-free — the three-way split `scripts/check-project.ts`'s coverage rule now holds in step (238 source files, 238 claimed, one owner each) |
 | `pnpm run site:build` (root wrapper → `pnpm --filter @platfolio/site build`) | 0 with the four names set; **1, naming `PLATFOLIO_SITE_ORIGIN`, without them** | the artifact exists, and D47 is an outcome rather than a policy: with no origin supplied the build refuses instead of inventing one. Read `dist/`, do not trust this row: `/index.html` ships **zero** `<script>` elements and zero island markers; `/dashboard/index.html` and `/callback/index.html` carry exactly one `<astro-island>` each; across every emitted chunk exactly one `polled` and one `createShellContext`. One literal `fetch(` survives minification and it is the shell's own issuer token request (`lib/browser-capabilities.ts`); the SDK transport reaches the network through `config.fetchImpl ?? fetch`, which the bundler renames, so the artifact count is *not* a claim that one connection exists — the rule-1 claim lives in `poll.ts` being the only transport, and §9.2 refusing `fetch(` anywhere else in the package. Measured 2026-11-17 by `apps/site/test/build-output.test.ts`, which builds and then reads — a *build* measurement, not a browser one |
| `npx -y tsx --test packages/ui/test/browser-auth-parity.test.ts` | 0 | the auth seam's one-policy property proved as wire parity — `crypto.subtle` against the operator's `createHash` over fixed and random verifiers — with state compared before any redeem and the verifier spent once. And D67's half, since 2026-11-17: the handoff policy is *data* that a widening fails (`cookie: true` on the verifier is a build failure, measured), a completed exchange leaves the tab holding **nothing**, a replayed callback after that answers `no-handoff` without reaching the token endpoint, and the mid-flow reload finishes the exchange exactly once with the verifier the tab was holding — which is the reload case stated correctly instead of as "the reload discards the verifier", which is not what `sessionStorage` does |
| `docker build -f apps/site/Dockerfile` (legacy builder, four `--build-arg`s) | 0 | the image assembles: `pnpm install --frozen-lockfile --filter @platfolio/site...` → `Scope: 6 of 8 workspace projects`, the Astro build inside the layer (`3 page(s) built`), `chown` before the `USER node` drop. The filter is the point of the row, and its history is the reason #267 item 1 declared the edge: the first version of this line used the same filter while `apps/site` declared no dependency on `@platfolio/ui`, and the build inside the image failed with `Rollup failed to resolve import "@platfolio/page-schema/page" from "/app/packages/ui/src/contract.ts"` — the graph stopped at this app while the alias still dragged `packages/ui/src/**` in, and the host looked fine only because the checkout was already installed whole. Re-measured after the edge: filtered install 0, whole-workspace install 0 (the control build, same tag family), and `docker run` of the filtered image serves `GET /` 200 with 0 `<script>` on `/` and `createShellContext` in exactly one of its 5 chunks |
| `docker run` of that image, then HTTP against it | 200 on `/`, `/dashboard`, `/callback`, `/config.js` | the strongest tier this change reaches without a browser: the container rendered `config.js` from *its* environment and served it (`window.__PLATFOLIO_SITE_CONFIG__ = {…three endpoints, no secret…}`), the served `/` had zero `<script>` and zero island markers, the served `/dashboard` had exactly one `<astro-island>` whose serialized props were the five endpoint fields and nothing token-shaped. And the refusal is real: started with `PLATFOLIO_URL` as plain http on a non-loopback host, the container printed the named problem and **did not serve** |
| `npx -y tsx --test apps/site/test/*.test.ts` | 0 | the shell's own logic: config resolution and its refusals, the runtime overlay's precedence and validation, one `client:*` per page, `createShellContext` only in an island, no `endpoints:` route table and no `/api/v1` literal in app code |
| `npx -y tsx --test packages/ui/test/shell-context-singleton.test.ts packages/ui/test/browser-auth-parity.test.ts` | 0 | D65's one-context property *executed* (same config → same object; different config → refused by naming both origins, with no credential vocabulary), and the auth seam's one-policy property proved as wire parity — `crypto.subtle` against the operator's `createHash` over fixed and random verifiers — with state compared before any redeem and the verifier spent once |
| `npx -y tsx scripts/check-environment-registry.ts` | 0 | 88 variables, all referenced, no committed secret values — including the four `apps/site` reads, two of which (`PLATFOLIO_URL`, `PLATFOLIO_IDENTITY_ISSUER`) are reused spellings rather than new ones |
| `pnpm run verify` | 1, **before running any gate** | `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK … Read-only file system` — the wrapper cannot lock its engine store in this sandbox, so each gate above was executed directly instead. [MAINTAINING § If `pnpm run <script>` fails before running anything](MAINTAINING.md#if-pnpm-run-script-fails-before-running-anything) records this and says CI is unaffected. Reporting it as a failed gate would be the wrong honesty |

Rules 2, 3, 4's UI half, and 5–6's UI half gained their first runnable gates on 2026-11-15, and #259 took two of the five NOT RUN rows off the list by putting screens in the registry. The shell landed on 2026-11-17 and added a gate of its own rather than removing one: `ui:check` is **21 gates today — 18 pass, 0 fail, 3 NOT RUN** (§9.7 needs browser containers, §9.8 needs axe and a layout engine, §9.9 needs the draft store, which still does not exist). The three that remain NOT RUN do so for the reason they did before the site existed: **the browser is missing, not the source.** So the source-level shell gates now have a real subject to audit — §D65 over `apps/site`, §9.2's rogue-data and rogue-storage sweep extended to the shell's own files, D63's token rule read against app CSS, D64's honesty read against app copy, and D47's configuration rule read against the four names the deploy supplies. Each was falsified by planting the violation in the site's own files or its built artifact — 35 planted violations, 35 named failures, every restore byte-verified — and three of §D65's first-pass rules **DID NOT BITE** until they were widened to read string contents rather than the comment- and string-blanked text, because a `client:*` directive and a module specifier both live inside a string.

#267 added two more halves to §D65, and both came with their own falsification runs (`npx -y tsx --test packages/ui/test/gates-falsify.test.ts`: **41 tests, 41 pass, 0 fail** — up from 37, and no `DID NOT BITE`). **D67's persistence door** (item 4): rule 4's storage ban was enforced by §9.2, which walks `packages/ui`, so *nothing in the gate set looked at the app* — planting `localStorage.setItem` in the dashboard island, `document.cookie` in the callback island, or a `sessionStorage.setItem` beside the one injected handoff each names its file and its rule. **The content-layout half** (item 5): planting a raw `@container (min-width: 48rem)`, a `@media (min-width: 60rem)`, or a `container-type` back into `apps/site/src/styles/site.css` each names the file, while the compliant cases — a `prefers-reduced-motion` query and a `rem` with no token behind it — are asserted to stay green in the same suite. The second of those two was measured **before** the rule existed: the pre-change §D65 reported PASS on the committed stylesheet that contained a real `@container` query and a `68ch` measure. Exit 0. DID NOT BITE — that was the finding, and the rule is the fix.

**One security assertion turned out to be a coin flip, and the suite said so by going red at random.** While re-running the gates on the #267 branch, `packages/ui/test/browser-auth-parity.test.ts`'s storage-hygiene case failed one run in three on code nothing had changed, with `a token-shaped value was persisted under platfolio.pkce.verifier`. The cause was the assertion, not the flow: it refused any value matching `^eyJ` or two 20-character base64url runs around a dot, but `createVerifierWith` draws from the **RFC 7636 unreserved set**, which contains the dot — so a verifier is routinely a dotted string. Measured over 2,000 drawn verifiers: 1,084 contained a dot and **222 matched the old rule** (an example that is a valid verifier, not a token: `R.ets_BImSC3NzWd1XybK8YMRirkdi-GI683lwkAGH2fwr.X4t9ZjNEuFTTT2Yjy`) — an ~11% false-refusal rate on the happy path. A rewrite that demanded three segments was *worse*: 319 of 2,000. Shape cannot do this job, so the guard is by identity now: the written keys must be exactly the two `HANDOFF_KEYS`, the value under the verifier key must satisfy `isPkceVerifier`, the value under the state key must be the opaque base64url that was actually sent, and no persisted value may equal any token the issuer returned. The residual limit is unchanged and stated in the test: a dot-free opaque token is indistinguishable from a verifier by shape, which is why `TOKEN_STORAGE` (inMemory, all three kinds) is the invariant and the spy is the tripwire. The flake is pinned by a 2,000-draw case that requires at least one verifier to look like a token to the *old* rule — so if a shape guard comes back, this test says so at ~11% per draw rather than one suite run in three. Proof of determinism: 40 consecutive runs of the parity file, 0 failures; `gates-falsify` 41/41; and no `isJwtShaped`-style value predicate was left in the policy module, because the one that was written there is the mistake this paragraph documents. Recorded here rather than buried because "a check that sometimes tests nothing is worse than no check" is already this repository's lesson, and this is its mirror: a check that sometimes refuses the truth.

What the site does *not* bring is a browser: no hydration was observed, no container was measured at 320 px, no axe run happened, and gate §9.7/§9.8/§9.9 stay exactly as honest as they were. 11's consequence is the rest of the enforcement, and it is worth repeating here because it is the one thing that stops the drift: **the
first `packages/ui` commit is the contract package — `contract.ts`, `layout.ts`, `signals.ts` and gates
§9.2–§9.6 — not a screen**, because a gate added after four screens exist audits nothing.

## Non-negotiables

- **The Tier 2 boundary (10, D13, D14) is not reversible and not generalizable.** "Pluggable" = swappable at
  build time behind a versioned registry, never loadable at runtime. Rule 6.
- **D4/D53 do not bend for UX convenience.** No secret value in a draft, a replayed signal payload, a page
  document, a log, or an audit row. Rule 4.
- **Spec first (D41/D48).** A new capability is an operation in `openapi.yaml` before it is a button; this
  file adds none.

## Open decisions — do not resolve silently

Five UI-OD decisions are open in [11 § Open decisions](design/11-ui-components-and-page-model.md#open-decisions);
they belong to the maintainer. An agent who picks one quietly has written a
second description of a decision the project has not made — and the diff will not look like a decision, it
will look like code. **Two were answered on 2026-11-15 — UI-OD2 (D64: design the push capability, ship
polling first) and UI-OD6 (D63: one `packages/ui` owns components and design tokens) — recorded in
[11 § Closed UI-OD decisions](design/11-ui-components-and-page-model.md#closed-ui-od-decisions) with the
maintainer's reasons. Do not re-open either in code; equally, do not treat D64 as a license to implement
the push channel — what it requires is the endpoint work 11 §4 names, owned elsewhere (D41).**

| ID | Blocked question | What an agent must do instead |
| --- | --- | --- |
| ~~UI-OD1~~ | **Closed 2026-11-16 to D65: Astro shell, dashboard as one React island.** Built 2026-11-17 in `apps/site`. | Do not re-open it, and do not re-decide its shape: the shell mounts `renderScreen` exactly once per island through `createShellContext`, which is memoised on its configuration and throws `ShellContextConflict` on a second, different one. Three checks hold the sentence — `ui:check` §D65 over the source, `apps/site/test/build-output.test.ts` over the built artifact (one `<astro-island>` per hydrating page, zero scripts on `/`), and `packages/ui/test/shell-context-singleton.test.ts` over the runtime property. No browser has observed any of it, which is what §9.7/§9.8 remain for |
| UI-OD3 | Native vehicle: RN / Capacitor / Tauri / web-only | Decide nothing; keep R9 honest so all four stay affordable |
| UI-OD4 | Draft retention rule (7-day TTL, local-only, sign-out wipe, never secrets) | Implement the mechanics; leave the retention numbers as the open question they are |
| UI-OD5 | Replay-from-store as the pattern for context signals, transient-by-rule elsewhere | Enforce "no default"; ask before choosing per-signal values beyond 11 §3's table |
| UI-OD7 | Where per-platform screens live: generated from the manifest, or page documents in the template repository (D60) | Ask. It decides where a template's screens are versioned |

The answered ones, restated only as routing: **UI-OD2 → D64, rule 5.** Build one freshness primitive with a
swappable transport; ship `poll`; never style polled data as live; the event operations are designed in
`openapi.yaml` first by the sessions that own it. **UI-OD6 → D63.** Design tokens are CSS custom properties
inside `packages/ui`; no separate token package; `packages/ui` exists (contracts, tokens, primitives, signals, SDK seam, gates) but has no screens — ask before
scaffolding it.

## Open gaps this file refuses to paper over

Five places where what sits around these rules is weaker, vaguer or staler than the rules sound. Recorded here
so nobody "fixes" one by silently choosing an answer. **Two of the five (1 and 3) were closed the same day
they were written, and say so with their residual limits still stated** — an entry that stays "open" after being
fixed is the same rot as one that was never written down, and each was checked against the code rather than
against this file.

1. **CLOSED 2026-11-15 — `findValueBearingProps` WAS two functions with one name, and neither caught a
   credential.** The exported one —
   [`packages/page-schema/src/page.ts:139`](../packages/page-schema/src/page.ts) — matches a **closed list** of
   exact key names (`value`, `currentValue`, `defaultValue`, `secretValue`, `plaintext`; the pattern is at
   line 148). The private copy in
   [`packages/page-schema/src/secrets-panel.ts:140`](../packages/page-schema/src/secrets-panel.ts) matches
   **any key containing `value`**, with two exceptions (`satisfied`, `labelValue`). So "reuse the existing
   predicate" has no single referent, and *neither* implementation rejects `token`, `apiKey` or
    `clientSecret`. A `draftable` path named `token` passed the walk untouched. **Fixed the same day**: one
    exported definition (`isValueBearingKey` plus the walk), the **union** of both previous behaviours so nothing
    formerly caught is let through, plus the credential-shaped names 11 §3(c) and §5 had assumed were already
    there — pinned by `packages/page-schema/test/secrets-panel.test.ts`, which fails if the duplicate returns, if
    the list narrows, or if a benign key (`label`, `text`, `custody`) starts being rejected.
    **Residual limit, not closable: this is a NAME test.** A credential under a neutral key is invisible here, so
    rule 4 holds because `PageSchema` gives a secret no legal place to sit and the builders are checked by their
    own tests — not because the walk is sufficient. The shared failure mode stands: a name is
   not a custody claim (D52), and an empty-looking placeholder is not an absence ("`webhookSecret` is now
   optional (absent, not an empty string that would pass a signature check it should fail)", CHANGELOG
   line 2192).
2. **Conditional-GET is not available without a server change.** 11 §4.2 states it and the spec confirms:
   no `ETag`, no `304`, no cache validator in `openapi.yaml`. So today's honest mechanism is polling with age
   labels; conditional-GET is the *next* step and needs headers on operations that already exist. Any task
   text that describes conditional-GET as what the UI does today overstates it.
3. **CLOSED 2026-11-15 — 11 cited a gate `§9.11` its own list did not contain.** Both invocations asked for the
   same thing: capability parity derived mechanically from declared `reads`, and 11 §2 acceptance (d) already
   stated it. So §9 now carries an eleventh gate saying exactly that, labelled *Specified, cannot run today*
   beside gates 2–5 and 7–9 rather than counted as enforcement. A dangling section number is not cosmetic: a
   reader who cannot find the gate concludes the requirement is optional.
4. **11's "measured this revision" numbers drift — which is why this file cites commands instead of
   counts.** 11 used to record `openapi.yaml` as "34 paths, 36 operations" and the generated type file as
   "830 lines"; they had drifted, and when D63/D64 were recorded the file was re-measured on 2026-11-15 —
   `grep -c '^  /' apps/control-plane/openapi.yaml` → 31, `grep -c operationId:
   apps/control-plane/openapi.yaml` → 36, `wc -l packages/api-contract/src/generated/types.ts` → 894
   (the gate reports 895) — and 11 now carries that reading with its date. The drift changes no rule:
   still no push channel, still no cache validator, the gate is still byte-for-byte. But a number written
   into prose goes stale within a day, and a stale measurement in a specification reads as a claim about
   the present. Re-measure with those commands rather than editing either document's counts to match each
   other.
5. **The emitter is not a field of 11 §3's signal table.** The request that produced this file described each
   signal as carrying "a name, payload schema, emitter and a mandatory retention declaration"; 11 §3's
   `PlatformSignals` holds name, payload and retention, and puts the emitter on the *component contract* as
   `produces`/`consumes`, cross-checked against real use by 11 §3 acceptance (e). This file encodes 11's split,
   because there the answer comes from the component that declares it rather than from a second list nobody
   audits. If the maintainer wants the emitter inside the table, that is a change to 11 §3 first.
6. **The shell exists; the deployment half of D62 does not.** `apps/site` builds, type-checks in its own project,
   and is gated (§D65, and the commands in the table above), but `compose.yaml` still describes three services and
   `platfolio.dev` / `preview.platfolio.dev` still do not resolve — so nothing has ever loaded this artifact, and no
   claim in this file about a *rendered* screen is anything yet. The follow-on has a specific shape, and it is not
   this change's to take: a service entry with a **generated** digest (`renderPlatform` refuses an unpinned
   first-party service, and `compose.prod.yaml` is generated), the site's origin added to
   `PLATFOLIO_ALLOWED_ORIGINS` — one variable (`grep -n PLATFOLIO_ALLOWED_ORIGINS environment.yaml` → one row, at
   line 268 of the generated file) carrying two values in the composition (`compose.yaml:42` production
   `https://platfolio.dev`, `compose.yaml:111` staging `https://preview.platfolio.dev`) — and the same two origins
   in the realm's `redirect_uris` and `webOrigins` as `<origin>/callback`, which is what `identity:seed` derives
   from that one variable rather than from anything the UI may invent. Then DNS plus certificates for whatever host
   the deploy names, and `PLATFOLIO_SITE_ORIGIN` set to that same origin (D58: one name, one row, already declared).
   **Item 3 of #267 tried exactly this and it is BLOCKED, for two independent reasons, and the entry was reverted
   rather than weakened around** (`compose.yaml` is byte-identical to the copy taken before the edit, `cmp`-verified;
   `platform:plan`, `check-project` and `packages/manifest/test/compose.test.ts` all return to exit 0 after the
   revert, and they were run to confirm it).

   What was written: a `site` service with `build: {context: ., dockerfile: apps/site/Dockerfile}`,
   `expose: ["4321"]`, a healthcheck that GETs `/` in the `api`/`identity` spelling
   (`node -e "fetch('http://127.0.0.1:4321/').then(r=>process.exit(r.ok?0:1))…"`), `public: true`,
   `domains: [platfolio.dev]`, `environments: [production, staging]`, and
   `x-platfolio.environmentValues.staging` carrying the three values that differ per environment (D56). Measured
   against that tree:

   | Command | Exit | Quoted message |
   | --- | --- | --- |
   | `npx -y tsx scripts/platform-deploy.ts` (`platform:plan`, dry run) | **1** | `services.site.image: no-artifact -- service "site" builds an image and none has been reported for it: publish one (POST /api/v1/instances/{instanceId}/artifacts) and the plan resolves. A digest is deliberately not committed to source control (D54)` |
   | `npx -y tsx --test packages/manifest/test/compose.test.ts` | **1** | `platfolio can describe and plan its own deployment` fails: `["no-artifact"]` vs `[]` (in the manifest+auth set: 121 tests, 120 pass, 1 fail) |
   | `npx -y tsx scripts/check-project.ts` | **1** | `compose.dev.yaml: platform service "site" has no dev entry -- local up would run without it while the plan expects it (D50)` |
   | `npx -y tsx scripts/check-environment-registry.ts` | **0** | 88 variables, all referenced -- the site's four names were already declared, so the registry is not an obstacle |

   **Blocker one: there is no published image, and the honest answer is not a digest in source.** The refusal lives
   in `packages/manifest/src/compose.ts:204-212` (a `build:` service whose image resolves to nothing), and the CLI
   reaches it because `scripts/platform-deploy.ts:50` calls `parseCompose([base, overlay])` with **no**
   `resolveArtifact` option -- although the option exists and is used on the server half
   (`apps/control-plane/src/capabilities.ts:488-490` builds the resolver from `store.listArtifacts(id)`, which is
   precisely why a tenant fork needs no `compose.prod.yaml`, D54). So a real representation of "planned but not yet
   published" exists in the *format* and does not exist in this repository's own deploy path, because there is no
   artifact to resolve. What the publishing workflow has to produce, concretely: an OCI image built from
   `apps/site/Dockerfile` and pushed to a named registry repository (declared in `x-platfolio.release` beside the
   control plane's, **and** added to `check-project.ts`'s `PUBLISHED_IMAGES` set -- D49 refuses an org repository
   named in configuration that is neither one of the four projects nor one of the two published images), then its
   digest delivered either by `POST /api/v1/instances/{id}/artifacts` plus an artifact resolver in
   `platform-deploy.ts`, or by teaching `scripts/render-platform-overlay.ts` (one hardcoded `IMAGE` today, line 17)
   to emit a second pin into `compose.prod.yaml`. Writing a digest by hand instead is the defect this file's own
   history records twice -- including the one where the overlay carried *a real digest of a deleted service's
   bytes and every check passed* -- so it was not done, and it is not the fix anyone should reach for later.

   **Blocker two (RESOLVED at the model, 2026-11-18): D62's staging origin is now expressible as a domain.** It
   used to be that staging hostnames were *derived*, not declared: `build-plan.ts` mapped each production domain
   through `stagingHost(host, stagingPrefix)` with the schema default `staging-`, and `stagingHost("platfolio.dev",
   "staging-")` → `staging-platfolio.dev` -- while `compose.yaml:111` declares staging's UI origin as
   `https://preview.platfolio.dev` (D62). Landing the entry as written would have put two different staging UI
   hostnames in one platform description, the second-copy-of-one-fact pattern AGENTS.md refuses. A service may now
   declare `environmentDomains.staging` (D68, `packages/manifest`) to name the host that environment serves,
   winning the derivation; `packages/manifest/test/fixtures/site-per-env-compose.yaml` proves the exact stanza
   parses, validates and plans `preview.platfolio.dev` as the site's staging host, and the model changes are
   committed. **This does not deploy the site.** The digest blocker above still stands, so the site service is
   expressible but not yet publishable, and no origin resolves. Until blocker one is settled the honest sentence
   about the UI stays: built, gated, undeployed, unrendered.
