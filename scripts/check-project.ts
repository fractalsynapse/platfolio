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

const EXCLUDED_DIRS = ['node_modules', '.cache', '.research', '.git', '.tmp']; // .tmp: gitignored scratch, incl. agent checkpoints
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

/**
 * D49: the projects platfolio tests against are the projects platfolio ships.
 *
 * Code and configuration may name only the four real test targets -- the three template repositories and
 * platfolio itself -- plus the two repositories that publish images. Anything else under this organization
 * appearing in executable files is either a stray probe project (which will drift, because nothing uses it in
 * anger) or a synthetic fixture squatting the namespace of a real asset, which is how a `widgets` fixture
 * came to look like an asset nobody maintained.
 *
 * Prose is deliberately out of scope: CHANGELOG entries and dated research notes record what existed at the
 * time, including probes that were deleted. Rewriting those would trade one kind of drift for a worse one --
 * a history that flatters the present.
 */
const REAL_PROJECTS = new Set(['platfolio', 'platfolio-starter-web', 'platfolio-starter-worker', 'platfolio-shared-identity']);
const PUBLISHED_IMAGES = new Set(['platfolio-control-plane', 'platfolio-status-api']);
const EXECUTABLE_PATH = /^(apps|packages|scripts|db|\.github)\//;
const ORG_REF = /fractalsynapse\/([A-Za-z0-9._-]+)/g;

/**
 * The development overlay must not drift from the platform description it overlays (D50).
 *
 * The maintainer's objection was fair: `compose.yaml` and `compose.dev.yaml` look like the same thing written
 * twice, and two files that describe one platform are exactly the pattern that has hurt this project before.
 * The distinction we settled on is that the dev file answers a question the platform file deliberately does
 * not: *what runs on a laptop*. It adds containers for things a provider provisions (the database, Mailpit),
 * published ports, loopback credentials and source mounts -- none of which ever reaches a plan, because
 * `platform:plan` reads `compose.yaml` + `compose.prod.yaml` only.
 *
 * So the gate enforces the pairing rather than deleting one half:
 *
 *  1. every service in the platform description must appear in the dev overlay, or local `up` silently runs
 *     half the platform and tells you it is whole;
 *  2. every service the overlay ADDS must be declared in the overlay's own `x-platfolio.devOnlyServices` list,
 *     so an extra container is a stated decision and not an accident a future reader inherits;
 *  3. the overlay must not declare domains or secrets the platform file does not -- a dev file that invents a
 *     hostname or a secret name is a second source of truth about what the platform needs.
 *
 * An overlay that does not exist is fine: `mode: hosted` platforms (shared-identity) are operated, not
 * developed, and D51 says so explicitly.
 */
