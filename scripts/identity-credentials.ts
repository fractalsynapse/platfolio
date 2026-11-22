/**
 * The one rule about identity credentials a script may use: a loopback default must never be sent to a host
 * that is not local.
 *
 * Why this exists as its own module, and not as three `if` statements. `seed-identity.ts`, `smoke-identity.ts`
 * and `smoke-browser-auth.ts` each default their admin/client/user credential to `platfolio-dev-only` — the
 * local stack's value, which is correct for a container on loopback and the reason those scripts are usable
 * without a flag. Run one against the hosted issuer without exporting the real value, and it silently
 * authenticates with the development credential. Keycloak answers `400 invalid_grant / Invalid user
 * credentials`, and because that is the same answer a genuinely lost admin account gives, a maintainer reads
 * the symptom as infrastructure and files it as one (#248: "Production's master-realm admin currently answers
 * 400 invalid_grant — the credential we hold does not match"). It did not hold that shape. The credential we
 * hold was fine; the script never used it, and three copies of the same default meant three places to be
 * wrong in the same way.
 *
 * So the check is here, in one function, and each script's own `--allow-remote` strength gate (which asks how
 * LONG a secret is) is not enough: a dev value is long enough to be weak and short enough to be wrong. This
 * asks a different question — *is this the local stack's placeholder arriving at a non-local host* — and the
 * answer is a refusal naming the variable to export and the file that holds the real one.
 *
 * D4 applies to the refusal itself: it prints the variable NAME and the file path, never a value, never a
 * length-derived guess about what the value is.
 */

/** The development credential the local stack boots with. Not a secret: it is public in this repository. */
export const LOOPBACK_CREDENTIAL = 'platfolio-dev-only';

/** True for a URL that points at this machine — the only place a development default is a correct answer. */
export function isLoopback(url: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/.test(url.trim());
}

export interface CredentialQuestion {
  /** What is being resolved, in the operator's words: "the master-realm admin password". */
  label: string;
  /** The environment variable that supplies it: `KC_ADMIN_PASSWORD`. */
  variable: string;
  /** The flag that would supply it: `--admin-password`. */
  flag?: string;
  /** The value the script would have used if nobody exported anything. */
  fallback: string;
  /** The value actually resolved from flag / environment / fallback, in that order. */
  value: string;
  /** The base URL it is about to be sent to. Decides whether a default is legitimate or a bug. */
  base: string;
  /** Where a maintainer running this against platfolio's own stack finds the real value. */
  source: string;
}

export type CredentialAnswer =
  | { ok: true; value: string; remote: boolean }
  | { ok: false; code: 'placeholder-on-remote' | 'missing'; message: string };

/**
 * Decide whether a resolved credential may be sent to `base`.
 *
 * Returns an answer rather than throwing or exiting, so the rule is testable and each caller keeps its own
 * output shape. A pure function over strings: no file is read here, no network is touched, and nothing about
 * the VALUE is reported — only which NAME was unset.
 */
export function resolveCredential(q: CredentialQuestion): CredentialAnswer {
  const remote = !isLoopback(q.base);
  // Loopback: the default is not just allowed, it is the point — the local stack boots with it and nobody
  // should have to export anything to run a smoke against their own container.
  if (!remote) return { ok: true, value: q.value, remote: false };
  if (q.value.length === 0) {
    return {
      ok: false,
      code: 'missing',
      message: `${q.label} is empty. Export ${q.variable}${q.flag ? ` or pass ${q.flag}` : ''} before running against ${q.base} — the value is in ${q.source} (read it, do not print it).`,
    };
  }
  // The load-bearing comparison. `===` against the known default, not a pattern over "looks weak": a real
  // credential that happens to contain "dev" must not be refused, and a dev placeholder that a future
  // refactor renames must not slip through because the test was a regex about vibes rather than about this
  // file's own constant.
  if (q.value === LOOPBACK_CREDENTIAL || q.value === q.fallback) {
    return {
      ok: false,
      code: 'placeholder-on-remote',
      message: `${q.label} is the ${q.value === q.fallback ? `script's own default` : `local stack's development`} value, and this run targets ${q.base}, which is not loopback. Refusing to authenticate a hosted issuer with a development placeholder: Keycloak answers 400 invalid_grant for that, and the answer looks exactly like a lost admin account, which is how a tooling mistake gets filed as an infrastructure outage (#248). Export ${q.variable}${q.flag ? ` (or pass ${q.flag})` : ''} with the real value — it lives in ${q.source}. Values are never printed.`,
    };
  }
  return { ok: true, value: q.value, remote: true };
}

/**
 * Read one `KEY=VALUE` line out of a `.secrets`-style file without ever returning the whole file.
 *
 * Exists because "the refusal names the file to read" is only useful if the script can then read it. It does
 * not log, does not echo, and returns undefined for a missing file so the caller's refusal still fires with
 * the same message rather than crashing on an ENOENT.
 */
export function readSecretFileValue(filePath: string, key: string): string | undefined {
  let text: string;
  try {
    // Imported lazily in the sense that it is only touched when a file is actually being read; a pure rule
    // module that could not be used without the filesystem would be harder to test, so this is the one place
    // the module reaches out, and callers that pass an explicit value never come here.
    const fs = require('node:fs') as typeof import('node:fs');
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    const value = line.slice(eq + 1).trim();
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}
