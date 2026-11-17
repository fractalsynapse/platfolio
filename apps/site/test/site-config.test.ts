import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  RUNTIME_CONFIG_GLOBAL,
  SITE_VARIABLES,
  SiteConfigError,
  endpointsForIsland,
  publicConfigOf,
  resolveSiteConfig,
  runtimeConfigFrom,
} from '../src/lib/site-config.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * The site's configuration seam, tested as the pure function it is (D47, D58).
 *
 * This is the file that decides whether "the endpoints arrive from the environment" is a fact or a comment, and it
 * is testable without a browser, a deploy or a network because `resolveSiteConfig` takes a record rather than
 * reading `process.env` itself. Four claims, each of which would be a real defect if it flipped:
 *
 *  1. a missing variable fails by NAME, and the message names the variable rather than a value (an operator has
 *     to be told which knob is missing, and a log that echoes a full config is one step from a token);
 *  2. a value that is not an absolute http(s) URL is refused, including `file:` and a bare host — the shape a
 *     `--url=` typo actually takes;
 *  3. plain `http` survives only on loopback, with no switch to loosen it;
 *  4. the runtime overlay cannot smuggle in what the build refused, and cannot carry a credential-shaped key.
 *
 * The last one is the interesting pair of directions. D4 is not a rule about transport, so a test that only
 * proves "the token exchange works" would miss it: what is checked here is that the *shape* of the overlay has no
 * place for a secret, and that `isTokenShapedName` — the policy's own predicate, imported from the browser-auth
 * policy module rather than restated — refuses the names a well-meaning deployer would reach for.
 */

const OK = {
  [SITE_VARIABLES.siteOrigin]: 'https://platfolio.example',
  [SITE_VARIABLES.apiUrl]: 'https://api.platfolio.example',
  [SITE_VARIABLES.issuer]: 'https://auth.platfolio.example/realms/platfolio',
};

test('the four names this app reads are the four the registry declares (D58: one registry per platform)', () => {
  const registry = fs.readFileSync(path.join(ROOT, 'environment.yaml'), 'utf8');
  for (const [field, name] of Object.entries(SITE_VARIABLES)) {
    assert.ok(
      new RegExp(`^\\s*- name: ${name}$`, 'm').test(registry),
      `apps/site reads ${name} (as SiteConfig.${field}) but environment.yaml has no row for it -- the registry is generated, so declare it in the HUMAN table of scripts/check-environment-registry.ts and re-emit`,
    );
  }
});

test('a missing variable is refused by name, and the message carries no value', () => {
  for (const [field, name] of Object.entries(SITE_VARIABLES)) {
    if (field === 'clientId') continue; // optional by design: the policy constant is its default
    const env = { ...OK };
    delete env[name as keyof typeof env];
    assert.throws(
      () => resolveSiteConfig(env),
      (error: unknown) => {
        assert.ok(error instanceof SiteConfigError, `expected SiteConfigError, got ${String(error)}`);
        assert.match(error.message, new RegExp(name));
        return true;
      },
      `${name} unset must fail rather than build a site pointed at an invented origin`,
    );
  }
});

test('a relative or non-http scheme is refused, because a token must not be sent to `file:`', () => {
  for (const bad of ['api.platfolio.example', 'file:///tmp/api', 'ftp://api', '/api/v1', 'https:/api']) {
    assert.throws(
      () => resolveSiteConfig({ ...OK, [SITE_VARIABLES.apiUrl]: bad }),
      SiteConfigError,
      `"${bad}" must not become an SDK base URL`,
    );
  }
});

