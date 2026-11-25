/**
 * The browser-authentication contract, in code.
 *
 * One definition, three consumers:
 *
 *  - `scripts/seed-identity.ts` writes the client shape from `browserClientShape()` / `browserClientMappers()`,
 *    so what the realm holds and what this file claims cannot drift apart;
 *  - `scripts/smoke-browser-auth.ts` drives the flow with `createPkcePair()` and reads the policy below;
 *  - `packages/contracts/test/browser-auth.test.ts` asserts the invariants inside `pnpm run test`, with no
 *    network and no Keycloak, so a shape regression fails a gate rather than a demo.
 *
 * Why it lives in `scripts/` and not `packages/contracts/src/`: that directory IS the published public surface
 * (`scripts/check-contracts.ts` baselines every declaration in it), and an operator script's notion of a realm
 * client is not a capability seam. Nothing a deployed service imports may depend on this file -- and the test
 * says so in the direction that matters, by refusing any token-shaped key in the API's own audit vocabulary.
 */
import { createHash, randomBytes } from 'node:crypto';

/**
 * The browser's half of this contract now lives in `packages/ui/src/web/browser-auth-policy.ts`, and this file
 * imports and re-exports it rather than holding a second copy of the same policy.
 *
 * The reason is a dependency direction, not a preference. That file's header tells it: the first `astro build` of
 * a platfolio UI tried to bundle this script, and a client bundle that reaches an operator script reaches
 * `node:crypto` — which this file's own opening paragraph forbids ("nothing a deployed service imports may depend
 * on this file"). Moving the declarations the browser must obey into the package, and leaving the realm-writing
 * shapes here, satisfies the sentence in both directions: a deployed UI depends on a package, a script depends on
 * a package, and nothing deployed depends on `scripts/`.
 *
 * The re-export is the point, not a courtesy: `packages/seed-identity.ts`, `scripts/smoke-browser-auth.ts` and
 * `packages/contracts/test/browser-auth.test.ts` keep reading these names from here, so a split that moved a fact
 * without moving a caller's address cannot quietly leave two spellings behind.
 */
import {
  API_CLIENT_ID, CALLBACK_PATH, HANDOFF_KEYS, HANDOFF_STORAGE, LOGIN_SCOPES, LOGOUT_CLEAR, PKCE_METHOD, RECOMMENDED_STORE,
  REQUIRED_SCOPE, TOKEN_STORAGE, WEB_CLIENT_ID, endSessionUrl, isPkceVerifier, isTokenShapedName, refreshAt,
  refreshSkewSeconds, type HandoffField, type PkcePair, type StorageLocation, type TokenKind,
} from '../packages/ui/src/web/browser-auth-policy.ts';

export {
  API_CLIENT_ID, CALLBACK_PATH, HANDOFF_KEYS, HANDOFF_STORAGE, LOGIN_SCOPES, LOGOUT_CLEAR, PKCE_METHOD, RECOMMENDED_STORE,
  REQUIRED_SCOPE, TOKEN_STORAGE, WEB_CLIENT_ID, endSessionUrl, isPkceVerifier, isTokenShapedName, refreshAt,
  refreshSkewSeconds, type HandoffField, type PkcePair, type StorageLocation, type TokenKind,
};
import { parse as parseYaml } from 'yaml';


import { normalizeUiOrigins } from './keycloak-browser-client.ts';
export { PKCE_CHALLENGE_ATTRIBUTE, browserClientMappers, browserClientShape, normalizeUiOrigins,
  type BrowserClientShape, type ProtocolMapperShape } from './keycloak-browser-client.ts';

/* ------------------------------------------------------------------ which realm, which UI */

/** The variable a platform description uses to say which realm its service authenticates against. */
export const ISSUER_VARIABLE = 'PLATFOLIO_IDENTITY_ISSUER';
/**
 * The variable that names the browser origins a deployment's UI is served from -- ONE name for two consumers:
 * the control plane's CORS allow-list, and the redirect URIs and `webOrigins` this script writes into a realm.
 *
 * It is not called `PLATFOLIO_UI_ORIGIN`. That name used to exist beside this one, holding the same list for
 * the second consumer, and the pair was one fact in two spellings: a UI could be admitted cross-origin while
 * the realm refused to redirect to it, or the reverse, and every gate stayed green because each file was
 * internally consistent. The API side keeps the name because it is the side that refuses to boot on a bad
 * value, and the seed reads what the deployment says rather than what an operator remembers to type.
 */
export const UI_ORIGIN_VARIABLE = 'PLATFOLIO_ALLOWED_ORIGINS';

/**
 * The development UI origin: the Vite dev server on loopback, which is what `compose.dev.yaml` declares as this
 * platform's `PLATFOLIO_ALLOWED_ORIGINS` locally, and what a seed or smoke run against a loopback issuer falls
 * back to when nobody names one. One spelling of a string that is otherwise written in a YAML file and two
 * scripts; the contract test checks the file against it, because a dev origin that drifts from the realm's
 * redirect URI produces a local login that fails in the one place nobody monitors.
 */
export const LOOPBACK_UI_ORIGIN = 'http://localhost:5173';

/**
 * One spelling of a service's environment as a platform DESCRIPTION declares it: the base `environment:` map,
 * and each `environmentValues.<env>` map that replaces entries in it (D56). `environment` is the empty string
 * for the base map, because the base is not an environment -- it is what an environment inherits.
 */
export interface DeclaredEnvironment {
  environment: string;
  /** Where a human would go to change it: `services.api environment`, `…environmentValues.staging`. */
  declaredIn: string;
  vars: Readonly<Record<string, string>>;
}

