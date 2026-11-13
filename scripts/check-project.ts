#!/usr/bin/env node
/**
 * Project-level documentation and skill checks, shared by the three CI workflows so the gate is one
 * command and not three copies of the same logic.
 *
 *   npx -y tsx scripts/check-project.ts [--quiet] [--root <dir>]
 *
 * Checks
 *   1. every local (non-http) link in project Markdown resolves to an existing file
 *   2. every cross-file `#anchor` targets a heading that exists in the target document
 *   3. every skill has frontmatter whose `name` matches its directory and a non-empty `description`
 *   4. every reference inside a skill resolves
 *
 * Scope excludes dependency and scratch trees: node_modules, .cache, .research, and the vendored
 * framework's own documentation (which is upstream's to validate).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';

const argv = process.argv.slice(2);
const quiet = argv.includes('--quiet');
const rootIndex = argv.indexOf('--root');
const rootArg = rootIndex === -1 ? undefined : argv[rootIndex + 1];
const ROOT = path.resolve(rootArg ?? process.cwd());

const EXCLUDED_DIRS = ['node_modules', '.cache', '.research', '.git'];
/** Vendored trees are excluded except their top-level project documents. */
const VENDOR_TOP_LEVEL = ['vendor/CORDIS.md'];

const say = (...lines: string[]): void => {
  if (!quiet) console.log(lines.join('\n'));
};

/** GitHub-style heading slug, applied identically here and in CI. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .replace(/ +/g, '-');
}

function headingsOf(markdown: string): Set<string> {
  const set = new Set<string>();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const heading = match[1];
    if (heading) set.add(slug(heading));
  }
  return set;
}

function isExcluded(relative: string): boolean {
  const parts = relative.split(path.sep);
  if (parts.some((p) => EXCLUDED_DIRS.includes(p))) return true;
  if (relative.startsWith(`vendor${path.sep}`) && !VENDOR_TOP_LEVEL.includes(relative.replace(/\\/g, '/'))) return true;
  return false;
}

async function markdownFiles(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs);
    if (entry.isDirectory()) {
      if (!isExcluded(rel)) await markdownFiles(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith('.md') && !isExcluded(rel)) {
      acc.push(abs);
    }
  }
  return acc;
}

/** `#` stays out of the path group so `[text](#anchor)` is recognised as an in-page link. */
const LINK = /\]\((?!https?:\/\/|mailto:)([^)\s#]*)(#[^)]*)?\)/g;

async function checkDocuments(files: string[]): Promise<string[]> {
  const problems: string[] = [];
  const cache = new Map<string, Set<string>>();

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    for (const match of text.matchAll(LINK)) {
      const target = match[1];
      const anchor = match[2];
      // An empty target with an anchor is an in-page link; it is checked against this document's
      // headings further down. Only a leading-slash target is a real absolute path, which is what
      // this rule exists to catch.
      if (target && target.startsWith('/')) {
        problems.push(`${path.relative(ROOT, file)}: absolute path link "${target}"`);
        continue;
      }
      const resolved = target && target.length > 0 ? path.resolve(path.dirname(file), target) : file;
      let exists = false;
      try {
        await fs.access(resolved);
        exists = true;
      } catch {
        exists = false;
      }
      if (!exists) {
        problems.push(`${path.relative(ROOT, file)}: missing link target "${target || '.'}"`);
        continue;
      }
      if (!anchor) continue;
      const stat = await fs.stat(resolved);
      let headings: Set<string>;
      if (stat.isDirectory()) continue;
      if (resolved.endsWith('.md')) {
        if (!cache.has(resolved)) cache.set(resolved, headingsOf(await fs.readFile(resolved, 'utf8')));
        headings = cache.get(resolved)!;
        if (!headings.has(anchor.slice(1))) {
          problems.push(`${path.relative(ROOT, file)}: missing anchor "${anchor}" in ${path.relative(ROOT, resolved)}`);
        }
      }
    }
  }
  return problems;
}

interface SkillCheck {
  file: string;
  problems: string[];
  name: string;
}

async function checkSkills(): Promise<{ skills: SkillCheck[]; problems: string[] }> {
  const problems: string[] = [];
  const skills: SkillCheck[] = [];
  const base = path.join(ROOT, '.agents', 'skills');
  let entries;
  try {
    entries = await fs.readdir(base, { withFileTypes: true });
  } catch {
    return { skills, problems: [`${path.relative(ROOT, base)}: no skills directory found`] };
  }

  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = path.join(base, entry.name, 'SKILL.md');
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      problems.push(`skill "${entry.name}": missing SKILL.md`);
      continue;
    }
    const local: string[] = [];
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!front) {
      local.push('no YAML frontmatter block');
    } else {
      const fields = new Map((front[1] ?? '').split(/\r?\n/).map((line) => {
        const i = line.indexOf(':');
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()] as [string, string];
      }));
      const name = fields.get('name') ?? '';
      const description = fields.get('description') ?? '';
      if (name !== entry.name) local.push(`frontmatter name "${name}" does not match directory "${entry.name}"`);
      if (!description) local.push('frontmatter description is empty');
      if (description.length > 400) local.push(`frontmatter description is ${description.length} chars (>400)`);
      skills.push({ file: path.relative(ROOT, file), name: name || entry.name, problems: local });
    }
    for (const match of text.matchAll(LINK)) {
      const resolved = path.resolve(path.dirname(file), match[1] || '.');
      try {
        await fs.access(resolved);
      } catch {
        local.push(`missing link target "${match[1]}"`);
      }
    }
    problems.push(...local.map((p) => `skill "${entry.name}": ${p}`));
  }
  return { skills, problems };
}

