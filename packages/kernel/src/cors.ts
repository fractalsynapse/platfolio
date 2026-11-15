import { z } from 'zod';

/**
 * Cross-origin policy, applied where responses are actually written.
 *
 * Two placement decisions are load-bearing, so they are stated here rather than left to be rediscovered:
 *
 * **Why the transport, not a handler.** `access-control-allow-origin` has to be on every response a browser is
 * allowed to read -- a 200, a 401 from the auth guard, the router's own 404 for an unknown path, and the 500 the
 * transport writes when a handler throws. Handlers are the many places; the listener is the one place. CORS
 * expressed per handler is CORS with holes in it, and a hole here reads to the SPA as an opaque network error
 * rather than as the status the API chose. This module owns the *mechanism*; it holds no opinion about the API
 * (no operationId, no path table) which is the rule the rest of this package keeps.
 *
 * **Why the preflight is not an OpenAPI operation (D41).** `operationsOf` treats every HTTP method key under a
 * path as an operation -- `options:` included -- so declaring a preflight would demand one operationId per path
 * (~30 of them), each with a declared security scheme and a matching route in `ROUTE_MANIFEST`, each validated
 * like an endpoint. A preflight has no response schema and no caller-visible meaning: the browser makes it, and
 * no client is permitted to depend on its answer. It is transport negotiation, the same as `Content-Length`.
 * So it is answered here, before route matching, and `api:check` keeps comparing the real surface in both
 * directions with nothing weakened and nothing added.
 *
 * **Why `access-control-allow-credentials` is never sent.** This API authenticates with
 * `Authorization: Bearer <token>` (`capabilities.ts` reads that one header and no other), which a browser sends
 * only because the SPA's own JavaScript put it there. It is not ambient state. `true` here would additionally
 * admit the visitor's *cookies* to every origin on the list -- a cross-site credentialed request surface this
 * project has no CSRF story for, in exchange for nothing the bearer scheme does not already provide. Listing an
 * origin therefore buys it the right to present a token, not the right to ride a session. Consequences stated
 * honestly: an SPA must keep its token in its own storage (not rely on a cookie platfolio would never read), and
 * `fetch` must use the default `credentials: 'same-origin'`.
 *
 * **Why never `*`.** The mechanism has no wildcard path at all: an entry of `*` is refused by the same predicate
 * that refuses a malformed origin, so a wildcard cannot be configured even by accident. The origin a response
 * carries is the *request's* Origin, and only when it is on the list.
 *
 * **Why `vary: origin` is on everything once a list exists.** With a list configured, the bytes of the answer
 * depend on a request header (`Origin`); a shared cache that does not know that serves a cors-cached response to
 * a browser that needed the header, or the reverse. With no list configured, nothing depends on Origin -- the
 * response is the same for every caller -- so no `vary` is claimed. That is why the header is absent in the
 * default configuration rather than present-and-useless.
 */

/** The refusal that names the reason, because "not allowed" teaches nobody what to type. */
export const WILDCARD_REFUSAL = 'a wildcard origin is not supported: this API accepts bearer tokens, so `*` would let any page read any record a visitor can name';

/**
 * Is this string one origin -- `scheme://host[:port]` and nothing more?
 *
 * `URL` does the parsing because reimplementing the origin grammar in a regex is how userinfo, IP literals,
 * punycode and default-port folding get wrong. What the parser rejects: any scheme but http/https, credentials
 * inside the URL (a DSN-shaped "origin" is not an origin), and a path, query or fragment -- an origin is a
 * tuple of scheme+host+port, and the browser's `Origin` header never carries more.
 */
export function canonicalOrigin(raw: string): string | undefined {
  const value = raw.trim();
  if (value === '' || value === '*') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.pathname !== '' && url.pathname !== '/') return undefined;
  if (url.search !== '' || url.hash !== '') return undefined;
  // `URL.origin` is the string `scheme://host[:port]` with a default port folded away, which is exactly what a
  // browser sends, and it lowercases the scheme and host -- so `https://APP.dev` matches `https://app.dev`.
  const origin = url.origin;
  return origin === '' || origin === 'null' ? undefined : origin;
}

const OriginListSchema = z.array(z.string().min(1)).superRefine((list, ctx) => {
  for (const raw of list) {
    if (raw.trim() === '*') {
      ctx.addIssue({ code: 'custom', message: `${WILDCARD_REFUSAL} -- got "${raw.trim()}"` });
      continue;
    }
    if (canonicalOrigin(raw) === undefined) {
      // The offending text is bounded and never contains credentials by construction (the predicate rejects a
      // URL with userinfo before this message is written), so quoting it is diagnostic rather than a leak.
      ctx.addIssue({ code: 'custom', message: `"${raw.slice(0, 80)}" is not an origin: expected scheme://host[:port] with no path, query or credentials` });
    }
  }
});

/**
 * The policy as the transport receives it. `allowedOrigins` empty means cross-origin use is **not enabled at
 * all**: no CORS header on any response, and `OPTIONS` keeps the answer it had before this file existed.
 */
