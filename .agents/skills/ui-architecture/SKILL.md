---
name: ui-architecture
description: Use when building or reviewing platfolio UI — components, layouts, page documents, signals, overlay drafts, freshness, or the API SDK. Loads the six architecture rules, the commands that check them, and the stop conditions.
---

# Build UI that cannot drift back into a breaking architecture

Apply the [project instructions](../../../AGENTS.md) first. **Normative rules: [docs/ui-architecture.md](../../../docs/ui-architecture.md)** —
this skill is procedure only. Design rationale, the full contracts and the eleven CI gates are
[11 — UI framework specification](../../../docs/design/11-ui-components-and-page-model.md); the client rule and
auth posture are [07](../../../docs/design/07-interfaces-api-mcp-mobile.md); the Tier 2 trust boundary is
[10](../../../docs/design/10-cordis-kernel-and-extension-seams.md). Do not restate those here — cite them.

## What exists before you start (measured)

`packages/ui` (D63, 2026-11-15: it will hold ALL reusable components **and** design tokens as CSS custom
properties — there is no `packages/tokens`) **now exists** with contracts, tokens, layout primitives, signals, the SDK seam and `ui:check` (19 gates; 5 report NOT RUN), **and no screens**; `packages/api-client` and `apps/site` **do not exist**. Real
today: `apps/control-plane/openapi.yaml` (request/response only, no push channel — re-check with the grep
below; D64 makes building toward push *required*, shipping on `poll` *current*), `packages/api-contract`'s
generated types, and `packages/page-schema` (pages as data, `buildSecretsPanel`, `findValueBearingProps`).
So a UI gate that audits `packages/ui` cannot run yet: report it **not run**, never passed.

## The six rules, compressed

1. **One data path.** Import server types from the generated contract; call the API through the SDK's
   transport. **Never** hand-copy a DTO, hand-write a client, `fetch` in a component, or commit a base URL
   (D47). A local interface with the server's fields is #247 in a `.tsx` file.
2. **Layout-driven responsive, mobile-first.** The five primitives (`stack`, `split`, `popout-sidebar`,
   `overlay-sheet`, `full-page`) own `container-type`; components query their **container**. No width
   `@media`, no `isMobile`/`compact`/`desktop` prop. Every capability reachable at 360 px — desktop adds
   simultaneity, never features.
3. **Typed signals, declared retention.** Every signal has a name, a payload schema, an explicit
   `retention: 'replay' | 'transient'`, **no default**, and an emitter in the component's `produces`.
   Side-effecting or credential-shaped payloads are `transient` by rule. No stringly-typed bus, no
   `window.dispatchEvent`, no ad-hoc `EventTarget`. Test late-mount **both ways**: replay delivers,
   transient stays silent.
4. **Drafts local, bounded, never secret-bearing.** Three failure modes specified separately: push/pop,
   backgrounding/kill, reload. IndexedDB only, keyed `person | team/environment | page | overlay`, allowlisted
   by `draftable`, TTL'd, wiped on sign-out and on successful submit, **never synced**. A secret field is
   never draftable, rejected by the value-bearing walk — not by a naming convention. Losing half-typed secret
   input on a kill is **correct behavior**; do not "fix" it.
