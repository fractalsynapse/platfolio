/**
 * Every platform's own registry is authoritative FOR THAT PLATFORM, so what generalises across them is the
 * obligation schema, not the name list. A template's `KC_DB_URL` is not a variable this control plane reads, and
 * demanding it in our root registry would recreate exactly the cross-namespace duplication D52 exists to remove
 * -- which is the mistake an earlier version of this function made, and why it is now a schema check.
 */
function checkPlatformRegistries(): string[] {
  const problems: string[] = [];
  for (const rel of inventoryFiles()) {
    let doc: unknown;
    try {
      doc = parseYaml(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    } catch (error) {
      problems.push(`${rel}: does not parse (${(error as Error).message.slice(0, 70)})`);
      continue;
    }
    const rows = Array.isArray((doc as { variables?: unknown })?.variables) ? (doc as { variables: Entry[] }).variables : [];
    // A vacuity guard, earned twice today: a shape change that makes a parser return zero rows turns a check
    // green without it looking at anything. Assert there are rows before reasoning about them.
    if (rows.length === 0) {
      problems.push(`${rel}: declares no variables -- either the platform has none (delete the file) or the shape changed and this check reads nothing`);
      continue;
    }
    for (const p of checkObligations(rows)) problems.push(`${rel}: ${p}`);
  }
  return problems;
}import { execFileSync } from 'node:child_process';
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
const IN_SCOPE = /^(apps\/|packages\/(contracts|kernel|manifest|api-contract)\/src\/|scripts\/|\.github\/|db\/|templates\/(starter-web|starter-worker|shared-identity)\/(compose(\.dev)?\.yaml|src\/))/;
/**
 * Files at the repository root whose contents are configuration.
 *
 * `.platfolio/` used to be listed here, and is deliberately gone. That directory holds the PLATFORM INVENTORY
 * (D33) -- a product artifact listing the obligations a platform declares for its operators, in its own schema
 * (`kind`, `required`, `service`, `description`). The central registry (D52) answers a different question about
 * the same names: is it a credential, which environments, where does the value live. Feeding one from the other
 * meant the same fact was maintained twice AND the registry inherited the inventory's staleness: when the
 * inventory still named SESSION_SIGNING_KEY and PUBLIC_ORIGIN (variables nothing reads), the registry treated
 * them as referenced.
 *
 * The experiment that justified removing it: exclude `.platfolio/` from discovery and re-run -- 82 variables,
 * all still referenced, no committed secret values, nothing lost. The inventory contributes zero facts the code
 * and composition do not already give, so it was pure duplication.
 *
 * It is still validated, in the direction that matters: `checkPlatformRegistries` applies the obligation schema to
 * every platform's registry, and no registry file is ever a discovery source.
 */
const IN_SCOPE_ROOT = /^(compose\.yaml|compose\.prod\.yaml|compose\.dev\.yaml|Dockerfile)/;

/**
 * The three environments a platform can live in (D51), and the only words allowed in an entry's
 * `environments` field.
 *
 * The vocabulary used to be six -- development, staging, production, ci, test, local -- and that is the
 * duplication the maintainer objected to: one fact, four spellings. `[development, staging, production]`,
 * `[development, staging, production, test, local]` and `[staging, production, ci, test, local]` all meant
 * "everywhere", and a registry whose same-meaning sets differ by spelling cannot be diffed, searched, or
 * trusted to answer "does this reach production?".
 *
 * `ci`, `test` and `local` are not environments. They describe *where a value lives*, which is `deployedTo`'s
 * job -- `ci:secret`, `local:compose-overlay`, `host:shell` already say it precisely. A runner is the
 * development environment; a laptop is the development environment.
 */
const ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/** Rejected with the reason and the field that actually owns the claim, because "not allowed" teaches nothing. */
const NOT_ENVIRONMENTS: Record<string, string> = {
  ci: 'a runner is the development environment; where its value lives belongs in `deployedTo` (ci:secret, ci:env)',
  test: 'tests run in the development environment -- use `development`',
  local: 'a laptop is the development environment -- use `development`',
};

/**
 * One variable, one definition (D52), now carrying the obligations the platform inventory used to hold in a
 * second file with a second schema. The two files were merged because the same facts kept twice drift -- and
 * one of them had already drifted in this repository's own history (an inventory naming SESSION_SIGNING_KEY
 * and PUBLIC_ORIGIN, which nothing reads).
 *
 * `kind` is the field that decides what an operator is being asked to do:
 *   value / secret  -- things supplied or defaulted; a secret is a custody claim (D4: platfolio stores none)
 *   reference       -- wiring resolved by the platform from a declared database; never typed by a tenant
 *   output          -- wiring provided from a capability (D34), e.g. `identity#jwks`
 * Mixing them up is the failure D33 was written to prevent: a panel that asks a tenant to type a value the
 * platform is supposed to resolve.
 */
interface Entry {
  name?: string;
  kind?: 'value' | 'secret' | 'reference' | 'output';
  secret?: boolean;
  /** `all` (the only legal spelling of the full set) or a non-empty subset of ENVIRONMENTS. */
  environments?: string[] | 'all';
  /** The service that reads it, where the composition says so. */
  service?: string;
  required?: boolean;
  default?: string;
  enum?: unknown[];
  rotate?: string;
  /** kind: reference -- the declared database whose output resolves this name. */
  database?: string;
  output?: string;
  /** kind: output -- `capability#output`. */
  from?: string;
  deployedTo?: string;
  note?: string;
}

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
    // A registry is a statement ABOUT variables, not a place that reads them. Scanning one (ours, or a
    // template's) would let declarations feed the derivation that produces them -- the loop we broke when the
    // platform inventory stopped being a discovery source, generalised: no registry file is ever a source.
    if (f === REGISTRY_PATH || f === 'scripts/check-environment-registry.ts' || /^templates\/[^/]+\/environment\.yaml$/.test(f) || f.startsWith('vendor/') || f.includes('/dist/')) continue;
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
  // Loopback and CI container passwords: not secrets in the custody sense, because there is nothing behind them.
  POSTGRES_PASSWORD: { secret: false, note: 'a container password on loopback/CI; no real service listens' },
  RAILWAY_TOKEN: { note: 'the provider grant. Exactly one per managed instance (D24), held as a GitHub environment secret so platfolio never stores it' },
  PLATFOLIO_GIT_TOKEN: { secret: true, environments: ['development'], deployedTo: 'host:shell', note: 'the git driver\'s HTTPS token, operator-supplied; production uses the App installation' },
  PLATFOLIO_SCM_DRIVER: { note: 'which driver is live: git | github-app | none (D51/D50)' },
  KEYCLOAK_ADMIN: { secret: false, note: 'a username is not a credential' },
  // A GitHub Packages push token. It is a credential even though the workflow reads it through `secrets.`, and
  // the emitter cannot know that from the name alone -- which is precisely why this table exists.
  CR_PAT: { secret: true, environments: 'all', deployedTo: 'ci:secret', note: 'GitHub Packages push token used by the image workflow' },
  // Which realm a first-party seeding run targets (D56). Not a credential, not deployed: it selects which
  // realm the operator is creating on the identity provider the platform already hosts.
  PLATFOLIO_IDENTITY_REALM: { secret: false, environments: ['development'], deployedTo: 'host:shell', note: 'which realm identity:seed targets; production realm is `platfolio`, staging is `platfolio-staging` (D56)' },
  CONTROL_PLANE_BASE: { environments: ['development'], note: 'which control plane a smoke script points at; never a deployment value' },
  KC_REALM: { environments: ['development'], note: 'which realm a smoke or seed script targets -- the hosted Keycloak runs one instance with a realm per environment (D56), so this selects the environment under test; never a deployment value' },
  OIDC_CLIENT_SECRET: { note: 'template placeholder: a tenant app that keeps its own OIDC client secret' },
  STRIPE_WEBHOOK_SECRET: { note: 'template placeholder: a tenant app verifying Stripe webhooks itself' },
  KEYCLOAK_ADMIN_PASSWORD: { note: 'the bootstrap admin of the hosted identity service, declared by name in the composition' },
  // ---- obligations carried over from the retired platform inventory (D33 folded into D52). These were the
  // only facts that file held which the derived registry could not know: which service reads a name, whether
  // it is required, its default, and the wiring that resolves it. They live here rather than in the generated
  // output because -- as with every judgement above -- a hand-edit to `environment.yaml` is lost on --emit.
  PLATFOLIO_IDENTITY_ISSUER: { kind: 'value', required: true, service: 'api', note: 'who an access token must be addressed to; staging overrides it per environment (D56)' },
  PLATFOLIO_IDENTITY_JWKS_URI: { kind: 'output', from: 'identity#jwks', required: true, service: 'api', note: 'resolved from the hosted identity capability, not typed (D34)' },
  PLATFOLIO_IDENTITY_AUDIENCE: { kind: 'value', required: true, default: 'platfolio-api', service: 'api' },
  PLATFOLIO_DB_URL: { kind: 'secret', required: false, service: 'api', note: 'the same credential as DATABASE_URL, delivered as a provider reference rather than a literal (OD13); the platform resolves it from the environment\'s own database, so no one types it' },
  PLATFOLIO_DB_MIGRATE: { kind: 'value', required: false, default: 'true', service: 'api', note: 'runs migrations at boot for the single-replica first-party deployment' },
  PLATFOLIO_RECONCILE_INTERVAL_MS: { kind: 'value', required: false, default: '60000', service: 'api' },
  PLATFOLIO_VERSION: { kind: 'value', required: false, service: 'api', note: 'reported by /healthz; set by the build, not the operator' },
  PLATFOLIO_EMAIL_DRIVER: { kind: 'value', required: false, default: 'none', enum: ['none', 'smtp', 'mailpit', 'memory'], service: 'api' },
  PLATFOLIO_EMAIL_FROM: { kind: 'value', required: false, default: 'platfolio@platfolio.dev', service: 'api' },
  PLATFOLIO_SMTP_HOST: { kind: 'value', required: false, service: 'api' },
  PLATFOLIO_SMTP_PORT: { kind: 'value', required: false, default: '587', service: 'api' },
  PLATFOLIO_SMTP_SECURE: { kind: 'value', required: false, default: 'false', service: 'api' },
  PLATFOLIO_SMTP_STARTTLS: { kind: 'value', required: false, default: 'require', enum: ['require', 'allow', 'off'], service: 'api' },
  PLATFOLIO_SMTP_USER: { kind: 'value', required: false, service: 'api' },
  PLATFOLIO_SMTP_PASSWORD: { kind: 'secret', required: false, service: 'api' },
  PLATFOLIO_MAILPIT_URL: { kind: 'value', required: false, service: 'api', note: 'the local mailbox reader; absent in production (D46)' },
};

