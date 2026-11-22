import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Falsification tests mutate tracked source files in place — that is how a gate is proven to bite — and this
 * module makes doing so safe under the two things that actually break it: another process, and a dead one.
 *
 * Both hazards were measured on this tree, not imagined:
 *
 * 1. `node --test` runs test *files* in parallel processes. `gates-falsify.test.ts` appends a violation to
 *    `packages/ui/src/contract.ts` for ~12 s at a time; `typecheck-coverage.test.ts` plants a type error and
 *    runs `tsc`. Whichever one asserts "the clean tree is green, therefore every failure below is attributable
 *    to my mutation" reads the *other* one's violation and goes red — correctly, and uselessly.
 * 2. A killed run leaves the planted bytes behind. Measured on this tree: while a suite is blocked inside
 *    `execFileSync` — which is the whole of a critical section here — a `SIGTERM` is queued and its handler does
 *    NOT run until the blocking call returns, and `SIGKILL` (what `timeout -k`, a CI step deadline and an
 *    escalating runner deliver) is never handled by anything in the process. So teardown is best effort, and the
 *    guarantee is the record written *before* the mutation: the sidecar under `.tmp/`, replayed by the next
 *    process that loads this module. Damage then lasts microseconds instead of until the next person commits it.
 *
 * ## The three properties, and what each one is allowed to do
 *
 * **Lock.** `exclusive()` serialises critical sections across processes with a ticket queue
 * (`.tmp/mutation-sandbox/<root>/want/<time>-<pid>-<seq>`) and an atomic `mkdir` lock. A waiter never proceeds
 * past a lock it cannot account for: it either reclaims a lock whose holder is *provably* gone, or fails with a
 * named reason carrying the holder's pid, label and age. There is no `--no-lock` and no fallthrough, because a
 * lock that quietly skips serialisation looks like a fix and is not one.
 *
 * **Liveness, and which way it guesses wrong.** A holder is reclaimable only on positive evidence it is gone:
 * `ESRCH` from `kill(pid, 0)`, or a `Z` state in `/proc/<pid>/stat` where procfs exists (a zombie is a dead
 * process its parent has not reaped, and treating it as alive would make every kill test hang for the full
 * timeout). A recycled pid, an `EPERM` pid or a lock written by another host reads as *alive*, so the worst
 * this rule can do is wait and then fail loudly. Guessing "alive" costs a named timeout; guessing "dead" would
 * cost the other suite's run, so the ambiguity goes that way.
 *
 * **Sidecar.** Every mutation writes `{meta.json, original, planted}` into a fresh directory and `rename`s it
 * into place before the target file is touched, so a sidecar is always complete or absent — never half.
 * Restoration compares current bytes against both records: equal to `original` (nothing to undo), equal to
 * `planted` (our own mutation, put it back), or neither (a third party edited a file we poisoned, so writing
 * back would destroy *their* work) — which is a named conflict, not a silent choice either way.
 *
 * ## What this does NOT fix, and what is holding the line instead
 *
 * The lock serialises processes that *mutate*. It cannot protect a process that merely *imports* something the
 * mutators change, and the reason is structural rather than a missing detail: ESM evaluates a test file's entire
 * static import graph before any of its code runs, so there is no point at which a reader can decide to wait — by
 * then `../src/layout/primitives.ts` has already been evaluated from whatever bytes the file held, possibly another
 * process's mutation. Measured with the overlap forced (poll the target until the planted bytes appear, then start
 * the reader): `layout.test.ts` failed three assertions, including `stack declares "size"`, while this package's
 * own falsification suite sat inside its container-type weakening — a red run in a suite that touches no file.
 *
 * `importQuietly()` is the remedy where the mutated subject is a **leaf**: `components.test.ts` reads the
 * invalid-prop-set fixture that way, because nothing else in its graph imports that file, so waiting for the tree
 * and then evaluating it fresh genuinely sees the quiet bytes. It cannot generalise to `packages/ui/src/**`: a
 * cache-busted specifier re-evaluates the *entry* module only, and that module's own imports still resolve to the
 * already-cached, possibly mutated instances. A consistent quiet read of the source tree would need the whole
 * graph loaded under the lock, which test code cannot arrange.
 *
 * So that gap is currently closed by `--test-concurrency=1` in the root `package.json` `test` script, and that flag
 * is **load-bearing for correctness, not performance tuning**: removing it before
 * [#263](https://github.com/fractalsynapse/platfolio/issues/263) lands trades a serial suite for one that can pass
 * while measuring somebody else's mutation. #263 asks for the structural fix — falsification against a copy of the
 * audited subtree in `.tmp/`, so the shared tree is never the thing being mutated — and records what
 * `scripts/check-ui.ts` would have to change to make it possible. This module stays essential either way: it is what
 * closes the *interruption* hazard, which #263 does not address, and it is what any suite that edits the tree in
 * place should use.
 *
 * ## Boundaries this module will not cross
 *
 * It restores bytes it captured and nothing else: no `git checkout`, `restore`, `stash`, `clean` or `reset`,
 * because this working tree carries other people's uncommitted work and those commands take it. State lives
 * under `<root>/.tmp/`, which is gitignored and which `scripts/check-project.ts` excludes by name, so a
 * sidecar can never become a tracked file or an unchecked one.
 *
 * Proved by test in `packages/ui/test/mutation-sandbox.test.ts` — including the `SIGKILL` path, which is
 * exercised by actually killing a child mid-mutation rather than asserted in prose.
 */

/** Every way this module refuses to continue. A reason is a name a failing run can be searched for. */
export type SandboxFailureReason =
  | 'MUTATION_LOCK_NOT_HELD'
  | 'MUTATION_LOCK_TIMEOUT'
  | 'MUTATION_SANDBOX_CONFIG'
  | 'MUTATION_SIDECAR_CONFLICT'
  | 'MUTATION_SIDECAR_ESCAPE'
  | 'MUTATION_TARGET_MISSING'
  | 'MUTATION_TARGET_UNCHANGED';

export class MutationSandboxError extends Error {
  readonly reason: SandboxFailureReason;

  constructor(reason: SandboxFailureReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'MutationSandboxError';
    this.reason = reason;
  }
}

export interface MutationSandboxOptions {
  /** Repository root whose working tree is mutated. A lock is keyed to its realpath, not its name. */
  readonly root: string;
  /**
   * How long a waiter holds out before `MUTATION_LOCK_TIMEOUT`. Default 180 s, or
   * `MUTATION_SANDBOX_WAIT_MS` when set and no option is given — which shortens the wait, never the refusal.
   */
  readonly waitMs?: number;
  /** Poll interval while waiting. Default 50 ms. */
  readonly pollMs?: number;
  /** Age past which a lock with no readable owner record is treated as abandoned. Default 60 s. */
  readonly unattributableAfterMs?: number;
  /** Age past which an holder we cannot disprove is treated as abandoned. Default 15 min. */
  readonly expiredAfterMs?: number;
  /** Where reports go. Default stderr, so a reclaim is visible in the test output and not only in `events`. */
  readonly log?: (line: string) => void;
}

export interface MutationSandbox {
  readonly root: string;
  readonly dir: string;
  /** Reclaim and recovery reports, oldest first. A test asserts on this instead of trusting a log line. */
  readonly events: readonly string[];
  /** True while this process holds the tree lock. */
  readonly locked: boolean;
  /**
   * Run `fn` with the working tree to this process alone, after recovering any sidecar left by a run that died.
   * Fails with `MUTATION_LOCK_TIMEOUT` rather than running `fn` on a tree someone else is mutating.
   */
  exclusive<T>(label: string, fn: () => T): T;
  /**
   * The await-capable form of `exclusive()`, for a body that must read the tree rather than change it.
   * Restores nothing, because it stages nothing; it holds the same lock for the same window.
   */
  exclusiveAsync<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Evaluate `target` (a module URL or path inside this root) *after* the tree is provably quiet, in a fresh
   * module instance so the bytes read are the current ones and not a cache entry another process poisoned.
   */
  importQuietly<T>(label: string, target: string): Promise<T>;
  /** Append `text` to `rel`. Returns the bytes captured *before* the mutation. */
  append(rel: string, text: string): Buffer;
  /** Replace the first occurrence of `find` in `rel`. Returns the pre-mutation bytes. */
  replaceOnce(rel: string, find: string, replace: string): Buffer;
  /** Write `contents` to `rel`, capturing whatever was there first (absent = deleted on restore). */
  write(rel: string, contents: string): Buffer | null;
  /** Put every still-staged file back, byte for byte. Idempotent; safe to call in a `finally`. */
  restore(): void;
  /** `rel` paths this process has staged and not yet restored. */
  pending(): readonly string[];
  /** Fail with a named reason if this process staged anything it did not restore. */
  assertNothingPending(): void;
}

interface SidecarMeta {
  readonly rel: string;
  readonly pid: number;
  readonly host: string;
  /** `/proc/<pid>/stat` field 22 of the writer, so a recycled pid cannot masquerade as a live holder. */
  readonly pidStart: number | null;
  /** The writing process's run id, which -- unlike its pid -- is never reused. */
  readonly runId?: string;
  readonly stagedAt: number;
  readonly existedBefore: boolean;
  readonly originalMtimeMs: number;
  readonly originalHash: string;
  readonly plantedHash: string;
}

const DEFAULT_WAIT_MS = 180_000;
const DEFAULT_POLL_MS = 50;
const DEFAULT_UNATTRIBUTABLE_MS = 60_000;
/**
 * Age past which a lock or ticket whose holder cannot be *disproved* is treated as abandoned.
 *
 * This is the fallback for the case procfs identity cannot settle: an artefact written before start times were
 * recorded, or a holder on a host we cannot probe. It is deliberately far above the longest critical section
 * measured on this tree (~30 s of `tsc`, ~12 s of `ui:check`), and it is deliberately not quiet: the reclaim is
 * reported with the holder's pid, label and age. A bounded wait that simply expires leaves the suite hanging
 * behind a phantom, which is what this exists to prevent.
 */
const DEFAULT_EXPIRED_MS = 15 * 60_000;

const shortHash = (bytes: Buffer | null): string =>
  bytes === null ? 'absent' : crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);

