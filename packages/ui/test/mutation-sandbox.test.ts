import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createMutationSandbox, MutationSandboxError, type MutationSandbox } from './mutation-sandbox.ts';

/**
 * The proof for `mutation-sandbox.ts`, and the reason it is a test file rather than a comment.
 *
 * The sandbox exists to survive the two things a mutation suite cannot control: another process holding the
 * tree, and its own death. The second one is not reachable from inside the process that dies — a `SIGKILL` runs
 * no handler, which is why the pre-mutation bytes live in a sidecar and not in memory. A claim like that cannot
 * be discharged by prose in a header, and it was not true of this repository for a day: an interrupted run left
 * `export interface __ForkTsx { readonly isMobile: boolean }` appended to a screen, and the *next* run's baseline
 * went red on a §9.3 violation nobody had written.
 *
 * So every case here kills a real child process — `process.kill(pid, 'SIGKILL')` from inside it, which is
 * deterministic where an external `kill -9` is a race against wherever the run had got to — and then asks the
 * tree, from a *different* process's point of view, what it says now. The repositories are scratch directories
 * under `.tmp/`, never this checkout's own tracked files: a test about not corrupting a working tree must not
 * be the thing that corrupts one.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const HELPER = path.join(import.meta.dirname, 'mutation-sandbox.ts');
const SCRATCH = path.join(ROOT, '.tmp', 'mutation-sandbox-selftest');
const DRIVER = path.join(SCRATCH, 'driver.ts');

/** gitignored scratch, and `.tmp` is excluded by name from `scripts/check-project.ts`'s source walk. */
const CHILD_SOURCE = [
  "import fs from 'node:fs';",
  "import { execFileSync } from 'node:child_process';",
  `import { createMutationSandbox } from ${JSON.stringify(HELPER)};`,
  '',
  'const [mode, root, rel, waitMs, holdMs, extra] = process.argv.slice(2);',
  'const sandbox = createMutationSandbox({ root, waitMs: Number(waitMs) });',
  'const log = (line) => { process.stdout.write(`${line}\\n`); };',
  'const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };',
  '',
  "if (mode === 'sigkill-after-mutate') {",
  "  sandbox.exclusive('sigkill mid-mutation', () => { sandbox.append(rel, '-planted-by-a-killed-run\\n'); process.kill(process.pid, 'SIGKILL'); });",
  "} else if (mode === 'sigkill-created-file') {",
  "  sandbox.exclusive('sigkill after creating', () => { sandbox.write(rel, 'created by a run that died\\n'); process.kill(process.pid, 'SIGKILL'); });",
  "} else if (mode === 'sigkill-while-holding') {",
  "  sandbox.exclusive('sigkill holding the lock', () => { log('HOLDING'); process.kill(process.pid, 'SIGKILL'); });",
  "} else if (mode === 'sigterm-during-gate') {",
  '  sandbox.exclusive("sigterm during a blocking gate", () => {',
  '    sandbox.append(rel, "-planted-then-signalled\\n");',
  "    log('HOLDING');",
  '    execFileSync("sleep", ["5"]);',
  '  });',
  "  log('DONE');",
  "} else if (mode === 'exit-mid-section') {",
  '  sandbox.exclusive("process.exit inside the section", () => {',
  '    sandbox.append(rel, "-planted-then-exited\\n");',
  "    process.exit(0);",
  '  });',
  "} else if (mode === 'hold') {",
  "  sandbox.exclusive('live holder', () => { sandbox.append(rel, '-held-while-you-waited\\n'); log('HOLDING'); sleep(Number(holdMs)); });",
  "  log('DONE');",
  "} else if (mode === 'contend') {",
  '  for (let i = 0; i < Number(holdMs); i += 1) {',
  '    sandbox.exclusive(`contend ${i}`, () => {',
  '      const started = Date.now();',
  '      fs.appendFileSync(extra, `enter ${process.pid} ${started}\\n`);',
  '      sleep(40);',
  '      fs.appendFileSync(extra, `exit ${process.pid} ${Date.now()}\\n`);',
  '    });',
  '  }',
  "  log('DONE');",
  '} else {',
  '  throw new Error(`unknown driver mode: ${mode}`);',
  '}',
  '',
].join('\n');

const CLEAN = 'the tree, as it was found\n';

interface ChildResult { readonly code: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string }
interface RunningChild { readonly done: Promise<ChildResult>; readonly pid: number; readonly output: () => string }

