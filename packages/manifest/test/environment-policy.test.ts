import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { enabledEnvironments, parse, renderCompose, renderRailwayIaC, serviceEnvironments, stagingHost, validateManifest } from '../src/index.ts';
import type { Manifest } from '../src/index.ts';

const root = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
function load(p: string): Manifest {
  const r = parse(fs.readFileSync(path.join(root, p), 'utf8'));
  assert.equal(r.issues.length, 0, JSON.stringify(r.issues));
  return r.manifest!;
}
const fullStack = load('samples/full-stack/manifest.yaml');

test('external services default to production-only, maintained ones to every enabled environment', () => {
  const enabled = enabledEnvironments(fullStack);
  assert.deepEqual(enabled, ['production', 'staging']);
  assert.deepEqual(serviceEnvironments(fullStack.spec.services.keycloak!, enabled), ['production']);
  assert.deepEqual(serviceEnvironments(fullStack.spec.services.web!, enabled), ['production', 'staging']);
});

test('staging hosts are derived, never reused', () => {
  assert.equal(stagingHost('app.example.com', 'staging-'), 'staging-app.example.com');
  assert.equal(stagingHost('*.auth.example.com', 'staging-'), '*.staging-auth.example.com');
  const iac = renderRailwayIaC(fullStack).files['.railway/railway.ts']!;
  // E24b: Railway rejects domain registration in the authoring file, so hosts are recorded as a
  // comment (staging derivation included) and never emitted as `domains:`.
  assert.ok(!/domains:/.test(iac), 'the IaC file must not declare domains');
  assert.ok(iac.includes('staging-app.example.com:3000 (staging)'), 'staging derivation is still documented');
  assert.ok(iac.includes('applied via the API, not this file'), 'the file says where domains actually get created');
});

test('a production-only service is declared but attached only where it exists', () => {
  const iac = renderRailwayIaC(fullStack).files['.railway/railway.ts']!;
  assert.ok(/let keycloak: ReturnType<typeof service> | undefined;/.test(iac), 'scoped service needs a guarded declaration');
  assert.ok(/if \(ctx\.isEnvironment\('production'\)\) \{/.test(iac), 'guard must use the documented context helper');
  assert.ok(/keycloak \?\? null/.test(iac) && /\.filter\(\(r\)/.test(iac), 'staging must not receive it');
  assert.ok(iac.includes('auth.example.com:8080 (production)'), 'the host is still recorded');
  assert.ok(!iac.includes('staging-auth.example.com'), 'a production-only service invents no staging host');
});

test('the Compose rendering keeps external services for local development', () => {
  const compose = renderCompose(fullStack).files['docker-compose.yml']!;
  assert.ok(compose.includes('  keycloak:'), 'local dev needs Keycloak present even when staging does not');
});

test('generated IaC with per-environment placement still type-checks against the published SDK', () => {
  const dir = path.join(root, '.tmp-render-policy');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, '.railway'), { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, '.railway/railway.ts'), renderRailwayIaC(fullStack).files['.railway/railway.ts']!);
    execFileSync(process.execPath, ['--import', 'tsx', path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'es2023', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', '--types', 'node', path.join(dir, '.railway/railway.ts')], { stdio: 'pipe', cwd: root });
  } catch (error) {
    const out = `${(error as { stdout?: Buffer }).stdout?.toString() ?? ''}${(error as { stderr?: Buffer }).stderr?.toString() ?? ''}`.trim();
    assert.fail(`scoped IaC did not type-check:\n${out.slice(0, 900)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a service may not name an environment the platform does not enable', () => {
  const bad = structuredClone(fullStack) as Manifest;
  bad.spec.services.web!.environments = ['production', 'staging'];
  bad.spec.environments.staging.enabled = false;
  const { issues } = { issues: validateWith(bad) };
  assert.ok(issues.some((i) => i.code === 'environment-not-enabled'), JSON.stringify(issues));
});

test('a staging-only placement is refused', () => {
  const bad = structuredClone(fullStack) as Manifest;
  bad.spec.services.agent!.environments = ['staging'];
  assert.ok(validateWith(bad).some((i) => i.code === 'staging-only-service'));
});

test('host overlap is reported per environment, and same-service overlap stays allowed', () => {
  // The provider rule: a wildcard and a concrete host may not overlap unless both belong to the
  // same service. Assert both halves, and that the report names the environment it was found in.
  const clash = structuredClone(fullStack) as Manifest;
  clash.spec.services.keycloak!.domains = ['*.svc.example.com'];
  clash.spec.services.keycloak!.environments = ['production'];
  clash.spec.services.api!.domains = ['private.svc.example.com'];
  const found = validateWith(clash).filter((i) => i.code === 'wildcard-conflict');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0]!.message, /in "production"/, found[0]!.message);
  assert.match(found[0]!.message, /keycloak/, 'the message should name the wildcard owner');

  const sameService = structuredClone(fullStack) as Manifest;
  sameService.spec.services.keycloak!.domains = ['*.svc.example.com', 'private.svc.example.com'];
  assert.ok(!validateWith(sameService).some((i) => i.code === 'wildcard-conflict'), JSON.stringify(validateWith(sameService)));

  // A production-only service's hosts must not be duplicated into a staging it does not exist in.
  const iac = renderRailwayIaC(fullStack).files['.railway/railway.ts']!;
  const kc = iac.slice(iac.indexOf("service('keycloak'"), iac.indexOf("service('keycloak'") + 900);
  assert.ok(kc.includes('auth.example.com:8080 (production)'), 'scoped service records its production host');
  assert.ok(!kc.includes('staging-auth'), 'no staging host is invented for a service with no staging placement');
});

/** Validation through the package entry point, so tests exercise the same path the product does. */
function validateWith(m: Manifest) {
  return validateManifest(m);
}
