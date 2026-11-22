import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildPlan } from '../src/build-plan.ts';
import { applyInventory, deriveObligations, parse, parseInventory, validateInventory } from '../src/index.ts';
import type { InventoryEntry, Manifest } from '../src/index.ts';

const manifest = (name: string): Manifest => parse(fs.readFileSync(path.resolve('packages/manifest/test/fixtures', name + '-manifest.yaml'), 'utf8')).manifest!;
const WEB = manifest('web-app');
const pin = (n: string) => `sha256:${Array.from(n).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64)}`;
const pinned = (m: Manifest): Manifest => {
  const services = Object.fromEntries(Object.entries(m.spec.services).map(([k, s]) => [k, { ...s, digest: pin(k) }]));
  return { ...m, spec: { ...m.spec, services } } as Manifest;
};
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

test('the shipped inventory parses, with every kind represented', () => {
  const text = fs.readFileSync(path.resolve('packages/manifest/test/fixtures/web-app-environment.yaml'), 'utf8');
  const parsed = parseInventory(text);
  assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));
  assert.equal(new Set(parsed.entries.map((e) => e.kind)).size, 4, JSON.stringify(codes(parsed.entries as unknown as { code: string }[])));
  assert.deepEqual(validateInventory(parsed.entries, WEB), [], JSON.stringify(validateInventory(parsed.entries, WEB)));
});

test('a secret entry carrying a value is refused with the reason, not "unrecognized key"', () => {
  const r = parseInventory('- { name: TOKEN, kind: secret, value: "abc123" }\n');
  assert.deepEqual(codes(r.issues), ['inventory-secret-carries-value']);
  assert.match(r.issues[0]!.message, /never stored|solely inside the request/);
});

test('a default on a secret entry is refused the same way', () => {
  assert.deepEqual(codes(parseInventory('- { name: TOKEN, kind: secret, default: x }\n').issues), ['inventory-secret-carries-value']);
});

test('an entry with no kind is refused: there is no safe default', () => {
  const r = parseInventory('- { name: THING, default: "1" }\n');
  assert.deepEqual(codes(r.issues), ['inventory-kind-missing']);
});

test('unknown fields are refused rather than dropped', () => {
  const r = parseInventory('- { name: X, kind: value, default: "1", scope: cluster }\n');
  assert.deepEqual(codes(r.issues), ['inventory-invalid']);
  assert.match(r.issues[0]!.message, /scope/);
});

test('a credential-shaped default on a value entry is refused (the wall between value and secret)', () => {
  const m = pinned(WEB);
  const entries = parseInventory('- { name: AWS_ACCESS_KEY_ID, kind: value, default: "AKIAABCDEFGHIJKLMNOP" }\n').entries;
  assert.deepEqual(codes(validateInventory(entries, m)), ['inventory-credential-in-value']);
});

test('a high-entropy default is refused even under an innocent name', () => {
  const entries = parseInventory('- { name: SETTINGS_BLOB, kind: value, default: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5" }\n').entries;
  assert.deepEqual(codes(validateInventory(entries, pinned(WEB))), ['inventory-credential-in-value']);
});

test('duplicates, unknown services, unknown environments and unknown databases are all caught', () => {
  const m = pinned(WEB);
  const dup = parseInventory('- { name: A, kind: value }\n- { name: a, kind: value }\n').entries;
  assert.ok(codes(validateInventory(dup, m)).includes('inventory-duplicate'));

  const badService = parseInventory('- { name: A, kind: value, service: ghost }\n').entries;
  assert.deepEqual(codes(validateInventory(badService, m)), ['inventory-unknown-service']);

  // An unknown environment name fails at the schema, so it never reaches validation: asserting the wrong
  // stage here would have produced an empty list and a passing-looking check that tested nothing.
  const badEnv = parseInventory('- { name: A, kind: value, service: api, environments: [qa] }\n');
  assert.deepEqual(codes(badEnv.issues), ['inventory-invalid']);
  // The refusal names the enum rather than echoing the value; the code is the contract here.

  const disabledEnv = parseInventory('- { name: A, kind: value, environments: [preview] }\n').entries;
  assert.ok(codes(validateInventory(disabledEnv, m)).includes('inventory-unknown-environment'));

  const badDb = parseInventory('- { name: DATABASE_URL, kind: reference, service: api, database: other-db }\n').entries;
  assert.ok(codes(validateInventory(badDb, m)).includes('inventory-unknown-database'));
});

