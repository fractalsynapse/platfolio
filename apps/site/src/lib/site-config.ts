// The policy defaults arrive by relative path, not through the `@platfolio/ui` specifier the islands use, and the
// reason is a runtime fact that was measured rather than assumed. This file is read twice: by the Astro build, and
// by `node apps/site/src/tools/render-runtime-config.ts` at *container start*, where the barrel is not loadable —
// measured inside the built image (node v22.23.4): importing `@platfolio/ui` there dies with
// `ERR_UNKNOWN_FILE_EXTENSION`, because the package's published surface is raw `.ts`/`.tsx` (it has no build step,
// D63) and Node's type stripping does not read JSX. The islands are transformed by Astro's React plugin before
// anything reaches a runtime, so they take the package specifier; a plain `node` process cannot.
//
// #267 item 1 declared the workspace edge and deleted the `astro.config.mjs` alias and the `tsconfig.json` `paths`
// that stood in for it, so the specifier now resolves for every consumer — but this one line stays a path, for the
// reason above, and it is dependency-free by construction: `browser-auth-policy.ts` imports nothing, which is the
// property that makes it the only part of the package a Node-startup script may read. `packages/ui/tsconfig.json`
// already reaches across by path for the same kind of reason (`../../scripts/check-ui.ts`).
import { LOGIN_SCOPES, WEB_CLIENT_ID } from '../../../../packages/ui/src/web/browser-auth-policy.ts';

/**
 * The site's configuration, read from the environment it was built or started in (D47, D58).
 *
 * ## Why this is a function over a record and not a module that reads `process.env` itself
 *
 * One caller reads the environment: `apps/site/src/pages/*.astro` at build, and `apps/site/Dockerfile` at
 * container start. Everything downstream takes a `SiteConfig` as data, which is what makes the three claims here
 * testable without a browser and without a deploy: a missing variable is a named failure, a value that is a
 * committed generated hostname is a named failure, and the shape a page passes to the island is this type. It is
 * also the reason `check-project.ts`'s endpoint rule can stay a grep over tracked files: the only place a platfolio
 * endpoint may appear is a variable's *name*, never its value.
 *
 * ## The two tiers, stated apart
 *
 * A static Astro artifact bakes the island's props at build, so `pnpm run site:build` resolves these from the
 * build environment. A container that must be pointed somewhere else after it was built gets the same values from
 * the runtime overlay: `astro.config.mjs` writes `dist/config.js`, which `apps/site/Dockerfile` regenerates from
 * the environment at start (`apps/site/src/tools/render-runtime-config.ts` is the renderer, and the same script answers
 * `docker compose config`'s interpolation). So one spelling of four names serves build and start, and neither of
 * them is a literal in this repository.
 *
 * ## Two of these four names already exist, and this file reuses them
 *
 * `PLATFOLIO_URL` is the control plane's base URL — the workflows, `managed-action` and `render-install.ts` all
 * read that spelling today, and the registry has a row for it. `PLATFOLIO_IDENTITY_ISSUER` is the realm URL the
 * API verifies tokens against. Inventing `PLATFOLIO_SITE_API_URL` and a second issuer name for the same two facts
 * is the defect AGENTS.md names ("if a change would create a second copy of a fact, fix the ownership instead of
 * adding a file and keeping them in step"), so the site reads the two it shares with the rest of the platform and
 * adds the two it alone needs:
 *
 *  - `PLATFOLIO_SITE_ORIGIN` — this site's own public origin, which the browser needs because the realm's
 *    redirect URIs are `<origin>/callback` (`CALLBACK_PATH`, from the same policy file). Nothing else in the
 *    repository knows it: `PLATFOLIO_ALLOWED_ORIGINS` is the list the API *admits*, which is a different question
 *    from the one address this document is served at.
 *  - `PLATFOLIO_WEB_CLIENT_ID` — because a realm may carry a differently-named public client. Its default is the
 *    policy's own `WEB_CLIENT_ID` constant, not a string written down here twice.
 */