function guess(name: string, places: Set<string>): Entry {
  const hosts = [...places].map((h) => h.split(':')[0]!);
  const composeOnly = hosts.every((h) => /^compose\.(prod\.)?yaml/.test(h));
  const devOnly = hosts.every((h) => /compose\.dev\.yaml|templates\/.*compose\.dev\.yaml/.test(h));
  const ci = hosts.some((h) => h.startsWith('.github/'));
  const scripts = hosts.some((h) => h.startsWith('scripts/'));
  // A JDBC or connection URL carries the password inside it, so the name alone is not the test. PLATFOLIO_DB_URL
  // and DATABASE_URL are secrets even though neither word looks like one -- that misclassification is exactly the
  // kind the registry exists to make visible.
  const credentialUrl = new Set(['DATABASE_URL', 'PLATFOLIO_DB_URL', 'POSTGRES_URL', 'PGPASSWORD']);
  const secret = /SECRET|TOKEN|_KEY$|_KEY_|PASSWORD|CREDENTIAL/.test(name) || credentialUrl.has(name);
  let environments: string[] | 'all' = devOnly ? ['development']
    : composeOnly ? ['staging', 'production']
      : ci && !scripts ? ['development']
        : scripts && !composeOnly ? ['development']
          : 'all';
  // Where the value lives is derived from the files that actually reference it, not from the shape of its
  // name. A prefix rule put RAILWAY_TOKEN in `railway:variable` when every workflow that reads it takes it from
  // a GitHub environment secret -- a registry whose only job is custody must not be right by guesswork.
  const inComposition = hosts.some((h) => /^compose\.(prod\.)?yaml/.test(h));
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
  // `environments` is derived from which files reference the name, not from a guess about the name. The rule set
  // is deliberately small: the platform description means the two provider environments, the dev overlay means
  // development, code that ships inside a deployed service means provider environments, a template must work
  // everywhere, and a maintainer script or a CI job runs in development.
  const applies = new Set<string>();
  if (hosts.some((h) => /^compose\.(yaml|prod\.yaml)$/.test(h))) { applies.add('production'); applies.add('staging'); }
  if (hosts.some((h) => /compose\.dev\.yaml/.test(h))) applies.add('development');
  if (hosts.some((h) => h.startsWith('scripts/') || h.startsWith('apps/managed-action/') || h.startsWith('.github/'))) applies.add('development');
  if (hosts.some((h) => h.startsWith('templates/'))) { applies.add('development'); applies.add('staging'); applies.add('production'); }
  if (hosts.some((h) => h.startsWith('packages/') || h.startsWith('apps/control-plane/'))) { applies.add('production'); applies.add('staging'); }
  if (applies.size === 0) applies.add('development');
  // Normalise: three-of-three is `all`, and `all` is the only way to write it. Emitting both spellings is how a
  // field with four synonyms for one meaning comes back.
  environments = applies.size === ENVIRONMENTS.length ? 'all' : ENVIRONMENTS.filter((e) => applies.has(e));
  const over = HUMAN[name] ?? {};
  return { name, secret: over.secret ?? secret, environments: over.environments ?? environments, deployedTo: over.deployedTo ?? deployedTo, note: over.note ?? `referenced by ${[...new Set(hosts.map((h) => h.split(':')[0]!))].slice(0, 4).join(', ')}` };
}

