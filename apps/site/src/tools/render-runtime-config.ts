#!/usr/bin/env node
/**
 * Render the site's runtime endpoint overlay — the bridge between D47 and a static artifact.
 *
 * ## The problem this exists for
 *
 * `apps/site` builds to static files, and a static build bakes the island's props: the control-plane base, the
 * issuer, the site's own origin. That is fine for a deployment that rebuilds per environment, and useless for one
 * that ships a single artifact and points it somewhere at start. The escape hatch is `/config.js`, loaded by
 * `apps/site/src/layouts/page.astro` on the two routes that hydrate, and read back by `runtimeConfigFrom()` in
 * `apps/site/src/lib/site-config.ts` — which validates what it finds exactly as the build validates what it is
 * given, because an overlay from a container is an input, not a trusted fact.
 *
 * So this script is what turns the environment into that input. It prints the object and nothing else; the
 * Dockerfile redirects it into `dist/config.js`. The tracked `apps/site/public/config.js` is comments only, which
 * is the same fact stated from the other direction: **no value is ever committed here** (D47). The four names it
 * reads are `SITE_VARIABLES` in `site-config.ts`, spelled once and declared in `environment.yaml`, and
 * `apps/site/test/site-config.test.ts` refuses the two spellings drifting apart.
 *
 * ## Why it refuses rather than defaulting
 *
 * An unset `PLATFOLIO_SITE_ORIGIN` is not "no overlay" — it is a container that has been started without being
 * told where it lives, and the quiet version of that is a UI that hydrates against build-time values an operator
 * believes they changed. So the script exits 1 naming the variable. An empty *set* is different and allowed:
 * `PLATFOLIO_WEB_CLIENT_ID=''` means "use the policy default", so the key is omitted and the island keeps the
 * constant from `browser-auth-policy.ts`. That distinction — absent versus empty — is the same one the registry
 * draws between `required: true` and a defaulted row.
 *
 * ## What it will not print
 *
 * A hostname it invented, a path it guessed at, or any value that is not an absolute http(s) URL with a host. It
 * also will not print a credential: the four keys are endpoints and a public client id, and D4 has nothing to do
 * here except be respected by construction — this script reads no secret name at all.
 */
import { SITE_VARIABLES, SiteConfigError, runtimeOverlayShape } from '../lib/site-config.ts';

const lines = process.argv.slice(2);
const wantJson = lines.includes('--json');

if (lines.includes('--help')) {
  process.stdout.write(
    'usage: apps/site/src/tools/render-runtime-config.ts [--json]\n'
    + '  Prints the runtime endpoint overlay for apps/site to stdout.\n'
    + `  Reads ${Object.values(SITE_VARIABLES).join(', ')} from the environment and refuses if a required one is unset.\n`
    + '  --json prints the object only (for a pipeline); the default prints an assignment to ' + `'window.__PLATFOLIO_SITE_CONFIG__'.\n`,
  );
  process.exit(0);
}

/**
 * The renderer reads the same predicate the browser does — a relative value or a host-less `https:/api` is refused
 * here rather than shipped into a file the island then has to defend itself against.
 */
function collect(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  const required = [SITE_VARIABLES.siteOrigin, SITE_VARIABLES.apiUrl, SITE_VARIABLES.issuer];
  const missing = required.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    process.stderr.write(
      `render-runtime-config: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set in this environment.\n`
      + '  The overlay exists so one artifact can be pointed at an environment at start; starting it without the\n'
      + '  names leaves the island on whatever the build baked, which the operator believes they have changed.\n'
      + '  Set them, or do not run the container.\n',
    );
    process.exit(1);
  }
  for (const [key, name] of [
    ['siteOrigin', SITE_VARIABLES.siteOrigin],
    ['apiBaseUrl', SITE_VARIABLES.apiUrl],
    ['issuerBaseUrl', SITE_VARIABLES.issuer],
    ['clientId', SITE_VARIABLES.clientId],
    ['installationRole', SITE_VARIABLES.installationRole],
  ] as const) {
    const value = (env[name] ?? '').trim();
    if (value === '') continue; // empty means "no override", and for the client id "use the policy default"
    runtimeOverlayShape(key, value);
    out[key] = value;
  }
  return out;
}

let overlay: Record<string, string>;
try {
  overlay = collect(process.env as Record<string, string | undefined>);
} catch (error) {
  if (error instanceof SiteConfigError) {
    process.stderr.write(`render-runtime-config: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

if (wantJson) {
  process.stdout.write(JSON.stringify(overlay) + '\n');
} else {
  // A classic script, not a module, and it carries no secret. The page loads it before the island's deferred
  // module scripts run, which is the only reason the reader can prefer these values over the baked ones.
  process.stdout.write(`window.${'__PLATFOLIO_SITE_CONFIG__'} = ${JSON.stringify(overlay, null, 2)};\n`);
}