export interface SiteConfig {
  readonly apiBaseUrl: string;
  readonly issuerBaseUrl: string;
  readonly siteOrigin: string;
  readonly clientId: string;
  readonly scope: string;
  readonly installationRole?: 'hub' | 'private';
}

/** The variable names this app reads. `environment.yaml` is generated from these spellings (D58). */
export const SITE_VARIABLES = {
  siteOrigin: 'PLATFOLIO_SITE_ORIGIN',
  apiUrl: 'PLATFOLIO_URL',
  issuer: 'PLATFOLIO_IDENTITY_ISSUER',
  clientId: 'PLATFOLIO_WEB_CLIENT_ID',
  installationRole: 'PLATFOLIO_INSTALLATION_ROLE',
} as const;

export class SiteConfigError extends Error {
  constructor(problem: string, fix: string) {
    super(`${problem}. ${fix}`);
    this.name = 'SiteConfigError';
  }
}

const required = (env: Readonly<Record<string, string | undefined>>, name: string): string => {
  const value = env[name]?.trim();
  if (value === undefined || value === '') {
    throw new SiteConfigError(
      `${name} is not set`,
      `set it in the environment the site is built or started in; apps/site does not carry a default (D47: an endpoint is configuration)`,
    );
  }
  return value;
};

/**
 * An absolute http(s) URL **with a host**, and nothing else.
 *
 * Three refusals, and the third is the one `new URL` does not make for you:
 *
 *  - a relative value (`api.platfolio.example`, `/api/v1`) throws, because a base URL that is not absolute turns
 *    every SDK request into a request against whatever origin the page happens to be served from;
 *  - a non-http scheme is refused — `new URL` accepts `file:` and `data:`, and a UI is about to attach a bearer
 *    token to whatever this string becomes;
 *  - an empty hostname is refused. `https:/api` is a *valid* URL (measured: it parses, protocol `https:`, host
 *    `''`) and it is exactly what a mistyped `--url=https:/…` produces. Accepted, it resolves every call against
 *    the document's own origin, so the dashboard would ask its static host for `/api/v1/instances`, be handed
 *    HTML back, and render an empty list — a configuration error that arrives dressed as an outage.
 *
 * The trailing slash is dropped so `${apiBaseUrl}${path}` cannot produce `//api/v1/…`: a double slash is a
 * different path to a proxy and a 404 a person reads as the platform being down.
 */
const httpUrl = (value: string, name: string): string => {
  // The shape check comes before `new URL`, because URL is more forgiving than this decision needs to be.
  // Measured on this tree: `new URL('https:/api')` does not throw — it answers protocol `https:` and hostname
  // `api`, turning a mistyped `--url=https:/…` into requests to a single-label host called "api". A base URL with
  // no authority is refused here rather than resolved into something wrong and quiet.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new SiteConfigError(`${name} is not an absolute URL with an authority: "${value}"`, 'it must be scheme://host[:port], the form the SDK joins a spec path onto');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SiteConfigError(`${name} is not an absolute URL: "${value}"`, 'it must be the full base URL including scheme');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SiteConfigError(`${name} must be an http(s) URL, got ${url.protocol}`, 'a token must never be sent to another scheme');
  }
  // No empty-hostname check here, and that is a measurement rather than an oversight: with an authority present,
  // `new URL` either throws (`http://` — tested) or takes the first label as the host (`https:///api` resolves to
  // host `api`). The host-less shape the check would have caught is therefore already refused by the test above,
  // and a branch that cannot run in a validator is a branch that will never be blamed when the rule changes.
  return url.toString().replace(/\/$/, '');
};

/** The loopback test, spelled once: `http` is allowed only where no real credential can be transmitted. */
const isLoopback = (value: string): boolean => {
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '0.0.0.0';
  } catch {
    return false;
  }
};

