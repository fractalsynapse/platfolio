/**
 * The real-template acceptance: platfolio parses, validates and plans the repositories people actually fork.
 *
 * This file used to read `templates/` — a bundled copy of three repositories that also existed, separately, on
 * GitHub. The copy was the bug. It drifted for a whole day while every offline gate stayed green (D58 deleted
 * `.platfolio/environment.yaml` from the bundled tree and left it live in all three published repositories,
 * where `applyInventory` merges whatever it finds into the plan), and the machinery built to manage that drift
 * — a publisher and a parity checker — existed only to keep two copies of one fact in step.
 *
 * The maintainer's ruling (2026-11-14) ended the arrangement:
 *
 * > "These template repositories are currently and will ALWAYS be public and open source so there is no need
 * > for credentials to clone them and they are small so there is not a size bottleneck. I still favor removing
 * > the hardcoded templates and using and aligning the REAL templates that people actually use. This tests the
 * > core Platfolio platform and the basic templates, so it is a double win with very little cost."
 *
 * So every byte below arrives through the source-control seam (D22) — `GitScm`, the same `git` driver
 * `apps/control-plane` uses for `POST …/plan/from-repository` via `ctx.scm.readFile` — pointed at a published
 * repository. Two things fall out of that, and both are the point:
 *
 * 1. it tests platfolio's own parsing and planning of a real tenant-shaped platform description, and
 * 2. it tests the three templates everyone forks, on every run, against the content they actually have.
 *
 * **No credentials.** The repositories are public by the ruling above, so this reads them anonymously: the
 * driver is constructed with no token, and a read that only works with a token is a finding, not a
 * configuration. **This belongs in CI**, where the network is a given: it is in `pnpm run verify` precisely
 * because an offline gate cannot tell you the published artifact is wrong, and the published artifact is the
 * thing a tenant forks.
 *
 * **A repository it cannot read is a FAILURE, never a skip.** Every test in this file awaits the same read; if
 * the read throws, `catalog()` calls `assert.fail` with the driver's own words, so the reason lands in the TAP
 * output attached to a named test. That shape is deliberate: this project has met the silently-skipped
 * acceptance test five times in one day, and a green "skipped" is how a check stops existing without anyone
 * deciding to remove it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { GitScm, type RepositoryFile } from '@platfolio/contracts';
import {
  applyInventory, buildPlan, checkRegistryObligations, enabledEnvironments, parseCompose, parseInventory,
  renderProdOverlay, validateInventory, type Manifest, type RegistryRow,
} from '../src/index.ts';
import {
  composeDocuments, readTemplate, TEMPLATE_CATALOG, templateTexts, type RepositorySource,
} from '../src/template-catalog.ts';

// A real digest captured from a real build (of the service this one replaced), standing in for what the
// tenant's release pipeline would pin. The assertions are about the plan's shape, not about which bytes the
// image contains -- so the name moved to the current service while the digest stays a genuine 64-hex value.
const PIN = { image: 'ghcr.io/fractalsynapse/platfolio-control-plane', tag: 'staging', digest: 'sha256:704e2d24f888e2502e27271723cdd8d7493b1a7fd8530a93f25ab916c2e7df95' };

/**
 * The seam, as this file reaches it: the `git` driver, no token, no ambient credential helper.
 *
 * Not `MemoryScm`, and not a fixture: a fixture named for these repositories would be a second copy of the
 * thing, which is what this change deleted (D49 -- test doubles prove a seam is provider-shaped; they do not
 * stand in for the artifact people install).
 */
const scm = new GitScm({});
const readFile = (request: { repo: string; ref: string; path: string }): Promise<RepositoryFile> => scm.readRepositoryFile(request);

/** One read per repository per run: the catalog is small, and a re-read could disagree with the first one. */
type CatalogResult = { sources: Map<string, RepositorySource>; error?: undefined } | { sources: Map<string, RepositorySource>; error: string };
const catalogRead: Promise<CatalogResult> = (async (): Promise<CatalogResult> => {
  const sources = new Map<string, RepositorySource>();
  try {
    for (const entry of TEMPLATE_CATALOG) {
      sources.set(entry.name, await readTemplate(readFile, entry));
    }
    return { sources };
  } catch (error) {
    // Keep whatever did arrive, so a failure names the repository that broke -- and still fail.
    return { sources, error: (error as Error).message.split('\n')[0] ?? String(error) };
  }
})();

