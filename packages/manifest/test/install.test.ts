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

const OPTS = { actionRepo: 'platfolio/action', actionSha: '0123456789abcdef0123456789abcdef01234567', platfolioUrl: 'https://api.platfolio.example', workspaceId: 'ws-123' };

test('the generated workflow is valid YAML with the expected shape', () => {
  const out = renderInstallPullRequest(manifest('packages/manifest/test/fixtures/full-stack-manifest.yaml'), OPTS);
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
  const out = renderInstallPullRequest(manifest('packages/manifest/test/fixtures/web-app-manifest.yaml'), OPTS);
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
  const out = renderInstallPullRequest(manifest('packages/manifest/test/fixtures/full-stack-manifest.yaml'), OPTS);
  const text = out.files[WORKFLOW_PATH]!;
  assert.ok(/environment:\s*\n\s+name:/.test(text), 'the job must reference a GitHub environment');
  assert.ok(text.includes('inputs.environment'), 'the environment is chosen per dispatch, so protection rules apply');
});

test('no empty or malformed expression placeholder appears in generated output', () => {
  const out = renderInstallPullRequest(manifest('packages/manifest/test/fixtures/full-stack-manifest.yaml'), OPTS);
  for (const [name, content] of Object.entries(out.files)) {
    const empty = content.match(/\$\{\{\s*\}\}/);
    assert.ok(!empty, `${name} contains an empty expression placeholder, which invalidates the whole file`);
    const opens = (content.match(/\$\{\{/g) ?? []).length;
    const closes = (content.match(/\}\}/g) ?? []).length;
    assert.equal(opens, closes, `${name} has unbalanced expression placeholders`);
  }
});

test('the action is pinned by SHA and the doc explains removal', () => {
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const out = renderInstallPullRequest(m, OPTS);
  assert.ok(out.files[WORKFLOW_PATH]!.includes(`@${OPTS.actionSha}`), 'must pin by commit SHA');
  assert.ok(!/@[a-z]+\/v?\d/.test(out.files[WORKFLOW_PATH]!.split('uses: platfolio/action@')[1] ?? ''), 'no floating tag on our own action');
  const doc = out.files['PLATFOLIO.md']!;
  assert.ok(doc.includes('Removing platfolio'), 'the exit path must be documented');
  assert.ok(doc.includes('Delete'), 'removal steps must be concrete');
});

test('no secret value can appear in the install output', () => {
  const out = renderInstallPullRequest(manifest('packages/manifest/test/fixtures/full-stack-manifest.yaml'), OPTS);
  const joined = Object.values(out.files).join('\n');
  for (const s of out.secrets) {
    assert.ok(joined.includes(s.name), `secret name ${s.name} should be listed`);
    const assigned = new RegExp(`${s.name}\\s*[:=]\\s*["']?[A-Za-z0-9_+/=-]{12,}`);
    assert.ok(!assigned.test(joined), `value appears for ${s.name}`);
  }
});

test('rendering is deterministic and depends only on the manifest and options', () => {
  const m = manifest('packages/manifest/test/fixtures/full-stack-manifest.yaml');
  const a = renderInstallPullRequest(m, OPTS);
  const b = renderInstallPullRequest(m, OPTS);
  assert.deepEqual(Object.keys(a.files).sort(), Object.keys(b.files).sort());
  for (const f of Object.keys(a.files)) assert.equal(a.files[f], b.files[f], `${f} differs between runs`);
});

test('an arm64-only platform runs on an arm runner', () => {
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const armOnly = { ...m, metadata: { ...m.metadata, architectures: ['arm64'] as ('amd64' | 'arm64')[] } };
  const out = renderInstallPullRequest(armOnly, OPTS);
  assert.ok(out.files[WORKFLOW_PATH]!.includes('runs-on: ubicloud-arm'), 'single-arch arm must not claim an x86 runner');
  const both = renderInstallPullRequest(m, OPTS);
  assert.ok(both.files[WORKFLOW_PATH]!.includes('runs-on: ubuntu-latest'));
});

test('staging is omitted from triggers when the platform does not enable it', () => {
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const prod = { ...m, spec: { ...m.spec, environments: { ...m.spec.environments, staging: { enabled: false, sleepByDefault: true } } } } as Manifest;
  const doc = yamlParse(renderInstallPullRequest(prod, OPTS).files[WORKFLOW_PATH]!) as Record<string, any>;
  assert.deepEqual(doc.on.push.branches, ['production']);
  assert.deepEqual(doc.on.workflow_dispatch.inputs.environment.options, ['production']);
});

test('every steps.<id> reference resolves to a step that declares that id', () => {
  // Found by reading my own generated workflow rather than trusting it: the report step referenced
  // `steps.apply.outcome` while the apply step had no `id`, so the outcome would have been silently empty --
  // valid YAML, correct syntax, meaningless data. An empty `${{ }}` gate (#9) could not catch that, so the
  // rule is general: collect the ids that exist, then check every reference against them.
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const workflow = renderInstallPullRequest(m, OPTS).files[WORKFLOW_PATH]!;
  const doc = yamlParse(workflow) as { jobs?: Record<string, { steps?: { id?: string }[] }> };
  const declared = new Set<string>();
  for (const job of Object.values(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) if (typeof step.id === 'string') declared.add(step.id);
  }
  const referenced = [...workflow.matchAll(/steps\.([a-zA-Z0-9_-]+)\./g)].map((x) => x[1] as string);
  assert.ok(referenced.length > 0, 'the fixture must exercise the reference path at all');
  for (const ref of referenced) assert.ok(declared.has(ref), `steps.${ref} is referenced but no step declares that id`);
});