export const CorsConfigSchema = z.object({
  allowedOrigins: OriginListSchema.default([]),
  /**
   * What a browser may send. This API reads `authorization` (the bearer token) and a JSON `content-type`, and
   * nothing else -- verified against the handlers, not guessed. A wider list is a wider request surface for no
   * capability, so a new custom header must arrive with the handler that reads it.
   */
  allowedHeaders: z.array(z.string().min(1)).default(['authorization', 'content-type']),
  /**
   * How long a browser may cache the preflight answer. No method list is configured here on purpose: the methods
   * a preflight may be granted are the ones the route table actually registers for that path, read at request
   * time -- so a preflight cannot survive a rename in the manifest, and the transport acquires no opinion about
   * the API.
   *
   * There is deliberately no `exposeHeaders` field either. Everything a caller is meant to act on is in the
   * status and the JSON body, both already readable cross-origin once the origin is listed. `www-authenticate`
   * is the one non-safelisted response header this API emits, and it is metadata for a generic HTTP client
   * rather than something a page needs to see; listing it would widen what a listed origin can observe for no
   * capability the SPA requires. If an operation ever needs a custom response header readable from JavaScript,
   * that is the moment this field appears -- with the operation that needs it.
   */
  maxAgeSeconds: z.number().int().min(0).max(86_400).default(600),
}).strict();

export type CorsConfig = z.infer<typeof CorsConfigSchema>;

/** The parsed form the transport holds: a set for O(1) admission, built once at construction. */
export interface CorsPolicy {
  readonly origins: ReadonlySet<string>;
  readonly configured: readonly string[];
  readonly allowedHeaders: readonly string[];
  readonly maxAgeSeconds: number;
}

/**
 * One spelling of "is cross-origin enabled, and with what". Returns `undefined` when it is not, which is the
 * state the transport treats as "behave exactly as you did before this existed".
 *
 * A malformed or wildcard entry **throws**, here as well as in the composition root. That is the second net, not
 * the first: a caller that assembles a `CorsConfig` without reading an environment variable still cannot install a
 * policy it did not intend, and a partially-applied origin list -- three of four entries live -- is a security
 * control that quietly became a guess.
 */