/**
 * Spawn the driver. `done` resolves on 'close', which is also when the pid is reaped — so a test that has
 * awaited it can rely on `probePid` inside the sandbox seeing the child as gone rather than as a zombie.
 */
function child(args: string[]): RunningChild {
  const proc = spawn(process.execPath, ['--import', 'tsx', DRIVER, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => { out += chunk; });
  proc.stderr.on('data', (chunk: string) => { err += chunk; });
  const done = new Promise<ChildResult>((resolve) => {
    proc.on('error', (error: Error) => { err += `${error}\n`; resolve({ code: -1, signal: null, stdout: out, stderr: err }); });
    proc.on('close', (code, signal) => { resolve({ code, signal, stdout: out, stderr: err }); });
  });
  return { done, pid: proc.pid ?? -1, output: () => out };
}

/** Wait for the child to print a line, so "it is inside its critical section now" is measured, not assumed. */
async function untilChildReaches(running: RunningChild, marker: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!running.output().includes(marker)) {
    if (Date.now() > deadline) {
      const settled = await running.done;
      assert.fail(`the driver never printed ${marker} (exit ${String(settled.code)} signal ${String(settled.signal)}): ${settled.stderr.slice(-1200)}`);
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 25); });
  }
}

/** A repo-shaped directory to mutate that is nobody's work but ours. */
function fakeRepo(name: string): { readonly root: string; readonly rel: string; readonly abs: string } {
  const root = path.join(SCRATCH, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const rel = 'src/victim.ts';
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, CLEAN);
  return { root, rel, abs };
}

const read = (abs: string): string => {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return '<absent>'; }
};

const sidecarsOf = (sandboxDir: string): string[] => {
  try { return fs.readdirSync(path.join(sandboxDir, 'staged')).filter((n) => !n.startsWith('.')); } catch { return []; }
};

fs.mkdirSync(SCRATCH, { recursive: true });
fs.writeFileSync(DRIVER, CHILD_SOURCE);

function openSandbox(root: string, waitMs = 30_000): MutationSandbox {
  return createMutationSandbox({ root, waitMs, log: (line) => { process.stdout.write(`${line}\n`); } });
}

test('SIGKILL: no handler ran, the next process replays the sidecar, and the tree is clean again', async () => {
  const repo = fakeRepo('sigkill-mutate');
  const killed = await child(['sigkill-after-mutate', repo.root, repo.rel, '30000']).done;
  assert.equal(killed.signal, 'SIGKILL', `the driver was supposed to die by SIGKILL, not run down a handler path: ${killed.stderr}`);
  // The damage this test exists for: the killed process wrote the violation and never got to undo it.
  assert.match(read(repo.abs), /planted-by-a-killed-run/, 'the killed run left nothing behind, so this case proves nothing about recovery');

  // A fresh sandbox at module scope is what the next test file, or the next CI attempt, does.
  const revived = openSandbox(repo.root);
  assert.equal(read(repo.abs), CLEAN, 'self-healing did not put the bytes back');
  assert.match(revived.events.join('\n'), /self-healed src\/victim\.ts/, `no recovery was reported: ${JSON.stringify(revived.events)}`);
  assert.deepEqual(revived.pending(), [], 'recovery left something staged');
  // The record goes with the damage: a replayed sidecar must not be replayed twice into a permanent warning.
  assert.deepEqual(sidecarsOf(revived.dir), [], 'the sidecar outlived the damage it described');
});

test('SIGKILL: a probe file the killed run created is removed by the next process', async () => {
  const repo = fakeRepo('sigkill-create');
  const probe = 'src/created-by-a-killed-run.ts';
  const killed = await child(['sigkill-created-file', repo.root, probe, '30000']).done;
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);
  assert.equal(read(path.join(repo.root, probe)), 'created by a run that died\n', 'the killed run created nothing, so this proves nothing');

  const revived = openSandbox(repo.root);
  assert.ok(!fs.existsSync(path.join(repo.root, probe)), 'the probe file survived both the run that made it and the recovery after it');
  assert.match(revived.events.join('\n'), /the file it created was removed/);
});

