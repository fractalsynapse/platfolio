import { Context } from 'cordis';

/**
 * The startup assertion Cordis does not give you.
 *
 * What was claimed about the reference tree (v4.0.0-rc.12) and what this repository measured:
 *
 * - Claim: a plugin whose injected service is missing stays `PENDING` forever, with no log line, and its
 *   `await` never settles -- so a mis-wired composition looks like a healthy process.
 * - Measured here (`packages/kernel`, Node 22, this exact vendored copy): reading the property on the root
 *   context returns **undefined** for a name nothing provides, and `ctx.inject(['ghost'], …)` **resolves**
 *   rather than hanging. The silent-hang story did not reproduce; the detectable symptom is absence.
 * - Not established: whether a provider stuck inside `[Service.init]` leaves a dependent unsatisfied. A first
 *   attempt to reproduce it crashed for an unrelated reason (`TypeError: Invalid effect` from a never-resolving
 *   disposer I wrote badly), so this guard neither claims nor relies on that behaviour.
 *
 * So this checks what is checkable: every required capability must be **present** on the context by the
 * deadline. Present is not the same as ACTIVE, and the gap is stated rather than glossed -- a service that
 * constructs but never finishes starting is a health-check problem, not a boot-graph problem, and pretending a
 * property lookup detects the difference would be exactly the kind of unearned confidence this project keeps
 * naming.
 */
export interface RequireServicesOptions {
  /** Bounded so a mis-wired composition reports instead of waiting forever. */
  timeoutMs?: number;
  /** Poll interval while waiting for later plugins to register. */
  intervalMs?: number;
}

export async function requireServices(ctx: Context, names: readonly string[], options: RequireServicesOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 20;
  const view = ctx as unknown as Record<string, unknown>;
  const deadline = Date.now() + timeoutMs;

  let missing = names.filter((name) => view[name] === undefined);
  while (missing.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    missing = missing.filter((name) => view[name] === undefined);
  }

  if (missing.length > 0) {
    // The message is the feature: readable without framework source, and ordered by likely cause.
    throw new Error(
      `startup: required capability ${missing.map((m) => `"${m}"`).join(', ')} is not present on the context after ${String(timeoutMs)}ms.\n`
      + '  Cordis gives no diagnostic for this -- the property is simply undefined.\n'
      + '  Check, in order: (1) is the providing plugin registered at all? (2) does its `static provide` match\n'
      + '  the name asked here? (3) did that plugin throw during setup (see the error logged above, if any)?\n'
      + `  Provided names present now: ${Object.keys(view).filter((k) => !k.startsWith('_')).slice(0, 12).join(', ') || '(none visible)'}.`,
    );
  }
}