export function corsPolicyOf(config: Partial<CorsConfig> | undefined): CorsPolicy | undefined {
  if (config === undefined) return undefined;
  let parsed: CorsConfig;
  try {
    parsed = CorsConfigSchema.parse(config);
  } catch (error) {
    const issues = (error as { issues?: Array<{ message: string }> }).issues;
    throw new Error(`cors configuration refused: ${(issues ?? []).map((i) => i.message).join('; ') || (error as Error).message}`);
  }
  if (parsed.allowedOrigins.length === 0) return undefined;
  const origins = new Set<string>();
  for (const raw of parsed.allowedOrigins) {
    const canonical = canonicalOrigin(raw);
    if (canonical === undefined) continue; // unreachable: OriginListSchema refused the document already
    origins.add(canonical);
  }
  return {
    origins,
    configured: [...origins].sort(),
    allowedHeaders: parsed.allowedHeaders.map((h) => h.toLowerCase()),
    maxAgeSeconds: parsed.maxAgeSeconds,
  };
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

type HeadersLike = Record<string, string | string[] | undefined>;

/** The request's Origin, canonicalized -- or `undefined` when the call carries no origin at all. */
export function requestOrigin(headers: HeadersLike): string | undefined {
  const raw = first(headers.origin);
  return raw === undefined ? undefined : canonicalOrigin(raw);
}

/** `Vary` is a list, and a handler that claimed its own must not be overwritten by the transport's. */
function joinVary(existing: string | undefined, addition: string): string {
  const parts = (existing ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
  for (const part of addition.split(',').map((s) => s.trim())) {
    if (part !== '' && !parts.includes(part.toLowerCase())) parts.push(part);
  }
  return parts.join(', ');
}

/**
 * Headers for an actual (non-preflight) response. Pure and total: it never throws, because a policy bug must
 * not become a 500 -- and it never emits `access-control-allow-credentials`; see the header of this file.
 */
export function corsResponseHeaders(policy: CorsPolicy | undefined, headers: HeadersLike): Record<string, string> {
  if (policy === undefined) return {};
  const out: Record<string, string> = {};
  const origin = requestOrigin(headers);
  if (origin !== undefined && policy.origins.has(origin)) out['access-control-allow-origin'] = origin;
  // Set whenever the answer depends on Origin -- including a request that brought no Origin at all, because the
  // same URL answered to a listed origin differently, and a cache is shared between the two.
  out.vary = 'origin';
  return out;
}

/**
 * Merge the CORS headers into a response, preserving a `vary` a handler already wrote.
 * Exported because the transport's error branch (a handler that threw) answers without ever going through
 * `dispatch`, and a browser still has to be able to read that 500.
 */
export function applyCors(response: { status: number; body: unknown; headers?: Record<string, string> }, policy: CorsPolicy | undefined, request: { headers: HeadersLike }): typeof response {
  if (policy === undefined) return response;
  const cors = corsResponseHeaders(policy, request.headers);
  const existing = response.headers ?? {};
  const merged: Record<string, string> = { ...existing };
  for (const [name, value] of Object.entries(cors)) {
    merged[name] = name === 'vary' ? joinVary(existing[name], value) : value;
  }
  return { ...response, headers: merged };
}

/** A preflight is an `OPTIONS` that brings both an Origin and the method it is asking permission for. */
export function isCorsPreflight(request: { method: string; headers: HeadersLike }): boolean {
  return request.method.toUpperCase() === 'OPTIONS'
    && request.headers.origin !== undefined
    && first(request.headers['access-control-request-method']) !== undefined;
}

const PREFLIGHT_VARY = 'origin, access-control-request-method, access-control-request-headers';

/**
 * The preflight answer, or `undefined` to let the request fall through to the router (which is what happens to a
 * plain `OPTIONS`, and to everything while no origin list is configured -- so the default deployment behaves
 * byte-identically to the one before this file).
 *
 * Rejection is by omission where omission is what the browser reads (no `access-control-allow-origin`), and by
 * 405 where an operator or a log has to be told why: a listed origin asking for a method that path does not
 * register gets `allow:` naming the ones it does. Both branches are refusals to a browser; only one is a refusal
 * a human can read.
 */
export function corsPreflightResponse(
  policy: CorsPolicy | undefined,
  request: { method: string; path: string; headers: HeadersLike },
  methodsForPath: readonly string[],
): { status: number; body: unknown; headers: Record<string, string> } | undefined {
  if (policy === undefined || !isCorsPreflight(request)) return undefined;
  const origin = requestOrigin(request.headers);
  if (origin === undefined || !policy.origins.has(origin)) {
    // Nothing that grants a cross-origin read is emitted. The Origin is echoed into the refusal because it is
    // the caller's own value and the operator needs to see which one was not on the list.
    return {
      status: 405,
      body: { error: 'origin-not-allowed', message: `the origin of this preflight is not on the allowed list, so no cross-origin permission is granted` },
      headers: { vary: PREFLIGHT_VARY },
    };
  }
  const methods = [...new Set(methodsForPath.map((m) => m.toUpperCase()))].sort();
  const requested = (first(request.headers['access-control-request-method']) ?? '').trim().toUpperCase();
  const headers: Record<string, string> = {
    vary: PREFLIGHT_VARY,
    'access-control-allow-origin': origin,
  };
  if (requested === '' || !methods.includes(requested)) {
    headers.allow = methods.join(', ');
    return { status: 405, body: { error: 'method-not-allowed', message: `no route registers ${requested} for this path` }, headers };
  }
  headers['access-control-allow-methods'] = methods.join(', ');
  // Echo back the intersection, not the whole policy: what a caller asked for and what is permitted are both
  // visible, and an unlisted header is missing from the answer rather than silently blessed into it.
  const asked = (first(request.headers['access-control-request-headers']) ?? '')
    .split(',').map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
  const granted = asked.filter((h) => policy.allowedHeaders.includes(h));
  if (granted.length > 0) headers['access-control-allow-headers'] = granted.join(', ');
  // The transport's blanket `no-store` would make `access-control-max-age` a number nobody honours, so a granted
  // preflight states its own lifetime: revalidatable by the browser for max-age, never shared. This response
  // carries no data, which is why `private` is enough of a limit to name.
  if (policy.maxAgeSeconds > 0) {
    headers['access-control-max-age'] = String(policy.maxAgeSeconds);
    headers['cache-control'] = `private, max-age=${String(policy.maxAgeSeconds)}`;
  }
  return { status: 204, body: undefined, headers };
}

/**
 * One line about what is in force, for boot.
 *
 * Count and shape only, never a permissive default: the sentence an operator reads at 3am is the difference
 * between "this deployment chose same-origin" and "this deployment was never told", and a line that suppresses a
 * wildcard would hide the one configuration that must never be reachable. The transport does not know the name of
 * the environment variable that fed it -- that belongs to the composition root, which is the caller here.
 */
export function describeCorsPolicy(policy: CorsPolicy | undefined): string {
  if (policy === undefined) {
    return 'cors: no allowed origins are configured -- same-origin requests only, and a browser on another origin will be refused';
  }
  const listed = policy.configured.slice(0, 5);
  const more = policy.configured.length > listed.length ? ` (+${String(policy.configured.length - listed.length)} more)` : '';
  return `cors: ${String(policy.configured.length)} allowed origin(s) [${listed.join(', ')}${more}]; `
    + 'preflight methods from the route table per path; '
    + `request headers ${policy.allowedHeaders.join(', ')}; `
    + 'no credentials (this API authenticates with a bearer header, not cookies); '
    + `preflight cached ${String(policy.maxAgeSeconds)}s`;
}