test('SIGKILL while holding the lock: the next holder reclaims it by name, having proved the holder is gone', async () => {
  const repo = fakeRepo('sigkill-lock');
  const killed = await child(['sigkill-while-holding', repo.root, repo.rel, '30000']).done;
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);

  const revived = openSandbox(repo.root);
  const lockDir = path.join(revived.dir, 'lock');
  assert.ok(fs.existsSync(lockDir), 'the killed run released its lock, so there was nothing to reclaim');
  const before = revived.events.length;
  const seen = revived.exclusive('after a dead holder', () => read(repo.abs));
  assert.equal(seen, CLEAN, 'the tree was not clean for the next holder');
  assert.match(revived.events.slice(before).join('\n'), /reclaimed the tree lock from pid \d+/, `the dead holder's lock was taken without a report: ${JSON.stringify(revived.events.slice(before))}`);
  assert.ok(!fs.existsSync(lockDir), 'the reclaimed lock directory was left standing');
});

test('teardown: a process that leaves mid-section restores before it goes', async () => {
  // The deterministic half of the teardown property. `process.exit()` from inside a critical section skips every
  // `finally` in the call stack, so only the registered `exit` handler can put the tree back -- which is also the
  // path a test runner takes when it is told to force-exit. No signal, no timing, no ambiguity: if the bytes are
  // clean and no sidecar stands, the handler did it.
  const repo = fakeRepo('exit-mid-section');
  const exited = await child(['exit-mid-section', repo.root, repo.rel, '30000']).done;
  assert.equal(exited.code, 0, `the driver was meant to leave on its own exit call: ${exited.stderr}`);
  assert.equal(read(repo.abs), CLEAN, 'the exit handler did not restore what the section had mutated');
  const revived = openSandbox(repo.root);
  assert.deepEqual(sidecarsOf(revived.dir), [], 'the exit handler left a sidecar behind, so teardown is not what cleaned the tree');
  assert.deepEqual(revived.events.filter((e) => e.includes('self-healed')), [], 'recovery, not teardown, repaired this run');
});

test('SIGTERM during a blocking gate call leaves a clean tree, whichever path got there', async () => {
  // Measured, not assumed: while a process is blocked inside `execFileSync` -- which is what these suites do for
  // the whole of a ~12 s critical section -- a queued SIGTERM does not reach its handler before the blocking call
  // returns. So the honest property is not "the handler runs", it is "the tree ends up clean", and it can be
  // reached by the handler, by the section's own `finally`, or by the next process replaying the sidecar. All
  // three are legitimate; the one that is not legitimate is a planted violation that survives the interruption.
  const repo = fakeRepo('sigterm-during-gate');
  const running = child(['sigterm-during-gate', repo.root, repo.rel, '30000', '5000']);
  await untilChildReaches(running, 'HOLDING');
  process.kill(running.pid, 'SIGTERM');
  const signalled = await running.done;
  assert.equal(read(repo.abs), CLEAN, `a SIGTERM-interrupted critical section left a planted violation: ${read(repo.abs)}`);
  assert.match(`${String(signalled.code)}:${String(signalled.signal)}`, /^(0:null|143:null|null:SIGTERM|143:SIGTERM)$/, `unexpected exit state ${String(signalled.code)}/${String(signalled.signal)}`);
});

test('a live holder blocks: the waiter fails with MUTATION_LOCK_TIMEOUT and writes nothing', async () => {
  const repo = fakeRepo('live-holder');
  const holding = child(['hold', repo.root, repo.rel, '30000', '1500']);
  await untilChildReaches(holding, 'HOLDING');

  const waiter = openSandbox(repo.root, 700);
  let failure: unknown = null;
  try {
    waiter.exclusive('waiter', () => { waiter.append(repo.rel, '-the-waiter-should-never-write-this\n'); });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof MutationSandboxError, `the waiter did not fail with a named reason: ${String(failure)}`);
  assert.equal((failure as MutationSandboxError).reason, 'MUTATION_LOCK_TIMEOUT');
  assert.match((failure as Error).message, /held by pid \d+ \("live holder"\) for \d+m?\d*s/, 'the message does not name the holder and its age');
  // The holder is still inside its section, so its own mutation is legitimately in the tree. What must NOT be
  // there is the waiter's: a suite that timed out and mutated anyway would be green and would have measured
  // two processes' damage at once.
  assert.doesNotMatch(read(repo.abs), /the-waiter-should-never-write-this/, 'the timed-out waiter wrote to a tree it never locked — the silent-skip failure this module exists to prevent');
  // And the other half, which is the defect this whole module is a response to: the tree the waiter wanted to
  // measure really was dirty. Had it gone ahead anyway, its own "the clean tree is green" assertion would have
  // read another process's mutation and reported it as its own. That is what PR #262's red run was.
  assert.match(read(repo.abs), /-held-while-you-waited/, 'the holder was not holding anything, so this case measured no collision at all');

  const done = await holding.done;
  assert.match(done.stdout, /DONE/, `the holder did not finish cleanly: ${done.stderr}`);
  assert.equal(read(repo.abs), CLEAN, 'the holder did not restore what it mutated');

  // A bounded wait that expires against a busy tree is correct; the same waiter after the holder is finished has
  // to proceed, or the lock is just a permanent failure.
  const after = openSandbox(repo.root, 5_000);
  const ran = after.exclusive('proceeds when free', () => {
    after.append(repo.rel, '-written-under-the-lock\n');
    return read(repo.abs);
  });
  assert.match(ran, /written-under-the-lock/);
  assert.equal(read(repo.abs), CLEAN, 'the section that ran did not restore the tree');
});

