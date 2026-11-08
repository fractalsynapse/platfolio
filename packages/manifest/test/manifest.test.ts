import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, renderAll, renderCompose, renderRailwayIaC, requiredSecrets } from '../src/index.ts';

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
  for (const p of ['templates/treedx/manifest.yaml', 'templates/arcnexus/manifest.yaml']) {
    const { manifest, issues } = parse(read(p));
    assert.equal(issues.length, 0, `${p}: ${JSON.stringify(issues)}`);
    assert.ok(manifest, `${p} should parse`);
  }
});

test('required secrets are names only, sorted and complete', () => {
  const { manifest } = parse(read('templates/arcnexus/manifest.yaml'));
  const list = requiredSecrets(manifest!);
  assert.deepEqual(list.map((s) => s.name), ['ANTHROPIC_API_KEY', 'OIDC_CLIENT_SECRET', 'STRIPE_WEBHOOK_SECRET']);
  assert.ok(list.every((s) => 'source' in s && !('value' in s)), 'no value may appear');
});

test('rendering is deterministic across runs', () => {
  const { manifest } = parse(read('templates/treedx/manifest.yaml'));
  const a = renderAll(manifest!);
  const b = renderAll(manifest!);
  assert.deepEqual(Object.keys(a.files).sort(), ['/.railway/railway.ts', '/docker-compose.yml'].map((s) => s.replace(/^\//, '')));
  for (const f of Object.keys(a.files)) assert.equal(a.files[f], b.files[f], `${f} not deterministic`);
});

test('no secret value ever appears in rendered output', () => {
  for (const p of ['templates/treedx/manifest.yaml', 'templates/arcnexus/manifest.yaml']) {
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
    const { manifest } = parse(read('templates/arcnexus/manifest.yaml'));
    const out = renderCompose(manifest!);
    const file = path.join(dir, 'docker-compose.yml');
    fs.writeFileSync(file, out.files['docker-compose.yml'] ?? assert.fail('no compose output'));
    execFileSync('docker', ['compose', '-f', file, 'config', '--quiet'], { stdio: 'pipe' });
    const text = fs.readFileSync(file, 'utf8');
    for (const svc of ['web', 'api', 'agent', 'arcnexus-db', 'arcnexus-cache']) assert.ok(text.includes(`${svc}:`), `compose missing ${svc}`);
    assert.ok(text.includes('OIDC_CLIENT_SECRET'), 'secret name should appear');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generated Railway IaC type-checks against the published SDK', () => {
  const dir = path.join(root, '.tmp-render');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.railway'), { recursive: true });
  try {
    for (const p of ['templates/treedx/manifest.yaml', 'templates/arcnexus/manifest.yaml']) {
      const { manifest } = parse(read(p));
      const iac = renderRailwayIaC(manifest!).files['.railway/railway.ts'] as string | undefined;
      fs.writeFileSync(path.join(dir, '.railway/railway.ts'), iac ?? assert.fail('no iac output'));
      execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', '--types', 'node', path.join(dir, '.railway/railway.ts')], { stdio: 'pipe', cwd: root });
    }
  } catch (error) {
    const out = `${(error as { stdout?: Buffer }).stdout?.toString() ?? ''}${(error as { stderr?: Buffer }).stderr?.toString() ?? ''}`;
    assert.fail(`generated IaC did not type-check:\n${out.slice(0, 1200)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource ceilings are reported, not silently dropped', () => {
  const { manifest } = parse(read('templates/arcnexus/manifest.yaml'));
  const out = renderRailwayIaC(manifest!);
  assert.ok(out.notes.some((n) => /NOT expressible|out of band/i.test(n)), JSON.stringify(out.notes));
  assert.ok((out.files['.railway/railway.ts'] ?? '').includes('NOT expressible in Railway IaC'), 'limits must be recorded in the file');
});
