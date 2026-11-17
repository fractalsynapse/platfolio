import { REQUIRED_SCOPE, WEB_CLIENT_ID } from '@platfolio/ui';

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
 * the environment at start (`scripts/site-env-print.ts` is the renderer, and the same script answers
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
}

/** The variable names this app reads. `environment.yaml` is generated from these spellings (D58). */
export const SITE_VARIABLES = {
  siteOrigin: 'PLATFOLIO_SITE_ORIGIN',
  apiUrl: 'PLATFOLIO_URL',
  issuer: 'PLATFOLIO_IDENTITY_ISSUER',
  clientId: 'PLATFOLIO_WEB_CLIENT_ID',
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
 * An absolute http(s) origin or base URL, and nothing else.
 *
 * `new URL` alone accepts `file:` and `data:`; a UI that will carry a bearer token must not be pointed at either.
 * The trailing slash is dropped so `${apiBaseUrl}${path}` cannot become `//api/v1/…` — a double slash is a
 * different origin to a proxy, and a 404 the person reads as an outage.
 */
const httpUrl = (value: string, name: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SiteConfigError(`${name} is not an absolute URL: "${value}"`, 'it must be the full base URL including scheme');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SiteConfigError(`${name} must be an http(s) URL, got ${url.protocol}`, 'a token must never be sent to another scheme');
  }
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
    scope: REQUIRED_SCOPE,
  };
}

/**
 * The `SITE_*`-shaped record a page hands to the island, and the reason it is a plain object rather than the
 * config itself: the island's props are serialised into the prerendered HTML, so every field here is
 * **public information**. Nothing credential-shaped belongs in it (D4), and `isTokenShapedName` is what the
 * auth-boundary test uses to keep it that way.
 */
export interface SitePublicConfig {
  readonly apiBaseUrl: string;
  readonly issuerBaseUrl: string;
  readonly siteOrigin: string;
  readonly clientId: string;
  readonly scope: string;
}

export const publicConfigOf = (config: SiteConfig): SitePublicConfig => ({
  apiBaseUrl: config.apiBaseUrl,
  issuerBaseUrl: config.issuerBaseUrl,
  siteOrigin: config.siteOrigin,
  clientId: config.clientId,
  scope: config.scope,
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
}

export function runtimeConfigFrom(scope: unknown): RuntimeSiteConfig | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined;
  const injected = (scope as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL];
  if (typeof injected !== 'object' || injected === null) return undefined;
  const out: Record<string, string> = {};
  for (const key of ['apiBaseUrl', 'issuerBaseUrl', 'siteOrigin', 'clientId'] as const) {
    const value = (injected as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim();
  }
  return Object.keys(out).length === 0 ? undefined : (out as RuntimeSiteConfig);
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
  const merged: SitePublicConfig = {
    apiBaseUrl: injected.apiBaseUrl ?? baked.apiBaseUrl,
    issuerBaseUrl: injected.issuerBaseUrl ?? baked.issuerBaseUrl,
    siteOrigin: injected.siteOrigin ?? baked.siteOrigin,
    clientId: injected.clientId ?? baked.clientId,
    scope: baked.scope,
  };
  for (const key of ['apiBaseUrl', 'issuerBaseUrl', 'siteOrigin'] as const) {
    httpUrl(merged[key], `${RUNTIME_CONFIG_GLOBAL}.${key}`);
    if (merged[key].startsWith('http://') && !isLoopback(merged[key])) {
      throw new SiteConfigError(
        `${RUNTIME_CONFIG_GLOBAL}.${key} is plain http on a non-loopback host`,
        'the runtime overlay is checked the same way the build inputs are; a browser carrying a token does not speak http to a machine it does not own',
      );
    }
  }
  return merged;
}
