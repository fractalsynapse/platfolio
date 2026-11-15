import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadSpec, operationsOf, type SpecDocument } from '../src/index.ts';
import { generateApiTypes, identifier, unexpressedKeywords } from '../src/generate-types.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SPEC_REL = 'apps/control-plane/openapi.yaml';
const OUT_REL = 'packages/api-contract/src/generated/types.ts';
const specText = await fs.readFile(path.join(ROOT, SPEC_REL), 'utf8');
const spec = loadSpec(specText);
const committed = await fs.readFile(path.join(ROOT, OUT_REL), 'utf8');

const generate = (doc: SpecDocument = spec, source = specText): string =>
  generateApiTypes(doc, { specPath: SPEC_REL, source });

/**
 * The freshness gate, living in the suite as well as in the script.
 *
 * A generated file is only worth importing if one thing writes it and something proves it still reproduces.
 * `pnpm run api:types:check` is the gate CI runs; these are the same comparisons, so `pnpm run test` cannot pass
 * on a tree where the committed types no longer come from the committed spec.
 */
test('the committed types reproduce from the committed spec, byte for byte', () => {
  const regenerated = generate();
  if (regenerated !== committed) {
    const a = committed.split('\n');
    const b = regenerated.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    assert.fail(
      `${OUT_REL} does not reproduce from ${SPEC_REL}. First difference at line ${String(i + 1)}:\n`
      + `  committed: ${JSON.stringify(a[i])}\n  generated: ${JSON.stringify(b[i])}\n`
      + 'Run `pnpm run api:types` and commit the regenerated file with the spec change it came from.',
    );
  }
  assert.match(committed, /GENERATED FILE -- DO NOT EDIT/);
  const digest = createHash('sha256').update(specText).digest('hex').slice(0, 16);
  // Recomputed from the spec rather than parsed out of the file: a header edited to match a stale input is the
  // exact way a generated file keeps looking current after the thing it describes moved.
  assert.ok(committed.includes(`Input digest: sha256/${digest}`), `the header does not name this spec (expected sha256/${digest})`);
});

test('generation is deterministic in the ways that matter', () => {
  assert.equal(generate(), generate(), 'two runs in one process must agree');
  const reordered = structuredClone(spec) as SpecDocument;
  const schemas = (reordered.components as SpecDocument).schemas as Record<string, unknown>;
  const entries = Object.entries(schemas).reverse();
  for (const [name] of entries) delete schemas[name];
  for (const [name, value] of entries) schemas[name] = value;
  assert.equal(generate(reordered), generate(), 'the output is sorted by name, not by the order keys were written in');
});

test('every component and every operation reaches the generated file', () => {
  const output = generate();
  for (const name of Object.keys((spec.components as SpecDocument).schemas as object)) {
    assert.ok(
      new RegExp(`export (interface|type) ${name}[ =\\n]`).test(output),
      `${name} has no declaration in the generated file`,
    );
  }
  const ops = operationsOf(spec);
  assert.ok(ops.length >= 21, 'the document must still describe the surface');
  const responses = output.slice(output.indexOf('export interface ApiResponses {'));
  for (const op of ops) {
    assert.ok(responses.includes(`  ${op.operationId}: {`), `${op.operationId} declares no responses in the generated file`);
    assert.ok(output.includes(`  /** ${op.method} ${op.path} */`), `${op.operationId} is not identified by method and path`);
    for (const status of Object.keys(op.responses)) {
      if (!/^\d{3}$/.test(status)) continue;
      assert.ok(responses.includes(`'${status}':`), `${op.operationId} is missing status ${status}`);
    }
  }
});