test('mutating outside a critical section is refused by name', () => {
  const repo = fakeRepo('unlocked-mutation');
  const sandbox = openSandbox(repo.root);
  assert.throws(() => sandbox.append(repo.rel, '-unlocked\n'), (error: unknown) => {
    assert.ok(error instanceof MutationSandboxError, String(error));
    assert.equal((error as MutationSandboxError).reason, 'MUTATION_LOCK_NOT_HELD');
    return true;
  });
  assert.equal(read(repo.abs), CLEAN, 'an unlocked append still reached the tree');
});

test('an uncontended tree is acquired at once, so a broken acquisition cannot read as contention', () => {
  // The bug this case caught: the sandbox used to create its `lock` directory up front, which made the
  // test-and-set `mkdir(lock)` fail with EEXIST for *every* process. Each one then waited out its bounded wait
  // against a lock nobody held — indistinguishable from real contention unless you measure a lone holder.
  const repo = fakeRepo('uncontended');
  const sandbox = openSandbox(repo.root, 300);
  const started = Date.now();
  const seen = sandbox.exclusive('alone', () => {
    sandbox.append(repo.rel, '-alone\n');
    return read(repo.abs);
  });
  assert.ok(Date.now() - started < 250, `acquiring a free tree took ${Date.now() - started} ms — something other than a live holder blocked it`);
  assert.match(seen, /-alone\n/, 'the mutation did not reach the tree inside its own section');
  assert.equal(read(repo.abs), CLEAN, 'the section did not restore what it mutated');
  assert.ok(!fs.existsSync(path.join(sandbox.dir, 'lock')), 'the lock outlived the section that took it');
});