/** The published source for one catalog entry, or a FAILURE that says why there is none. */
async function template(name: string): Promise<RepositorySource> {
  const { sources, error } = await catalogRead;
  if (error !== undefined) {
    assert.fail(`cannot read the published template repositories, so this acceptance test checked nothing: ${error}`);
  }
  const found = sources.get(name);
  if (!found) assert.fail(`"${name}" is not in the catalog read (${[...sources.keys()].join(', ') || 'empty'} -- and an empty read is a failure, not a pass)`);
  return found!;
}

/** Parse + validate one published template, exactly as the control plane would after reading it. */
async function planned(name: string, pinned: boolean): Promise<{ manifest: Manifest | undefined; issues: string[]; source: RepositorySource }> {
  const source = await template(name);
  const docs = composeDocuments(source);
  if (pinned) {
    // Services come from the `services:` block only. A looser regex once matched metadata/requires/resources
    // under x-platfolio, and the overlay "pinned" a mapping key instead of an image.
    const doc = parseYaml(source.compose) as { services?: Record<string, unknown> };
    const pins: Record<string, typeof PIN> = {};
    for (const n of Object.keys(doc.services ?? {})) pins[n] = PIN;
    docs.push(renderProdOverlay(source.compose, pins));
  }
  const parsed = parseCompose(docs);
  const entries = source.inventory === undefined ? [] : parseInventory(source.inventory).entries;
  const invIssues = source.inventory === undefined ? [] : parseInventory(source.inventory).issues.map((i) => `${i.code}@${i.path}`);
  const cross = parsed.manifest ? validateInventory(entries, parsed.manifest).map((i) => `${i.code}@${i.path}`) : [];
  return {
    manifest: parsed.manifest ? applyInventory(parsed.manifest, entries) : undefined,
    issues: [...parsed.issues.map((i) => `${i.code}@${i.path}`), ...invIssues, ...cross],
    source,
  };
}

test('the catalog is the three published repositories, read anonymously through the seam', async (t) => {
  const { sources, error } = await catalogRead;
  if (error !== undefined) assert.fail(`reading the published templates failed: ${error}`);
  assert.deepEqual([...sources.keys()], TEMPLATE_CATALOG.map((e) => e.name), 'every catalog entry must arrive, in catalog order');
  assert.deepEqual(
    TEMPLATE_CATALOG.map((e) => e.repo),
    ['fractalsynapse/platfolio-starter-web', 'fractalsynapse/platfolio-starter-worker', 'fractalsynapse/platfolio-shared-identity'],
    'the catalog names the real repositories, not a bundled directory (D49)',
  );
  // Evidence of WHAT this green check actually looked at. Blob SHAs are computed by git on both sides, so a
  // match against a local `git hash-object` is proof rather than opinion (the same property D54 relies on).
  for (const [name, source] of sources) {
    t.diagnostic(`${name}: ${source.repo}@${source.ref} ` + Object.entries(source.blobs).sort(([a], [b]) => a.localeCompare(b)).map(([p, s]) => `${p}=${s.slice(0, 12)}`).join(' '));
  }
  for (const [name, source] of sources) {
    assert.ok(source.compose.length > 0, `${name}: compose.yaml came back empty`);
    assert.ok(source.inventory !== undefined, `${name}: no environment.yaml -- every platform declares its variables in one registry at its root (D58)`);
    assert.ok(Object.keys(source.blobs).length >= 2, `${name}: read at least the description and its registry`);
  }
});

test('starter-web: pinned overlay yields a public service plus provider-resolved database wiring', async () => {
  const { manifest, issues } = await planned('starter-web', true);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert.ok(manifest, 'the template must parse');
  const web = manifest!.spec.services.web!;
  assert.ok(web.domains.length > 0 || web.public, 'the point of this template is that it is reachable');
  assert.deepEqual(web.references, [{ variable: 'DATABASE_URL', database: 'app-db', output: 'DATABASE_URL' }], 'DATABASE_URL is wiring, not a tenant obligation');
  // starter-web's inventory used to declare APP_SESSION_KEY as a required secret, and this line asserted it --
  // freezing a fiction in place. Nothing in the template reads that variable, and because applyInventory merges
  // the inventory into the plan, the entry was a blocking credential obligation on every tenant who forks this.
  // The name is gone from the inventory; the rule it violated is now asserted directly, further down.
  assert.deepEqual(web.secrets.map((s) => s.name).sort(), [], 'the template declares no secret that its own code does not read');
  assert.deepEqual([manifest!.metadata.kind, manifest!.metadata.mode], ['web', 'development'], 'the web template is a developed web platform (D51)');
  // D51: starter-web is a starting point for CHANGE, so staging is enabled in the template itself.
  assert.deepEqual(enabledEnvironments(manifest!), ['production', 'staging']);
});

