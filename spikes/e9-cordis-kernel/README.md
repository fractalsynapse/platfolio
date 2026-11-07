# E9 — Cordis kernel boot experiment

Milestone 0 experiment from [09 § Milestone 0](../../docs/design/09-delivery-plan.md). Question:

> Does the vendored Cordis kernel boot a platfolio control plane **without** `--expose-internals`,
> with the infrastructure provider selected purely by configuration?

Answer: **yes** — with one significant exception about the published plugin ecosystem, below.

## Run it

```bash
cd spikes/e9-cordis-kernel
export npm_config_cache="$PWD/../../.cache/npm"   # this box's ~/.npm is read-only
npx -y tsx driver.ts                              # exits non-zero if an assertion fails
```

## Configuration (so the result is reproducible)

- Node `v22.22.1`, no `--expose-internals`; TypeScript executed through `tsx` because **this Node
  build errors on native type-stripping** (`ERR_NO_TYPESCRIPT`).
- Packages installed from npm at the versions matching the vendored tag: `cordis@4.0.0-rc.12`,
  `@cordisjs/plugin-loader@1.0.0-rc.9`, `@cordisjs/plugin-include@1.2.0`,
  `@cordisjs/plugin-timer@1.1.4`, `@cordisjs/plugin-group@1.0.0`, `@cordisjs/plugin-server@1.7.0`.
- `cordis.alpha.yml` / `cordis.beta.yml` differ **only** in which provider entry is `disabled` and in
  the probe config string; `cordis.invalid.yml` deliberately contains malformed entries.
- `src/infra.ts` declares one capability (`ctx.infra`); `src/provider-alpha.ts` and
  `src/provider-beta.ts` are two implementations of it. Nothing in the driver names a provider.

## Observed

| ID | Result | Evidence |
| --- | --- | --- |
| A1 | PASS | Boots with no internals flag; capabilities `infra`, `server`, `timer` all resolve |
| A2 | PASS | Identical code, two profiles → `alpha` / `beta`; `createProject` dispatched to the selected provider |
| A3 | OBSERVE | A profile with malformed entries **boots without throwing** — entry validation is not enforced at load |
| A4 | PASS | `intercept()` layers per scope; inner wins per key — the per-tenant provider-config mechanism works |
| A5 | OBSERVE | `isolate('infra').infra` threw `cannot get property "infra" without inject`, i.e. un-injected access is blocked; still not a sandbox (see limits) |
| A6 | PASS | Registration inside a plugin/fiber scope works both synchronously and after `await`; the failure mode is calling `inject` on the **root** context outside any fiber |
| A7 | PASS | `fiber.dispose()` removes listeners cleanly (`FiberState.DISPOSED=4`) — reversible registration confirmed |
| A8 | PASS | A `node:http` server resolves the capability inside the request handler and answers `200` |
| A9 | OBSERVE | **`@cordisjs/plugin-server@1.7.0` registers, then fails at route definition** against the vendored core |
| A10 | OBSERVE | A booted `server` capability keeps the event loop alive; shutdown must be explicit |

## The exception that matters (A9)

`plugin-server` calls `Service.resolveConfig`. That symbol exists in the published
**`@deepseek-ai/cordis@4.1.0`** (verified in its `lib/utils.js`) but **not** in
`cordiverse/cordis@4.0.0-rc.12` — which has `resolveIntercept` — nor in upstream `main`. Its declared
peer range `^4.0.0-rc.6` permits the broken combination, so npm installs a set that only fails once
you define a route. Consequence: **the published `@cordisjs/*` plugin ecosystem is built against a
forked core, not the repository we vendored.** Two decisions follow: keep our own HTTP surface behind
the kernel adapter rather than adopting `plugin-server`, and settle the core lineage deliberately
(E13), including the fork's license and provenance before anything of it is vendored.

## Limits of this experiment

It answers boot/config-swap/effect-lifecycle questions and nothing else. It does **not** test: the
`infra.provider` conformance suite, real Railway or GitHub calls, multi-tenancy, hot reload (E12),
persistence, or whether `isolate()` is an adequate boundary for untrusted plugins (it is not assumed
to be — D13 treats it as composition scoping). It consumed **npm artifacts, not artifacts built from
`vendor/cordis`**, which is sound only while `vendor/patches/` is empty (OD6a); once we carry a patch,
the spike must be re-run against our own package.

## What it changes

`node_modules/` is gitignored; nothing here is a deliverable. Read the conclusions in
[10 § E9 result](../../docs/design/10-cordis-kernel-and-extension-seams.md) and the follow-up
experiments E13–E14 in [09](../../docs/design/09-delivery-plan.md).