async function checkDevOverlayPairing(): Promise<string[]> {
  type Doc = Record<string, unknown>;
  const readDoc = async (file: string): Promise<Doc | null> => {
    try {
      return parseYaml(await fs.readFile(file, 'utf8')) as Doc;
    } catch {
      return null;
    }
  };
  const exists = async (file: string): Promise<boolean> => {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  };

  const findings: string[] = [];
  // Only platfolio's own platform description is in this tree. The three published templates used to be paired
  // here from `templates/<name>/`, and that half of the rule now runs where the files live:
  // `packages/manifest/test/templates.test.ts` reads each repository's `compose.yaml` and `compose.dev.yaml`
  // through the source-control seam and applies the same first requirement (D50). Keeping the local pairs would
  // mean pointing at paths that no longer exist -- a rule that quietly checks nothing.
  const pairs: [string, string][] = [
    ['compose.yaml', 'compose.dev.yaml'],
  ];
  for (const [platformRel, devRel] of pairs) {
    const platformPath = path.join(ROOT, platformRel);
    const devPath = path.join(ROOT, devRel);
    if (!(await exists(platformPath)) || !(await exists(devPath))) continue;
    const pDoc = await readDoc(platformPath);
    const dDoc = await readDoc(devPath);
    if (!pDoc || !dDoc) { findings.push(`${platformRel} or ${devRel} does not parse`); continue; }
    const services = (doc: Doc): string[] => Object.keys(((doc.services ?? {}) as Record<string, unknown>));
    const xOf = (doc: Doc, name: string): Record<string, unknown> => {
      const svc = ((doc.services ?? {}) as Record<string, Record<string, unknown>>)[name] ?? {};
      return (svc['x-platfolio'] ?? {}) as Record<string, unknown>;
    };
    const declared = (((dDoc['x-platfolio'] ?? {}) as Record<string, unknown>).devOnlyServices ?? []) as unknown[];
    const devOnly = declared.map(String);
    const pServices = services(pDoc);
    for (const s of services(dDoc)) {
      if (!pServices.includes(s) && !devOnly.includes(s)) {
        findings.push(`${devRel}: extra service "${s}" is not declared in x-platfolio.devOnlyServices -- an undeclared container is a fact about the platform nobody wrote down (D50)`);
      }
    }
    for (const name of pServices) {
      const svc = ((dDoc.services ?? {}) as Record<string, unknown>)[name];
      if (svc === undefined) findings.push(`${devRel}: platform service "${name}" has no dev entry -- local up would run without it while the plan expects it (D50)`);
    }
    for (const name of services(dDoc)) {
      const dx = xOf(dDoc, name);
      const px = xOf(pDoc, name);
      const dDomains = Array.isArray(dx.domains) ? dx.domains.length : 0;
      const pDomains = Array.isArray(px.domains) ? px.domains.length : 0;
      if (dDomains > 0 && pDomains === 0) {
        findings.push(`${devRel}: service "${name}" declares dev domains absent from ${platformRel} -- a hostname invented in a dev file is never issued and never deployed, and it hides the real requirement`);
      }
      const dSecrets = Array.isArray(dx.secrets) ? dx.secrets.length : 0;
      const pSecrets = Array.isArray(px.secrets) ? px.secrets.length : 0;
      if (dSecrets > 0 && pSecrets === 0) {
        findings.push(`${devRel}: service "${name}" declares secrets absent from ${platformRel} -- the platform description is where a required credential belongs (D4)`);
      }
    }
  }
  return findings;
}

async function checkCommittedProjects(): Promise<string[]> {
  const findings: string[] = [];
  const out = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) return ['git ls-files failed; cannot verify test targets (D49)'];
  for (const f of out.stdout.split('\n').filter(Boolean)) {
    if (!EXECUTABLE_PATH.test(f) || /\.(png|jpg|gif|woff2?|lock)$/i.test(f)) continue;
    if (f.startsWith('vendor/') || f.includes('/dist/')) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('fractalsynapse/')) continue;
    for (const [i, line] of text.split('\n').entries()) {
      for (const match of line.matchAll(ORG_REF)) {
        const name = match[1]!;
        if (REAL_PROJECTS.has(name) || PUBLISHED_IMAGES.has(name)) continue;
        findings.push(`${f}:${String(i + 1)} names fractalsynapse/${name} in executable files -- D49 allows the four real projects (${[...REAL_PROJECTS].join(', ')}) and the published images; a fixture belongs under platfolio-fixtures/, and a fifth project belongs deleted`);
      }
    }
  }
  return findings;
}

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

/** The tracked file list, from the index rather than the disk: an ignored scratch file is not a claim about the project. */
function trackedFiles(): string[] {
  const out = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
  if (out.status !== 0) throw new Error('git ls-files failed');
  return out.stdout.split('\n').filter(Boolean);
}

/** platfolio's own environment registry (D52, D58), which makes this repository one of the platforms it hosts. */
const REGISTRY_NAME = 'environment.yaml';

async function registryRows(rel: string): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
  let text: string;
  try {
    text = await fs.readFile(path.join(ROOT, rel), 'utf8');
  } catch (error) {
    return { rows: [], error: `cannot be read (${(error as Error).message.slice(0, 60)})` };
  }
  try {
    const doc = parseYaml(text) as { variables?: unknown } | null;
    return { rows: Array.isArray(doc?.variables) ? doc.variables as Record<string, unknown>[] : [] };
  } catch (error) {
    return { rows: [], error: `does not parse: ${(error as Error).message.split('\n')[0] ?? ''}`.slice(0, 160) };
  }
}

