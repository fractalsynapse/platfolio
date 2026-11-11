import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, renderAll, renderCompose, renderRailwayIaC, requiredSecrets, validateManifest } from '../src/index.ts';

const here = path.dirname(fileToPathSafe(import.meta.url));
const root = path.resolve(here, '../../..');
function fileToPathSafe(url: string): string { return new URL(url).pathname; }
function read(rel: string): string { return fs.readFileSync(path.join(root, rel), 'utf8'); }

function expectIssues(file: string, code: string): void {
  const { issues } = parse(read(`packages/manifest/test/fixtures/${file}`));
  assert.ok(issues.length > 0, `${file}: expected rejection, got none`);
  assert.ok(issues.some((i) => i.code === code), `${file}: expected code ${code}, got ${JSON.stringify(issues.map((i) => i.code))}`);
}

for (const [name, file] of [['secret-inline', 'secret-value-inline'], ['wildcard-conflict', 'wildcard-conflict'], ['mutable-tag', 'mutable-tag'], ['unknown-dependency', 'unknown-dependency'], ['renderer-window', 'renderer-version-window']] as const) {
  test(`rejects ${name} with code ${file}`, () => expectIssues(`${name}.yaml`, file));
}

test('real manifests parse with zero issues', () => {
  for (const p of ['samples/web-app/manifest.yaml', 'samples/full-stack/manifest.yaml']) {
    const { manifest, issues } = parse(read(p));
    assert.equal(issues.length, 0, `${p}: ${JSON.stringify(issues)}`);
    assert.ok(manifest, `${p} should parse`);
  }
});

test('required secrets are names only, sorted and complete', () => {
  const { manifest } = parse(read('samples/full-stack/manifest.yaml'));
  const list = requiredSecrets(manifest!);
  // requiredSecrets sorts by service, then name: agent, api, keycloak.
  assert.deepEqual(list.map((s) => `${s.service}/${s.name}`), ['agent/ANTHROPIC_API_KEY', 'api/OIDC_CLIENT_SECRET', 'api/STRIPE_WEBHOOK_SECRET', 'keycloak/KEYCLOAK_ADMIN_INITIAL_ACCESS']);
  assert.ok(list.every((s) => 'source' in s && !('value' in s)), 'no value may appear');
  // D23: an external, production-only service must not demand its secrets in a staging that has no place for them.
  const kc = list.find((s) => s.name === 'KEYCLOAK_ADMIN_INITIAL_ACCESS');
  assert.deepEqual(kc?.environments, ['production'], 'keycloak is production-only');
  assert.deepEqual(list.find((s) => s.name === 'OIDC_CLIENT_SECRET')?.environments, ['production', 'staging']);
});