test('plain http is accepted on loopback and refused on a host it does not own', () => {
  const local = resolveSiteConfig({
    [SITE_VARIABLES.siteOrigin]: 'http://localhost:4321',
    [SITE_VARIABLES.apiUrl]: 'http://127.0.0.1:8080',
    [SITE_VARIABLES.issuer]: 'http://localhost:8081/realms/platfolio',
  });
  assert.equal(local.apiBaseUrl, 'http://127.0.0.1:8080');

  assert.throws(
    () => resolveSiteConfig({ ...OK, [SITE_VARIABLES.apiUrl]: 'http://api.somewhere-else.test' }),
    /plain http on a non-loopback host/,
    'there is no option that turns this check off, and that is the point',
  );
});

test('a trailing slash is dropped, so the SDK can never build //api/v1', () => {
  const config = resolveSiteConfig({ ...OK, [SITE_VARIABLES.apiUrl]: 'https://api.platfolio.example/' });
  assert.equal(config.apiBaseUrl, 'https://api.platfolio.example');
  // Joined the way `poll.ts` joins it, the URL has exactly one slash between host and path. (Comparing the whole
  // string for `//` would be nonsense: `https://` has one. The path is what must not start with a second.)
  const joined = new URL(`${config.apiBaseUrl}/api/v1/instances`);
  assert.equal(joined.pathname, '/api/v1/instances');
  assert.equal(joined.host, 'api.platfolio.example');
});

test('the client id defaults to the policy constant and is overridable only by the environment', () => {
  assert.equal(resolveSiteConfig(OK).clientId, 'platfolio-web');
  assert.equal(resolveSiteConfig({ ...OK, [SITE_VARIABLES.clientId]: 'platfolio-web-eu' }).clientId, 'platfolio-web-eu');
  // Blank is "unset", not "a client called empty string" -- a realm will refuse it and the operator deserves the
  // configuration error, not a 400 from the authorization endpoint.
  assert.equal(resolveSiteConfig({ ...OK, [SITE_VARIABLES.clientId]: '   ' }).clientId, 'platfolio-web');
});

test('the public config carries endpoints and nothing credential-shaped reaches a page (D4)', async () => {
  const { isTokenShapedName } = await import('../../../packages/ui/src/web/browser-auth-policy.ts');
  const config = resolveSiteConfig(OK);
  const publicConfig = publicConfigOf(config);
  for (const key of Object.keys(publicConfig)) {
    assert.ok(!isTokenShapedName(key), `SitePublicConfig.${key} is token-shaped: it must not travel into the island's props`);
  }
  assert.deepEqual(Object.keys(publicConfig).sort(), ['apiBaseUrl', 'clientId', 'issuerBaseUrl', 'scope', 'siteOrigin']);
});

test('the runtime overlay wins field by field, and an omitted field keeps the build value', () => {
  const baked = resolveSiteConfig(OK);
  const merged = endpointsForIsland(baked, { apiBaseUrl: 'https://staging-api.platfolio.example' });
  assert.equal(merged.apiBaseUrl, 'https://staging-api.platfolio.example');
  assert.equal(merged.issuerBaseUrl, baked.issuerBaseUrl, 'a half-written config.js must not silently un-configure the issuer');
  assert.equal(endpointsForIsland(baked, undefined), baked, 'no overlay means the baked values, unchanged and by identity');
});

test('the overlay reader refuses what the build refuses, because an overlay is an input and inputs are checked', () => {
  const overlay = (values: Record<string, unknown>): Record<string, unknown> => ({ [RUNTIME_CONFIG_GLOBAL]: values });
  assert.throws(() => runtimeConfigFrom(overlay({ apiBaseUrl: 'http://api.not-loopback.test' })), /plain http on a non-loopback host/);
  assert.throws(() => runtimeConfigFrom(overlay({ siteOrigin: 'not-a-url' })), SiteConfigError);
  assert.throws(() => runtimeConfigFrom(overlay({ issuerBaseUrl: 'file:///tmp/realm' })), /must be an http\(s\) URL/);
  assert.throws(() => runtimeConfigFrom(overlay({ clientId: 'https://x.test' })), /not a client name/);
  assert.equal(runtimeConfigFrom(overlay({ clientId: 'ok_client-1.2' }))?.clientId, 'ok_client-1.2');
});