const digestOf = (rel: string): string => crypto.createHash('sha256').update(rel).digest('hex').slice(0, 16);

/** Field 22 of /proc/<pid>/stat: process start time in clock ticks. Identity, when a pid is not. */
function processStartTime(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(' ');
    const start = Number(fields[19]);
    return Number.isFinite(start) ? start : null;
  } catch {
    return null;
  }
}

const SELF_START = processStartTime(process.pid);

/**
 * This process's identity, independent of its pid.
 *
 * The container this suite runs in reuses low pids within minutes -- measured directly, where a lock recorded by
 * a dead run at pid 40 was later read back as "pid 40 is running (state R)" because the *new* suite process had
 * been given pid 40. A pid can therefore neither prove a holder alive nor prove a sidecar belongs to it. The run
 * id can: a staged record and the lock are written by the same process, so any lock that is not *this* run's is
 * evidence the writer is gone, whatever its pid says now.
 */
const RUN_ID = crypto.randomUUID();

/**
 * Is the process that wrote this record still the process that is running?
 *
 * `pid` alone is not enough, and a container proved it: a killed suite's pid was taken by an unrelated process
 * within minutes, and every later section then waited politely behind a holder that no longer existed. So a
 * recorded start time that disagrees with the live one is *positive* evidence the holder is gone, whatever is
 * sitting on the pid now. With no recorded start to compare (an artefact from before that rule, or a host with
 * no procfs) the answer degrades to 'alive', which can only cost a wait -- never a corrupted run.
 *
 * `evidence` is what goes in the report line, because "the lock was stale" is not a sentence a reader can act on.
 */