test('starter-worker: no inbound host, and a volume declared to survive its service', async () => {
  const { manifest } = await planned('starter-worker', true);
  assert.ok(manifest);
  const queue = manifest!.spec.services.queue!;
  assert.equal(queue.public, false, 'a worker that accepts connections is not this kind');
  assert.deepEqual(queue.domains, []);
  const volume = manifest!.spec.resources.volumes.find((v) => v.name === 'job-state');
  assert.ok(volume, 'the retained volume must be declared');
  assert.equal(volume!.retention, 'survive', 'default deletion would destroy the state this exists to keep');
  assert.deepEqual([manifest!.metadata.kind, manifest!.metadata.mode], ['worker', 'development'], 'the worker template is a developed worker platform');
});

test('shared-identity: declares a capability with a secret output, and refuses to float an unpinned image', async () => {
  const unpinned = await planned('shared-identity', false);
  assert.equal(unpinned.manifest, undefined, 'a third-party image with no digest must not silently host');
  assert.ok(JSON.stringify(unpinned.issues).includes('compose-image-unpinned'), JSON.stringify(unpinned.issues));

  const { manifest } = await planned('shared-identity', true);
  assert.ok(manifest, 'with a pin it is a valid platform');
  assert.equal(manifest!.spec.provides?.name, 'identity');
  const outputs = manifest!.spec.provides?.outputs ?? [];
  assert.ok(outputs.some((o) => o.output === 'issuer' && o.kind === 'url'));
  assert.ok(outputs.some((o) => o.output === 'client_secret' && o.kind === 'secret'), 'declared as state; nothing here can hold its value');
  assert.deepEqual([manifest!.metadata.kind, manifest!.metadata.mode], ['web', 'hosted'], 'identity is a web platform that is operated, not developed -- sharing lives in provides');
});

test('all three published templates build a plan the provider accepts, and the worker keeps its volume out of teardown', async () => {
  for (const entry of TEMPLATE_CATALOG) {
    const { manifest, source } = await planned(entry.name, true);
    assert.ok(manifest, `${entry.repo} must parse`);
    const plan = buildPlan(manifest!, { instanceId: `t-${entry.name}`, teamId: 'team-templates', images: {} });
    const env = plan.environments.find((e) => e.name === 'production')!;
    assert.ok(env.services.length > 0, `${entry.name} has services`);
    assert.ok(env.services.every((s) => s.digest.length === 71 && s.image.includes('@') === false), `${entry.name} services carry image + digest separately`);
    const volumes = env.volumes ?? [];
    if (entry.name === 'starter-worker') {
      assert.equal(volumes.length, 1, JSON.stringify(volumes));
      assert.equal(volumes[0]!.retention, 'survive', 'retention must survive from Compose into the plan');
      assert.deepEqual(env.domains, [], 'no inbound hosts on the worker plan');
    }
    if (entry.name === 'starter-web') assert.deepEqual(env.databases, [{ name: 'app-db', kind: 'postgres' }], JSON.stringify(env.databases));
    assert.ok(!JSON.stringify(plan).includes(PIN.digest.slice(7, 20) + 'token'), 'plans carry coordinates, never secrets');
    assert.equal(source.repo, entry.repo, 'the plan really was built from the published repository');
  }
});

/**
 * The rule the APP_SESSION_KEY assertion should have been enforcing, now enforced against the published
 * repositories rather than against a copy that could disagree with them.
 *
 * `environment.yaml` is not documentation: `applyInventory` merges it into the plan, so every entry becomes an
 * obligation on each tenant who forks the template. An entry for a variable nothing reads is therefore not a
 * harmless example -- `kind: secret, required: true` makes the deploy refuse to go healthy over a credential
 * with no consumer, and a `kind: value` one puts a dead setting on the operator's panel.
 *
 * "Referenced" here means: named in the published repository's own source or in either of its Compose files.
 * That is the narrowest honest reading, and it is the one the four invented entries failed.
 */

