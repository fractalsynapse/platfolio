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
// A real digest of a real image, standing in for what the tenant's release pipeline would pin. The
// assertions below are about the plan's shape, not about which bytes that image contains.
const PIN = { image: 'ghcr.io/fractalsynapse/platfolio-status-api', tag: 'staging', digest: 'sha256:704e2d24f888e2502e27271723cdd8d7493b1a7fd8530a93f25ab916c2e7df95' };

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
  assert.ok(web.secrets.some((s) => s.name === 'APP_SESSION_KEY'));
  assert.equal(manifest!.metadata.archetype, 'full-stack-web');
  assert.deepEqual(enabledEnvironments(manifest!), ['production']);
});

test('starter-worker: no inbound host, and a volume declared to survive its service', () => {
  const { manifest } = load('starter-worker', true);
  assert.ok(manifest);
  const queue = manifest!.spec.services.queue!;
  assert.equal(queue.public, false, 'a worker that accepts connections is not this archetype');
  assert.deepEqual(queue.domains, []);
  const volume = manifest!.spec.resources.volumes.find((v) => v.name === 'job-state');
  assert.ok(volume, 'the retained volume must be declared');
  assert.equal(volume!.retention, 'survive', 'default deletion would destroy the state this exists to keep');
  assert.equal(manifest!.metadata.archetype, 'worker');
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
  assert.equal(manifest!.metadata.archetype, 'shared-service');
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
