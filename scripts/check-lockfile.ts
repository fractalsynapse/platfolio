#!/usr/bin/env node
/**
 * Lockfile freshness check.
 *
 * `pnpm install --frozen-lockfile` is the command CI runs, but locally it can exit 0 against a stale
 * lockfile because an existing node_modules satisfies the request before the importers are compared —
 * which is exactly how a bad lock reached CI in #23 while passing on a workstation. This check reads
 * the two files instead of asking the package manager, so it fails identically everywhere.
 *
 *   tsx scripts/check-lockfile.ts
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function importsOf(pkgFile: string): string[] {
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
  };
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {})].sort();
}

/**
 * Read the `importers:` sections of pnpm-lock.yaml without taking a YAML dependency.
 *
 * Two subtleties that both bit an earlier draft: pnpm 12 writes this file as multiple YAML
 * documents separated by `---` (a preamble document plus the v9 body), so every document must be
 * parsed and merged; and dependency names sit under `dependencies:` / `devDependencies:` at
 * 6-space indent, not under a `specifiers:` key.
 */
function parseDocument(text: string, into: Map<string, Set<string>>): void {
  const lines = text.split('\n');
  let inImporters = false;
  let current: string | null = null;
  let inDeps = false;
  for (const raw of lines) {
    if (/^importers:\s*$/.test(raw)) { inImporters = true; current = null; inDeps = false; continue; }
    if (inImporters && /^[A-Za-z]/.test(raw)) { inImporters = false; current = null; inDeps = false; continue; }
    if (!inImporters) continue;
    const importer = raw.match(/^  (?:'([^']+)'|(\S+)):\s*$/);
    if (importer) {
      current = (importer[1] ?? importer[2] ?? '.').trim();
      if (!into.has(current)) into.set(current, new Set<string>());
      inDeps = false;
      continue;
    }
    if (!current) continue;
    if (/^ {4}(?:dependencies|devDependencies|optionalDependencies):\s*$/.test(raw)) { inDeps = true; continue; }
    if (/^ {4}\S/.test(raw)) { inDeps = false; continue; }
    if (!inDeps) continue;
    const dep = raw.match(/^ {6}(?:'([^']+)'|(\S+)):\s*$/);
    const name = dep?.[1] ?? dep?.[2];
    if (name) into.get(current)!.add(name.trim());
  }
}

function lockImporters(text: string): Map<string, string[]> {
  const merged = new Map<string, Set<string>>();
  for (const doc of text.split(/\n---\n/)) parseDocument(doc, merged);
  const out = new Map<string, string[]>();
  for (const [k, v] of merged) out.set(k, [...v].sort());
  return out;
}

const lockPath = path.join(ROOT, 'pnpm-lock.yaml');
if (!fs.existsSync(lockPath)) {
  console.error('error: pnpm-lock.yaml is missing; run `pnpm install` and commit it');
  process.exit(1);
}
const importers = lockImporters(fs.readFileSync(lockPath, 'utf8'));

// Workspace members, from the same source pnpm uses.
const workspace = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
const patterns = [...workspace.matchAll(/^\s{2}-\s+'?([^\s']+)'?$/gm)].map((m) => m[1]!);
const members: string[] = ['.'];
for (const pattern of patterns) {
  const globDir = pattern.replace(/\/\*$/, '');
  if (globDir === pattern && fs.existsSync(path.join(ROOT, pattern, 'package.json'))) { members.push(pattern.replace(/^\.\//, '')); continue; }
  const base = path.join(ROOT, globDir);
  if (!fs.existsSync(base)) continue;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'package.json'))) members.push(`${globDir}/${entry.name}`);
  }
}

const problems: string[] = [];
for (const member of members) {
  const declared = importsOf(path.join(ROOT, member, 'package.json'));
  const inLock = importers.get(member);
  if (!inLock) {
    problems.push(`${member}: absent from pnpm-lock.yaml importers (regenerate with \`pnpm install\`)`);
    continue;
  }
  const missing = declared.filter((d) => !inLock.includes(d));
  const extra = inLock.filter((d) => !declared.includes(d));
  if (missing.length) problems.push(`${member}: lock is missing ${missing.join(', ')}`);
  if (extra.length) problems.push(`${member}: lock has undeclared ${extra.join(', ')}`);
}

if (problems.length) {
  console.error(`lockfile is stale for ${members.length} workspace member(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nrun `pnpm install` and commit pnpm-lock.yaml with the change that needs it');
  process.exit(1);
}
console.log(`lockfile covers ${members.length} workspace members: ${members.join(', ')}`);