test('the tenant-facing document never names a file the install PR does not emit', () => {
  // The prose used to say the workflow applies `.railway/railway.ts`, which the renderer never produced: a
  // tenant following those words would look for a file that does not exist. Desired state lives with
  // platfolio and is fetched per run, so the document says that instead.
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const out = renderInstallPullRequest(m, OPTS);
  assert.deepEqual(Object.keys(out.files).sort(), ['.github/workflows/platfolio-managed.yml', 'PLATFOLIO.md']);
  assert.ok(!out.files['PLATFOLIO.md']!.includes('.railway/railway.ts'), 'no claim about a file that is not shipped');
  assert.match(out.files['PLATFOLIO.md']!, /fetched per run and checked against a hash/);
});

test('D36: the removal steps say plainly that platfolio never deletes the repository', () => {
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const doc = renderInstallPullRequest(m, OPTS).files['PLATFOLIO.md']!;
  assert.match(doc, /Your repository is never deleted/);
  assert.ok(!/delete (your|the) repo/i.test(doc), 'and no step asks the tenant to expect deletion');
});

test('the outcome reaches platfolio through a step output, not a log line', () => {
  // D30 law 2: logs are never read. The report step is convenience for a human staring at a run; the machine
  // path is the action's own `outcome` output, which is why the id above matters rather than being cosmetic.
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const workflow = renderInstallPullRequest(m, OPTS).files[WORKFLOW_PATH]!;
  assert.match(workflow, /- name: Apply desired state[\s\S]{0,80}id: apply/);
  assert.ok(workflow.includes(`uses: ${OPTS.actionRepo}/${'.github/actions/platfolio-managed'}@${OPTS.actionSha}`), 'the workflow must reference the action by path, since that is where it lives');
  assert.match(workflow, /uses: [^@]+\/.github\/actions\/[^@]+@[0-9a-f]{40}/, 'path-qualified and SHA-pinned: a tag is not a trust anchor');
  assert.match(workflow, /steps\.apply\.outcome/);
});

test('the apply step is given its credentials, by name, and its configuration in the clear', () => {
  // Measured failure: without RAILWAY_TOKEN the action has a plan, an identity, a trigger, and no way to act;
  // without RAILWAY_WORKSPACE_ID it authenticates and then asks Railway for projects(workspaceId: "") --
  // Not Authorized, indistinguishable from a bad credential (#161).
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const workflow = renderInstallPullRequest(m, OPTS).files[WORKFLOW_PATH]!;
  const doc = yamlParse(workflow) as { jobs: Record<string, { steps?: { id?: string; env?: Record<string, string> }[] }> };
  const apply = doc.jobs.managed!.steps!.find((s) => s.id === 'apply');
  assert.ok(apply, 'the apply step exists');
  assert.deepEqual(Object.keys(apply!.env ?? {}).sort(), ['PLATFOLIO_DISPATCH_TOKEN', 'RAILWAY_TOKEN', 'RAILWAY_WORKSPACE_ID']);
  assert.ok(workflow.includes('instance_id'), 'and the identity inputs are still passed');
});

test('credentials are secret expressions; provider configuration is a literal, and only that key may be', () => {
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const doc = yamlParse(renderInstallPullRequest(m, OPTS).files[WORKFLOW_PATH]!) as { jobs: Record<string, { steps?: { id?: string; env?: Record<string, string> }[] }> };
  const env = doc.jobs.managed!.steps!.find((s) => s.id === 'apply')!.env!;
  // Two kinds of value with different rules. A blanket "everything must be a secret expression" was written
  // before any legitimate literal existed and would have blocked the #161 fix outright.
  const SECRET_KEYS = ['RAILWAY_TOKEN', 'PLATFOLIO_DISPATCH_TOKEN'];
  for (const name of SECRET_KEYS) {
    const value = env[name] ?? '';
    assert.ok(value.startsWith('${' + '{ secrets.'), `${name} must resolve from a secret, got ${value}`);
    assert.ok(value.endsWith(' }' + '}'), `${name} must close its expression, got ${value}`);
  }
  const literals = Object.entries(env).filter(([name]) => !SECRET_KEYS.includes(name));
  assert.deepEqual(literals.map(([name]) => name).sort(), ['RAILWAY_WORKSPACE_ID'], 'only the named configuration may be literal');
  for (const [name, value] of literals) {
    assert.ok(!value.includes('secrets.'), `${name} is configuration, not a secret`);
    assert.ok(value.trim().length > 3 && !/\s/.test(value.trim()), `${name} looks like a placeholder: ${value}`);
  }
});

test('the tenant document names every secret the workflow resolves', () => {
  const m = manifest('packages/manifest/test/fixtures/web-app-manifest.yaml');
  const doc = renderInstallPullRequest(m, OPTS).files['PLATFOLIO.md']!;
  assert.ok(doc.includes('RAILWAY_TOKEN'), 'the provider credential must appear where the tenant reads instructions');
  assert.ok(doc.includes('PLATFOLIO_DISPATCH_TOKEN'), 'so must the control-plane credential');
});