const docProblems = await checkDocuments(files);
const { skills, problems: skillProblems } = await checkSkills();
const workflowProblems = await checkWorkflows();
const hygieneProblems = await checkCredentialHygiene();
const endpointProblems = await checkCommittedEndpoints();
const projectProblems = await checkCommittedProjects();
const overlayProblems = await checkDevOverlayPairing();
const actionProblems = await checkActionManifests();
const registryProblems = await checkTemplateRegistries();

/**
 * The templates are repositories, so this is the half that stays offline (D58, and the maintainer's ruling of
 * 2026-11-14 that ended the bundled copies).
 *
 * What used to live here was the offline half of *publication integrity*: a bundled `templates/` directory had
 * to be kept in step with three published repositories, and `pnpm run templates:check` was the networked half.
 * There is one copy now, so there is nothing to keep in step -- and the rules below are the ones that survive
 * the arrangement rather than the ones that served it.
 *
 *  - nothing in this repository may put a platform's files under a second `.platfolio/` registry, which is the
 *    duplication D58 was raised to remove (measured the hard way: the consolidation deleted the bundled copy
 *    while all three published repositories kept theirs, and `applyInventory` merges whatever it finds);
 *  - platfolio is itself one of the platforms it hosts (D49, D50), so its registry sits at this repository's
 *    root and must exist and declare rows -- a registry that parses to zero variables makes every other rule
 *    about it vacuous, and a vacuous rule is how a green gate hides a missing check;
 *  - no code or configuration may name a path under `templates/` as a literal. This is the assertion that the
 *    retargeting is *complete*: the directory is deleted by the orchestrator, and what must not survive is the
 *    reading of it. Prose is out of scope (comments, CHANGELOG and dated research notes describe what used to
 *    exist, and rewriting history is a worse drift than an old sentence -- the same reasoning D49 gives), so the
 *    pattern looks for a quoted path, which is how a program reaches for a file and not how a person writes
 *    about one.
 *
 * What a published template *contains* is checked where it lives, over the seam, by
 * `packages/manifest/test/templates.test.ts`.
 */
async function checkTemplateRegistries(): Promise<string[]> {
  const problems: string[] = [];
  const tracked = trackedFiles();
  for (const f of tracked) {
    if (f.startsWith('.platfolio/') || f.includes('/.platfolio/')) {
      problems.push(`${f}: the platform inventory was folded into the registry (D58); a second registry per platform is the duplication that change removed`);
    }
  }
  problems.push(...await checkNoBundledTemplateReads(tracked));
  if (!tracked.includes(REGISTRY_NAME)) {
    problems.push(`${REGISTRY_NAME}: missing -- platfolio hosts itself (D50), so this repository is a platform and declares its variables in one registry at its root (D58)`);
    return problems;
  }
  const registry = await registryRows(REGISTRY_NAME);
  if (registry.error !== undefined) problems.push(`${REGISTRY_NAME}: ${registry.error}`);
  // The vacuity guard, and it is not decoration: with zero rows every "is this declared, is it referenced, is
  // its custody right" rule reads nothing and still reports clean. `environment:registry` catches this sideways
  // (every discovered name becomes "undeclared"); this gate says the actual reason, in one line.
  else if (registry.rows.length === 0) {
    problems.push(`${REGISTRY_NAME}: declares no variables -- either this platform has none (delete the file) or its shape changed and every rule that reads it now reads nothing (D58)`);
  }
  return problems;
}

/**
 * Nothing may reach for a bundled template: a quoted path literal under `templates/` in code or composition.
 *
 * The directory itself is not checked here, deliberately. It is deleted by the orchestrator in a tree three
 * agents are editing at once, so pointing a gate at a path that is pending somebody else's move would only make
 * this check red for a reason nobody can act on. What must not survive the change is the READING: a `resolve('templates/...')`
 * left behind in a script, a CI path filter that still names the directory, a compose file that mounts it. Those
 * are the second way of reading a repository this change exists to end, and each one is a string literal a
 * program actually evaluates -- which is why the pattern is a quote followed by `templates/`, and why prose that
 * describes the old arrangement stays out of scope.
 */