test('the renderer writes the global the reader consumes, refuses an unset name by that name, and prints no hostname of its own', () => {
  const script = path.join(ROOT, 'scripts/site-env-print.ts');
  assert.ok(fs.existsSync(script), 'scripts/site-env-print.ts is the other half of the overlay contract: the container runs it to make dist/config.js');
  const text = fs.readFileSync(script, 'utf8');
  assert.ok(text.includes('SITE_VARIABLES'), 'the renderer reads the same constant map the app does -- one spelling of the four names (D58)');
  assert.ok(text.includes(RUNTIME_CONFIG_GLOBAL), 'the renderer prints the global the reader consumes');
  assert.ok(!/https?:\/\/[a-z0-9.-]+\.(railway\.app|platfolio\.dev)/i.test(text), 'the renderer prints what the environment holds, never a hostname remembered in source (D47)');

  const run = (env: Record<string, string | undefined>): { code: number; out: string; err: string } => {
    try {
      const out = execFileSync('npx', ['-y', 'tsx', script, '--json'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, stdio: 'pipe' });
      return { code: 0, out, err: '' };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, out: e.stdout ?? '', err: e.stderr ?? '' };
    }
  };

  const printed = run({ ...OK });
  assert.equal(printed.code, 0, printed.err);
  assert.deepEqual(JSON.parse(printed.out), {
    siteOrigin: OK[SITE_VARIABLES.siteOrigin],
    apiBaseUrl: OK[SITE_VARIABLES.apiUrl],
    issuerBaseUrl: OK[SITE_VARIABLES.issuer],
  }, 'the overlay carries the endpoints and nothing else; the client id was unset, so it stays the policy default');

  const missing = run({ ...OK, [SITE_VARIABLES.apiUrl]: '' });
  assert.equal(missing.code, 1, 'an unset required name must fail the renderer, not print a partial overlay');
  assert.match(missing.err, new RegExp(SITE_VARIABLES.apiUrl));
  assert.ok(!/https:\/\/api\./.test(missing.err), 'the failure names the variable, never echoes a value it did not accept');

  const badUrl = run({ ...OK, [SITE_VARIABLES.issuer]: 'not-a-url' });
  assert.equal(badUrl.code, 1, 'the renderer validates with the same predicate the browser uses; a value it would refuse must not reach config.js');
});

test('runtimeConfigFrom reads only the four endpoint keys, and returns undefined for an empty overlay', () => {
  assert.equal(runtimeConfigFrom({}), undefined);
  assert.equal(runtimeConfigFrom(undefined), undefined);
  assert.deepEqual(
    runtimeConfigFrom({ [RUNTIME_CONFIG_GLOBAL]: { apiBaseUrl: ' https://x.test ', clientId: '', scope: 'nope' } }),
    { apiBaseUrl: 'https://x.test' },
    'a blank value is not an override, and `scope` is not the overlay\'s to change (it comes from the policy)',
  );
});

test('the tracked overlay is prose only, so no endpoint is committed in the file a container overwrites', () => {
  const shipped = path.join(ROOT, 'apps/site/public/config.js');
  assert.ok(fs.existsSync(shipped), 'public/config.js is the file a container replaces at start; without it the reader has no contract to read against');
  const text = fs.readFileSync(shipped, 'utf8');
  // Strip the block comment and require nothing to remain. That is the invariant, and it is stricter than "no
  // assignment": the moment this tracked artifact grows a statement it is a second source of configuration, and
  // `check-project.ts`'s endpoint rule would only notice if the value happened to be a generated Railway
  // hostname. A committed *origin* is not generated, so this test — not that gate — is what refuses it here.
  assert.equal(text.replace(/\/\*[\s\S]*?\*\//g, '').trim(), '', 'apps/site/public/config.js must be comments only; values belong to the environment');
});