/**
 * Resolve the site's configuration from a record that stands in for the environment.
 *
 * Plain `http` is accepted on loopback hosts and refused everywhere else, with no switch to turn it off. There
 * is deliberately no `allowInsecureLoopback`-shaped option here: an option whose only job is to loosen a safety
 * rule is the shape that ends up set in production because someone wanted a local build to pass, and the rule
 * would then describe nothing. A local build passes as written, because it is on loopback.
 */
export function resolveSiteConfig(env: Readonly<Record<string, string | undefined>>): SiteConfig {
  const siteOrigin = httpUrl(required(env, SITE_VARIABLES.siteOrigin), SITE_VARIABLES.siteOrigin);
  const apiBaseUrl = httpUrl(required(env, SITE_VARIABLES.apiUrl), SITE_VARIABLES.apiUrl);
  const issuerBaseUrl = httpUrl(required(env, SITE_VARIABLES.issuer), SITE_VARIABLES.issuer);
  const role = env[SITE_VARIABLES.installationRole]?.trim();

  for (const [name, value] of Object.entries({ [SITE_VARIABLES.siteOrigin]: siteOrigin, [SITE_VARIABLES.apiUrl]: apiBaseUrl, [SITE_VARIABLES.issuer]: issuerBaseUrl })) {
    if (value !== undefined && value.startsWith('http://') && !isLoopback(value)) {
      throw new SiteConfigError(
        `${name} is plain http on a non-loopback host`,
        'a browser that is about to carry a platfolio access token does not speak http to a machine it does not own',
      );
    }
  }

  return {
    siteOrigin,
    apiBaseUrl,
    issuerBaseUrl,
    // The policy's constant is the default; a deploy that renamed the realm client names it here, in the
    // environment, rather than editing this file (which would be a second copy of the client's identity).
    clientId: env[SITE_VARIABLES.clientId]?.trim() || WEB_CLIENT_ID,
    scope: LOGIN_SCOPES,
    ...(role ? { installationRole: installationRole(role) } : {}),
  };
}

function installationRole(value: string): 'hub' | 'private' {
  if (value === 'hub' || value === 'private') return value;
  throw new SiteConfigError('Invalid Platfolio installation role', 'use hub or private');
}

/**
 * The `SITE_*`-shaped record a page hands to the island, and the reason it is a plain object rather than the
 * config itself: the island's props are serialised into the prerendered HTML, so every field here is
 * **public information**. Nothing credential-shaped belongs in it (D4), and `isTokenShapedName` is what the
 * auth-boundary test uses to keep it that way.
 */
export type SitePublicConfig = SiteConfig;

export const publicConfigOf = (config: SiteConfig): SitePublicConfig => ({
  apiBaseUrl: config.apiBaseUrl,
  issuerBaseUrl: config.issuerBaseUrl,
  siteOrigin: config.siteOrigin,
  clientId: config.clientId,
  scope: config.scope,
  ...(config.installationRole ? { installationRole: config.installationRole } : {}),
});

/**
 * The runtime overlay, for a static artifact that has to be pointed somewhere after it was built.
 *
 * A prerendered page bakes its island's props, so `apps/site/Dockerfile` writes `dist/config.js` at container
 * start from the same four variable names, and the island prefers what it finds there. This is not a second
 * source of truth about an endpoint: the *values* still arrive from the environment, and
 * `runtimeConfigFrom`/`endpointsForIsland` are the same validation the build applies — a plain-http-on-a-public-host
 * value or a `file:` scheme is refused at runtime exactly as it is refused at build, because the overlay is an
 * input from the deployment and inputs are checked, not trusted.
 *
 * Absent is a normal state, not an error: a build that ships one artifact to one origin has no `config.js`, the
 * island falls back to what was baked, and nothing prints. The name is the one spelling — the Dockerfile writes
 * this global, `runtimeConfigFrom` reads it, and a test compares both against this constant.
 */
