import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * The central environment registry (D52): `environment.yaml`, machine-readable, at the repository root.
 *
 * Both directions are checked, because a one-directional registry drifts the way documentation does: every
 * variable this project's configuration reads or deploys must be DECLARED, and every declared variable must
 * still be referenced somewhere -- otherwise the file accretes memorials.
 *
 * The secret half is the point of the exercise. "platfolio stores no tenant secrets" (D4) is only checkable if
 * each variable says whether it carries a credential; otherwise a new `*_TOKEN` can be committed as a literal
 * into a compose file and every existing gate stays silent, because nothing knew it was a secret. So a variable
 * marked `secret: true` must not be assigned a literal value in tracked files, and must name where its value
 * actually lives.
 *
 * Scope is deliberate. Prose, test fixtures and spikes are not this project's configuration. An early pass that
 * scanned TypeScript for YAML keys filled the registry with the provider's deployment-status vocabulary
 * (`PENDING`, `NEEDS_APPROVAL`) and with a fixture's invented `DATABASE_URL` -- a scanner that reads code as
 * configuration invents variables nobody sets.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY_PATH = 'environment.yaml';

/** The runtime, the OS, and the CI provider's own vocabulary: consumed, never declared by us. */
const EXTERNAL = new Set([
  'NODE_ENV', 'PORT', 'HOST', 'HOME', 'PATH', 'SHELL', 'CI', 'TZ', 'LANG', 'LC_ALL', 'FORCE_COLOR',
  'npm_config_cache', 'TMPDIR', 'DOCKER_CONFIG', 'USER', 'PWD', 'NODE_OPTIONS', 'NODE_VERSION',
  'GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_REF_NAME', 'GITHUB_REF_TYPE',
  'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_REPOSITORY_OWNER', 'GITHUB_OUTPUT', 'GITHUB_ENV',
  'GITHUB_STEP_SUMMARY', 'GITHUB_API_URL', 'GITHUB_SERVER_URL', 'ACTIONS_ID_TOKEN_REQUEST_URL',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'GH_TOKEN', 'IMAGE_NAME', 'IMAGE_REPO_OWNER', 'EVENT_NAME',
  'EVENT_ACTION', 'REGISTRY',
]);
/** GitHub synthesises `INPUT_*` from an action's `with:` keys; the rest is the runner's own namespace. */
const EXTERNAL_PREFIXES = ['INPUT_', 'GITHUB_', 'ACTIONS_'];

/** The name shapes that are ours: our prefix, a provider we configure, or a credential-shaped suffix. */
const OURS = /^(PLATFOLIO|RAILWAY|KEYCLOAK|KC_|MP_|MAILPIT|SESSION_|APP_|POSTGRES_|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGDATA|LIVE_|CONTROL_PLANE_|DATABASE_URL$|CR_)|(_TOKEN|_KEY|_SECRET|_PASSWORD|_URL)$/;

/** Where configuration lives: our code, our composition, our CI, our templates' own settings. */
const IN_SCOPE = /^(apps\/|packages\/(contracts|kernel|manifest|api-contract)\/src\/|scripts\/|\.github\/|db\/|templates\/(starter-web|starter-worker|shared-identity)\/(compose\.dev\.yaml|src\/))/;
const IN_SCOPE_ROOT = /^(compose\.yaml|compose\.prod\.yaml|compose\.dev\.yaml|\.platfolio\/|Dockerfile)/;

const ENVIRONMENTS = ['development', 'staging', 'production', 'ci', 'test', 'local'];

interface Entry { name?: string; secret?: boolean; appliesTo?: string[]; deployedTo?: string; note?: string }

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}