test('a recycled pid cannot masquerade as a live holder', () => {
  // The bug this case pins: liveness by `kill(pid, 0)` alone, in a container whose pids are low and reused
  // within minutes. A suite hung for its entire bounded wait behind a lock whose recorded pid had been taken by
  // an unrelated process -- "alive", and therefore politely waited for. The holder record now carries the
  // writer's `/proc` start time, and a disagreement is proof the holder is gone whatever wears the pid.
  const repo = fakeRepo('recycled-pid');
  const sandbox = openSandbox(repo.root, 20_000);
  const lockDir = path.join(sandbox.dir, 'lock');
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({
    pid: process.pid, host: os.hostname(), label: 'a run that died and left its pid behind',
    startedAt: Date.now() - 60_000, start: 1,
  })}\n`);

  const started = Date.now();
  const seen = sandbox.exclusive('after the recycling', () => read(repo.abs));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `waited ${elapsed} ms behind a holder the start time already disproved -- that is the hang this rule exists to stop`);
  assert.equal(seen, CLEAN, 'the section ran on a tree it did not lock');
  assert.match(sandbox.events.join('\n'), /pid \d+ now belongs to a process started \d+ ticks later/, `the reclaim did not say why: ${JSON.stringify(sandbox.events)}`);

  // The same artefact with a *matching* start time is us, and the answer must be the nesting refusal, not a wait.
  fs.mkdirSync(lockDir, { recursive: true });
  const own = fs.readFileSync('/proc/self/stat', 'utf8').trim().split(' ')[21];
  fs.writeFileSync(path.join(lockDir, 'owner.json'), `${JSON.stringify({
    pid: process.pid, host: os.hostname(), label: 'this process, for real', startedAt: Date.now(), start: Number(own),
  })}\n`);
  assert.throws(() => sandbox.exclusive('nested for real', () => read(repo.abs)), /not reentrant/);
});
test('a nested critical section is refused by name instead of hanging until the wait expires', () => {
  // Without this the failure looks like a lock held by a process that does not exist: the suite sits in the
  // acquisition loop for its full bounded wait, waiting for itself.
  const repo = fakeRepo('nested-section');
  const sandbox = openSandbox(repo.root, 5_000);
  let nested: unknown = null;
  try {
    sandbox.exclusive('outer', () => {
      sandbox.exclusive('inner', () => { throw new Error('the inner section must never run'); });
      return 0;
    });
  } catch (error) {
    nested = error;
  }
  assert.ok(nested instanceof MutationSandboxError, `the nesting was not refused: ${String(nested)}`);
  assert.match((nested as Error).message, /not reentrant/, `the message does not name the real cause: ${(nested as Error).message}`);
  assert.equal(read(repo.abs), CLEAN, 'the refused nesting still reached the tree');
  // The refused inner section must have released its queue ticket, or the outer one could never finish.
  const after = sandbox.exclusive('outer again', () => read(repo.abs));
  assert.equal(after, CLEAN, 'the nested refusal left the tree locked or queued');
});

test('two contenders never hold the tree at the same time', async () => {
  // The measured question, not the reassuring one: do the intervals overlap? Two driver processes each running
  // sections back to back is exactly `gates-falsify.test.ts` against `typecheck-coverage.test.ts`.
  const repo = fakeRepo('two-contenders');
  const timeline = path.join(SCRATCH, 'two-contenders-timeline.txt');
  fs.rmSync(timeline, { force: true });
  const rounds = 12;
  const [a, b] = await Promise.all([
    child(['contend', repo.root, repo.rel, '30000', String(rounds), timeline]).done,
    child(['contend', repo.root, repo.rel, '30000', String(rounds), timeline]).done,
  ]);
  assert.match(a.stdout, /DONE/, `contender A failed: ${a.stderr}`);
  assert.match(b.stdout, /DONE/, `contender B failed: ${b.stderr}`);
  assert.equal(read(repo.abs), CLEAN, 'a contender left its mutation in the tree');

  const events = fs.readFileSync(timeline, 'utf8').trim().split('\n').map((line) => {
    const [phase, pid, at] = line.split(' ');
    return { phase: phase ?? '', pid: pid ?? '', at: Number(at) };
  }).sort((x, y) => x.at - y.at);
  assert.equal(events.length, rounds * 4, `expected ${rounds} enter/exit pairs per contender, got ${events.length} lines`);

  const open = new Map<string, number>();
  let overlaps = 0;
  for (const event of events) {
    if (event.phase === 'exit') {
      open.delete(event.pid);
    } else {
      // A section holds the tree for its 40 ms sleep; anything entering inside that window from another pid is
      // a second process mutating the same file.
      for (const [pid, started] of open) if (pid !== event.pid && event.at < started + 40) overlaps += 1;
      open.set(event.pid, event.at);
    }
  }
  assert.equal(overlaps, 0, `${overlaps} sections ran inside another contender's section — the lock is decoration`);
  // Non-vacuity: 2 × 12 sections × 40 ms of held time cannot fit in a span shorter than one contender's holds.
  const span = events[events.length - 1]!.at - events[0]!.at;
  assert.ok(span >= rounds * 40 * 1.5, `the two contenders finished in ${span} ms, which is shorter than serialised holds can take — they did not contend`);
});

test('recovery refuses to overwrite bytes that are neither the capture nor the mutation', async () => {
  const repo = fakeRepo('third-party-bytes');
  const killed = await child(['sigkill-after-mutate', repo.root, repo.rel, '30000']).done;
  assert.equal(killed.signal, 'SIGKILL', killed.stderr);
  // Someone edits the poisoned file before anybody recovers it. Their work is not ours to write over, and
  // restoring the captured bytes quietly would take it — the failure mode this project has already paid for.
  fs.writeFileSync(repo.abs, `${read(repo.abs)}\n// somebody's uncommitted work\n`);

  let failure: unknown = null;
  try {
    openSandbox(repo.root);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof MutationSandboxError, `recovery did not report the conflict: ${String(failure)}`);
  assert.equal((failure as MutationSandboxError).reason, 'MUTATION_SIDECAR_CONFLICT');
  assert.match(read(repo.abs), /somebody's uncommitted work/, 'recovery clobbered bytes it did not write');

  // The sidecar stays where a human can find it, because the tree is genuinely still carrying a violation.
  const stagedRoot = path.join(repo.root, '.tmp', 'mutation-sandbox');
  const standing = fs.readdirSync(stagedRoot).flatMap((id) => sidecarsOf(path.join(stagedRoot, id)));
  assert.equal(standing.length, 1, 'the conflict record was dropped, so the planted violation became invisible');
});