/** The realm an issuer URL addresses, read out of its path; undefined when it addresses none. */
export function realmOfIssuer(issuer: string | undefined): string | undefined {
  if (!issuer) return undefined;
  let pathname: string;
  try { pathname = new URL(issuer).pathname; } catch { return undefined; }
  return /\/realms\/([^/?#]+)/.exec(pathname)?.[1];
}

/**
 * The environment maps a platform description declares, read from its Compose text: each service's base
 * `environment:`, and each `x-platfolio.environmentValues.<env>` composed over it the way `buildPlan` composes
 * them (D56).
 *
 * Two keys of one file, deliberately, and not a second renderer: `platform-deploy.ts` drives
 * `parseCompose` -> `validateManifest` -> `buildPlan`, which needs the generated prod overlay for an image
 * digest and has nothing to do with where a UI is served from. What lives here exists so the seed that writes a
 * realm and the test that checks the realm agree on one reader of the same two lines.
 */
export function declaredEnvironmentsFrom(composeText: string): DeclaredEnvironment[] {
  let doc: unknown;
  try {
    doc = parseYaml(composeText, { uniqueKeys: true });
  } catch (error) {
    throw new Error(`the platform description does not parse: ${(error as Error).message}`);
  }
  const services = asRecord(asRecord(doc)?.services);
  const out: DeclaredEnvironment[] = [];
  for (const [name, raw] of Object.entries(services)) {
    const svc = asRecord(raw);
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(svc?.environment))) vars[key] = String(value ?? '');
    out.push({ environment: '', declaredIn: `services.${name} environment`, vars });
    for (const [envName, rawOverrides] of Object.entries(asRecord(asRecord(svc?.['x-platfolio'])?.environmentValues))) {
      const composed: Record<string, string> = { ...vars };
      for (const [key, value] of Object.entries(asRecord(rawOverrides))) composed[key] = String(value ?? '');
      out.push({ environment: envName, declaredIn: `services.${name} x-platfolio.environmentValues.${envName}`, vars: composed });
    }
  }
  return out;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/**
 * The browser origins the platform description declares for the environment that authenticates against
 * `realm`, or undefined when the description says nothing usable about it.
 *
 * This exists so `identity:seed` can seed a hosted realm without carrying its own list of hostnames. The
 * composition is where per-environment values live (D56) and where the deploy reads them from; a hostname table
 * inside a script would be a second answer to "where is staging's UI", and those two answers drifting is
 * precisely the failure that lets a staging code land on the production page. The seed is the consumer that can
 * afford to look the value up, because what it writes must agree with what the API admits at boot -- which is
 * the same string, read from the same file.
 *
 * Refuses rather than picks when the description says two different things about one realm. Which one wins is
 * otherwise a detail of map order, and a seed that guesses has written a redirect URI nobody chose.
 */
export function declaredUiOrigins(
  environments: readonly DeclaredEnvironment[],
  realm: string,
): { environment: string; declaredIn: string; origins: string[] } | undefined {
  const matches = environments.filter((e) => realmOfIssuer(e.vars[ISSUER_VARIABLE]) === realm);
  if (matches.length === 0) return undefined;
  const spellings = new Set(matches.map((m) => (m.vars[UI_ORIGIN_VARIABLE] ?? '').trim()).filter((s) => s.length > 0));
  if (spellings.size > 1) {
    throw new Error(`the platform description declares different ${UI_ORIGIN_VARIABLE} values for realm "${realm}" (${matches.map((m) => `${m.declaredIn}="${m.vars[UI_ORIGIN_VARIABLE] ?? ''}"`).join(', ')}) -- one realm, one UI origin list: fix the description rather than letting a seed choose between them`);
  }
  const hit = matches.find((m) => ((m.vars[UI_ORIGIN_VARIABLE] ?? '').trim().length > 0));
  // Absent is a real state of the composition, and inventing a value for it is not this function's job: the
  // caller refuses, because a hosted realm with no declared UI origin is a gap in the description.
  if (hit === undefined) return undefined;
  return { environment: hit.environment, declaredIn: hit.declaredIn, origins: normalizeUiOrigins([hit.vars[UI_ORIGIN_VARIABLE] ?? '']) };
}

/* ------------------------------------------------------------------ PKCE primitives */

/**
 * RFC 7636 §4.1: a verifier is 43..128 characters of the unreserved set. 48 random bytes base64url is 64
 * characters -- inside the window, with 384 bits behind it, and no padding characters.
 */
export function createPkcePair(rand: (n: number) => Uint8Array = randomBytes): PkcePair {
  const verifier = Buffer.from(rand(48)).toString('base64url');
  return { verifier, challenge: codeChallenge(verifier), method: PKCE_METHOD };
}

/** The S256 transformation, exactly as §4.2 defines it: BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(Buffer.from(verifier, 'ascii')).digest('base64url');
}


/**
 * The audit detail keys the control plane writes today, and the only ones it may write without this test
 * failing. The list is deliberately explicit: an audit row is the one place a well-meaning handler could put
 * "the token that made this call", and D4 says platfolio holds no credential -- not for the moment, not
 * temporarily, not redacted.
 */
export const AUDIT_DETAIL_KEYS_ALLOWLIST = [
  // Provider ID, explicit keep/wipe choice, and verification flag for hosted operations.
  'provider', 'storagePolicy', 'verified',
  'template', 'teamId', 'from', 'state', 'planHash', 'repo', 'commit', 'files', 'service', 'image', 'digest',
  'dispatchId', 'action', 'environment', 'ref', 'workflow', 'result', 'resources', 'to', 'environmentState',
  'capability', 'toTeamId', 'providerInstanceId', 'email', 'role', 'sent', 'personId', 'reason', 'name',
  // A normalized public hostname. The DNS verification value stays out of the audit row.
  'hostname',
] as const;
