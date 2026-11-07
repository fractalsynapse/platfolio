#!/usr/bin/env node
/**
 * Vendor-management tool for `vendor/cordis` (OD6).
 *
 * Keeps a third-party framework checkout in this repository reproducible: it records which upstream
 * commit is vendored, detects unrecorded local edits, plans an upgrade as a real file diff, applies
 * it atomically, and re-verifies. It only ever writes inside `vendor/` and `.cache/`.
 *
 * Node built-ins only — no packages to install.
 *
 * Run (this repository's Node build has no TypeScript support, so use a loader):
 *   node --experimental-strip-types scripts/vendor-cordis.ts <command>    # Node with TS support
 *   npx -y tsx scripts/vendor-cordis.ts <command>                         # portable today
 *
 * Commands
 *   adopt   record the tree that is already vendored (one-time, after manual vendoring)
 *   verify  tree hash matches the lock; LICENSE present; no nested .git; ref/version agree
 *   check   compare vendored ref with upstream tags; exit 1 when outdated (CI gate)
 *   list    upstream tags and branches
 *   plan    fetch a ref, diff against the vendored tree, write vendor/cordis.plan-<ref>.md
 *   apply   do what plan describes (needs --yes, or an interactive confirmation)
 *
 * Options
 *   --to <tag|ref|sha>   target revision (plan/apply default: newest upstream tag; adopt requires it)
 *   --cache <dir>        mirror + working location            (default: .cache/vendor-cordis)
 *   --force              proceed despite unrecorded local edits (apply would otherwise discard them)
 *   --yes                skip confirmation
 *   --quiet              less output
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';

/* ---------------------------------------------------------------- configuration */

const UPSTREAM = 'https://github.com/cordiverse/cordis';
const LICENSE_SPDX = 'MIT';
const LICENSE_HOLDER = 'Copyright (c) 2021-present Shigma';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const VENDOR_DIR = path.join(ROOT, 'vendor');
const TARGET_DIR = path.join(VENDOR_DIR, 'cordis');
const LOCK_FILE = path.join(VENDOR_DIR, 'cordis.lock.json');
const DOC_FILE = path.join(VENDOR_DIR, 'CORDIS.md');
const PATCH_DIR = path.join(VENDOR_DIR, 'patches');
const MANAGED_BEGIN = '<!-- BEGIN managed: vendor provenance -->';
const MANAGED_END = '<!-- END managed: vendor provenance -->';

/** Entries excluded from the tree hash (never vendored content). */
const IGNORE = new Set(['node_modules', '.git', '.cache', 'dist', 'coverage', '.turbo', '.yarn']);

/**
 * Files at the platfolio boundary. Any change here is a platfolio decision, not a routine
 * dependency bump, because `packages/contracts` and `packages/kernel` are written against them.
 */
const BOUNDARY = [
  'packages/core/src/context.ts',
  'packages/core/src/registry.ts',
  'packages/core/src/service.ts',
  'packages/core/src/events.ts',
  'packages/core/src/fiber.ts',
  'packages/core/src/reflect.ts',
  'packages/core/package.json',
  'packages/loader/src/index.ts',
  'packages/loader/src/config/entry.ts',
  'packages/include/src/index.ts',
];

/* ------------------------------------------------------------------------- types */

interface LockFile {
  schema: 1;
  upstream: string;
  license: string;
  licenseHolder: string;
  ref: string;
  commit: string;
  treeHash: string;
  fileCount: number;
  vendoredAt: string;
  updatedAt: string;
  patches: string[];
  note?: string;
}

interface Entry {
  rel: string;
  hash: string;
}

interface Diff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: number;
}

interface Plan {
  currentRef: string;
  currentCommit: string;
  targetRef: string;
  targetCommit: string;
  diff: Diff;
  drift: Diff;
  patchResults: { file: string; ok: boolean; message: string }[];
  boundary: string[];
}

/* ---------------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith('-')) ?? 'check';
const flag = (name: string): boolean => argv.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= argv.length ? undefined : argv[i + 1];
};
const quiet = flag('quiet');
const say = (...lines: string[]): void => {
  if (!quiet) console.log(lines.join('\n'));
};
/**
 * Declared as a function (not a const arrow) so TypeScript treats calls that never return as
 * unreachable and narrows the guards that rely on it.
 */
function die(message: string, code = 1): never {
  console.error(`error: ${message}`);
  process.exit(code);
}

