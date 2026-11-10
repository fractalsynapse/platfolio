import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseManifest, type Manifest } from '@platfolio/manifest';
import {
  COMPONENT_NAMES, COMPONENT_REGISTRY, PageSchema, SecretFieldSchema,
  buildSecretsPanel, findValueBearingProps, projectToText, type Page,
} from '../src/index.ts';

const root = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
function manifest(p: string): Manifest {
  const r = parseManifest(fs.readFileSync(path.join(root, p), 'utf8'));
  assert.equal(r.issues.length, 0, JSON.stringify(r.issues));
  return r.manifest!;
}
const fullStack = manifest('templates/example-full-stack/manifest.yaml');

const BOTH_ENVS = { instanceId: 'inst-1', environments: ['production', 'staging'], satisfied: [] };
const SEALED = { sealedVariables: true, custody: 'managed' as const };

function walk(page: Page): { component: string; props: Record<string, unknown> }[] {
  const out: { component: string; props: Record<string, unknown> }[] = [];
  const visit = (n: { component: string; props?: unknown; children?: unknown[] }): void => {
    out.push({ component: n.component, props: (n.props ?? {}) as Record<string, unknown> });
    const kids = n.children as { component: string }[] | undefined;
    if (kids) kids.forEach((k) => visit(k as never));
    if (n.component === 'secret-group') { /* children already walked */ }
  };
  visit(page as never);
  return out;
}

test('managed + sealable renders write-only inputs, one per secret per environment', () => {
  const panel = buildSecretsPanel(fullStack, BOTH_ENVS, SEALED);
  const fields = walk(panel).filter((n) => n.component === 'secret-field');
  const names = fields.map((f) => `${f.props.service}/${f.props.environment}/${f.props.name}`).sort();
  assert.deepEqual(names, [
    'agent/production/ANTHROPIC_API_KEY', 'agent/staging/ANTHROPIC_API_KEY',
    'api/production/OIDC_CLIENT_SECRET', 'api/production/STRIPE_WEBHOOK_SECRET',
    'api/staging/OIDC_CLIENT_SECRET', 'api/staging/STRIPE_WEBHOOK_SECRET',
    'keycloak/production/KEYCLOAK_ADMIN_INITIAL_ACCESS',
  ], JSON.stringify(names));
  assert.ok(fields.every((f) => f.props.mode === 'relay-sealed'));
});

test('a production-only external service gets no staging rows (D23)', () => {
  const panel = buildSecretsPanel(fullStack, BOTH_ENVS, SEALED);
  const groups = walk(panel).filter((n) => n.component === 'secret-group');
  const kc = groups.filter((g) => g.props.service === 'keycloak');
  assert.equal(kc.length, 1, 'keycloak appears once');
  assert.deepEqual(kc[0]!.props.environment, 'production');
  assert.match(String(kc[0]!.props.placement), /exists in: production/, 'placement explains the absence');
});

test('the built page carries no value-bearing property anywhere', () => {
  const panel = buildSecretsPanel(fullStack, BOTH_ENVS, SEALED);
  assert.deepEqual(findValueBearingProps(panel), []);
  const text = projectToText(panel);
  // A key would serialise as "value": — checking the *key* form, not the word, because the word
  // legitimately appears in copy ("Set a new value").
  assert.ok(!/"(value|currentValue|defaultValue|secretValue|plaintext)"\s*:/.test(JSON.stringify(panel)), 'no value-bearing key');
  assert.ok(text.includes('mode=relay-sealed'));
});

test('a secret-field schema refuses a value prop outright', () => {
  const attempt = {
    component: 'secret-field',
    props: {
      id: 'x-1', name: 'OIDC_CLIENT_SECRET', service: 'api', environment: 'production',
      source: 'preserve', mode: 'relay-sealed', label: 'x', help: 'y', satisfied: false,
      submitLabel: 'z', value: 'this-must-not-be-representable',
    },
  };
  const parsed = SecretFieldSchema.safeParse(attempt);
  assert.equal(parsed.success, false);
  const issue = parsed.error.issues.find((i) => i.code === 'unrecognized_keys');
  assert.ok(issue, JSON.stringify(parsed.error.issues));
  assert.ok((issue as { keys: string[] }).keys.includes('value'), 'the report must name the offending key');
});

