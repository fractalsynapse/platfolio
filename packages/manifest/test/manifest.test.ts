import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
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
  for (const p of ['packages/manifest/test/fixtures/web-app-manifest.yaml', 'packages/manifest/test/fixtures/full-stack-manifest.yaml']) {
    const { manifest, issues } = parse(read(p));
    assert.equal(issues.length, 0, `${p}: ${JSON.stringify(issues)}`);
    assert.ok(manifest, `${p} should parse`);
  }
});

test('required secrets are names only, sorted and complete', () => {
  const { manifest } = parse(read('packages/manifest/test/fixtures/full-stack-manifest.yaml'));
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
  const { manifest } = parse(read('packages/manifest/test/fixtures/web-app-manifest.yaml'));
  const a = renderAll(manifest!);
  const b = renderAll(manifest!);
  assert.deepEqual(Object.keys(a.files).sort(), ['/.railway/railway.ts', '/docker-compose.yml'].map((s) => s.replace(/^\//, '')));
  for (const f of Object.keys(a.files)) assert.equal(a.files[f], b.files[f], `${f} not deterministic`);
});

test('no secret value ever appears in rendered output', () => {
  for (const p of ['packages/manifest/test/fixtures/web-app-manifest.yaml', 'packages/manifest/test/fixtures/full-stack-manifest.yaml']) {
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
    const { manifest } = parse(read('packages/manifest/test/fixtures/full-stack-manifest.yaml'));
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
    for (const p of ['packages/manifest/test/fixtures/web-app-manifest.yaml', 'packages/manifest/test/fixtures/full-stack-manifest.yaml']) {
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
  const { manifest } = parse(read('packages/manifest/test/fixtures/full-stack-manifest.yaml'));
  const out = renderRailwayIaC(manifest!);
  assert.ok(out.notes.some((n) => /NOT expressible|out of band/i.test(n)), JSON.stringify(out.notes));
  assert.ok((out.files['.railway/railway.ts'] ?? '').includes('NOT expressible in Railway IaC'), 'limits must be recorded in the file');
});

test('kind and mode carry rules, not just names (D51)', () => {
  // Mutating a shipped template rather than hand-writing YAML: the fixture stays valid as the schema evolves,
  // so a failing assertion means the rule broke and not that my fixture drifted.
  const base = parse(read('packages/manifest/test/fixtures/web-app-manifest.yaml')).manifest!;
  const shaped = (over: Partial<typeof base.metadata>): typeof base =>
    ({ ...base, metadata: { ...base.metadata, ...over } });
  const codes = (m: typeof base) => validateManifest(m).map((i) => i.code);

  // A web template's service takes inbound connections, so calling the platform a worker must be refused --
  // this is the whole distinction, and the one rule the old `archetype` labels actually encoded.
  assert.ok(codes(shaped({ kind: 'worker' })).includes('kind-worker-exposed'), JSON.stringify(codes(shaped({ kind: 'worker' }))));

  // Clear every host and the web kind must complain: nothing reachable means nothing a user can reach, and a
  // deployment that reports live while no one can connect is the failure this replaces a silent pass with.
  const quiet = structuredClone(base);
  for (const name of Object.keys(quiet.spec.services)) quiet.spec.services[name] = { ...quiet.spec.services[name]!, domains: [] };
  assert.ok(codes(quiet).includes('kind-web-unreachable'), JSON.stringify(codes(quiet)));

  // Put a host back and the same document passes. Without this the assertion above would only prove the rule
  // fires, not that it stops -- the difference between a check and a complaint.
  quiet.spec.services.api = { ...quiet.spec.services.api!, domains: ['app.example.com'] };
  assert.ok(!codes(quiet).includes('kind-web-unreachable'), JSON.stringify(codes(quiet)));

  // mode drives the environment set, which is what the old labels left implicit. Three cases: the mismatch in
  // each direction, and the matching pair as a control -- without it the two refusals could be a rule that
  // simply always fires.
  const withStaging = (enabled: boolean) => ({
    ...base,
    spec: {
      ...base.spec,
      environments: { ...base.spec.environments, staging: enabled
        ? { enabled: true, branch: 'staging' } as typeof base.spec.environments.staging
        : { enabled: false } as typeof base.spec.environments.staging },
    },
  });
  assert.ok(codes({ ...withStaging(false), metadata: { ...base.metadata, mode: 'development' } }).includes('mode-development-staging'),
    'a developed platform with no staging has nowhere to put a change');
  assert.ok(codes({ ...withStaging(true), metadata: { ...base.metadata, mode: 'hosted' } }).includes('mode-hosted-extra-env'),
    'an operated platform with staging pays for a copy nobody is changing');
  assert.ok(!codes({ ...withStaging(false), metadata: { ...base.metadata, mode: 'hosted' } }).some((c) => c.startsWith('mode-')),
    'and the matching pair must be quiet: otherwise the two refusals above prove nothing');

  // Offering a capability requires reachability: a worker cannot be bound to, so D34 sharing and kind worker
  // are a contradiction rather than a rare combination.
  const offering = structuredClone(shaped({ kind: 'worker' }));
  (offering as { spec: { provides?: unknown } }).spec.provides = { name: 'identity', outputs: [{ output: 'issuer', kind: 'url', description: 'x' }] };
  assert.ok(codes(offering).includes('provides-requires-web'), JSON.stringify(codes(offering)));

  // The migration guard: a document that still declares the retired label is translated and WARNED, never
  // refused by rules it never opted into. Without this, renaming a field would have made every existing
  // manifest invalid on the version bump that introduced the new name.
  const legacy = { ...base, metadata: { ...base.metadata, kind: undefined as unknown as 'web', legacyShape: true } };
  const legacyCodes = codes(legacy).filter((c) => c.startsWith('kind-') || c.startsWith('mode-'));
  assert.deepEqual(legacyCodes, [], `legacy documents must not be refused by the new rules: ${JSON.stringify(legacyCodes)}`);
});