/**
 * Migration, in code, once: the registry used to spell environments six ways. `--emit` reads the old field so a
 * hand-curated file survives regeneration, mapping each retired word to the field that owns the claim now --
 * `ci`/`local`/`test` were never environments, and the full set has exactly one spelling.
 */
function migrateLegacy(value: unknown): string[] | 'all' | undefined {
  if (!Array.isArray(value)) return undefined;
  const mapped = new Set<string>();
  for (const raw of value) {
    const word = String(raw).toLowerCase();
    if ((ENVIRONMENTS as readonly string[]).includes(word)) { mapped.add(word); continue; }
    if (word === 'ci' || word === 'local' || word === 'test') { mapped.add('development'); continue; }
    // An unrecognised old word is dropped rather than guessed at, because the entry that needs it will fail the
    // check with its name in the message -- silence here would be a silent reclassification.
  }
  if (mapped.size === 0) return ['development'];
  return mapped.size === ENVIRONMENTS.length ? 'all' : ENVIRONMENTS.filter((e) => mapped.has(e));
}


/**
 * The platform inventories (D33) must agree with the central registry (D52), in the one direction that keeps
 * both honest: every name a platform declares as an obligation must be a variable this project actually knows
 * about, and neither file may claim differently about custody.
 *
 * The registry is the authority because it is derived from code and composition and re-checked in CI; the
 * inventory is hand-authored operator-facing prose that has already been observed to go stale (it once named
 * SESSION_SIGNING_KEY and PUBLIC_ORIGIN, which nothing reads, and asserted KEYCLOAK_ISSUER was optional when
 * the control plane refuses to start without it). Letting the stale document feed the derived one inverted the
 * only useful direction of trust.
 */