function cacheDir(): string {
  return path.resolve(ROOT, opt('cache') ?? '.cache/vendor-cordis');
}

/* --------------------------------------------------------------------------- shell */

function git(args: string[], opts: { text?: boolean } = {}): { status: number; out: string; err: string; buf?: Buffer } {
  const r = spawnSync('git', args, {
    encoding: opts.text === false ? 'buffer' : 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) die(`git ${args.join(' ')} failed to start: ${r.error.message}`);
  const out = typeof r.stdout === 'string' ? r.stdout : (r.stdout?.toString('utf8') ?? '');
  const err = typeof r.stderr === 'string' ? r.stderr : (r.stderr?.toString('utf8') ?? '');
  return { status: r.status ?? 1, out, err, buf: typeof r.stdout === 'string' ? undefined : r.stdout };
}

function requireGit(): void {
  const r = git(['--version']);
  if (r.status !== 0) die('git is required to manage the vendored tree');
}

const lastLine = (s: string): string => s.trim().split('\n').pop() ?? 'unknown error';

/* ------------------------------------------------------------------------ tree state */

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/** Refuse to touch a path outside the directory it is supposed to live in. */
function inside(dir: string, parent: string, label: string): string {
  const resolved = path.resolve(dir);
  const base = path.resolve(parent);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    die(`refusing to operate on ${label} outside ${base} (resolved to ${resolved})`);
  }
  return resolved;
}

async function hashTree(dir: string): Promise<{ entries: Entry[]; treeHash: string }> {
  const entries: Entry[] = [];
  const walk = async (current: string): Promise<void> => {
    const dirents = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const d of dirents) {
      if (IGNORE.has(d.name)) continue;
      const abs = path.join(current, d.name);
      if (d.isDirectory()) {
        await walk(abs);
      } else if (d.isFile() || d.isSymbolicLink()) {
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        const payload = d.isSymbolicLink() ? `symlink:${await fs.readlink(abs)}` : await fs.readFile(abs);
        entries.push({ rel, hash: sha256(payload) });
      }
    }
  };
  await walk(dir);
  const digest = crypto.createHash('sha256');
  for (const e of entries) digest.update(`${e.rel}\u0000${e.hash}\n`);
  return { entries, treeHash: digest.digest('hex') };
}

function diffTrees(before: Entry[], after: Entry[]): Diff {
  const b = new Map(before.map((e) => [e.rel, e.hash]));
  const a = new Map(after.map((e) => [e.rel, e.hash]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [rel, hash] of a) {
    if (!b.has(rel)) added.push(rel);
    else if (b.get(rel) !== hash) changed.push(rel);
    else unchanged++;
  }
  for (const rel of b.keys()) if (!a.has(rel)) removed.push(rel);
  const byDepth = (x: string, y: string): number => y.split('/').length - x.split('/').length || (x < y ? -1 : 1);
  return { added: added.sort(byDepth), removed: removed.sort(byDepth), changed: changed.sort(byDepth), unchanged };
}

/* --------------------------------------------------------------------------- lock */

async function readLock(): Promise<LockFile> {
  if (!(await exists(LOCK_FILE))) die(`no lock file at ${path.relative(ROOT, LOCK_FILE)}; run \`adopt --to <tag>\` first`);
  const raw = JSON.parse(await fs.readFile(LOCK_FILE, 'utf8')) as LockFile;
  if (raw.schema !== 1) die(`unsupported lock schema: ${String(raw.schema)}`);
  return raw;
}

async function writeLock(lock: LockFile): Promise<void> {
  await fs.mkdir(VENDOR_DIR, { recursive: true });
  await fs.writeFile(LOCK_FILE, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await updateDocProvenance(lock);
}

async function currentLock(ref: string, commit: string, note?: string): Promise<LockFile> {
  const { entries, treeHash } = await hashTree(TARGET_DIR);
  const existing = (await exists(LOCK_FILE)) ? await readLock() : undefined;
  const now = new Date().toISOString();
  return {
    schema: 1,
    upstream: UPSTREAM,
    license: LICENSE_SPDX,
    licenseHolder: LICENSE_HOLDER,
    ref,
    commit,
    treeHash,
    fileCount: entries.length,
    vendoredAt: existing?.vendoredAt ?? now,
    updatedAt: now,
    patches: (await listPatches()).map((p) => path.basename(p)),
    note,
  };
}

/* ------------------------------------------------------------------------- upstream */

async function ensureMirror(): Promise<string> {
  requireGit();
  const cache = cacheDir();
  await fs.mkdir(cache, { recursive: true });
  const mirror = inside(path.join(cache, 'cordis.git'), cache, 'git mirror');
  if (await exists(path.join(mirror, 'objects'))) {
    say('fetching upstream …');
    const r = git(['-C', mirror, 'fetch', '--prune', '--tags', '--force', 'origin', '+refs/heads/*:refs/heads/*']);
    if (r.status !== 0) die(`upstream fetch failed: ${lastLine(r.err)}`);
  } else {
    say(`cloning bare mirror from ${UPSTREAM} …`);
    const r = git(['clone', '--bare', UPSTREAM, mirror]);
    if (r.status !== 0) die(`mirror clone failed: ${lastLine(r.err)}`);
  }
  return mirror;
}

function tags(mirror: string): string[] {
  const list = git(['-C', mirror, 'tag', '--list']).out.split('\n').map((s) => s.trim()).filter(Boolean);
  const key = (t: string): number[] => t.replace(/^v/, '').split(/[.\-+_]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  return list.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const d = (ka[i] ?? -1) - (kb[i] ?? -1);
      if (d !== 0) return d;
    }
    return a < b ? -1 : 1;
  });
}