/**
 * True when the inventory entry's service is a THIRD-PARTY image (an `image:` with no `build:`).
 *
 * This is the boundary the first cut of the rule got wrong. For a service the tenant compiles, every obligation
 * must be visible in that tenant's own source or compose -- which is exactly how four invented names
 * (APP_SESSION_KEY, LOG_LEVEL, QUEUE_DRIVER, STATE_ENCRYPTION_KEY) were caught: nothing read them, so the
 * inventory was imposing a credential obligation for a feature that does not exist. For a service nobody
 * compiles, the consumer is the image's own documented configuration surface: Keycloak reads
 * KC_BOOTSTRAP_ADMIN_PASSWORD and our repository contains no Keycloak source to grep. Demanding a local
 * mention there would not verify anything -- it would only push people to write fake mentions -- so those
 * entries are exempt, and the real evidence for them is upstream documentation, which is what
 * docs/research/keycloak-realm-import-roles-2026-11-14.md exists to hold.
 */
function serviceIsThirdParty(source: RepositorySource, service: string): boolean {
  const doc = parseYaml(source.compose) as { services?: Record<string, Record<string, unknown>> };
  const svc = doc.services?.[service];
  if (!svc) return false;
  return typeof svc.image === 'string' && svc.build === undefined;
}

/** Every inventory name the published repository's own text mentions. The registry itself is NOT text. */
function referencedNames(source: RepositorySource): Set<string> {
  const names = new Set<string>();
  const entryNames = new Set(parseInventory(source.inventory ?? '').entries.map((e) => e.name));
  // The registry is the declaration, not a reference: counting its own rows as "the template mentions it" is
  // how the rule would pass on every name forever. So the scan set is composition plus source only.
  for (const text of templateTexts(source)) {
    for (const name of entryNames) if (text.includes(name)) names.add(name);
  }
  return names;
}

test('no published template declares a variable its own repository does not reference', async () => {
  for (const entry of TEMPLATE_CATALOG) {
    const source = await template(entry.name);
    const entries = parseInventory(source.inventory ?? '').entries;
    // A vacuity guard, because this rule nearly passed on a broken file: an inventory that fails to parse yields
    // zero entries, and a loop over zero entries asserts nothing. The parse issues are surfaced by planned() in
    // the tests above, but this rule must not depend on another test to notice it stopped checking anything.
    assert.ok(entries.length > 0, `${entry.repo}: no inventory entries parsed -- this rule would pass on nothing`);
    const referenced = referencedNames(source);
    for (const entry2 of entries) {
      if (serviceIsThirdParty(source, entry2.service ?? '')) continue;
      assert.ok(referenced.has(entry2.name),
        `${entry.repo}: inventory declares ${entry2.name}, but no source or compose file in that published repository mentions it. applyInventory merges this file into the plan, so the declaration becomes a tenant-facing obligation for a variable that does nothing (D33, D52)`);
    }
  }
});

test('the inventory-vs-plan cross-check still runs on every published template (D33)', async () => {
  for (const entry of TEMPLATE_CATALOG) {
    const { manifest, issues } = await planned(entry.name, true);
    assert.ok(manifest, `${entry.repo} must parse`);
    const codes = issues.filter((i) => i.startsWith('inventory'));
    assert.deepEqual(codes, [], `${entry.name}: ${JSON.stringify(issues)}`);
  }
});

/**
 * Every published template's registry holds together as an obligation document (D33, D52, D58).
 *
 * `pnpm run environment:registry` used to check this over the bundled `templates/` registries on disk. Its scan
 * set is the configuration this repository owns now, so the rule travels with its subject: the same predicate
 * (`checkRegistryObligations`, one spelling, shared with the script) applied to the raw rows of the registry as
 * the published repository actually has it. Rows rather than parsed entries on purpose -- `secret: true` beside
 * `kind: value` is exactly the contradiction the predicate catches, and `parseInventory` drops the registry-only
 * fields before anyone could see it.
 *
 * The zero-row guard is not decoration: a registry that parses to no rows makes every rule below vacuously
 * true, which is how `KC_DB_URL`-shaped fictions survive a green gate.
 */