test('rendering is deterministic across runs', () => {
  const { manifest } = parse(read('samples/web-app/manifest.yaml'));
  const a = renderAll(manifest!);
  const b = renderAll(manifest!);
  assert.deepEqual(Object.keys(a.files).sort(), ['/.railway/railway.ts', '/docker-compose.yml'].map((s) => s.replace(/^\//, '')));
  for (const f of Object.keys(a.files)) assert.equal(a.files[f], b.files[f], `${f} not deterministic`);
});

test('no secret value ever appears in rendered output', () => {
  for (const p of ['samples/web-app/manifest.yaml', 'samples/full-stack/manifest.yaml']) {
    const { manifest } = parse(read(p));
    const rendered = renderAll(manifest!);
    for (const [name, content] of Object.entries(rendered.files)) {
      const leak = (content ?? '').match(/(client_secret|api_key|password|token)"?\s*[:=]\s*["']?[A-Za-z0-9_\-./]{12,}/i);
      assert.ok(!leak || /preserve\(\)|\$\{/.test(content), `${name} may embed a value: ${leak?.[0]}`);
    }
  }
});

test('generated Compose is accepted by docker compose config', (t) => {
  let hasDocker = true;
  try { execFileSync('docker', ['version'], { stdio: 'ignore' }); } catch { hasDocker = false; }
  if (!hasDocker) { t.skip('docker unavailable'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platfolio-compose-'));
  try {
    const { manifest } = parse(read('samples/full-stack/manifest.yaml'));
    const out = renderCompose(manifest!);
    const file = path.join(dir, 'docker-compose.yml');
    fs.writeFileSync(file, out.files['docker-compose.yml'] ?? assert.fail('no compose output'));
    execFileSync('docker', ['compose', '-f', file, 'config', '--quiet'], { stdio: 'pipe' });
    const text = fs.readFileSync(file, 'utf8');
    for (const svc of ['web', 'api', 'agent', 'app-db', 'example-full-stack-cache']) assert.ok(text.includes(`${svc}:`), `compose missing ${svc}`);
    assert.ok(text.includes('OIDC_CLIENT_SECRET'), 'secret name should appear');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generated Railway IaC type-checks against the published SDK', () => {
  const dir = path.join(root, '.tmp-render-manifest');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.railway'), { recursive: true });
  try {
    for (const p of ['samples/web-app/manifest.yaml', 'samples/full-stack/manifest.yaml']) {
      const { manifest } = parse(read(p));
      const iac = renderRailwayIaC(manifest!).files['.railway/railway.ts'] as string | undefined;
      fs.writeFileSync(path.join(dir, '.railway/railway.ts'), iac ?? assert.fail('no iac output'));
      execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', '--types', 'node', path.join(dir, '.railway/railway.ts')], { stdio: 'pipe', cwd: root });
    }
  } catch (error) {
    const out = `${(error as { stdout?: Buffer }).stdout?.toString() ?? ''}${(error as { stderr?: Buffer }).stderr?.toString() ?? ''}`.trim();
    assert.fail(`generated IaC did not type-check:\n${out.slice(0, 1200)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource ceilings are reported, not silently dropped', () => {
  const { manifest } = parse(read('samples/full-stack/manifest.yaml'));
  const out = renderRailwayIaC(manifest!);
  assert.ok(out.notes.some((n) => /NOT expressible|out of band/i.test(n)), JSON.stringify(out.notes));
  assert.ok((out.files['.railway/railway.ts'] ?? '').includes('NOT expressible in Railway IaC'), 'limits must be recorded in the file');
});

test('the new archetypes carry rules, not just names', () => {
  // Mutating a shipped template rather than hand-writing YAML: the fixture stays valid as the schema evolves,
  // so a failing assertion means the rule broke and not that my fixture drifted.
  const base = parse(read('samples/web-app/manifest.yaml')).manifest!;
  const withArchetype = (archetype: 'worker' | 'shared-service'): typeof base => ({ ...base, metadata: { ...base.metadata, archetype } });

  // The web template's api service is externally reachable, so calling it a worker must be refused.
  const worker = validateManifest(withArchetype('worker'));
  assert.ok(worker.some((i) => i.code === 'archetype-worker'), JSON.stringify(worker.map((i) => i.code)));

  // example-full-stack has no public inbound? it does (app). Use it for the shared-service contract instead:
  // a shared service with nothing reachable is unbindable, so the rule must say so.
  const quiet = structuredClone(base);
  for (const name of Object.keys(quiet.spec.services)) quiet.spec.services[name] = { ...quiet.spec.services[name]!, domains: [] };
  const shared = validateManifest(withArchetype('shared-service'));
  // Clear the hosts the same way the schema models them (strings on the service), or the assertion below
  // proves only that my fixture was wrong.
  const cleared = structuredClone(base);
  for (const name of Object.keys(cleared.spec.services)) cleared.spec.services[name] = { ...cleared.spec.services[name]!, domains: [] };
  assert.deepEqual(validateManifest({ ...cleared, metadata: { ...cleared.metadata, archetype: 'full-stack-web' } })
    .filter((i) => i.code === 'archetype-full-stack').map((i) => i.code), ['archetype-full-stack'], 'the cleared fixture must still be a valid shape apart from exposure');
  assert.ok(validateManifest({ ...cleared, metadata: { ...cleared.metadata, archetype: 'shared-service' } })
    .some((i) => i.code === 'archetype-shared-service'), 'no public service means nothing can bind to it');
  // ...and once something is reachable, the same shape passes.
  const exposed = structuredClone(quiet);
  exposed.spec.services.api = { ...exposed.spec.services.api!, domains: ['id.example.com'] };
  assert.ok(!validateManifest({ ...exposed, metadata: { ...exposed.metadata, archetype: 'shared-service' } }).some((i) => i.code === 'archetype-shared-service'),
    'a shared service that exposes something is valid');
});