function resolveRef(mirror: string, ref: string): string {
  const r = git(['-C', mirror, 'rev-parse', '--verify', `${ref}^{commit}`]);
  if (r.status !== 0) die(`cannot resolve "${ref}" in ${UPSTREAM} — see \`list\``);
  return r.out.trim();
}

async function exportTree(mirror: string, commit: string, dest: string): Promise<void> {
  const target = inside(dest, cacheDir(), 'export directory');
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  const tar = git(['-C', mirror, 'archive', `--format=tar`, commit], { text: false });
  if (tar.status !== 0) die(`git archive failed: ${lastLine(tar.err)}`);
  const x = spawnSync('tar', ['-xf', '-', '-C', target], { input: tar.buf });
  if ((x.status ?? 1) !== 0) die(`tar extraction failed: ${x.stderr?.toString().trim()}`);
}

/** Upstream view of the recorded commit — the baseline for detecting local edits. */
async function baseline(lock: LockFile, mirror: string): Promise<{ entries: Entry[]; treeHash: string }> {
  const dir = path.join(cacheDir(), `baseline-${lock.commit.slice(0, 12)}`);
  if (!(await exists(path.join(dir, 'packages')))) await exportTree(mirror, lock.commit, dir);
  return hashTree(dir);
}

/* ------------------------------------------------------------------------- patches */

async function listPatches(): Promise<string[]> {
  if (!(await exists(PATCH_DIR))) return [];
  const files = (await fs.readdir(PATCH_DIR)).filter((f) => /\.(patch|diff)$/.test(f)).sort();
  return files.map((f) => path.join(PATCH_DIR, f));
}

/** Do the recorded patches still apply to a candidate tree? Checked before anything is written. */
async function testPatches(tree: string, patches: string[]): Promise<Plan['patchResults']> {
  const results: Plan['patchResults'] = [];
  for (const p of patches) {
    const r = spawnSync('git', ['apply', '--check', '-p1', p], { cwd: tree, encoding: 'utf8' });
    results.push({
      file: path.basename(p),
      ok: (r.status ?? 1) === 0,
      message: (r.status ?? 1) === 0 ? 'applies cleanly' : lastLine(r.stderr || r.stdout),
    });
  }
  return results;
}

/* --------------------------------------------------------------------------- docs */

function provenanceBlock(lock: LockFile): string {
  return [
    MANAGED_BEGIN,
    '| Field | Value |',
    '| --- | --- |',
    `| Upstream | \`${lock.upstream}\` |`,
    `| Ref | \`${lock.ref}\` |`,
    `| Commit | \`${lock.commit}\` |`,
    `| Tree hash | \`${lock.treeHash.slice(0, 16)}…\` (${lock.fileCount} files) |`,
    `| License | ${lock.license} — ${lock.licenseHolder} |`,
    `| Vendored | ${lock.vendoredAt.slice(0, 10)} |`,
    `| Updated | ${lock.updatedAt.slice(0, 10)} |`,
    `| Local patches | ${lock.patches.length ? lock.patches.map((p) => `\`${p}\``).join(', ') : 'none'} |`,
    `| Tool | \`scripts/vendor-cordis.ts\` (\`verify\` is the CI check) |`,
    MANAGED_END,
  ].join('\n');
}

