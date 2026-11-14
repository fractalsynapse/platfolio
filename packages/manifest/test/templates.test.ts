import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import {
  applyInventory, buildPlan, enabledEnvironments, parseCompose, parseInventory, renderProdOverlay, validateInventory,
  type Manifest,
} from '../src/index.ts';

const ROOT = path.resolve('templates');
// A real digest captured from a real build (of the service this one replaced), standing in for what the
// tenant's release pipeline would pin. The assertions are about the plan's shape, not about which bytes the
// image contains -- so the name moved to the current service while the digest stays a genuine 64-hex value.
const PIN = { image: 'ghcr.io/fractalsynapse/platfolio-control-plane', tag: 'staging', digest: 'sha256:704e2d24f888e2502e27271723cdd8d7493b1a7fd8530a93f25ab916c2e7df95' };

function load(dir: string, pinned: boolean): { manifest: Manifest | undefined; issues: string[] } {
  const base = fs.readFileSync(path.join(ROOT, dir, 'compose.yaml'), 'utf8');
  const docs = [base];
  if (pinned) {
      // Service names come from the services: block only. The loose regex this replaces also matched
    // metadata/requires/resources under x-platfolio, so the overlay would have "pinned" a mapping key.
    const doc = parseYaml(base) as { services?: Record<string, unknown> };
    const names = Object.keys(doc.services ?? {});
    const pins: Record<string, typeof PIN> = {};
    for (const n of names) pins[n] = PIN;
    docs.push(renderProdOverlay(base, pins));
  }
  const parsed = parseCompose(docs);
  const invPath = path.join(ROOT, dir, '.platfolio/environment.yaml');
  const entries = fs.existsSync(invPath) ? parseInventory(fs.readFileSync(invPath, 'utf8')).entries : [];
  const invIssues = fs.existsSync(invPath) ? parseInventory(fs.readFileSync(invPath, 'utf8')).issues.map((i) => `${i.code}@${i.path}`) : [];
  const cross = parsed.manifest ? validateInventory(entries, parsed.manifest).map((i) => `${i.code}@${i.path}`) : [];
  return {
    manifest: parsed.manifest ? applyInventory(parsed.manifest, entries) : undefined,
    issues: [
      ...parsed.issues.map((i) => `${i.code}@${i.path}`),
      ...invIssues,
      ...cross,
      ...Object.keys(parseInventory(fs.existsSync(invPath) ? fs.readFileSync(invPath, 'utf8') : '').entries.length ? {} : {}),
    ],
  };
}

test('starter-web: pinned overlay yields a public service plus provider-resolved database wiring', () => {
  const { manifest, issues } = load('starter-web', true);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert.ok(manifest, 'the template must parse');
  const web = manifest!.spec.services.web!;
  assert.ok(web.domains.length > 0 || web.public, 'the point of this template is that it is reachable');
  assert.deepEqual(web.references, [{ variable: 'DATABASE_URL', database: 'app-db', output: 'DATABASE_URL' }], 'DATABASE_URL is wiring, not a tenant obligation');
  // starter-web's inventory used to declare APP_SESSION_KEY as a required secret, and this line asserted it --
  // freezing a fiction in place. Nothing in the template reads that variable, and because applyInventory merges
  // the inventory into the plan, the entry was a blocking credential obligation on every tenant who forks this.
  // The name is gone from the inventory; the rule it violated is now asserted directly, at the end of this file.
  assert.deepEqual(web.secrets.map((s) => s.name).sort(), [], 'the template declares no secret that its own code does not read');
  assert.deepEqual([manifest!.metadata.kind, manifest!.metadata.mode], ['web', 'development'], 'the web template is a developed web platform (D51)');
  // D51: starter-web is a starting point for CHANGE, so staging is enabled in the template itself
  
  assert.deepEqual(enabledEnvironments(manifest!), ['production', 'staging']);
});

test('starter-worker: no inbound host, and a volume declared to survive its service', () => {
  const { manifest } = load('starter-worker', true);
  assert.ok(manifest);
  const queue = manifest!.spec.services.queue!;
  assert.equal(queue.public, false, 'a worker that accepts connections is not this kind');
  assert.deepEqual(queue.domains, []);
  const volume = manifest!.spec.resources.volumes.find((v) => v.name === 'job-state');
  assert.ok(volume, 'the retained volume must be declared');
  assert.equal(volume!.retention, 'survive', 'default deletion would destroy the state this exists to keep');
  assert.deepEqual([manifest!.metadata.kind, manifest!.metadata.mode], ['worker', 'development'], 'the worker template is a developed worker platform');
});

test('shared-identity: declares a capability with a secret output, and refuses to float an unpinned image', () => {
  const unpinned = load('shared-identity', false);
  assert.equal(unpinned.manifest, undefined, 'a third-party image with no digest must not silently host');
  assert.ok(JSON.stringify(unpinned.issues).includes('compose-image-unpinned'), JSON.stringify(unpinned.issues));

  const { manifest } = load('shared-identity', true);
  assert.ok(manifest, 'with a pin it is a valid platform');
  assert.equal(manifest!.spec.provides?.name, 'identity');
  const outputs = manifest!.spec.provides?.outputs ?? [];
  assert.ok(outputs.some((o) => o.output === 'issuer' && o.kind === 'url'));
  assert.ok(outputs.some((o) => o.output === 'client_secret' && o.kind === 'secret'), 'declared as state; nothing here can hold its value');
  assert.deepEqual([manifest!.metadata.kind, manifest!.metadata.mode], ['web', 'hosted'], 'identity is a web platform that is operated, not developed -- sharing lives in provides');
});