async function checkNoBundledTemplateReads(tracked: string[]): Promise<string[]> {
  const problems: string[] = [];
  // Two shapes, because "reaching for a bundled copy" means different syntax in code and in configuration.
  //
  // In code the tell is a filesystem call whose argument is a `templates/` path -- which is why this rule does
  // not need an exemption for itself: `f.startsWith('templates/')` in the loop below is a test on a path string,
  // not a read of one, and a checker that had to hide its own definition would be a checker people route around.
  // In configuration the tell is a value position holding the path (a CI path filter, a compose mount, a script
  // argument in package.json), where there is no call to name.
  // The quote set, written as an ordinary string so a backtick can appear in it without ending a template
  // literal: `['"`]` inside String.raw`...` is the one thing that syntax cannot hold.
  const QUOTE = "['\"`]";
  const CODE_READ = new RegExp('\\b(?:readFileSync|readFile|existsSync|readdirSync|statSync|createReadStream|openSync|rmSync|writeFileSync|resolve|join|glob)\\s*\\([^)]{0,120}' + QUOTE + 'templates\\/');
  // The quote is REQUIRED and must sit directly against the path, so the value *begins* there. Measured reason:
  // the looser form caught `"referenced by compose.dev.yaml, templates/shared-identity/compose.yaml"` (a
  // generated note in the registry, which prose about the old layout and is the orchestrator's to re-emit) and
  // `"ghcr.io/railwayapp-templates/postgres-ssl:18"` (the provider's own image namespace, which is not a
  // template and never was). A path a program reads starts with the path; a sentence about one does not.
  const CONFIG_VALUE = new RegExp('(?:^|[\\s:,\[-])' + QUOTE + 'templates\\/');
  for (const f of tracked) {
    if (f.startsWith('templates/') || f.startsWith('vendor/') || f.includes('/dist/')) continue;
    if (/\.md$/.test(f)) continue;                                   // prose about the old layout is history, not a read
    if (!(/\.(ts|mjs|js|cjs|ya?ml|json)$/.test(f))) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(ROOT, f), 'utf8');
    } catch {
      continue;   // tracked but absent: the pending deletion, which is the orchestrator's to make, not a finding here
    }
    const isConfig = /\.(ya?ml|json)$/.test(f);
    for (const [i, line] of text.split('\n').entries()) {
      // Comments are not a program reaching for a file. This file's own documentation has to say what the old
      // arrangement was in order to explain why it ended, and a gate that forbids its own prose either gets
      // reworded into silence or gets ignored -- both of which are worse than the exemption. Same reasoning,
      // same shape as `check-environment-registry.ts` skipping its own name sets.
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#')) continue;
      const hit = isConfig ? line.match(CONFIG_VALUE) : line.match(CODE_READ);
      if (hit) problems.push(`${f}:${String(i + 1)} reaches for a bundled template path (${hit[0].trim().slice(0, 70)}) -- a template is its published repository now, read through the source-control seam (packages/manifest/src/template-catalog.ts). Keeping a second reader is the defect this change removed (2026-11-14)`);
    }
  }
  return problems;
}

/**
 * This repository is TypeScript. No Python, and a gate so it cannot creep back.
 *
 * The maintainer's ruling: one language for the toolchain. Ad-hoc scripting belongs in `tsx` under `.tmp/`
 * (gitignored, disposable, and it runs against the same types as everything else), not in a `.py` file beside
 * it. The reason is the one this whole change runs on: a second way of doing a thing is a second thing to keep
 * in step. Two interpreters means two dependency stories, a lockfile that describes only one of them, a CI
 * runner that installs a runtime nobody reviewed, and a script that is invisible to `typecheck`, to
 * `contracts:check` and to every gate that reads TypeScript.
 *
 * Two rules, both over TRACKED files (`git ls-files`), because an ignored scratch file is exactly what `.tmp/`
 * is for and a gate on scratch would only train people to scratch elsewhere:
 *
 *  1. no `*.py` file is tracked;
 *  2. no tracked file under `scripts/`, `docs/`, `.github/workflows/`, or `package.json` *invokes* an
 *     interpreter or a package installer.
 *
 * "Invokes" is the narrow half of the rule, and deliberately so: prose about somebody else's stack is not our
 * toolchain problem, and a checker that flags the word "Python" gets trained to be ignored inside a week. The
 * pattern therefore needs a command shape -- the interpreter with a flag, with a `.py` argument, or with a
 * subcommand; the installer with its subcommand; a shebang line; or a wrapper (uv, poetry, conda, pipx)
 * reaching for pip. Measured against the current tree: this rule finds 0 lines, while a bare case-insensitive
 * word match finds 5, all of them evidence about other projects (Railway's IaC note that Python and Go are in
 * beta, Authentik's Python/Django row) -- and evidence about the world is what docs/research is for.
 *
 * This file is not excluded from its own rule. The pattern source holds the words only inside regular-expression
 * syntax, which the boundary test does not read as a command; if that ever stops being true, this gate will fail
 * on itself, which is the correct and visible outcome.
 */