test('an unsealable provider switches to outbound links and never writes', () => {
  const panel = buildSecretsPanel(fullStack, BOTH_ENVS, { sealedVariables: false, custody: 'managed' });
  const kinds = new Set(walk(panel).map((n) => n.component));
  assert.ok(!kinds.has('secret-field'), 'no input fields when sealing is unavailable');
  assert.ok(kinds.has('link-field'));
  const notice = walk(panel).find((n) => n.component === 'notice');
  assert.match(String(notice?.props.text), /will not write them/);
  assert.equal(notice?.props.tone, 'warning', 'the downgrade is visible');
  const links = walk(panel).filter((n) => n.component === 'link-field');
  assert.ok(links.every((l) => String(l.props.href).startsWith('https://')), 'deep links are absolute');
});

test('strict custody routes secrets to the tenant CI', () => {
  const panel = buildSecretsPanel(fullStack, BOTH_ENVS, { sealedVariables: true, custody: 'strict' });
  const kinds = new Set(walk(panel).map((n) => n.component));
  assert.ok(kinds.has('instructions'));
  assert.ok(!kinds.has('secret-field') && !kinds.has('link-field'));
  const steps = walk(panel).filter((n) => n.component === 'instructions').flatMap((i) => i.props.steps as string[]);
  assert.ok(steps.some((s) => /environment secret/i.test(s)), JSON.stringify(steps));
});

test('a satisfied sealed secret shows the rotation warning and changes its action label', () => {
  const panel = buildSecretsPanel(fullStack, {
    ...BOTH_ENVS, satisfied: [{ service: 'api', environment: 'production', name: 'OIDC_CLIENT_SECRET' }],
  }, SEALED);
  const field = walk(panel).find((n) => n.component === 'secret-field' && n.props.name === 'OIDC_CLIENT_SECRET' && n.props.environment === 'production');
  assert.equal(field?.props.satisfied, true);
  assert.equal(field?.props.submitLabel, 'Set a new value');
  assert.match(String(field?.props.rotationNotice), /cannot be read back|un-sealed/, 'rotation must explain irreversibility');
  const other = walk(panel).find((n) => n.component === 'secret-field' && n.props.name === 'STRIPE_WEBHOOK_SECRET');
  assert.equal(other?.props.submitLabel, 'Deliver secret');
  assert.ok(!('rotationNotice' in (other?.props ?? {})), 'unsatisfied fields carry no rotation noise');
});

test('an environment the platform does not declare is reported, not rendered blindly', () => {
  const panel = buildSecretsPanel(fullStack, { ...BOTH_ENVS, environments: ['production', 'qa'] }, SEALED);
  const notices = walk(panel).filter((n) => n.component === 'notice');
  assert.ok(notices.some((n) => /"qa" is not declared/.test(String(n.props.text))), JSON.stringify(notices.map((n) => n.props.text)));
});

test('rendering is deterministic: the same inputs give the same page, byte for byte', () => {
  const a = buildSecretsPanel(fullStack, BOTH_ENVS, SEALED);
  const b = buildSecretsPanel(fullStack, BOTH_ENVS, SEALED);
  assert.deepEqual(a, b);
  assert.equal(projectToText(a), projectToText(b));
  assert.notEqual(projectToText(a), projectToText(buildSecretsPanel(fullStack, BOTH_ENVS, { sealedVariables: false, custody: 'managed' })));
});

test('the registry covers every declared component name and nothing else', () => {
  assert.deepEqual(Object.keys(COMPONENT_REGISTRY).sort(), [...COMPONENT_NAMES].sort());
  assert.ok(COMPONENT_REGISTRY['secret-field'].includes('write-only'), 'the panel\'s core property is documented in the registry');
});

test('a page with no secrets says so instead of rendering an empty shell', () => {
  const panel = buildSecretsPanel(fullStack, { instanceId: 'inst-2', environments: ['production'], satisfied: [] }, { sealedVariables: true, custody: 'strict' });
  const groups = walk(panel).filter((n) => n.component === 'secret-group');
  assert.ok(groups.length >= 1);
  assert.ok(PageSchema.safeParse(panel).success, 'output validates against its own schema');
});

test('unknown components are refused by the page schema', () => {
  const bad = { component: 'page', props: { id: 'p', title: 't', platform: 'web' }, children: [{ component: 'iframe', props: { src: 'https://evil' } }] };
  const parsed = PageSchema.safeParse(bad);
  assert.equal(parsed.success, false);
});
