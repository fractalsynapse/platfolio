import type { Digest, HandoffStore, IssuerRequest, RandomBytes } from '@platfolio/ui';

/**
 * The four browser capabilities the SDK's auth seam is injected with (D65; 11 §6).
 *
 * ## Why they live here and not in `packages/ui/src/web/`
 *
 * `packages/ui/src/web/browser-auth.ts` describes the `platfolio-web` flow and refuses to own its sockets: gate
 * §9.2 forbids `fetch(` anywhere in that package outside `sdk/poll.ts` — the transport driver is the only door to
 * the *platfolio API*, and a second file in the package that can open a connection is a second door. The identity
 * issuer is not that API, so the flow still has to reach the network, and it reaches it through these four
 * functions, supplied by the shell that owns the browser.
 *
 * That split is the reason this file exists. It is also the reason a reviewer can ask the question 11 §1's
 * portability pass asks — "would this survive import from a native shell unedited?" — and get a greppable answer:
 * everything browser-specific about auth is in this directory, and everything protocol-shaped is in `web/`.
 *
 * ## The one thing here that is a security decision, not a plumbing detail
 *
 * `handoff` writes to `sessionStorage`, and it is the only persistence anywhere in the auth path — and that is a
 * recorded decision, not a local one (D67). The policy this app imports names both halves of it: `TOKEN_STORAGE`
 * enumerates access, refresh and id tokens and marks all three `sessionStorage: false`, while
 * `HANDOFF_STORAGE`/`HANDOFF_KEYS` enumerate the two values that are *not* tokens and may still survive the
 * redirect — the verifier and `state`, both single-use, both deleted before the exchange is attempted
 * (`browser-auth.ts`'s `complete` reads once, then drops). The verifier grants nothing without the code that
 * arrives beside it, and the code is spent in the same request. A token never touches storage at all, which is why
 * signing in again after a reload is the accepted cost and not a bug. This file imports the key names rather than
 * typing them because a second spelling of a lookup key is how a handoff that was spent starts reporting an
 * unexplained `no-handoff`. The refusals (no cookie — the transport never emits
 * `access-control-allow-credentials`, and both sides of that seam test it; no `localStorage` — it outlives the
 * session that minted the value) and the limit (`sessionStorage` is still readable to anything that can run script
 * on this origin) are argued in one place: the header of `packages/ui/src/web/browser-auth-policy.ts`.
 */

/** `crypto.subtle.digest`, shaped as the `Digest` the seam takes. Throws rather than returning a wrong digest. */
export const webCryptoDigest: Digest = async (bytes) => {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return new Uint8Array(buffer);
};

export const webCryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/**
 * The issuer's token endpoint, form-encoded, as an `application/x-www-form-urlencoded` POST.
 *
 * No `Authorization` header and no client secret: `platfolio-web` is a public PKCE client, which is the shape
 * `scripts/browser-auth.ts` seeds into the realm and the reason this request body carries `client_id` rather than
 * a credential (D4 — a browser cannot hold a secret, and this app never asks it to).
 */
export const formPostRequest: IssuerRequest = async (url, form) => {
  const body = new URLSearchParams(form);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return { status: response.status, body: await response.text() };
};

/**
 * The single-use PKCE handoff.
 *
 * The key names come from `web/browser-auth.ts`, already namespace-prefixed (`platfolio.pkce.*`), and are passed
 * through untouched: prefixing again here would put the same fact in two files and make the two disagree about
 * what a lookup key is. `read` does not delete — `complete` drops explicitly after it has read, so a second read
 * of the same handoff is the failure mode the drop exists to prevent.
 */
export const sessionStorageHandoff: HandoffStore = {
  read: (key) => sessionStorage.getItem(key) ?? undefined,
  write: (key, value) => sessionStorage.setItem(key, value),
  drop: (key) => sessionStorage.removeItem(key),
};

/** All four, as one object, so a page mounts the island without repeating the wiring (and cannot get it half right). */
export const browserCapabilities = () => ({
  request: formPostRequest,
  digest: webCryptoDigest,
  random: webCryptoRandom,
  handoff: sessionStorageHandoff,
});