async function updateDocProvenance(lock: LockFile): Promise<void> {
  if (!(await exists(DOC_FILE))) return;
  const text = await fs.readFile(DOC_FILE, 'utf8');
  const begin = text.indexOf(MANAGED_BEGIN);
  const end = text.indexOf(MANAGED_END);
  if (begin === -1 || end === -1 || end < begin) {
    say(`note: ${path.relative(ROOT, DOC_FILE)} has no managed provenance block; left untouched`);
    return;
  }
  await fs.writeFile(DOC_FILE, `${text.slice(0, begin)}${provenanceBlock(lock)}${text.slice(end + MANAGED_END.length)}`, 'utf8');
}

/* ------------------------------------------------------------------------ commands */

async function cmdAdopt(): Promise<number> {
  const ref = opt('to');
  if (!ref) die('adopt needs --to <tag> naming what the existing tree corresponds to');
  if (!(await exists(TARGET_DIR))) die(`no vendored tree at ${path.relative(ROOT, TARGET_DIR)}`);
  const mirror = await ensureMirror();
  const commit = resolveRef(mirror, ref);
  const lock = await currentLock(ref, commit, 'adopted from an existing vendored tree');
  if (!(await exists(path.join(TARGET_DIR, 'LICENSE')))) die('LICENSE missing from the vendored tree — vendor the license with the source');
  await writeLock(lock);
  say(`adopted ${ref} (${commit.slice(0, 12)}) — ${lock.fileCount} files, tree ${lock.treeHash.slice(0, 16)}…`);
  return 0;
}

async function cmdVerify(): Promise<number> {
  const lock = await readLock();
  if (!(await exists(TARGET_DIR))) die('vendored tree is missing');
  const { entries, treeHash } = await hashTree(TARGET_DIR);
  const problems: string[] = [];

  if (treeHash !== lock.treeHash) {
    problems.push(`tree hash does not match the lock (unrecorded local edits, or patches applied after the last adopt/apply)`);
  }
  if (!(await exists(path.join(TARGET_DIR, 'LICENSE')))) problems.push('LICENSE is missing — the MIT notice must ship with the source');
  if (await exists(path.join(TARGET_DIR, '.git'))) problems.push('nested .git present; it must not be committed');

  // Symlinks are the silent failure mode of copying a tree: a link rewritten to an absolute path
  // (or into the scratch cache) looks correct until the cache is cleaned. Catch it here, not in CI.
  const escapes: string[] = [];
  const walkLinks = async (current: string): Promise<void> => {
    for (const d of await fs.readdir(current, { withFileTypes: true })) {
      if (IGNORE.has(d.name)) continue;
      const abs = path.join(current, d.name);
      if (d.isDirectory()) await walkLinks(abs);
      else if (d.isSymbolicLink()) {
        const resolved = path.resolve(path.dirname(abs), await fs.readlink(abs));
        const rel = path.relative(TARGET_DIR, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          escapes.push(`${path.relative(TARGET_DIR, abs)} -> ${await fs.readlink(abs)}`);
        }
      }
    }
  };
  await walkLinks(TARGET_DIR);
  if (escapes.length) {
    problems.push(`${escapes.length} symlink(s) resolve outside the vendored tree: ${escapes.slice(0, 5).join(', ')}`);
  }
  const pkgPath = path.join(TARGET_DIR, 'packages/core/package.json');
  if (await exists(pkgPath)) {
    const version = JSON.parse(await fs.readFile(pkgPath, 'utf8')).version as string;
    if (!lock.ref.includes(version)) problems.push(`core package version ${version} disagrees with recorded ref ${lock.ref}`);
  }
  say(
    [
      `upstream : ${lock.upstream}`,
      `ref      : ${lock.ref} (${lock.commit.slice(0, 12)})`,
      `files    : ${entries.length}`,
      `treeHash : ${treeHash.slice(0, 16)}…`,
      `patches  : ${lock.patches.length ? lock.patches.join(', ') : 'none'}`,
    ].join('\n'),
  );
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(` - ${p}`);
    console.error('\nif the edits are intentional, record them as vendor/patches/*.patch and re-run adopt.');
    return 1;
  }
  say('verified: the vendored tree matches its lock');
  return 0;
}