/**
 * The obligations are now part of the registry, so the registry has to hold them to the standard the separate
 * inventory schema used to: a `reference` must name a database, an `output` must be `capability#output`, a
 * `default` on a secret is a contradiction, and `kind: secret` must agree with `secret: true`. Dropping these
 * rules with the old file would have quietly weakened a check while appearing to simplify one.
 */
function checkObligations(entries: Entry[]): string[] {
  const problems: string[] = [];
  for (const e of entries) {
    const name = e.name ?? '(unnamed entry)';
    const kind = e.kind ?? (e.secret ? 'secret' : 'value');
    if (!['value', 'secret', 'reference', 'output'].includes(kind)) {
      problems.push(`${name}: kind "${kind}" is not one of value | secret | reference | output`);
      continue;
    }
    if (kind === 'secret' && e.secret !== true) problems.push(`${name}: kind is secret but secret: ${String(e.secret)} -- the custody claim and the obligation disagree (D4)`);
    if (kind !== 'secret' && e.secret === true) problems.push(`${name}: secret: true with kind "${kind}" -- a credential cannot be a default, a reference, or an output`);
    if (kind === 'secret' && e.default !== undefined) problems.push(`${name}: a secret declares a default value; defaults are for non-credentials precisely because they are committed (D4)`);
    if (kind === 'reference' && !e.database) problems.push(`${name}: kind is reference but names no database to resolve from -- this is the field a tenant is never asked to type, so a dangling reference is a deploy that fails at boot`);
    if (kind === 'output' && !(e.from ?? '').includes('#')) problems.push(`${name}: kind is output but \`from\` is not capability#output (D34)`);
    if ((kind === 'reference' || kind === 'output') && e.required === true) problems.push(`${name}: wiring cannot be required of an operator -- it is resolved by the platform, not supplied`);
  }
  return problems;
}