function liveness(pid: number, host: string, recordedStart: number | null | undefined): { state: 'alive' | 'dead' | 'unknown'; evidence: string } {
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'unknown', evidence: 'the record names no usable pid' };
  if (host !== os.hostname()) return { state: 'unknown', evidence: `written on host ${host}, which this host cannot probe` };
  let procState: string | null = null;
  let procStart: number | null = null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(' ');
    procState = fields[0] ?? null;
    procStart = Number(fields[19]);
    if (!Number.isFinite(procStart)) procStart = null;
  } catch {
    /* procfs absent (macOS) or the pid is gone: fall through to the signal probe. */
  }
  if (procState === 'Z') return { state: 'dead', evidence: `pid ${pid} is a zombie: its parent has not reaped it` };
  if (procStart !== null && recordedStart !== undefined && recordedStart !== null && procStart !== recordedStart) {
    return { state: 'dead', evidence: `pid ${pid} now belongs to a process started ${Math.abs(procStart - recordedStart)} ticks later -- the holder's pid was recycled` };
  }
  if (procState !== null) return { state: 'alive', evidence: `pid ${pid} is running (state ${procState})` };
  try {
    process.kill(pid, 0);
    return { state: 'alive', evidence: `pid ${pid} answers a signal probe` };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ESRCH') return { state: 'dead', evidence: `pid ${pid} does not exist` };
    if (code === 'EPERM') return { state: 'alive', evidence: `pid ${pid} exists but belongs to another user` };
    return { state: 'unknown', evidence: `pid ${pid} could not be probed (${String(code)})` };
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ageOf = (startedAt: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};

/** Sandboxes in this process, for teardown. One `exit` handler for all of them, installed once. */
const live: Sandbox[] = [];
let teardownInstalled = false;
/** Distinguishes quiet imports from each other, so a file read twice under two locks is read twice for real. */
let quietImports = 0;

class Sandbox implements MutationSandbox {
  readonly root: string;
  readonly dir: string;
  readonly events: string[] = [];
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly unattributableAfterMs: number;
  private readonly expiredAfterMs: number;
  private readonly log: (line: string) => void;
  /** rel -> staged record, in the order they were staged. Cleared as each is restored. */
  private readonly staged = new Map<string, { dir: string; original: Buffer | null }>();
  private lockDir: string | null = null;
  private ticketDir: string | null = null;
  private ticketSeq = 0;
  /** Why the last record `orphaned()` accepted was treated as abandoned; carried to the report line. */
  private pendingOrphanEvidence = '';
  private releasedByTeardown = false;

  constructor(options: MutationSandboxOptions) {
    const root = fs.realpathSync(path.resolve(options.root));
    // `MUTATION_SANDBOX_WAIT_MS` shortens the WAIT, which is how the bound gets measured instead of trusted. It
    // is not a switch for the lock: no value reaches the "proceed anyway" branch, because there isn't one.
    const waitFromEnv = process.env.MUTATION_SANDBOX_WAIT_MS;
    const envWait = waitFromEnv === undefined ? null : Number(waitFromEnv);
    if (envWait !== null && (!Number.isFinite(envWait) || envWait < 0)) {
      throw new MutationSandboxError('MUTATION_SANDBOX_CONFIG', `MUTATION_SANDBOX_WAIT_MS=${waitFromEnv} is not a non-negative number of milliseconds`);
    }
    const waitMs = options.waitMs ?? envWait ?? DEFAULT_WAIT_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const unattributableAfterMs = options.unattributableAfterMs ?? DEFAULT_UNATTRIBUTABLE_MS;
    const expiredAfterMs = options.expiredAfterMs ?? DEFAULT_EXPIRED_MS;
    this.root = root;
    this.waitMs = waitMs;
    this.pollMs = pollMs;
    this.unattributableAfterMs = unattributableAfterMs;
    this.expiredAfterMs = expiredAfterMs;
    this.log = options.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
    const rootId = crypto.createHash('sha256').update(root).digest('hex').slice(0, 12);
    this.dir = path.join(root, '.tmp', 'mutation-sandbox', rootId);
    // `lock` deliberately does NOT get created here. `mkdir(lock)` is the test-and-set, so the directory has to
    // exist only while the tree is held; pre-creating it makes every acquisition fail with EEXIST, and the suite
    // then spends its bounded wait on a lock nobody holds. (Measured: that was this module's first behaviour.)
    for (const sub of ['want', 'staged'] as const) fs.mkdirSync(path.join(this.dir, sub), { recursive: true });

    // The recovery the header promises: a sidecar whose owner is provably gone is replayed *here*, before this
    // process reads the tree, so an interrupted run's damage lasts microseconds. A sidecar whose owner may
    // still be working is left alone; `exclusive()` recovers again after the lock is ours.
    this.recoverStaleSidecars('module load');

    live.push(this);
    if (!teardownInstalled) {
      teardownInstalled = true;
      process.on('exit', () => { for (const s of live) s.teardown(); });
      for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
        process.on(signal, () => {
          for (const s of live) s.teardown();
          // Registering the handler suppresses the default action, so the exit is ours to finish.
          process.exit(code);
        });
      }
    }
  }

  get locked(): boolean { return this.lockDir !== null; }

  exclusive<T>(label: string, fn: () => T): T {
    this.makeTicket();
    try {
      this.acquire(label);
      try {
        return fn();
      } finally {
        this.releaseLockOnly();
      }
    } finally {
      // The ticket goes even when acquisition failed. A timed-out waiter that kept its ticket would block every
      // later section in its own process forever, because that process is by definition still alive to be
      // waited on -- measured, with this line absent, as a 5 s `MUTATION_LOCK_TIMEOUT` naming its own pid.
      this.releaseTicket();
    }
  }

  /**
   * The same critical section for a body that has to await.
   *
   * Readers need it. A suite that only *imports* a file another suite mutates can be corrupted without ever
   * touching the tree: `components.test.ts` failed its invalid-prop-set refusal assertion while
   * `gates-falsify.test.ts` stood inside its §9.5 window -- a red run in a file that mutates nothing, which no
   * amount of mutator-versus-mutator locking prevents, because the lock was never the reader's to take.
   */
  async exclusiveAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.makeTicket();
    try {
      this.acquire(label);
      try {
        return await fn();
      } finally {
        this.releaseLockOnly();
      }
    } finally {
      this.releaseTicket();
    }
  }

  async importQuietly<T>(label: string, target: string): Promise<T> {
    quietImports += 1;
    const url = target.startsWith('file:') ? target : pathToFileURL(target).href;
    // The query is what makes the wait mean something: without it the module is whatever the *first* import of
    // it saw, which may have been mid-mutation in another process, and holding the lock afterwards would only
    // have protected a cache entry that was already poisoned.
    const busted = `${url}?mutation-sandbox-quiet=${process.pid}-${quietImports}`;
    return this.exclusiveAsync(label, async () => (await import(busted)) as T);
  }

  /** Take the turn and then the lock, or throw. Leaves the ticket owned by the caller's `finally`. */
  private acquire(label: string): void {
    const deadline = Date.now() + this.waitMs;
    const queuedAt = Date.now();
    let blockedBy = 'nothing';
    for (;;) {
      const holder = this.readLock();
      if (holder === null) {
        const ahead = this.ticketsAheadOfMe();
        if (ahead.length === 0) {
          if (this.tryTakeLock(label)) break;
          continue;
        }
        blockedBy = `a queue ticket ahead of mine: ${ahead.join(', ')}`;
      } else if (holder === 'unattributable') {
        const since = this.lockMtimeMs();
        if (Date.now() - since > this.unattributableAfterMs) {
          this.report(`reclaimed a lock with no readable owner record, ${ageOf(since)} old: a live holder writes its record in the same tick as the mkdir, so one older than ${Math.round(this.unattributableAfterMs / 1000)}s is a process that died mid-create`);
          this.dropLockDir();
          continue;
        }
        blockedBy = `a lock with no readable owner record, ${ageOf(since)} old and too young to call abandoned`;
      } else {
        const verdict = liveness(holder.pid, holder.host, holder.start);
        if (verdict.state === 'dead') {
          this.report(`reclaimed the tree lock from pid ${holder.pid} ("${holder.label}"), which held it for ${ageOf(holder.startedAt)}: ${verdict.evidence}`);
          this.dropLockDir();
          continue;
        }
        if (holder.start === null && Date.now() - holder.startedAt > this.expiredAfterMs) {
          // A record with no start time can only be aged out, never identified. That is safe *because* the bound
          // sits far above any section this tree has measured (~30 s of `tsc`, ~12 s of `ui:check`). A record
          // that does carry a start time is never aged out: there liveness is trustworthy, and a holder that has
          // genuinely run for fifteen minutes must fail a suite loudly rather than be walked over.
          this.report(`reclaimed the tree lock from pid ${holder.pid} ("${holder.label}") after ${ageOf(holder.startedAt)}: ${verdict.evidence}, but the record carries no start time and the lock is older than the ${Math.round(this.expiredAfterMs / 60_000)} min bound. If that pid really is mid-mutation, its own restore will now disagree with the tree, loudly.`);
          this.dropLockDir();
          continue;
        }
        if (holder.run === RUN_ID || (holder.pid === process.pid && holder.host === os.hostname() && holder.start === SELF_START)) {
          // Ourselves. A section cannot nest inside a section on the same tree, and a suite that tried would sit
          // in this loop until its bounded wait expired -- a multi-minute hang whose message names a process
          // nobody can find in `ps`, because the process writing the message is the one holding the lock.
          throw new MutationSandboxError(
            'MUTATION_LOCK_TIMEOUT',
            `exclusive() was called while this process (pid ${process.pid}) already holds the tree lock in "${holder.label}". The lock is not reentrant: unnest the critical section, do not raise the wait.`,
          );
        }
        blockedBy = `held by pid ${holder.pid} ("${holder.label}") for ${ageOf(holder.startedAt)} on host ${holder.host} (${verdict.evidence})`;
      }
      if (Date.now() >= deadline) {
        throw new MutationSandboxError(
          'MUTATION_LOCK_TIMEOUT',
          `waited ${Math.round(this.waitMs / 1000)}s for the working tree and did not get it: the tree is ${blockedBy}. `
          + `Refusing to run the section: a mutation measured against another process's mutation is evidence about nothing, a read taken from that tree is the same, and skipping the section would make this suite green by testing nothing. `
          + `If that pid is a live run, let it finish; if it is gone but still reads as holder, delete ${path.relative(this.root, this.dir)}/lock and re-run.`,
        );
      }
      sleepSync(this.pollMs);
    }
    // Serialisation is otherwise invisible: two suites interleaving safely look exactly like two suites that
    // never met. One line per waited section is what makes `waited 12s` greppable in a CI log.
    const waited = Date.now() - queuedAt;
    if (waited >= 100) this.report(`waited ${(waited / 1000).toFixed(1)}s for the working tree before "${label}"`);
    // The lock is ours from here on, and this is the only place anything is allowed to touch the tree.
    // Second recovery pass: whoever held the lock before us may have died while we waited.
    this.recoverStaleSidecars('lock acquired');
  }

  /** Restore what this section staged, then put the lock down -- in that order, always. */
  private releaseLockOnly(): void {
    try {
      this.restore();
    } finally {
      if (this.lockDir !== null) {
        this.dropLockDir();
        this.lockDir = null;
      }
    }
  }

  append(rel: string, text: string): Buffer {
    const abs = this.resolve(rel);
    const original = this.readCurrent(abs);
    if (original === null) {
      throw new MutationSandboxError('MUTATION_TARGET_MISSING', `${rel} does not exist, so there is nothing to append a violation to`);
    }
    const planted = Buffer.concat([original, Buffer.from(text)]);
    this.stage(rel, abs, original, planted);
    return original;
  }

  replaceOnce(rel: string, find: string, replace: string): Buffer {
    const abs = this.resolve(rel);
    const original = this.readCurrent(abs);
    if (original === null) {
      throw new MutationSandboxError('MUTATION_TARGET_MISSING', `${rel} does not exist, so ${find.slice(0, 40)} cannot be replaced in it`);
    }
    const text = original.toString();
    if (!text.includes(find)) {
      throw new MutationSandboxError(
        'MUTATION_TARGET_MISSING',
        `${rel} no longer contains the source line this mutation targets: the rule moved and the falsification is stale`,
      );
    }
    const planted = Buffer.from(text.replace(find, replace));
    if (planted.equals(original)) {
      throw new MutationSandboxError('MUTATION_TARGET_UNCHANGED', `the mutation of ${rel} changed nothing, so it proves nothing`);
    }
    this.stage(rel, abs, original, planted);
    return original;
  }

  write(rel: string, contents: string): Buffer | null {
    const abs = this.resolve(rel);
    const original = this.readCurrent(abs);
    const planted = Buffer.from(contents);
    if (original !== null && original.equals(planted)) {
      throw new MutationSandboxError('MUTATION_TARGET_UNCHANGED', `writing ${rel} would change nothing, so it proves nothing`);
    }
    this.stage(rel, abs, original, planted);
    return original;
  }

  restore(): void {
    for (const [rel, entry] of [...this.staged.entries()].reverse()) this.putBack(rel, entry.dir, this.resolve(rel), entry.original);
  }

  pending(): readonly string[] { return [...this.staged.keys()]; }

  assertNothingPending(): void {
    const pending = this.pending();
    if (pending.length > 0) {
      throw new MutationSandboxError(
        'MUTATION_SIDECAR_CONFLICT',
        `this run staged ${pending.join(', ')} and did not restore it. The bytes are in ${path.relative(this.root, this.dir)}/staged and the tree is still mutated.`,
      );
    }
    // Sidecars whose owner is provably gone should have been replayed by `recoverStaleSidecars`; one still
    // standing means the recovery path itself has a bug, and that is what this check is for. A sidecar owned by
    // a live pid belongs to another run's critical section and is none of our business.
    const abandoned = this.listSidecarDirs().filter((dir) => {
      const meta = this.readSidecarMeta(dir);
      if (meta === null) return true;
      return this.orphaned(meta, this.lockDir !== null);
    });
    if (abandoned.length > 0) {
      throw new MutationSandboxError(
        'MUTATION_SIDECAR_CONFLICT',
        `${abandoned.length} sidecar(s) in ${path.relative(this.root, this.dir)}/staged are still standing after recovery: ${abandoned.map((d) => path.basename(d)).join(', ')}. Recovery did not replay them, so the tree may still carry a planted violation.`,
      );
    }
  }

  /** Signal and exit teardown: restore first, then let the process leave. */
  private teardown(): void {
    if (this.releasedByTeardown) return;
    this.releasedByTeardown = true;
    try {
      this.restore();
    } finally {
      this.releaseLock();
    }
  }

  // ---------------------------------------------------------------- internals

  private report(line: string): void {
    this.events.push(line);
    this.log(`[mutation-sandbox] ${line}`);
  }

  private resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    const within = path.relative(this.root, abs);
    if (within.startsWith('..') || path.isAbsolute(within)) {
      throw new MutationSandboxError('MUTATION_SIDECAR_ESCAPE', `${rel} resolves outside ${this.root}; refusing to mutate there`);
    }
    return abs;
  }

  private readCurrent(abs: string): Buffer | null {
    try {
      return fs.readFileSync(abs);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Write the complete record — original bytes, the bytes the mutation is *going to* produce, and the meta — into
   * a fresh directory and `rename` it into place before touching the target. That ordering is the whole
   * self-healing property: at every instant after the rename, a process that dies next leaves enough to undo it.
   */
  private stage(rel: string, abs: string, original: Buffer | null, planted: Buffer): void {
    if (this.lockDir === null) {
      throw new MutationSandboxError(
        'MUTATION_LOCK_NOT_HELD',
        `refusing to mutate ${rel} outside exclusive(): another test file may be mutating this tree right now`,
      );
    }
    const existing = this.staged.get(rel);
    const dir = existing?.dir ?? path.join(this.dir, 'staged', digestOf(rel));
    if (existing === undefined) {
      const scratch = path.join(this.dir, 'staged', `.new-${digestOf(rel)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
      fs.mkdirSync(scratch, { recursive: true });
      if (original !== null) fs.writeFileSync(path.join(scratch, 'original'), original);
      fs.writeFileSync(path.join(scratch, 'planted'), planted);
      const meta: SidecarMeta = {
        rel,
        pid: process.pid,
        host: os.hostname(),
        pidStart: SELF_START,
        runId: RUN_ID,
        stagedAt: Date.now(),
        existedBefore: original !== null,
        originalMtimeMs: original === null ? 0 : this.mtimeOf(abs),
        originalHash: shortHash(original),
        plantedHash: shortHash(planted),
      };
      fs.writeFileSync(path.join(scratch, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
      try {
        fs.renameSync(scratch, dir);
      } catch (error) {
        fs.rmSync(scratch, { recursive: true, force: true });
        throw error;
      }
      this.staged.set(rel, { dir, original });
    } else if (original !== null && (existing.original === null || !existing.original.equals(original))) {
      // Staged once, mutated again in the same section: `original` stays the first capture. Rewrite `planted`
      // so a recovery after this second mutation still recognises the current bytes.
      fs.writeFileSync(path.join(dir, 'planted'), planted);
    }
    fs.writeFileSync(abs, planted);
  }

  private mtimeOf(abs: string): number {
    try {
      return fs.statSync(abs).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** The one restore path: byte-compared against both records, never against a guess. */
  private putBack(rel: string, sidecarDir: string, abs: string, captured: Buffer | null): void {
    const current = this.readCurrent(abs);
    const planted = this.readSidecarFile(sidecarDir, 'planted');
    if (current === null) {
      if (captured !== null) fs.writeFileSync(abs, captured);
    } else if (captured === null) {
      if (planted !== null && !current.equals(planted)) {
        this.conflict(rel, 'a file this run created does not hold the bytes this run wrote', current, captured, planted);
      }
      fs.rmSync(abs, { force: true });
    } else if (!current.equals(captured)) {
      if (planted !== null && !current.equals(planted)) {
        this.conflict(rel, 'the current bytes match neither the pre-mutation capture nor the mutation this run wrote', current, captured, planted);
      }
      fs.writeFileSync(abs, captured);
      const mtime = this.readSidecarMeta(sidecarDir)?.originalMtimeMs ?? 0;
      if (mtime > 0) {
        try {
          fs.utimesSync(abs, Date.now() / 1000, mtime / 1000);
        } catch {
          /* mtime fidelity is a nicety; the bytes are the guarantee. */
        }
      }
    }
    fs.rmSync(sidecarDir, { recursive: true, force: true });
    this.staged.delete(rel);
  }

  private conflict(rel: string, why: string, current: Buffer | null, captured: Buffer | null, planted: Buffer | null): never {
    throw new MutationSandboxError(
      'MUTATION_SIDECAR_CONFLICT',
      `${rel}: ${why} (${shortHash(current)} vs original ${shortHash(captured)} / planted ${shortHash(planted)}). `
      + 'Refusing to overwrite: those bytes may be someone\'s uncommitted work layered on a planted violation. Resolve by hand and re-run.',
    );
  }

  private readSidecarFile(dir: string, name: string): Buffer | null {
    try {
      return fs.readFileSync(path.join(dir, name));
    } catch {
      return null;
    }
  }

  private readSidecarMeta(dir: string): SidecarMeta | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as SidecarMeta;
    } catch {
      return null;
    }
  }

  private listSidecarDirs(): string[] {
    const root = path.join(this.dir, 'staged');
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      return [];
    }
    return names.filter((n) => !n.startsWith('.')).map((n) => path.join(root, n));
  }

  /**
   * Is this record's writer gone?
   *
   * The invariant that answers it: a staged record only exists while its writer holds the tree lock -- `stage()`
   * refuses to write one otherwise, and a section restores before it releases. So the lock, not the pid, decides
   * whether a mutation is in flight. Three cases, in the order they are checked:
   *
   * - We hold the lock. Then no other run can be inside a section, and every foreign sidecar is a leftover.
   *   This is why recovery also runs right after acquisition, not only at module load.
   * - The lock belongs to this same record's run (matching `runId`). Leave it alone: somebody is measuring
   *   against those bytes right now.
   * - Anything else -- no lock at all, or a lock held by a different run, or a legacy record whose writer's
   *   start time disagrees with the pid it recorded. The writer is gone. Ageing these out over minutes instead
   *   left a planted violation in the tree while a suite sat and waited for a pid that had been reissued.
   *
   * A legacy record (no `runId`, no `pidStart`) can only be judged by the clock and the lock, so it is treated as
   * live while some *other* lock claim predates it -- the old, conservative answer -- and abandoned once the
   * lock has demonstrably changed hands or expired.
   */
  private orphaned(meta: SidecarMeta, weHoldTheTree: boolean): boolean {
    const verdict = liveness(meta.pid, meta.host, meta.pidStart);
    if (verdict.state === 'dead') {
      this.pendingOrphanEvidence = verdict.evidence;
      return true;
    }
    if (weHoldTheTree) {
      this.pendingOrphanEvidence = `this run holds the tree lock, so no other section can be in flight (${verdict.evidence})`;
      return true;
    }
    const holder = this.readLock();
    if (holder === null) {
      this.pendingOrphanEvidence = 'no process holds the tree lock, and a staged record only exists while its writer holds it';
      return true;
    }
    if (typeof holder === 'object' && holder.run !== null && meta.runId !== undefined && holder.run === meta.runId) return false;
    if (typeof holder === 'object' && holder.run !== null && meta.runId !== undefined && holder.run !== meta.runId) {
      this.pendingOrphanEvidence = `the tree lock belongs to a different run (${holder.run} at pid ${holder.pid}), not the ${meta.runId} that wrote this record`;
      return true;
    }
    // No run id on either side (a record from before this rule): fall back to pid liveness plus the age bound.
    if (Date.now() - meta.stagedAt <= this.expiredAfterMs) return false;
    this.pendingOrphanEvidence = `${verdict.evidence}, and the record is ${ageOf(meta.stagedAt)} old -- past the bound any real section could have set`;
    return true;
  }

  /**
   * Replay sidecars whose owner is provably gone. A sidecar from a process we cannot place outside a section is
   * left for that process, because restoring its file mid-section would undo a mutation another suite is
   * measuring.
   */
  private recoverStaleSidecars(when: string): void {
    const weHoldTheTree = this.lockDir !== null;
    for (const dir of this.listSidecarDirs()) {
      const meta = this.readSidecarMeta(dir);
      if (meta === null) {
        const since = this.mtimeOf(dir);
        if (Date.now() - since > this.unattributableAfterMs) {
          this.report(`${when}: dropping an unattributable sidecar at ${path.relative(this.root, dir)} — no readable meta after ${ageOf(since)}; a complete record is renamed into place, so one that never got a meta came from a process that died mid-rename`);
          fs.rmSync(dir, { recursive: true, force: true });
        }
        continue;
      }
      if (this.staged.has(meta.rel)) continue;
      if (!this.orphaned(meta, weHoldTheTree)) continue;
      const evidence = this.pendingOrphanEvidence;
      const abs = this.resolve(meta.rel);
      const captured = meta.existedBefore ? this.readSidecarFile(dir, 'original') : null;
      if (meta.existedBefore && captured === null) {
        this.report(`sidecar record incomplete at ${when}: the sidecar for ${meta.rel} records that the file existed but carries no original bytes, so nobody can put it back. Leaving it for a human; ${path.relative(this.root, dir)}`);
        continue;
      }
      const current = this.readCurrent(abs);
      if (current !== null && meta.existedBefore && shortHash(current) === meta.originalHash) {
        // The damage was already undone (by us, or by hand). Drop the record, say nothing alarming.
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (current === null && !meta.existedBefore) {
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      this.putBack(meta.rel, dir, abs, captured);
      this.report(`self-healed ${meta.rel} at ${when}: pid ${meta.pid} on host ${meta.host} staged it ${ageOf(meta.stagedAt)} before it died with the mutation applied, and its sidecar put the bytes back (${meta.existedBefore ? meta.originalHash : 'the file it created was removed'}; ${evidence})`);
    }
  }

  // ---------------------------------------------------------------- lock plumbing

  private makeTicket(): void {
    this.ticketSeq += 1;
    const queuedAt = Date.now();
    const name = `${String(queuedAt).padStart(14, '0')}-${process.pid}-${String(this.ticketSeq).padStart(4, '0')}`;
    const dir = path.join(this.dir, 'want', name);
    fs.mkdirSync(dir, { recursive: false });
    this.ticketDir = dir;
    // The start time is what tells a later process whether this pid is still *this* process. The name already
    // carries the pid and the moment, so a ticket killed between the mkdir and this write is still judgeable --
    // by age, and loudly.
    try {
      fs.writeFileSync(path.join(dir, 'holder.json'), `${JSON.stringify({ pid: process.pid, host: os.hostname(), start: SELF_START, queuedAt })}\n`);
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      this.ticketDir = null;
      throw error;
    }
  }

  /**
   * Ticket names sorting before mine whose owners are gone, dead, or older than any legitimate wait.
   *
   * The queue exists because two suites that release and immediately re-queue starve each other without it: the
   * one that finishes a section first simply takes the lock again before the waiter even wakes, and the waiter's
   * bounded wait then expires against a tree that was free the whole time — a named failure with nothing behind
   * it. Ordering by ticket name (padded millisecond timestamp, then pid, then a per-process counter) gives every
   * process the same answer about who is next without any process owning the queue.
   */
  private ticketsAheadOfMe(): string[] {
    const mine = this.ticketDir === null ? '' : path.basename(this.ticketDir);
    const ahead: string[] = [];
    for (const name of this.listTickets()) {
      if (name === mine || name > mine) continue;
      const pid = Number(name.split('-')[1]);
      const queuedAt = Number(name.slice(0, 14));
      if (pid === process.pid) {
        // A ticket carrying our own pid cannot be a live waiter: this function only runs from inside a critical
        // section's acquisition loop, so the process is here, not queued. Anything that looks like it was left by
        // an earlier section that threw, or by a second sandbox on the same root in this process.
        this.dropTicket(name, 'this process, from a section that did not reach its release');
        continue;
      }
      const record = this.readTicketHolder(name);
      const verdict = record === null
        ? { state: 'unknown' as const, evidence: 'the ticket was written before holder records existed, or its writer died between the mkdir and the record' }
        : liveness(record.pid, record.host, record.start);
      if (verdict.state === 'dead') {
        this.dropTicket(name, verdict.evidence);
        continue;
      }
      if (Date.now() - queuedAt > this.expiredAfterMs) {
        // Nobody queues for fifteen minutes: a section's own bounded wait is shorter than this by design.
        this.dropTicket(name, `${verdict.evidence}, and the ticket is ${ageOf(queuedAt)} old -- older than any wait this module permits`);
        continue;
      }
      ahead.push(name);
    }
    return ahead;
  }

  private readTicketHolder(name: string): { pid: number; host: string; start: number | null; queuedAt: number } | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dir, 'want', name, 'holder.json'), 'utf8')) as {
        pid: number; host: string; start: number | null; queuedAt: number;
      };
    } catch {
      return null;
    }
  }

  private dropTicket(name: string, why: string): void {
    fs.rmSync(path.join(this.dir, 'want', name), { recursive: true, force: true });
    this.report(`removed the abandoned queue ticket ${name}: ${why}`);
  }

  private listTickets(): string[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(this.dir, 'want'));
    } catch {
      return [];
    }
    return names.filter((name) => !name.startsWith('.'));
  }

  private tryTakeLock(label: string): boolean {
    const dir = path.join(this.dir, 'lock');
    try {
      fs.mkdirSync(dir, { recursive: false });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EEXIST') return false;
      throw error;
    }
    this.lockDir = dir;
    try {
      fs.writeFileSync(path.join(dir, 'owner.json'), `${JSON.stringify({ pid: process.pid, host: os.hostname(), label, startedAt: Date.now(), start: SELF_START, run: RUN_ID })}\n`);
    } catch (error) {
      this.lockDir = null;
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    return true;
  }

  private readLock(): { pid: number; host: string; label: string; startedAt: number; start: number | null; run: string | null } | 'unattributable' | null {
    const dir = path.join(this.dir, 'lock');
    if (!fs.existsSync(dir)) return null;
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')) as {
        pid?: number; host?: string; label?: string; startedAt?: number; start?: number | null; run?: string | null;
      };
      if (typeof owner.pid !== 'number' || typeof owner.startedAt !== 'number') return 'unattributable';
      return {
        pid: owner.pid, host: owner.host ?? os.hostname(), label: owner.label ?? '',
        startedAt: owner.startedAt, start: typeof owner.start === 'number' ? owner.start : null,
        run: typeof owner.run === 'string' ? owner.run : null,
      };
    } catch {
      return 'unattributable';
    }
  }

  private lockMtimeMs(): number {
    try {
      return fs.statSync(path.join(this.dir, 'lock')).mtimeMs;
    } catch {
      return Date.now();
    }
  }

  private dropLockDir(): void {
    fs.rmSync(path.join(this.dir, 'lock'), { recursive: true, force: true });
  }

  private releaseLock(): void {
    // Lock first, ticket second: a waiter that could take the lock while my ticket still reads as queued just
    // waits one more poll, whereas the reverse order lets me requeue ahead of someone who waited longer.
    if (this.lockDir !== null) {
      this.dropLockDir();
      this.lockDir = null;
    }
    this.releaseTicket();
  }

  private releaseTicket(): void {
    if (this.ticketDir !== null) {
      fs.rmSync(this.ticketDir, { recursive: true, force: true });
      this.ticketDir = null;
    }
  }
}

/**
 * Open a sandbox for `root`, recovering any sidecar a killed run left behind as it opens.
 *
 * Called at module scope by the suites that mutate, which is what puts recovery before their baseline
 * assertions: by the time the first test body runs, the tree is either provably clean or the run has failed
 * with a named reason.
 */
export function createMutationSandbox(options: MutationSandboxOptions): MutationSandbox {
  return new Sandbox(options);
}
