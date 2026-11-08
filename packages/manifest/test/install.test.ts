import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse as yamlParse } from 'yaml';
import { parse as parseManifest, renderInstallPullRequest, WORKFLOW_PATH, WORKFLOW_PERMISSIONS, type Manifest } from '../src/index.ts';

const root = path.resolve(new URL('.', import.meta.url).pathname, '../../..');

/** Load a fixture through the package's own parser, so tests see what the product sees. */
function manifest(p: string): Manifest {
  const r = parseManifest(fs.readFileSync(path.join(root, p), 'utf8'));
  assert.equal(r.issues.length, 0, `${p}: ${JSON.stringify(r.issues)}`);
  return r.manifest!;
}

const OPTS = { actionRepo: 'platfolio/action', actionSha: '0123456789abcdef0123456789abcdef01234567', platfolioUrl: 'https://api.platfolio.example' };

test('the generated workflow is valid YAML with the expected shape', () => {
  const out = renderInstallPullRequest(manifest('templates/arcnexus/manifest.yaml'), OPTS);
  const doc = yamlParse(out.files[WORKFLOW_PATH]!) as Record<string, any>;
  assert.equal(doc.name, 'platfolio managed');
  assert.ok(doc.on.workflow_dispatch.inputs, 'dispatch inputs required');
  for (const key of ['instance_id', 'dispatch_id', 'nonce', 'plan_hash', 'action', 'environment']) {
    assert.ok(doc.on.workflow_dispatch.inputs[key], `missing input ${key}`);
    assert.equal(doc.on.workflow_dispatch.inputs[key].required, true, `${key} must be required`);
  }
  assert.deepEqual(doc.on.push.branches, ['production', 'staging']);
  assert.equal(doc.concurrency['cancel-in-progress'], false, 'an in-flight infra write must not be cancelled');
  assert.equal(doc.jobs.managed.timeout, undefined);
  assert.ok(doc.jobs.managed['timeout-minutes'] >= 5, 'must have a timeout');
});

test('permissions stay exactly the minimal set', () => {
  const out = renderInstallPullRequest(manifest('templates/treedx/manifest.yaml'), OPTS);
  const doc = yamlParse(out.files[WORKFLOW_PATH]!) as Record<string, any>;
  assert.deepEqual(doc.permissions, WORKFLOW_PERMISSIONS);
  assert.deepEqual(Object.keys(WORKFLOW_PERMISSIONS).sort(), ['checks', 'contents', 'id-token', 'statuses']);
  assert.equal(doc.permissions.contents, 'read', 'contents must never be write');
  const granted = JSON.stringify(doc.permissions);
  assert.ok(!granted.includes('secrets'), 'the workflow must not ask for secrets scope');
  assert.ok(!granted.includes('"write","contents":"write"') && !Object.entries(doc.permissions).some(([k, v]) => k === 'contents' && v !== 'read'), 'contents stays read-only');
  // Deleting the workflow file is the documented off-switch, so the workflow must not be the only path.
  assert.ok(!('security-events' in doc.permissions), 'no upload of analysis artifacts beyond what is needed');
});

test('production is gated by an environment, not by a bare job', () => {
  const out = renderInstallPullRequest(manifest('templates/arcnexus/manifest.yaml'), OPTS);
  const text = out.files[WORKFLOW_PATH]!;
  assert.ok(/environment:\s*\n\s+name:/.test(text), 'the job must reference a GitHub environment');
  assert.ok(text.includes('inputs.environment'), 'the environment is chosen per dispatch, so protection rules apply');
});

test('no empty or malformed expression placeholder appears in generated output', () => {
  const out = renderInstallPullRequest(manifest('templates/arcnexus/manifest.yaml'), OPTS);
  for (const [name, content] of Object.entries(out.files)) {
    const empty = content.match(/\$\{\{\s*\}\}/);
    assert.ok(!empty, `${name} contains an empty expression placeholder, which invalidates the whole file`);
    const opens = (content.match(/\$\{\{/g) ?? []).length;
    const closes = (content.match(/\}\}/g) ?? []).length;
    assert.equal(opens, closes, `${name} has unbalanced expression placeholders`);
  }
});

test('the action is pinned by SHA and the doc explains removal', () => {
  const m = manifest('templates/treedx/manifest.yaml');
  const out = renderInstallPullRequest(m, OPTS);
  assert.ok(out.files[WORKFLOW_PATH]!.includes(`@${OPTS.actionSha}`), 'must pin by commit SHA');
  assert.ok(!/@[a-z]+\/v?\d/.test(out.files[WORKFLOW_PATH]!.split('uses: platfolio/action@')[1] ?? ''), 'no floating tag on our own action');
  const doc = out.files['PLATFOLIO.md']!;
  assert.ok(doc.includes('Removing platfolio'), 'the exit path must be documented');
  assert.ok(doc.includes('Delete'), 'removal steps must be concrete');
});

test('no secret value can appear in the install output', () => {
  const out = renderInstallPullRequest(manifest('templates/arcnexus/manifest.yaml'), OPTS);
  const joined = Object.values(out.files).join('\n');
  for (const s of out.secrets) {
    assert.ok(joined.includes(s.name), `secret name ${s.name} should be listed`);
    const assigned = new RegExp(`${s.name}\\s*[:=]\\s*["']?[A-Za-z0-9_+/=-]{12,}`);
    assert.ok(!assigned.test(joined), `value appears for ${s.name}`);
  }
});

test('rendering is deterministic and depends only on the manifest and options', () => {
  const m = manifest('templates/arcnexus/manifest.yaml');
  const a = renderInstallPullRequest(m, OPTS);
  const b = renderInstallPullRequest(m, OPTS);
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort());
  for (const f of Object.keys(a.files)) assert.equal(a.files[f], b.files[f], `${f} differs between runs`);
});

test('an arm64-only platform runs on an arm runner', () => {
  const m = manifest('templates/treedx/manifest.yaml');
  const armOnly = { ...m, metadata: { ...m.metadata, architectures: ['arm64'] as ('amd64' | 'arm64')[] } };
  const out = renderInstallPullRequest(armOnly, OPTS);
  assert.ok(out.files[WORKFLOW_PATH]!.includes('runs-on: ubicloud-arm'), 'single-arch arm must not claim an x86 runner');
  const both = renderInstallPullRequest(m, OPTS);
  assert.ok(both.files[WORKFLOW_PATH]!.includes('runs-on: ubuntu-latest'));
});

test('staging is omitted from triggers when the platform does not enable it', () => {
  const m = manifest('templates/treedx/manifest.yaml');
  const prod = { ...m, spec: { ...m.spec, environments: { ...m.spec.environments, staging: { enabled: false, sleepByDefault: true } } } } as Manifest;
  const doc = yamlParse(renderInstallPullRequest(prod, OPTS).files[WORKFLOW_PATH]!) as Record<string, any>;
  assert.deepEqual(doc.on.push.branches, ['production']);
  assert.deepEqual(doc.on.workflow_dispatch.inputs.environment.options, ['production']);
});