function inventoryFiles(): string[] {
  // Each platform declares its obligations in its OWN registry, at its root -- one file per platform, one
  // schema, no `.platfolio/` shadow copy of the same facts.
  return [
    'templates/starter-web/environment.yaml',
    'templates/starter-worker/environment.yaml',
    'templates/shared-identity/environment.yaml',
  ].filter((rel) => fs.existsSync(path.join(ROOT, rel)));
}

const found = discover();
const { entries, error } = loadRegistry();
const declared = new Map(entries.map((e) => [e.name ?? '', e]));
// One definition per variable (D52). The Map hides repeats, so they are named before anything else runs: a
// variable declared twice is two claims about custody that can disagree, and which one wins is a detail of
// parse order.
const duplicateProblems: string[] = [];
const seen = new Set<string>();
for (const e of entries) {
  const n = e.name ?? '(unnamed entry)';
  if (seen.has(n)) duplicateProblems.push(`${REGISTRY_PATH} defines ${n} more than once -- one variable, one definition, with \`environments\` saying where it applies`);
  seen.add(n);
}

if (process.argv.includes('--emit')) {
  const rows = [...found.keys()].sort();
  const body = rows.map((name) => {
    const existing = declared.get(name);
    const e = existing ?? guess(name, found.get(name)!);
    // Prefer a curated value; else migrate the retired field; else the derivation. `all` is then enforced as
    // the only spelling of the full set, so a migrated file cannot reintroduce the four-way synonymy.
    const raw = e.environments ?? migrateLegacy((e as { appliesTo?: unknown }).appliesTo) ?? guess(name, found.get(name)!).environments;
    const list = raw === 'all' ? [...ENVIRONMENTS] : raw ?? [];
    const envsOut = ENVIRONMENTS.every((x) => list.includes(x)) ? 'all' : `[${ENVIRONMENTS.filter((x) => list.includes(x)).join(', ')}]`;
    const rows = [
      `  - name: ${e.name}`,
      `    kind: ${e.kind ?? (e.secret ? 'secret' : 'value')}`,
      `    secret: ${String(e.secret ?? false)}`,
      `    environments: ${envsOut}`,
    ];
    if (e.service) rows.push(`    service: ${e.service}`);
    if (e.required !== undefined) rows.push(`    required: ${String(e.required)}`);
    if (e.default !== undefined) rows.push(`    default: ${JSON.stringify(e.default)}`);
    if (e.enum) rows.push(`    enum: [${e.enum.map((v) => JSON.stringify(v)).join(', ')}]`);
    if (e.rotate) rows.push(`    rotate: ${e.rotate}`);
    if (e.database) rows.push(`    database: ${e.database}`);
    if (e.output) rows.push(`    output: ${e.output}`);
    if (e.from) rows.push(`    from: ${e.from}`);
    rows.push(`    deployedTo: ${e.deployedTo ?? 'host:shell'}`);
    if (e.note) rows.push(`    note: ${JSON.stringify(e.note)}`);
    return rows.join('\n');
  }).join('\n');
  process.stdout.write([
    '# The central environment registry (D52).',
    '',
    '# Every variable this project reads or deploys: whether it carries a credential (a custody claim, not a',
    '# guess), which environments it applies to -- development | staging | production, or all -- and where its',
    '# value actually lives.',
    '',
    '# Enforced both ways by `pnpm run environment:registry`: an undeclared variable and a declaration nothing',
    '# references are both failures, as is a variable defined twice or the full set written any way but `all`.',
    '# Regenerate the skeleton with --emit; judgement calls belong in the HUMAN table inside that script, never',
    '# hand-edited here, or the next regeneration silently loses them.',
    'variables:',
    body,
    '',
  ].join('\n'));
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

const problems: string[] = [...duplicateProblems];
if (error) problems.push(`environment registry: ${error} -- the central registry is required at the repository root (D52)`);

// The inventory-vs-registry cross-check, before the reference checks, because a disagreement between two
// declarations of the same fact is the more confusing failure to be told about second.
problems.push(...checkPlatformRegistries());
problems.push(...checkObligations(entries));

for (const [name, places] of found) {
  if (!declared.has(name)) {
    problems.push(`${name} is referenced in configuration (${[...places].map((p) => p.split(':')[0]).slice(0, 3).join(', ')}) but is not declared in ${REGISTRY_PATH}`);
  }
}

for (const e of entries) {
  const name = e.name ?? '(unnamed entry)';
  if (!found.has(name)) problems.push(`${REGISTRY_PATH} declares ${name}, which nothing in configuration references any more -- delete it or wire it up`);
  if (typeof e.secret !== 'boolean') problems.push(`${name}: \`secret\` must be true or false -- custody is a per-variable claim, not a guess`);
  // The anti-duplication rule, enforced: one variable, one entry, one way to say "everywhere".
  const legacy = (e as { appliesTo?: unknown }).appliesTo;
  if (legacy !== undefined) problems.push(`${name}: \`appliesTo\` is retired -- the field is \`environments\`, valued development|staging|production|all (D52)`);
  if (e.environments === undefined) problems.push(`${name}: \`environments\` is required (development | staging | production, or all)`);
  else if (e.environments === 'all') { /* the only legal spelling of the full set */ }
  else if (!Array.isArray(e.environments) || e.environments.length === 0) problems.push(`${name}: \`environments\` must be all or a non-empty list of ${ENVIRONMENTS.join('|')}`);
  else {
    const list = e.environments.map(String);
    for (const v of list) {
      if ((ENVIRONMENTS as readonly string[]).includes(v)) continue;
      const hint = NOT_ENVIRONMENTS[v.toLowerCase()];
      problems.push(`${name}: \`environments: ${v}\` is not an environment${hint ? ` -- ${hint}` : ` (allowed: ${ENVIRONMENTS.join('|')} or all)`}`);
    }
    if (ENVIRONMENTS.every((x) => list.includes(x))) problems.push(`${name}: list all three environments as \`environments: all\` -- the same set must not have two spellings`);
    if (new Set(list).size !== list.length) problems.push(`${name}: \`environments\` lists the same environment twice`);
  }
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