/** Every variable this project's configuration references, with the places that reference it. */
function discover(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const want = (name: string): boolean =>
    /^[A-Z][A-Z0-9_]{3,}$/.test(name) && !EXTERNAL.has(name)
    && !EXTERNAL_PREFIXES.some((x) => name.startsWith(x)) && OURS.test(name);
  const add = (name: string, where: string): void => {
    if (!want(name)) return;
    const set = found.get(name) ?? new Set<string>();
    set.add(where);
    found.set(name, set);
  };

  for (const f of trackedFiles()) {
    // The scanner is not configuration. Excluding it is not a loophole: the name sets inside it
    // (`POSTGRES_URL`, `PGPASSWORD`) are vocabulary ABOUT variables, not variables anyone sets. CI found this,
    // not me -- the check passed locally only because the file was still untracked, so `git ls-files` never
    // listed it. A tool that reads the repository has to state where it stops reading itself.
    if (f === REGISTRY_PATH || f === 'scripts/check-environment-registry.ts' || f.startsWith('vendor/') || f.includes('/dist/')) continue;
    if (/\.md$/.test(f) || f === 'pnpm-lock.yaml' || f.includes('/test/') || f.startsWith('spikes/') || f.startsWith('examples/')) continue;
    if (!(/\.(ts|mjs|js|yaml|yml)$/.test(f) || f.endsWith('Dockerfile'))) continue;
    if (!(IN_SCOPE.test(f) || IN_SCOPE_ROOT.test(f))) continue;

    const isYaml = /\.(yaml|yml)$/.test(f);
    let text: string;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const [i, line] of text.split('\n').entries()) {
      const at = `${f}:${String(i + 1)}`;
      if (line.includes('check-environment-registry') || /^\s*(const EXTERNAL|const OURS|const IN_SCOPE)/.test(line)) continue;
      for (const m of line.matchAll(/(?:process\.env|env|Env)\s*(?:\.|\[\s*['"])([A-Za-z_][A-Za-z0-9_]*)/g)) add(m[1]!.toUpperCase(), at);
      for (const m of line.matchAll(/['"]([A-Z][A-Z0-9_]{4,})['"]/g)) add(m[1]!, at);
      if (isYaml) {
        for (const m of line.matchAll(/^\s+-?\s*([A-Z][A-Z0-9_]{3,})\s*:/g)) add(m[1]!, at);
        for (const m of line.matchAll(/name:\s*([A-Z][A-Z0-9_]{3,})/g)) add(m[1]!, at);
      }
      for (const m of line.matchAll(/(?:vars|secrets)\.([A-Z][A-Z0-9_]{2,})/g)) add(m[1]!, at);
    }
  }
  return found;
}

function loadRegistry(): { entries: Entry[]; error?: string } {
  const p = path.join(ROOT, REGISTRY_PATH);
  if (!fs.existsSync(p)) return { entries: [], error: `${REGISTRY_PATH} does not exist` };
  try {
    const doc = parseYaml(fs.readFileSync(p, 'utf8')) as { variables?: Entry[] };
    return { entries: doc.variables ?? [] };
  } catch (error) {
    return { entries: [], error: `${REGISTRY_PATH} does not parse: ${(error as Error).message}` };
  }
}

/*
 * Judgement calls, in code rather than hand-edited into the generated file: `--emit` has to stay reproducible,
 * and an override that lives only in the output would be silently lost the next time the skeleton is
 * regenerated. Each one is a claim about custody, so each says why.
 */
const HUMAN: Record<string, Partial<Entry>> = {
  // The tenant application reads it; platfolio never does. It is credential-bearing, and it is the reason
  // `references` exist instead of a typed URL (D4, OD13).
  DATABASE_URL: { note: 'read by the tenant application (starter-web); platfolio resolves the production value from the database reference' },
  PLATFOLIO_DB_URL: { note: 'the same credential, delivered as a provider reference rather than a literal (OD13)' },
  // Loopback and CI container passwords: not secrets in the custody sense, because there is nothing behind them.
  POSTGRES_PASSWORD: { secret: false, note: 'a container password on loopback/CI; no real service listens' },
  RAILWAY_TOKEN: { note: 'the provider grant. Exactly one per managed instance (D24), held as a GitHub environment secret so platfolio never stores it' },
  PLATFOLIO_GIT_TOKEN: { secret: true, appliesTo: ['development', 'local', 'test'], deployedTo: 'host:shell', note: 'the git driver\'s HTTPS token, operator-supplied; production uses the App installation' },
  PLATFOLIO_SCM_DRIVER: { note: 'which driver is live: git | github-app | none (D51/D50)' },
  KEYCLOAK_ADMIN: { secret: false, note: 'a username is not a credential' },
  // A GitHub Packages push token. It is a credential even though the workflow reads it through `secrets.`, and
  // the emitter cannot know that from the name alone -- which is precisely why this table exists.
  CR_PAT: { secret: true, appliesTo: ['ci'], deployedTo: 'ci:secret', note: 'GitHub Packages push token used by the image workflow' },
  CONTROL_PLANE_BASE: { appliesTo: ['local', 'test'], note: 'which control plane a smoke script points at; never a deployment value' },
  OIDC_CLIENT_SECRET: { note: 'template placeholder: a tenant app that keeps its own OIDC client secret' },
  STRIPE_WEBHOOK_SECRET: { note: 'template placeholder: a tenant app verifying Stripe webhooks itself' },
  KEYCLOAK_ADMIN_PASSWORD: { note: 'the bootstrap admin of the hosted identity service, declared by name in the composition' },
};

function guess(name: string, places: Set<string>): Entry {
  const hosts = [...places].map((h) => h.split(':')[0]!);
  const composeOnly = hosts.every((h) => /^compose\.(prod\.)?yaml|^\.platfolio\//.test(h));
  const devOnly = hosts.every((h) => /compose\.dev\.yaml|templates\/.*compose\.dev\.yaml/.test(h));
  const ci = hosts.some((h) => h.startsWith('.github/'));
  const scripts = hosts.some((h) => h.startsWith('scripts/'));
  // A JDBC or connection URL carries the password inside it, so the name alone is not the test. PLATFOLIO_DB_URL
  // and DATABASE_URL are secrets even though neither word looks like one -- that misclassification is exactly the
  // kind the registry exists to make visible.
  const credentialUrl = new Set(['DATABASE_URL', 'PLATFOLIO_DB_URL', 'POSTGRES_URL', 'PGPASSWORD']);
  const secret = /SECRET|TOKEN|_KEY$|_KEY_|PASSWORD|CREDENTIAL/.test(name) || credentialUrl.has(name);
  let appliesTo = devOnly ? ['development']
    : composeOnly ? ['production', 'staging']
      : ci && !scripts ? ['ci']
        : scripts && !composeOnly ? ['local', 'test']
          : ['development', 'staging', 'production'];
  // Where the value lives is derived from the files that actually reference it, not from the shape of its
  // name. A prefix rule put RAILWAY_TOKEN in `railway:variable` when every workflow that reads it takes it from
  // a GitHub environment secret -- a registry whose only job is custody must not be right by guesswork.
  const inComposition = hosts.some((h) => /^compose\.(prod\.)?yaml/.test(h) || h.startsWith('.platfolio/'));
  const sharedVariableDeclared = ['compose.yaml', 'compose.prod.yaml', 'templates/starter-web/compose.yaml', 'templates/shared-identity/compose.yaml']
    .some((f) => fs.existsSync(path.join(ROOT, f)) && fs.readFileSync(path.join(ROOT, f), 'utf8').includes(`{ name: ${name}, source: shared-variable }`));
  const inWorkflows = hosts.some((h) => h.startsWith('.github/'));
  const deployedTo = secret
    ? (sharedVariableDeclared ? 'railway:shared-variable'
      : hosts.some((h) => /secrets\.[A-Z_]+|\$\{\{ secrets\./.test(h) || h.startsWith('.github/')) && !inComposition ? 'github:environment-secret'
        : inComposition ? 'railway:variable'
          : devOnly ? 'local:compose-overlay' : 'host:shell')
    : devOnly ? 'local:compose-overlay'
      : inWorkflows && !inComposition ? 'ci:env'
        : inComposition ? 'railway:variable'
          : 'host:shell';
  // appliesTo comes from which files reference it, not from a guess about the name: the platform file means the
  // deployed environments, the dev overlay means development, workflows mean ci, scripts mean local and test.
  const applies = new Set<string>();
  if (hosts.some((h) => /^compose\.(yaml|prod\.yaml)$/.test(h) || h.startsWith('.platfolio/'))) { applies.add('production'); applies.add('staging'); }
  if (hosts.some((h) => /compose\.dev\.yaml/.test(h))) applies.add('development');
  if (inWorkflows) applies.add('ci');
  if (hosts.some((h) => h.startsWith('scripts/') || h.startsWith('apps/managed-action/'))) { applies.add('local'); applies.add('test'); }
  if (hosts.some((h) => h.startsWith('templates/'))) { applies.add('development'); applies.add('staging'); applies.add('production'); }
  if (hosts.some((h) => h.startsWith('packages/') || h.startsWith('apps/control-plane/'))) { applies.add('production'); applies.add('staging'); }
  if (applies.size === 0) applies.add('local');
  appliesTo = [...applies].sort((a, b) => ENVIRONMENTS.indexOf(a) - ENVIRONMENTS.indexOf(b));
  const over = HUMAN[name] ?? {};
  return { name, secret: over.secret ?? secret, appliesTo: over.appliesTo ?? appliesTo, deployedTo: over.deployedTo ?? deployedTo, note: over.note ?? `referenced by ${[...new Set(hosts.map((h) => h.split(':')[0]!))].slice(0, 4).join(', ')}` };
}

const found = discover();
const { entries, error } = loadRegistry();
const declared = new Map(entries.map((e) => [e.name ?? '', e]));

if (process.argv.includes('--emit')) {
  const rows = [...found.keys()].sort();
  const body = rows.map((name) => {
    const existing = declared.get(name);
    const e = existing ?? guess(name, found.get(name)!);
    return `  - name: ${e.name}\n    secret: ${String(e.secret ?? false)}\n    appliesTo: [${(e.appliesTo ?? []).join(', ')}]\n    deployedTo: ${e.deployedTo ?? 'host:shell'}${e.note ? `\n    note: ${JSON.stringify(e.note)}` : ''}`;
  }).join('\n');
  process.stdout.write(`# The central environment registry (D52).\n# Every variable platfolio's configuration reads or deploys, whether it carries a\n# credential, which environments it applies to, and where its value lives.\n# Enforced by scripts/check-environment-registry.ts, both directions.\n# Skeleton from --emit. Judgement calls (which names are credentials, where values live) live in
# the script's HUMAN table: edit them there, because a hand-edit here is lost on the next --emit.\nvariables:\n${body}\n`);
  process.exit(0);
}

if (process.argv.includes('--report')) {
  const rows = [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
  process.stdout.write(`# ${String(rows.length)} variable(s) referenced. credential? / name / declared? / where\n`);
  for (const [name, places] of rows) {
    const cred = /SECRET|TOKEN|_KEY$|_KEY_|PASSWORD|CREDENTIAL/.test(name) ? 'credential' : 'plain';
    process.stdout.write(`${cred}\t${name}\t${declared.has(name) ? 'declared' : 'MISSING'}\t${[...places].map((p) => p.split(':')[0]).slice(0, 3).join(' ')}\n`);
  }
  process.exit(0);
}

const problems: string[] = [];
if (error) problems.push(`environment registry: ${error} -- the central registry is required at the repository root (D52)`);

for (const [name, places] of found) {
  if (!declared.has(name)) {
    problems.push(`${name} is referenced in configuration (${[...places].map((p) => p.split(':')[0]).slice(0, 3).join(', ')}) but is not declared in ${REGISTRY_PATH}`);
  }
}

for (const e of entries) {
  const name = e.name ?? '(unnamed entry)';
  if (!found.has(name)) problems.push(`${REGISTRY_PATH} declares ${name}, which nothing in configuration references any more -- delete it or wire it up`);
  if (typeof e.secret !== 'boolean') problems.push(`${name}: \`secret\` must be true or false -- custody is a per-variable claim, not a guess`);
  if (!Array.isArray(e.appliesTo) || e.appliesTo.length === 0) problems.push(`${name}: appliesTo must list at least one of ${ENVIRONMENTS.join('|')}`);
  else for (const a of e.appliesTo) if (!ENVIRONMENTS.includes(String(a))) problems.push(`${name}: appliesTo entry "${String(a)}" is not one of ${ENVIRONMENTS.join('|')}`);
  if (typeof e.deployedTo !== 'string' || e.deployedTo.length === 0) problems.push(`${name}: deployedTo must say where the value lives (railway:variable | railway:shared-variable | railway:reference | github:environment-secret | ci:secret | local:file | local:compose-overlay | host:shell)`);

  if (e.secret === true) {
    /*
     * The risk being checked is one thing: a real credential reaching a deployment description. So the rule is
     * scoped by where a value can land, not by trying to pattern-match "does this look secret?" -- that
     * judgement is unknowable from a string, and a whitelist of benign-looking values is how a leak gets
     * blessed. My first pass matched `NAME ==` in `env.NAME === undefined` and called CI service containers and
     * test doubles violations; five findings, all of them the scanner's fault, which is why the scope is now
     * stated as file classes.
     */
    const PRODUCTION_BEARING = /^(compose\.yaml|compose\.prod\.yaml|\.platfolio\/|templates\/[^/]+\/compose\.yaml|apps\/[^/]+\/Dockerfile|apps\/control-plane\/src\/|apps\/managed-action\/src\/|packages\/(contracts|kernel|manifest)\/src\/|\.github\/actions\/[^/]+\/action\.yml)/;
    const DEV_OVERLAY = /^(compose\.dev\.yaml|templates\/[^/]+\/compose\.dev\.yaml)/;
    for (const f of trackedFiles()) {
      if (f === REGISTRY_PATH || f.startsWith('vendor/') || f.includes('/dist/')) continue;
      if (!PRODUCTION_BEARING.test(f) && !DEV_OVERLAY.test(f)) continue;   // tests, CI jobs and scripts hold throwaways legitimately
      if (/\.md$/.test(f)) continue;
      if (!(/\.(yaml|yml|ts|mjs|js)$/.test(f) || f.endsWith('Dockerfile'))) continue;
      let text: string;
      try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
      for (const [i, line] of text.split('\n').entries()) {
        if (line.trim().startsWith('#') || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // `NAME: value` or `NAME=value`, but NOT `NAME === x` / `NAME !== x`: a comparison is a read, not an
        // assignment, and matching it made the control plane's own environment mapping look like a leak.
        const m = line.match(new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\s*(?::|=)(?!=)\\s*['\"]?([^'"\\s,}][^'\",}]*)?`));
        if (!m) continue;
        const value = (m[1] ?? '').trim();
        if (value === '') continue;
        if (/\$\{|\{\{|process\.env|Env\./.test(line)) continue;                       // interpolated, not literal
        const devShape = (s: string): boolean => /(dev-only|change-me|ci-only|not-a-secret|replace-me)/i.test(s);
        if (DEV_OVERLAY.test(f)) {
          // Loopback credentials are allowed in a development overlay (D46) -- but what is actually being
          // permitted is *the absence of a real secret*, not membership of a list of friendly strings, which is
          // how a whitelist turns a leak into an approved value. So the test is structural: a URL that carries
          // user:password userinfo must use a dev-shaped password. Everything else in a dev file is a
          // hostname, a port, or a JDBC string with no credential in it, and none of that is a secret.
          // (This rule caught my own first attempt to mark KC_DB_URL a secret: it has no credential in it, and
          // a registry that calls a hostname a secret trains nobody to trust it.)
          const embedded = value.match(/:\/\/[^/@\s]*:([^@/\s]+)@/);
          if (embedded !== null && !devShape(embedded[1]!)) {  // the predicate, not the boolean computed for the whole value
            problems.push(`${f}:${String(i + 1)} embeds a credential in ${name} that is not dev-shaped: "${embedded[1]!.slice(0, 8)}..." -- D46 allows loopback stand-ins, not real secrets in a development overlay`);
          }
          continue;
        }
        problems.push(`${f}:${String(i + 1)} assigns a literal value to ${name}, which the registry marks secret -- commit the NAME and let the provider hold the value (D4)`);
      }
    }
    const declaredByComposition = ['compose.yaml', 'compose.prod.yaml', 'compose.dev.yaml', '.platfolio/environment.yaml', 'templates/starter-web/compose.yaml', 'templates/starter-web/compose.dev.yaml', 'templates/starter-worker/compose.dev.yaml', 'templates/shared-identity/compose.yaml'].some((f) => {
      const p = path.join(ROOT, f);
      return fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(name);
    });
    const delivered = /github:environment-secret|ci:secret|local:file|local:compose-overlay|railway:variable|railway:shared-variable|host:shell/.test(String(e.deployedTo ?? ''));
    if (!declaredByComposition && !delivered) {
      problems.push(`${name}: marked secret but nothing says where the value lives -- list it as a secrets name in a composition or set deployedTo to the github/ci/local/railway location that holds it`);
    }
  }
}

if (problems.length) {
  console.error(`environment registry: ${String(problems.length)} problem(s)`);
  for (const p of problems.slice(0, 25)) console.error(`  - ${p}`);
  if (problems.length > 25) console.error(`  ... and ${String(problems.length - 25)} more`);
  process.exit(1);
}
const secrets = entries.filter((e) => e.secret === true).length;
console.log(`environment registry: ${String(entries.length)} variables declared (${String(secrets)} carry credentials), all referenced, no committed secret values in production descriptions.`);