async function cmdCheck(): Promise<number> {
  const lock = await readLock();
  const mirror = await ensureMirror();
  const all = tags(mirror);
  const newest = all[all.length - 1];
  const index = all.indexOf(lock.ref);
  const behind = index === -1 ? all.length : all.length - 1 - index;
  say(`vendored ${lock.ref} · newest upstream tag ${newest}`);
  if (behind > 0) {
    say(`outdated by ${behind} tag(s): ${all.slice(index + 1).join(', ')}`);
    say(`next: plan an upgrade with \`plan --to ${newest}\``);
    return 1;
  }
  say('up to date');
  return 0;
}

async function cmdList(): Promise<number> {
  const lock = (await exists(LOCK_FILE)) ? await readLock() : undefined;
  const mirror = await ensureMirror();
  say('upstream tags (oldest → newest):');
  for (const t of tags(mirror)) console.log(`  ${t === lock?.ref ? '* ' : '  '}${t}`);
  const heads = git(['-C', mirror, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']).out.trim().split('\n');
  say('\nbranches — moving targets, not for vendoring, listed for triage:');
  for (const h of heads) console.log(`  ${h}`);
  return 0;
}

async function buildPlan(): Promise<Plan & { mirror: string }> {
  const lock = await readLock();
  const mirror = await ensureMirror();
  const all = tags(mirror);
  const targetRef = opt('to') ?? all[all.length - 1];
  if (!targetRef) die('no upstream refs found');
  const targetCommit = resolveRef(mirror, targetRef);

  const candidate = path.join(cacheDir(), 'candidate');
  await exportTree(mirror, targetCommit, candidate);

  const base = await baseline(lock, mirror);
  const onDisk = await hashTree(TARGET_DIR);
  const target = await hashTree(candidate);

  const patches = await listPatches();
  const candidateCheck = path.join(cacheDir(), 'candidate-check');
  await fs.rm(candidateCheck, { recursive: true, force: true });
  // verbatimSymlinks keeps relative symlinks relative; the default rewrites them to absolute
  // paths inside the cache, which would silently break the vendored tree.
  await fs.cp(candidate, candidateCheck, { recursive: true, verbatimSymlinks: true, dereference: false });
  const patchResults = await testPatches(candidateCheck, patches);

  const diff = diffTrees(base.entries, target.entries);
  return {
    currentRef: lock.ref,
    currentCommit: lock.commit,
    targetRef,
    targetCommit,
    diff,
    drift: diffTrees(base.entries, onDisk.entries),
    patchResults,
    boundary: [...diff.changed, ...diff.added, ...diff.removed].filter((f) => BOUNDARY.includes(f)),
    mirror,
  };
}

function formatPlan(p: Plan): string {
  const lines: string[] = [
    '# Vendored Cordis update plan',
    '',
    `- current: \`${p.currentRef}\` (${p.currentCommit.slice(0, 12)})`,
    `- target : \`${p.targetRef}\` (${p.targetCommit.slice(0, 12)})`,
    `- files  : ${p.diff.unchanged} unchanged · ${p.diff.added.length} added · ${p.diff.removed.length} removed · ${p.diff.changed.length} changed`,
    '',
  ];
  const driftTotal = p.drift.added.length + p.drift.removed.length + p.drift.changed.length;
  if (driftTotal) {
    lines.push(
      `## Unrecorded local edits in vendor/cordis (${driftTotal})`,
      '',
      'These will be discarded by `apply` unless they are recorded as `vendor/patches/*.patch` first.',
      '',
      ...[...p.drift.changed, ...p.drift.added, ...p.drift.removed].slice(0, 40).map((f) => `- ${f}`),
      '',
    );
  }
  if (p.boundary.length) {
    lines.push(
      `## Boundary files touched (${p.boundary.length}) — review before applying`,
      '',
      ...p.boundary.map((f) => `- \`${f}\``),
      '',
      'These are the modules `packages/contracts` and `packages/kernel` are written against. A change here is a',
      'platfolio decision: re-run the conformance suites and expect a contracts version conversation.',
      '',
    );
  }
  if (p.patchResults.length) {
    lines.push('## Recorded patches', '', ...p.patchResults.map((r) => `- \`${r.file}\` — ${r.ok ? 'applies cleanly' : `**CONFLICT**: ${r.message}`}`), '');
  }
  const section = (title: string, items: string[]): string[] => {
    if (!items.length) return [];
    const shown = items.slice(0, 60).map((f) => `- ${f}`);
    if (items.length > 60) shown.push(`- …and ${items.length - 60} more`);
    return [`## ${title} (${items.length})`, '', ...shown, ''];
  };
  lines.push(...section('Added', p.diff.added), ...section('Removed', p.diff.removed), ...section('Changed', p.diff.changed));
  return lines.join('\n');
}

async function cmdPlan(): Promise<number> {
  const plan = await buildPlan();
  const report = path.join(VENDOR_DIR, `cordis.plan-${plan.targetRef}.md`);
  await fs.writeFile(report, `${formatPlan(plan)}\n`, 'utf8');
  say(formatPlan(plan));
  say(`report: ${path.relative(ROOT, report)}`);
  if (plan.patchResults.some((r) => !r.ok)) say('\nblocked: recorded patches conflict with the target. Resolve, then re-run plan.');
  return plan.patchResults.every((r) => r.ok) ? 0 : 2;
}

async function cmdApply(): Promise<number> {
  const lock = await readLock();
  const plan = await buildPlan();
  if (plan.patchResults.some((r) => !r.ok)) die('recorded patches conflict with the target; resolve before applying');

  const driftTotal = plan.drift.added.length + plan.drift.removed.length + plan.drift.changed.length;
  if (driftTotal && !flag('force')) {
    die(`vendor/cordis has ${driftTotal} unrecorded edit(s). Record them as vendor/patches/*.patch, or pass --force to discard them.`);
  }
  if (plan.targetRef === lock.ref && plan.targetCommit === lock.commit && !driftTotal) {
    say(`already at ${lock.ref}; nothing to do`);
    return 0;
  }
  if (!flag('yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`replace vendor/cordis ${plan.currentRef} → ${plan.targetRef}? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      say('aborted; nothing changed');
      return 130;
    }
  }

  const staging = inside(path.join(VENDOR_DIR, '.cordis-staging'), VENDOR_DIR, 'staging');
  const previous = inside(path.join(VENDOR_DIR, '.cordis-previous'), VENDOR_DIR, 'previous');
  const candidate = path.join(cacheDir(), 'candidate');
  assertInsideTarget();
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(candidate, staging, { recursive: true, verbatimSymlinks: true, dereference: false });

  // Apply recorded patches into staging BEFORE anything is swapped, so a conflict leaves the
  // vendored tree untouched. `plan` only checks; this is the step that actually applies.
  const patches = await listPatches();
  for (const p of patches) {
    const r = spawnSync('git', ['apply', '-p1', p], { cwd: staging, encoding: 'utf8' });
    if ((r.status ?? 1) !== 0) {
      await fs.rm(staging, { recursive: true, force: true });
      die(`patch ${path.basename(p)} failed against ${plan.targetRef}; nothing was changed: ${lastLine(r.stderr || r.stdout)}`);
    }
    say(`applied patch ${path.basename(p)}`);
  }

  if (await exists(path.join(staging, '.git'))) die('candidate contains a nested .git; refusing');
  if (!(await exists(path.join(staging, 'LICENSE')))) die('candidate is missing LICENSE; refusing to replace');

  await fs.rm(previous, { recursive: true, force: true });
  await fs.rename(TARGET_DIR, previous);
  try {
    await fs.rename(staging, TARGET_DIR);
  } catch (e) {
    await fs.rename(previous, TARGET_DIR);
    die(`replace failed, previous tree restored: ${(e as Error).message}`);
  }
  await fs.rm(previous, { recursive: true, force: true });

  const next = await currentLock(plan.targetRef, plan.targetCommit);
  await writeLock(next);
  say(`applied ${plan.targetRef} — ${next.fileCount} files, tree ${next.treeHash.slice(0, 16)}…`);
  say('next: run `verify`, the contracts conformance suites, then commit vendor/ and the lock together');
  return 0;
}

/** Final guard: the only path this tool may replace is the vendored tree itself. */
function assertInsideTarget(): void {
  const resolved = path.resolve(TARGET_DIR);
  const expected = path.join(path.resolve(ROOT), 'vendor', 'cordis');
  if (resolved !== expected) die(`refusing to operate: target resolved to ${resolved}`);
}

/* ---------------------------------------------------------------------------- main */

async function main(): Promise<number> {
  switch (command) {
    case 'adopt':
      return cmdAdopt();
    case 'verify':
      return cmdVerify();
    case 'check':
      return cmdCheck();
    case 'list':
      return cmdList();
    case 'plan':
      return cmdPlan();
    case 'apply':
      return cmdApply();
    default:
      die(`unknown command "${command}" — adopt | verify | check | list | plan | apply`);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => die(error.stack ?? error.message));