const PY_SCOPE = /^(scripts\/|docs\/|\.github\/workflows\/|package\.json$)/;
/**
 * Command shapes, not vocabulary.
 *
 * `BOUNDARY` is what makes prose safe to keep: a command token must begin after something that is not a word
 * character (line start, whitespace, punctuation), and must be followed by a flag, a script name, or a
 * subcommand. "Railway IaC supports Python and Go" satisfies neither half; a workflow line that runs the
 * interpreter with a flag satisfies both.
 */
const BOUNDARY = String.raw`(?:^|[^A-Za-z0-9_])`;
const PY_INVOCATION = new RegExp([
  `${BOUNDARY}python3?\\s+-[\\w-]`,
  `${BOUNDARY}python3?\\s+[\\w./-]+\\.py`,
  `${BOUNDARY}python3?\\s+(?:-m|install|run|venv|freeze|download|wheel|compile)\\b`,
  `${BOUNDARY}pip3?\\s+(?:install|freeze|download|wheel|list|show|uninstall|-\\w)`,
  String.raw`^\s*#!.*\bpython`,
  `${BOUNDARY}(?:uv|poetry|conda|pipx)\\s+pip\\b`,
].join('|'));

async function checkNoPython(): Promise<string[]> {
  const problems: string[] = [];
  for (const f of trackedFiles()) {
    if (f.endsWith('.py')) {
      problems.push(`${f}: a Python file is tracked -- this repository's toolchain is TypeScript, and ad-hoc scripting belongs in tsx under .tmp/ (gitignored, disposable, and it runs against the same types as everything else)`);
      continue;
    }
    if (!PY_SCOPE.test(f)) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    for (const [i, line] of text.split('\n').entries()) {
      if (PY_INVOCATION.test(line)) {
        problems.push(`${f}:${String(i + 1)}: invokes Python (${line.trim().slice(0, 90)}) -- the toolchain here is TypeScript only. Move it to \`npx -y tsx\` under .tmp/, or state in prose what it is evidence about rather than how to run it.`);
      }
    }
  }
  return problems;
}

const pythonProblems = await checkNoPython();

const all = [...docProblems, ...skillProblems, ...workflowProblems, ...actionProblems, ...hygieneProblems, ...endpointProblems, ...projectProblems, ...overlayProblems, ...registryProblems, ...pythonProblems];
say(`skills checked: ${skills.length} (${skills.map((s) => s.name).join(', ')})`);
say(`workflows linted: ${workflowProblems.length === 0 ? 'clean' : `${workflowProblems.length} problem(s)`}`);
say(`action manifests checked: ${actionProblems.length === 0 ? 'clean' : `${actionProblems.length} problem(s)`}`);
say(`committed endpoints: ${endpointProblems.length === 0 ? 'no generated hostnames in tracked files' : `${endpointProblems.length} problem(s)`}`);
say(`test targets (D49): ${projectProblems.length === 0 ? 'only the real projects are named in code' : `${projectProblems.length} problem(s)`}`);
say(`dev overlays (D50): ${overlayProblems.length === 0 ? 'every platform service has a dev entry; extras are declared' : `${overlayProblems.length} problem(s)`}`);
say(`template registries (D58): ${registryProblems.length === 0 ? 'one environment.yaml per platform, no retired path shipped' : `${registryProblems.length} problem(s)`}`);
say(`toolchain (TypeScript only): ${pythonProblems.length === 0 ? 'no tracked Python, no tracked file invokes python/pip' : `${pythonProblems.length} problem(s)`}`);

if (all.length) {
  console.error(`\n${all.length} problem(s):`);
  for (const p of all) console.error(` - ${p}`);
  process.exit(1);
}
say('project checks passed: links and anchors resolve, skill metadata is consistent, workflows lint clean.');