test('every published template registry is a valid obligation document (D58)', async () => {
  for (const entry of TEMPLATE_CATALOG) {
    const source = await template(entry.name);
    const doc = parseYaml(source.inventory ?? '', { uniqueKeys: true }) as { variables?: unknown[] } | null;
    const rows = (Array.isArray(doc?.variables) ? doc.variables : []) as RegistryRow[];    assert.ok(rows.length > 0, `${entry.repo}: environment.yaml declares no variables -- either the platform has none (delete the file) or its shape changed and this check reads nothing`);
    assert.deepEqual(checkRegistryObligations(rows), [], `${entry.repo}: ${JSON.stringify(checkRegistryObligations(rows))}`);
    // One definition per name: a second row for the same variable is a second custody claim, and which one
    // wins is a detail of parse order (D52).
    const names = rows.map((r) => r.name ?? '(unnamed entry)');
    assert.equal(new Set(names).size, names.length, `${entry.repo}: a variable is declared twice: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
  }
});

/**
 * The dev-overlay pairing rule, moved to where its subject lives.
 *
 * `check-project.ts` used to compare the bundled compose pair on disk. Those files are not here any more, so the
 * rule travels with them -- same assertion, real content, read through the same seam.
 *
 * **The expected shape comes from the published platform, not from the catalog.** An earlier cut of this test
 * looped over entries whose `devOverlayPath` was declared and `continue`d otherwise -- and falsifying it by
 * deleting the field from one entry made the rule check nothing and stay green, which is exactly the silent
 * no-op this file exists to prevent. So `mode` is read from the parsed manifest (D51 is what makes a developed
 * platform need an overlay to change in), the catalog is asserted to agree with it, and the count of pairs
 * actually inspected is asserted at the end. Change any of the three and the named test goes red.
 */
test('a developed template ships a dev overlay that carries every platform service', async () => {
  let pairsInspected = 0;
  for (const entry of TEMPLATE_CATALOG) {
    const source = await template(entry.name);
    const { manifest } = await planned(entry.name, true);
    assert.ok(manifest, `${entry.repo} must parse before its overlay pairing can be judged`);
    const developed = manifest!.metadata.mode === 'development';
    assert.equal(entry.devOverlayPath !== undefined, developed,
      `${entry.name}: mode is "${manifest!.metadata.mode}" but the catalog ${entry.devOverlayPath === undefined ? 'declares no' : 'declares a'} dev overlay -- D51 makes staging (and a place to run it) a consequence of mode, so this rule would silently skip a platform that should be checked`);
    if (!developed) continue;   // hosted is operated, not developed: no overlay is the correct answer, and it is asserted above

    assert.ok(source.devOverlay !== undefined, `${entry.name}: the catalog declares ${entry.devOverlayPath} but the published repository has no such file`);
    pairsInspected++;
    const doc = parseYaml(source.devOverlay!) as { services?: Record<string, Record<string, unknown>>; 'x-platfolio'?: { devOnlyServices?: unknown[] } };
    const declared = ((doc['x-platfolio'] ?? {}).devOnlyServices ?? []).map(String);
    const platform = parseYaml(source.compose) as { services?: Record<string, unknown> };
    for (const name of Object.keys(platform.services ?? {})) {
      assert.ok(doc.services?.[name] !== undefined || declared.includes(name),
        `${entry.name}: compose.dev.yaml has no entry for platform service "${name}" and does not declare it dev-only -- local up would run half the platform and tell you it was whole (D50)`);
    }
    for (const name of Object.keys(doc.services ?? {})) {
      if (platform.services?.[name] === undefined) {
        assert.ok(declared.includes(name),
          `${entry.name}: compose.dev.yaml adds service "${name}" without declaring it in x-platfolio.devOnlyServices -- an undeclared container is a fact about the platform nobody wrote down (D50)`);
      }
    }
  }
  // The vacuity guard, and it is earned: the mutation this file was rewritten to survive was a rule that read
  // nothing and passed. Two of the three published templates are `mode: development`, so two pairs must be here.
  assert.equal(pairsInspected, 2, `expected to inspect a dev overlay for both developed templates and inspected ${String(pairsInspected)} -- 0 means this rule stopped checking anything`);
});
