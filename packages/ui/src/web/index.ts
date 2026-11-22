/**
 * The declared browser boundary (11 §1, gate §9.2). **No screens live here yet, and that is reported, not
 * hidden.**
 *
 * Gate §9.2 permits `window.`, `document.`, `localStorage`, `sessionStorage` and `indexedDB` in exactly two
 * places in this package: this directory, and the transport driver at `src/sdk/poll.ts`. Everywhere else they
 * fail the build. The reason a boundary has to be a *directory* rather than a rule in someone's head is rule 9
 * of the reviewer pass — "would this screen's components survive `import` from a native shell unedited? It
 * imports from `web/`" is a greppable question only if `web/` is where the ungreppable things are.
 *
 * The type-level half of this boundary is already enforced by accident of configuration, and it is worth
 * stating so nobody "fixes" it: the root `tsconfig.json` sets `lib: ["ES2023"]` and `types: ["node"]`, with no
 * `dom`. So `window`, `document` and `indexedDB` **do not resolve in this repository at all** (measured — see
 * the report), and a file that reaches for them fails `tsc` before any grep runs. `@types/react` contributes
 * *interfaces* named `Element`/`HTMLElement`, which is why the gate is a grep and not a type test: the names
 * exist as types, so only the text tells you whether something is actually touching a browser.
 *
 * What belongs here when screens arrive, per 11 §5: the draft store (`drafts.ts`, IndexedDB, the only door to
 * persistence), the overlay-stack host, and the focus trap. Not components, and not anything a native shell
 * would have to reimplement — those live above, and reach down only through an injected interface.
 *
 * Nothing is exported from this file. Its existence is the contract; `scripts/check-ui.ts` asserts that
 * whatever appears inside it stays inside the rules, and that the directory's emptiness is *reported* as a
 * limitation of gate §9.9 rather than counted as a pass.
 */

/**
 * The boundary's path, **owned by this module** and read by `scripts/check-ui.ts`.
 *
 * It used to live in the gate as a string literal, which made two spellings of the one fact that decides which
 * files may touch a browser — and the two already disagreed about the trailing slash. Rule 9 of the reviewer
 * pass ("would this survive import from a native shell? It imports from `web/`") is only answerable if there is
 * one answer to "where is `web/`".
 */
export const WEB_BOUNDARY_DIR = 'packages/ui/src/web';