5. **Real-time is honest about what exists.** D64 (UI-OD2 answered): the design must be **capable** of real
   time — one SDK freshness primitive whose transport is swappable at build time (`poll` today, `events` when
   §4's operations land) — while no push channel exists yet, so no `EventSource`, no `WebSocket`, no "live"
   pill, no unlabelled spinner, no optimistic success. Every server-derived render carries its age. Polling
   is never described or styled as push, and a UI change never designs the endpoint (D41).
6. **Pluggable means build-time.** The component registry is compiled in; page documents are data. **Never**
   dynamic-import UI code from a URL, never fetch a registry at runtime. [10's Tier 2 boundary](../../../docs/design/10-cordis-kernel-and-extension-seams.md#the-collision-and-the-resolution)
   is a security property, not a style preference.

## Commands that check them

Run from the repository root. In this sandbox pnpm cannot lock its store
(`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`), so use the direct form, which [MAINTAINING](../../../docs/MAINTAINING.md#if-pnpm-run-script-fails-before-running-anything)
documents as equivalent; CI runs the `pnpm run` wrappers inside `verify`.

| Command | What failing it means |
| --- | --- |
| `npx -y tsx scripts/gen-api-spec.ts --check` (`spec:check`) | the committed spec is not what the schemas generate — rule 1 broke at the source |
| `npx -y tsx scripts/check-api.ts` (`api:check`) | routes and document disagree in either direction; a "push operation" cannot be smuggled in |
| `npx -y tsx scripts/gen-api-types.ts --check` (`api:types:check`) | the types a UI imports no longer reproduce from the spec — nothing above may build on them |
| `npx -y tsx --test packages/api-contract/test/generated-types.test.ts packages/api-contract/test/schema-parity.test.ts packages/api-contract/test/spec-generation.test.ts packages/api-contract/test/spec.test.ts` | the parity ledger, the generated-block rule, or a spec-that-became-fiction check failed |
| `npx -y tsx --test packages/page-schema/test/secrets-panel.test.ts packages/page-schema/test/binding-panel.test.ts` | the page-a-data contract slipped: a value-bearing property, an unknown component, or a registry that no longer covers exactly the declared names |
| `npx -y tsx --test apps/control-plane/test/cors.test.ts` | the browser half of rule 1: origins are configuration (`PLATFOLIO_ALLOWED_ORIGINS`), so a UI cannot smuggle a committed endpoint past it |
| `npx -y tsx scripts/check-contracts.ts` (`contracts:check`) | the surface being rendered changed without its bump being derived |
| `npx -y tsx scripts/check-project.ts` (`check`) | a doc link, heading anchor or skill metadata broke |
| `grep -n "text/event-stream\|websocket\|EventSource\|WebSocket" apps/control-plane/openapi.yaml` | expect **no match** (exit 1). A match means §4's push operations exist — rule 5's constraint changes, and the UI task becomes swapping the SDK transport driver, not touching a component; designing those operations is still nobody's call from a UI branch (D41, D64) |

`pnpm run verify` runs every gate in that table except the last row, which is a reading of the document rather
than a gate. It is the merge gate. For a screen-level review, use the nine-step conformance checklist in
[docs/ui-architecture.md § Per-screen conformance checklist](../../../docs/ui-architecture.md#per-screen-conformance-checklist).

## Stop conditions — do not decide these yourself

Five UI-OD decisions are open in [11 § Open decisions](../../../docs/design/11-ui-components-and-page-model.md#open-decisions);
two more were **answered by the maintainer on 2026-11-15** (UI-OD2, UI-OD6) and are kept with his reasons in
[11 § Closed UI-OD decisions](../../../docs/design/11-ui-components-and-page-model.md#closed-ui-od-decisions).
An agent who resolves an open one in code has made a decision the project has not made, in a place nobody
reviews; an agent who re-litigates a closed one has done the same against a decision that *has* been made:

- **UI-OD3 — native vehicle** (RN / Capacitor / Tauri / web-only). Build to the contracts; choose nothing.
- **UI-OD1 — Astro islands vs a plain React mount** for the dashboard shell.
- **UI-OD5 — replay-from-store as the pattern for context signals**, with transient mandatory elsewhere.
- **UI-OD4 — the draft retention numbers** (7-day TTL, wipe-on-sign-out posture). Implement the mechanics,
  leave the numbers as the open question.
- **UI-OD7 — where a template's screens live** (generated from the manifest, or page documents versioned in
  the template repository under D60).

Answered — follow the answer, do not re-ask, do not overstep it either:

- **UI-OD6 — CLOSED (D63): `packages/ui` holds components *and* design tokens as CSS custom properties; no
  `packages/tokens`.** Do not scaffold `packages/ui` from a UI task anyway — its first commit is the contract
  package and gates, per [11 § Consequences for the plan](../../../docs/design/11-ui-components-and-page-model.md#consequences-for-the-plan).
- **UI-OD2 — ANSWERED (D64): design the push capability, ship polling first.** The push operations
  (`GET …/events`, `POST …/events/ticket`) and the ticketed-auth identity work remain API operations under
  D41, owned by the sessions that own `openapi.yaml` and `packages/contracts`; they do not exist yet and are
  required work, not permission to build a "live" UX today. Never design them from a UI branch.

Also stop and ask when: a `draftable` field looks credential-shaped but `findValueBearingProps` does not
reject it (see the two-predicate gap in [docs/ui-architecture.md § Open gaps](../../../docs/ui-architecture.md#open-gaps-this-file-refuses-to-paper-over)
— it is a real hole, do not paper it over with a name check); a screen needs a capability the API does not
expose ([07 § The rule](../../../docs/design/07-interfaces-api-mcp-mobile.md#the-rule) — if it can only be
reached by clicking, the API is wrong); or a spec command fails on files another agent is mid-edit.

## Not negotiable, not generalizable

**The Tier 2 boundary (D13/D14) and D4/D53 do not bend for convenience.** No runtime-loaded UI code, no
remote module specifiers in the registry, no "temporarily" hot-swapped component map — an in-process
extension shares the heap of the user's session. And no secret value in a draft, a replayed signal payload, a
page document, a log or an audit row, including a *transient* local cache: platfolio delivering a credential
and keeping nothing is the product's claim, not a UX suggestion. If a request implies either, say so and stop
rather than narrowing the rule to fit.

## Exclusions

Capability interfaces and provider seams belong to
[capability-seams](../capability-seams/SKILL.md); hosting definitions to
[platform-manifest](../platform-manifest/SKILL.md); claiming a control-plane, identity or provisioning change
is safe belongs to [tenant-safety-check](../tenant-safety-check/SKILL.md) plus
[verification](../verification-before-completion/SKILL.md). This skill audits UI architecture only.