test('what the shapes come out as -- the cases a UI actually reads', () => {
  const output = generate();
  // A `$ref` stays a name, so a client shares the type instead of a structural copy of it.
  assert.match(output, /export interface TeamWithRole \{\n {2}teamId: string;\n {2}name: Slug;/);
  // enum-likes become literal unions, both as a component and inside an object.
  assert.match(output, /export type Slug = string;/);
  assert.match(output, / {2}provider: 'railway' \| 'fake';/);
  assert.match(output, / {2}role: 'owner' \| 'member';/);
  assert.match(output, / {2}state: 'pending' \| 'provisioning' \| 'live' \| 'degraded' \| 'paused' \| 'failed' \| 'deprovisioning' \| 'removed';/);
  // `const: false` becomes the literal type, which is what makes the invariant readable at the call site.
  assert.match(output, / {2}tenantAuthority: false;/);
  // A map with a constrained value range becomes a Record over a union, never an index signature over anything.
  assert.match(output, / {2}detail: Record<string, string \| number \| boolean>;/);
  // An array of objects is `Array<{…}>`; an array of a union is parenthesised or the suffix binds wrong.
  assert.match(output, / {2}environments\?: Array<\{/);
  assert.match(output, / {2}scope: string\[\];/);
  // A 204 is `void`: the spec says there is no body, which is a claim, not a gap.
  assert.match(output, / {2}putSecret: \{\n {4}'204': void;/);
  // The error envelope travels through every refusal the document declares.
  assert.match(output, / {4}'401': Error;/);
  // A query parameter is typed from its declared schema, not stringified by assumption.
  assert.match(output, / {2}listAudit: \{\n {4}limit\?: number;\n {2}\};/);
});

test('nothing in the generated file is a placeholder', () => {
  const output = generate();
  const lines = output.split('\n');
  // A type position holding `any`, `unknown` or a bare `object` is a hole in the contract.
  const placeholders = lines.filter((line) => /:\s*(any|unknown|object|Object);/.test(line) || /<(any|unknown)>/.test(line) || /\bany\b\[\]/.test(line));
  assert.deepEqual(placeholders, []);
  const dangling = lines.filter((line) => /:\s*(\|\s*)*;$/.test(line));
  assert.deepEqual(dangling, []);
  // Every emitted union is either a literal list or a primitive list; nothing widened to `string`.
  assert.ok(!/ {2}state: string;/.test(output), 'the instance state union must not collapse to string');
  assert.ok(!/ {2}role: string;/.test(output), 'the role union must not collapse to string');
});

test('the emitter refuses constructs it cannot represent, naming where they are', () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    [
      'an object whose values are unconstrained',
      { type: 'object', additionalProperties: true },
      /has no honest type here/,
    ],
    ['a node with no type, no properties and no enum', {}, /refusing to emit `unknown`/],
    ['a remote ref', { $ref: 'https://example.com/schema.json' }, /only local component-schema refs/],
    ['an array with no items schema', { type: 'array' }, /no items schema/],
    [
      'an array of unconstrained objects',
      { type: 'array', items: { type: 'object', additionalProperties: true } },
      /has no honest type here/,
    ],
    ['properties declared on a non-object', { type: 'string', properties: { a: { type: 'string' } } }, /declares properties together with type/],
    ['a type list holding a non-string', { type: ['string', 3] }, /non-string member/],
    [
      'a property that is boolean true',
      { type: 'object', properties: { flag: true }, required: ['flag'] },
      /boolean `true` schema/,
    ],
    ['an empty object schema as a property', { type: 'object', properties: { meta: {} }, required: ['meta'] }, /refusing to emit `unknown`/],
  ];
  for (const [name, schema, expected] of cases) {
    const doc = withComponent('Untestable', schema);
    assert.throws(() => generate(doc, `mutated-${name}`), expected, `${name} must be refused, not approximated`);
  }
});

test('a nested refusal names the pointer it came from', () => {
  const doc = withComponent('Untestable', {
    type: 'object',
    properties: { outer: { type: 'array', items: {} } },
    required: ['outer'],
  });
  assert.throws(
    () => generate(doc, 'nested'),
    /#\/components\/schemas\/Untestable\/properties\/outer\/items/,
    'the message must lead a reader to the place in the document, not just say it failed',
  );
});

test('the operation maps carry only what the document declares', () => {
  const output = generate();
  const bodies = output.slice(output.indexOf('export interface ApiRequestBodies {'), output.indexOf('export interface ApiResponses {'));
  const withBodies = operationsOf(spec).filter((op) => {
    const pathItem = (spec.paths as Record<string, SpecDocument>)[op.path];
    const entry = pathItem?.[op.method.toLowerCase()] as SpecDocument;
    return entry?.requestBody !== undefined;
  });
  assert.ok(withBodies.length >= 10, 'the surface must still have request bodies to check');
  for (const op of withBodies) {
    assert.ok(bodies.includes(`  ${op.operationId}:`), `${op.operationId} has a request body in the spec and none in the file`);
  }
  for (const op of operationsOf(spec).filter((o) => !withBodies.some((b) => b.operationId === o.operationId))) {
    assert.ok(!bodies.includes(`  ${op.operationId}:`), `${op.operationId} has no request body in the spec, so it must not appear in the map`);
  }
});

test('a keyword the emitter does not read is reported, not swallowed', () => {
  // The mechanism: a YAML flow scalar containing `, ` and `:` parses as a short value plus a NEW KEY named after
  // the rest of the sentence. Ajv runs non-strict and `checkSpec` walks known keywords, so both pass it and the
  // prose simply stops existing for anyone downstream. `unexpressedKeywords` is the place that notices.
  const doc = withComponent('Typo', { type: 'string', descripton: 'misspelt, and therefore invisible' });
  const found = unexpressedKeywords(doc);
  assert.ok(found.some((line) => line.includes('components.schemas.Typo') && line.includes('descripton')),
    `expected the misspelt keyword to be reported, got ${JSON.stringify(found)}`);
  // A known keyword, a vendor extension and a well-formed description stay silent.
  const clean = withComponent('Fine', { type: 'string', description: 'ok', 'x-platfolio': true, format: 'date-time' });
  assert.deepEqual(unexpressedKeywords(clean).filter((line) => line.includes('schemas.Fine')), []);
});

test('the shipped document loses two descriptions to that quoting bug -- characterised, not hidden', () => {
  const found = unexpressedKeywords(spec);
  // These are defects in `openapi.yaml`, not in the emitter: quote the flow scalar and each sentence arrives in
  // full. When they are quoted this assertion fails by name, and the right response is to delete the two pointers
  // and the truncation assertions below -- the generated comments will then say more than they do today.
  assert.deepEqual(found.map((line) => line.split(':')[0]).sort(), [
    'components.schemas.Invitation.properties.emailReceipt',
    'paths./api/v1/instances.post.requestBody.content.application/json.schema.properties.template',
  ], `the unheard-keyword list moved -- now: ${JSON.stringify(found)}`);
  // The visible consequence, asserted so the bug cannot be half-fixed: half of each description is gone.
  assert.match(generate(), /\/\*\* The transport's receipt \*\//, 'the receipt sentence is truncated to its first clause');
  assert.match(generate(), /\/\*\* Catalog identifier \*\//, 'the template sentence is truncated to its first clause');
});

test('identifier() keeps a name that is not a TypeScript identifier out of the type system', () => {
  assert.equal(identifier('Instance'), 'Instance');
  assert.equal(identifier('x-team'), '_x_team');
  const doc = withComponent('x-team', { type: 'string' });
  const output = generate(doc, 'x-team');
  assert.match(output, /export type _x_team = string;/);
});

function withComponent(name: string, schema: Record<string, unknown>): SpecDocument {
  const doc = structuredClone(spec) as SpecDocument;
  ((doc.components as SpecDocument).schemas as Record<string, unknown>)[name] = schema;
  return doc;
}