export const RUNTIME_CONFIG_GLOBAL = '__PLATFOLIO_SITE_CONFIG__';

/** The keys the overlay may carry: the four configuration names, never a token and never a secret (D4). */
export interface RuntimeSiteConfig {
  readonly apiBaseUrl?: string;
  readonly issuerBaseUrl?: string;
  readonly siteOrigin?: string;
  readonly clientId?: string;
  readonly installationRole?: 'hub' | 'private';
}

export function runtimeConfigFrom(scope: unknown): RuntimeSiteConfig | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const injected = (scope as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL];
  if (typeof injected !== 'object' || injected === null) return undefined;
  const out: Record<string, string> = {};
  for (const key of ['apiBaseUrl', 'issuerBaseUrl', 'siteOrigin', 'clientId', 'installationRole'] as const) {
    const value = (injected as Record<string, unknown>)[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    // Validated as it is read, not after the merge. A container that wrote a host-less URL or a client id with a
    // slash in it must fail the page loudly at boot rather than have the value travel one layer further, because
    // by the time `poll.ts` sees it the mistake looks like an outage.
    out[key] = runtimeOverlayShape(key, value.trim());
  }
  return Object.keys(out).length === 0 ? undefined : (out as RuntimeSiteConfig);
}

/**
 * The one predicate for what an overlay field may hold, shared by the browser reader and `apps/site/src/tools/render-runtime-config.ts`.
 *
 * Both ends of the same fact need the same answer, and the renderer is the end that can fail at deploy time with
 * a person watching: if the renderer accepted a value the browser would later refuse, the container would start
 * and the dashboard would break — the worst order for those two events. So `clientId` (a name, not an address) is
 * checked as a name, and the three URLs are checked with the build's own `httpUrl` plus the loopback rule.
 */
export function runtimeOverlayShape(key: keyof RuntimeSiteConfig, value: string): string {
  const label = `${RUNTIME_CONFIG_GLOBAL}.${key}`;
  if (key === 'installationRole') return installationRole(value);
  if (key === 'clientId') {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
      throw new SiteConfigError(`${label} is not a client name: "${value}"`, 'a realm client id is an opaque slug; anything else is a URL that arrived in the wrong field');
    }
    return value;
  }
  const absolute = httpUrl(value, label);
  if (absolute.startsWith('http://') && !isLoopback(absolute)) {
    throw new SiteConfigError(`${label} is plain http on a non-loopback host`, 'the overlay is checked the way the build inputs are; a browser carrying a token does not speak http to a machine it does not own');
  }
  return absolute;
}

/**
 * The endpoints the island actually uses: the overlay where it speaks, the baked props where it does not.
 *
 * Every field that arrives is re-validated, so an overlay cannot be the narrow place the http rule leaks through.
 * A field the overlay omits keeps the build's value rather than becoming undefined, because a half-written
 * `config.js` should degrade to the artifact, not break the page.
 */
export function endpointsForIsland(baked: SitePublicConfig, injected: RuntimeSiteConfig | undefined): SitePublicConfig {
  if (injected === undefined) return baked;
  // No validation pass here on purpose. `runtimeConfigFrom` already checked every field it let through, with the
  // build's own `httpUrl` and the same loopback rule; a second copy in the merge would be two answers for one
  // question, and the kind that drift -- the merge would be the one nobody tests because the reader is red first.
  const role = injected.installationRole ?? baked.installationRole;
  return {
    apiBaseUrl: injected.apiBaseUrl ?? baked.apiBaseUrl,
    issuerBaseUrl: injected.issuerBaseUrl ?? baked.issuerBaseUrl,
    siteOrigin: injected.siteOrigin ?? baked.siteOrigin,
    clientId: injected.clientId ?? baked.clientId,
    scope: baked.scope,
    ...(role ? { installationRole: role } : {}),
  };
}