/**
 * Workflow linting that a YAML parser cannot do. GitHub's expression language has rules a
 * syntactically valid file can still violate, and the failure mode is a run with zero jobs and no log.
 * Targeted at this repository's workflow style (job ids at two-space indentation under `jobs:`):
 *   - every `needs` target names a job that exists in the same file
 *   - no `needs.<job>.` dot access on a hyphenated job id, which is invalid in GitHub expressions
 */
/**
 * Credential-hygiene gate. A committed token would undo the project's central claim, so this is a
 * check and not a convention. It inspects the git index rather than the working tree, because an
 * ignored file that was force-added is exactly the mistake being prevented.
 */
async function checkCredentialHygiene(): Promise<string[]> {
  const findings: string[] = [];
  const out = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) return ['git ls-files failed; cannot verify credential hygiene'];
  const tracked = out.stdout.split('\n').filter(Boolean);
  for (const f of tracked) {
    if (/(^|\/)\.?secrets\//i.test(f) || /\.token$/i.test(f)) findings.push(`tracked file looks like a credential: ${f}`);
    if (/^\.env(\..*)?$/.test(f) && !f.endsWith('.example')) findings.push(`tracked env file: ${f}`);
  }
  return findings;
}

/**
 * D47: a running environment's endpoints are configuration, not source.
 *
 * Two shapes of Railway-generated hostname are caught: `{service}-{environment}-{hash}` and the bare `{hash}`
 * routing target. Both were committed here -- the first as a workflow's control-plane URL, the second copied
 * out of a measured API response into a test fixture and a research note. Neither is usable by a tenant, and a
 * repository carrying one cannot be pointed at another platfolio without editing files.
 *
 * Synthetic sentinels (`verify-target.up.railway.app`) and the provider's own `.up.railway.app` SUFFIX
 * logic are not caught on purpose: the suffix is vocabulary and the sentinels are ours. The rule targets a
 * deployment's identity, not the platform's naming scheme.
 */
const GENERATED_HOST = /\b[a-z0-9]+-[a-z0-9]+-[0-9a-f]{6,}\.up\.railway\.app\b|\b[a-z0-9]{8}\.up\.railway\.app\b/;

async function checkCommittedEndpoints(): Promise<string[]> {
  const findings: string[] = [];
  const out = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) return ['git ls-files failed; cannot verify committed endpoints'];
  for (const f of out.stdout.split('\n').filter(Boolean)) {
    if (f.startsWith('vendor/') || /\.(png|jpg|gif|woff2?|lock)$/i.test(f)) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('up.railway.app')) continue;
    for (const [i, line] of text.split('\n').entries()) {
      const hit = line.match(GENERATED_HOST);
      if (hit) findings.push(`${f}:${String(i + 1)} commits a generated Railway hostname (${hit[0]}) -- an endpoint belonging to a running environment is configuration: a repository variable or an operator-supplied URL (D47)`);
    }
  }
  return findings;
}

async function checkWorkflows(): Promise<string[]> {
  const problems: string[] = [];
  const dir = path.join(ROOT, '.github', 'workflows');
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => /\.(yml|yaml)$/.test(n)).sort();
  } catch {
    return [];
  }

  for (const name of names) {
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    const jobIds = new Set<string>();
    let inJobs = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
      if (inJobs && /^\S/.test(line)) inJobs = false;
      if (!inJobs) continue;
      const id = line.match(/^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
      const jobId = id?.[1];
      if (jobId) jobIds.add(jobId);
    }

    for (const match of text.matchAll(/\bneeds:\s*\[([^\]]*)\]/g)) {
      for (const raw of (match[1] ?? '').split(',')) {
        const target = raw.trim().replace(/^['"]|['"]$/g, '');
        if (target && !jobIds.has(target)) problems.push(`${name}: needs refers to unknown job "${target}"`);
      }
    }
    for (const match of text.matchAll(/^\s+needs:\s*([A-Za-z0-9_-]+)\s*$/gm)) {
      const needsJob = match[1];
      if (needsJob && !jobIds.has(needsJob)) problems.push(`${name}: needs refers to unknown job "${needsJob}"`);
    }
    for (const match of text.matchAll(/\bneeds\.([A-Za-z0-9_]*-[A-Za-z0-9_-]*)\./g)) {
      problems.push(
        `${name}: "needs.${match[1]}." is invalid GitHub expression syntax — hyphenated job ids cannot use dot access; name the job with '_' or write needs['${match[1]}']`,
      );
    }
    if (!jobIds.size) problems.push(`${name}: no jobs found at two-space indentation (lint assumption)`);

    // GitHub interpolates expressions inside run bodies too, so an empty or unclosed placeholder
    // invalidates the whole workflow file — and the resulting run has zero jobs and no log.
    for (const match of text.matchAll(/\$\{\{([^{}]*)\}\}/g)) {
      if (!(match[1] ?? 'x').trim()) problems.push(`${name}: empty expression placeholder — write "GitHub expression" in prose instead`);
    }
    const opens = (text.match(/\$\{\{/g) ?? []).length;
    const closes = (text.match(/\}\}/g) ?? []).length;
    if (opens !== closes) problems.push(`${name}: unbalanced expression placeholders: ${opens} opening, ${closes} closing`);
  }
  return problems;
}

