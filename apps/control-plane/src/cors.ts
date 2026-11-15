import { canonicalOrigin, WILDCARD_REFUSAL } from '@platfolio/kernel';
import { redactCredentialShaped } from '@platfolio/contracts';

/**
 * The `PLATFOLIO_ALLOWED_ORIGINS` contract, in one place.
 *
 * Format: a comma-separated list of origins, each one `scheme://host[:port]` and nothing more.
 *
 *   PLATFOLIO_ALLOWED_ORIGINS=https://app.platfolio.dev,https://staging.platfolio.dev
 *
 * Default: **unset, which enables no cross-origin request at all.** The control plane answers same-origin traffic
 * exactly as it did before this variable existed, and a browser on any other origin is refused. A deployment that
 * wants a UI on another host has to say so, naming the origins, and that choice then appears in the composition,
 * the environment registry and the boot log. The default is not `*` and not "everything": an API that takes
 * `Authorization: Bearer` handed wildcard CORS would let any page read any record its visitor can name.
 *
 * Failure mode: a list that is not shaped like a list of origins makes the control plane **refuse to start**. The
 * alternative -- drop the bad entry, keep the good ones -- leaves a deployment answering a UI nobody authorized
 * while its operator believes the list they typed is the list that is live. Loudness at boot is cheap; a silently
 * narrowed (or silently widened) origin policy is not. The message names the variable, the position, the offending
 * entry, and what was expected.
 *
 * The origin grammar itself is the kernel's (`canonicalOrigin`), not a second regex here: one spelling of
 * "scheme://host[:port]", used by both the check that refuses this variable and the check that runs per request.
 */
export const ALLOWED_ORIGINS_ENV = 'PLATFOLIO_ALLOWED_ORIGINS';

export interface CorsBootConfig {
  /** Canonical `scheme://host[:port]` strings. Empty means cross-origin use is not enabled. */
  readonly allowedOrigins: readonly string[];
}

/** Refused during configuration, so nothing is listening yet when an operator reads this. */
export class CorsOriginsRefused extends Error {
  constructor(message: string) {
    super(`${ALLOWED_ORIGINS_ENV}: ${message}`);
    this.name = 'CorsOriginsRefused';
  }
}

/**
 * Parse and validate. An unset or wholly-blank value is the empty list -- absent is a real configuration state,
 * and it is what a Compose file writing `${PLATFOLIO_ALLOWED_ORIGINS:-}` means. Everything else is held to the
 * shape: a blank entry, a wildcard, and anything that is not exactly one origin are each refused, with the entry
 * quoted bounded and credential-redacted. That last part is not paranoia: `https://user:pass@host` parses as a
 * URL, is refused as an origin, and would otherwise arrive in a provider's log stream as written -- which is
 * platfolio putting a credential in a log in the component that promises not to (D4).
 */
export function parseAllowedOrigins(raw: string | undefined | null): readonly string[] {
  const value = (raw ?? '').trim();
  if (value === '') return [];
  const entries = value.split(',');
  const accepted: string[] = [];
  entries.forEach((entry, index) => {
    const text = entry.trim();
    const position = `entry ${String(index + 1)} of ${String(entries.length)}`;
    if (text === '') throw new CorsOriginsRefused(`${position} is empty -- a stray or trailing comma is not an origin`);
    if (text === '*') throw new CorsOriginsRefused(`${position} is "*" -- ${WILDCARD_REFUSAL}`);
    const canonical = canonicalOrigin(text);
    if (canonical === undefined) {
      throw new CorsOriginsRefused(`${position} "${redactCredentialShaped(text).slice(0, 80)}" is not an origin -- expected scheme://host[:port] with no path, query, fragment or credentials`);
    }
    // Deduplicated, because `https://a.dev,https://a.dev/` is one origin typed twice, and a policy that counts it
    // twice misreports in the boot log what is actually configured.
    if (!accepted.includes(canonical)) accepted.push(canonical);
  });
  return accepted;
}

/**
 * What this variable says, in the line boot prints. Count and shape only. Never a wildcard-suppressing default:
 * there is no code path here that turns a bad value into a permissive one, and the sentence for the empty case
 * says so in terms a operator can act on -- it does not read like a failure, because same-origin-only is a
 * legitimate choice, and a log line that cries wolf at the safe default is one that gets ignored.
 */
export function describeAllowedOriginsConfig(origins: readonly string[]): string {
  if (origins.length === 0) {
    return `${ALLOWED_ORIGINS_ENV} is unset or empty -- cross-origin requests are not enabled. Same-origin traffic is unaffected; a browser on another origin will be refused. Name the UI's origin(s) to change that.`;
  }
  const listed = origins.slice(0, 5);
  return `${ALLOWED_ORIGINS_ENV}: ${String(origins.length)} origin(s) accepted [${listed.join(', ')}${origins.length > listed.length ? ` (+${String(origins.length - listed.length)} more)` : ''}]`;
}
