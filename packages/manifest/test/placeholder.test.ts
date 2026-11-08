import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse, validateManifest } from '../src/index.ts';
import type { Manifest } from '../src/index.ts';

const root = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
const base = parse(fs.readFileSync(path.join(root, 'templates/treedx/manifest.yaml'), 'utf8')).manifest!;

function withEnv(key: string, value: string) {
  const m = structuredClone(base) as Manifest;
  m.spec.services.api!.env[key] = value;
  return validateManifest(m).filter((i) => i.code === 'placeholder-value');
}

test('placeholder-shaped literal values are rejected with a located path', () => {
  for (const bad of ['placeholder-resolved-at-apply-time', 'TODO', 'changeme', 'replace_me', 'xxx', 'fill-me-in', 'your-here', 'TBD-guide']) {
    const issues = withEnv('SOME_CONFIG', bad);
    assert.equal(issues.length, 1, `${bad}: got ${JSON.stringify(issues)}`);
    assert.match(issues[0]!.path, /spec\.services\.api\.env\.SOME_CONFIG$/);
    assert.match(issues[0]!.message, /OD11|placeholder/);
  }
});

test('real values are not rejected — the rule must not produce false positives', () => {
  for (const fine of ['https://auth.example.com/realms/acme', 'info', '120000', 'node dist/server.js', 'Todoist', '/var/lib/data', 'mongodb', 'xxl-large', 'staging-app.example.com']) {
    assert.deepEqual(withEnv('SOME_CONFIG', fine), [], `"${fine}" was flagged`);
  }
});

test('both shipped fixtures resolve cleanly with no placeholder in them', () => {
  for (const p of ['templates/treedx/manifest.yaml', 'templates/arcnexus/manifest.yaml']) {
    const r = parse(fs.readFileSync(path.join(root, p), 'utf8'));
    assert.equal(r.issues.length, 0, `${p}: ${JSON.stringify(r.issues)}`);
    // Check *values*, not raw text: prose in a comment is allowed to mention the word.
    const values = Object.values(r.manifest!.spec.services).flatMap((s) => Object.values(s.env));
    assert.deepEqual(values.filter((v) => /stand-in|not-set/i.test(v)), [], `${p} has an unresolved env value`);
  }
});