/**
 * Action manifests are GitHub-parsed too, and a manifest that fails to parse surfaces as a runner setup error
 * with no hint of YAML ("Unexpected type '' encountered while reading 'action manifest root'"). The first real
 * dispatch died exactly that way, on an unquoted `${'{'}{ steps.run.outputs.outcome }`'}`'}` inside a flow
 * mapping -- the brace starts a nested mapping. Workflows were linted; this file type was not.
 */
async function checkActionManifests(): Promise<string[]> {
  const problems: string[] = [];
  const candidates: string[] = [];
  const walk = async (dir: string, allowHidden = false): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && (allowHidden || !entry.name.startsWith('.'))) await walk(full); }
      else if (entry.name === 'action.yml' || entry.name === 'action.yaml') candidates.push(full);
    }
  };
  await walk(path.join(ROOT, '.github'), true);


  for (const file of candidates) {
    const name = path.relative(ROOT, file);
    const text = await fs.readFile(file, 'utf8');
    let doc: Record<string, unknown>;
    try {
      doc = parseYaml(text) as Record<string, unknown>;
    } catch (error) {
      problems.push(`${name}: does not parse as YAML -- GitHub reports this as an opaque runner setup error: ${((error as Error).message.split('\n')[0] ?? '').slice(0, 110)}`);
      continue;
    }
    if (!doc || typeof doc !== 'object') { problems.push(`${name}: parsed to nothing useful`); continue; }
    for (const key of ['name', 'description', 'runs']) if (!Reflect.has(doc, key)) problems.push(`${name}: missing required key "${key}"`);
    const runs = doc.runs as Record<string, unknown> | undefined;
    const using = runs?.using;
    if (typeof using !== 'string' || !['composite', 'node16', 'node20', 'docker'].includes(using)) {
      problems.push(`${name}: runs.using must be composite/node16/node20/docker, got ${JSON.stringify(using)}`);
    } else if (using === 'composite') {
      const steps = Array.isArray(runs?.steps) ? (runs?.steps as Record<string, unknown>[]) : [];
      if (steps.length === 0) problems.push(`${name}: a composite action needs at least one step`);
      steps.forEach((s, i) => {
        if (!s.run && !s.uses) problems.push(`${name}: step ${String(i + 1)} has neither run nor uses`);
        if (s.run && !s.shell) problems.push(`${name}: step ${String(i + 1)} runs a script without a shell`);
      });
    }
    for (const match of text.matchAll(/\$\{\{([^{}]*)\}\}/g)) {
      if (!(match[1] ?? 'x').trim()) problems.push(`${name}: empty expression placeholder`);
    }
    const opens = (text.match(/\$\{\{/g) ?? []).length;
    const closes = (text.match(/\}\}/g) ?? []).length;
    if (opens !== closes) problems.push(`${name}: unbalanced expression placeholders (${opens} opening, ${closes} closing)`);
  }
  return problems;
}

const files = await markdownFiles(ROOT);
say(`scanning ${files.length} markdown files under ${path.relative(ROOT, ROOT) || ROOT}`);

const docProblems = await checkDocuments(files);
const { skills, problems: skillProblems } = await checkSkills();
const workflowProblems = await checkWorkflows();
const hygieneProblems = await checkCredentialHygiene();
const endpointProblems = await checkCommittedEndpoints();
const actionProblems = await checkActionManifests();

const all = [...docProblems, ...skillProblems, ...workflowProblems, ...actionProblems, ...hygieneProblems, ...endpointProblems];
say(`skills checked: ${skills.length} (${skills.map((s) => s.name).join(', ')})`);
say(`workflows linted: ${workflowProblems.length === 0 ? 'clean' : `${workflowProblems.length} problem(s)`}`);
say(`action manifests checked: ${actionProblems.length === 0 ? 'clean' : `${actionProblems.length} problem(s)`}`);
say(`committed endpoints: ${endpointProblems.length === 0 ? 'no generated hostnames in tracked files' : `${endpointProblems.length} problem(s)`}`);

if (all.length) {
  console.error(`\n${all.length} problem(s):`);
  for (const p of all) console.error(` - ${p}`);
  process.exit(1);
}
say('project checks passed: links and anchors resolve, skill metadata is consistent, workflows lint clean.');