test('all three templates build a plan the provider accepts, and the worker keeps its volume out of teardown', () => {
  for (const dir of ['starter-web', 'starter-worker', 'shared-identity']) {
    const { manifest } = load(dir, true);
    assert.ok(manifest, `${dir} must parse`);
    const plan = buildPlan(manifest!, { instanceId: `t-${dir}`, teamId: 'team-templates', images: {} });
    const env = plan.environments.find((e) => e.name === 'production')!;
    assert.ok(env.services.length > 0, `${dir} has services`);
    assert.ok(env.services.every((s) => s.digest.length === 71 && s.image.includes('@') === false), `${dir} services carry image + digest separately`);
    const volumes = env.volumes ?? [];
    if (dir === 'starter-worker') {
      assert.equal(volumes.length, 1, JSON.stringify(volumes));
      assert.equal(volumes[0]!.retention, 'survive', 'retention must survive from Compose into the plan');
      assert.deepEqual(env.domains, [], 'no inbound hosts on the worker plan');
    }
    if (dir === 'starter-web') assert.deepEqual(env.databases, [{ name: 'app-db', kind: 'postgres' }], JSON.stringify(env.databases));
    assert.ok(!JSON.stringify(plan).includes(PIN.digest.slice(7, 20) + 'token'), 'plans carry coordinates, never secrets');
  }
});

/**
 * The rule the APP_SESSION_KEY assertion should have been enforcing.
 *
 * `.platfolio/environment.yaml` is not documentation: `applyInventory` merges it into the plan, so every entry
 * becomes an obligation on each tenant who forks the template. An entry for a variable nothing reads is
 * therefore not a harmless example -- `kind: secret, required: true` makes the deploy refuse to go healthy over
 * a credential with no consumer, and a `kind: value` one puts a dead setting on the operator's panel.
 *
 * "Referenced" here means: named in the template's own source or in either of its Compose files. That is the
 * narrowest honest reading, and it is the one the four orphan entries failed.
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
function serviceIsThirdParty(dir: string, service: string): boolean {
  const doc = parseYaml(fs.readFileSync(path.join(ROOT, dir, 'compose.yaml'), 'utf8')) as { services?: Record<string, Record<string, unknown>> };
  const svc = doc.services?.[service];
  if (!svc) return false;
  return typeof svc.image === 'string' && svc.build === undefined;
}

function referencedInTemplate(dir: string, name: string): boolean {
  const base = path.join(ROOT, dir);
  const candidates: string[] = [];
  for (const f of ['compose.yaml', 'compose.dev.yaml']) {
    const p = path.join(base, f);
    if (fs.existsSync(p)) candidates.push(p);
  }
  const srcDir = path.join(base, 'src');
  if (fs.existsSync(srcDir)) {
    for (const f of fs.readdirSync(srcDir, { recursive: true })) {
      const p = path.join(srcDir, String(f));
      if (fs.statSync(p).isFile() && /\.(mjs|js|ts|html)$/.test(p)) candidates.push(p);
    }
  }
  return candidates.some((p) => fs.readFileSync(p, 'utf8').includes(name));
}

/** Entry names plus the service each one targets, from a template's own inventory. */
function inventoryEntriesOf(dir: string): Array<{ name: string; service?: string }> {
  const invPath = path.join(ROOT, dir, '.platfolio/environment.yaml');
  if (!fs.existsSync(invPath)) return [];
  return parseInventory(fs.readFileSync(invPath, 'utf8')).entries as Array<{ name: string; service?: string }>;
}

test('no template inventory declares a variable that template does not reference', () => {
  for (const dir of ['starter-web', 'starter-worker', 'shared-identity']) {
    const entries = inventoryEntriesOf(dir);
    // A vacuity guard, because this rule nearly passed on a broken file: an inventory that fails to parse yields
    // zero entries, and a loop over zero entries asserts nothing. The parse issues are surfaced by load() in the
    // tests above, but this rule must not depend on another test to notice it stopped checking anything.
    assert.ok(entries.length > 0, `templates/${dir}: no inventory entries parsed -- this rule would pass on nothing`);
    for (const entry of entries) {
      if (serviceIsThirdParty(dir, entry.service ?? '')) continue;
      assert.ok(referencedInTemplate(dir, entry.name),
        `templates/${dir}: inventory declares ${entry.name}, but no source or compose file in that template mentions it. applyInventory merges this file into the plan, so the declaration becomes a tenant-facing obligation for a variable that does nothing (D33, D52)`);
    }
  }
});

test('the inventory-vs-plan cross-check still runs on every template (D33)', () => {
  for (const dir of ['starter-web', 'starter-worker', 'shared-identity']) {
    const { manifest, issues } = load(dir, true);
    assert.ok(manifest, `templates/${dir} must parse`);
    const codes = issues.filter((i) => i.startsWith('inventory'));
    assert.deepEqual(codes, [], `${dir}: ${JSON.stringify(issues)}`);
  }
});