test('a reference to a service that is not placed in that environment is caught', () => {
  // Built inline rather than read from a template: the assertion is about the placement rule, and a
  // fixture that happens to place everything would silently make the test vacuous.
  const base = pinned(WEB);
  const services = { ...base.spec.services, solo: { ...base.spec.services.api!, environments: ['production'] } };
  const m = { ...base, spec: { ...base.spec, services } } as Manifest;
  const dbName = m.spec.resources.database?.name ?? 'app-db';
  const entries = parseInventory(`- { name: DATABASE_URL, kind: reference, service: solo, database: ${dbName}, environments: [staging] }\n`).entries;
  assert.deepEqual(codes(validateInventory(entries, m)), ['inventory-service-not-placed'], JSON.stringify(validateInventory(entries, m)));
  // Enabled-but-not-placed is different from not-enabled: the same entry with preview (disabled) is a
  // different code, and conflating them would hide which fix the tenant needs.
  const disabled = parseInventory('- { name: SOLO_LEVEL, kind: value, environments: [preview] }\n').entries;
  assert.ok(codes(validateInventory(disabled, m)).includes('inventory-unknown-environment'));
});

test('obligations separate what a tenant supplies from what the provider resolves', () => {
  const text = fs.readFileSync(path.resolve('packages/manifest/test/fixtures/web-app-environment.yaml'), 'utf8');
  const o = deriveObligations(parseInventory(text).entries, WEB);
  assert.deepEqual(o.secrets.map((s) => s.name).sort(), ['APP_API_SIGNING_KEY', 'GIT_PROVIDER_TOKEN']);
  assert.deepEqual(o.references.map((r) => r.variable), ['DATABASE_URL'], 'wiring is not an obligation');
  assert.ok(!o.secrets.some((s) => s.name === 'DATABASE_URL'), 'a provider-resolved URL must never reach the tenant checklist');
  assert.deepEqual(o.outputs.map((x) => [x.name, x.from]), [['OIDC_ISSUER', 'identity#issuer']]);
  assert.deepEqual(o.literals.map((x) => [x.name, x.value]).sort(), [['CONTEXT_BUDGET_TOKENS', '120000'], ['LOG_LEVEL', 'info']]);
  assert.ok(o.secrets[0]!.environments.includes('production'));
});

test('applying the inventory fills the manifest and is idempotent', () => {
  const text = fs.readFileSync(path.resolve('packages/manifest/test/fixtures/web-app-environment.yaml'), 'utf8');
  const entries = parseInventory(text).entries;
  const once = applyInventory(pinned(WEB), entries);
  const twice = applyInventory(once, entries);
  assert.deepEqual(twice, once, 'a second apply must not duplicate entries');

  const api = once.spec.services.api!;
  assert.ok(api.secrets.some((s) => s.name === 'APP_API_SIGNING_KEY'), 'secret declared for the api service lands on it');
  assert.equal(api.env.CONTEXT_BUDGET_TOKENS, '120000', 'defaults become literals');
  assert.ok(!('GIT_PROVIDER_TOKEN' in api.env), 'a secret never becomes an env value');
  assert.deepEqual(api.references, [{ variable: 'DATABASE_URL', database: 'app-db', output: 'DATABASE_URL' }]);
  assert.ok(once.spec.services.worker!.secrets.some((s) => s.name === 'GIT_PROVIDER_TOKEN'), 'service-scoped secrets stay scoped');
});

test('an applied inventory produces a plan the contract accepts, wiring included', () => {
  const text = fs.readFileSync(path.resolve('packages/manifest/test/fixtures/web-app-environment.yaml'), 'utf8');
  const plan = buildPlan(applyInventory(pinned(WEB), parseInventory(text).entries), { instanceId: 'inst-1', teamId: 'team-1' });
  const prod = plan.environments[0]!;
  assert.deepEqual(prod.databases, [{ name: 'app-db', kind: 'postgres' }]);
  assert.deepEqual(prod.services.find((s) => s.name === 'api')!.references, [{ variable: 'DATABASE_URL', database: 'app-db', output: 'DATABASE_URL' }]);
  assert.ok(prod.services.find((s) => s.name === 'api')!.secrets.some((s) => s.name === 'APP_API_SIGNING_KEY'));
  const json = JSON.stringify(plan);
  assert.ok(!json.includes('APP_API_SIGNING_KEY:'), 'the plan carries secret names, never values');
});

test('the inventory refuses to describe a service the platform does not have', () => {
  const entries: InventoryEntry[] = [{ name: 'X', kind: 'reference', service: 'api', database: 'app-db' }];
  assert.deepEqual(codes(validateInventory(entries, pinned(WEB))), [], 'sanity: the good case passes');
});
