import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadSpec, operationsOf, type SpecDocument } from '../src/index.ts';
import { ENDPOINTS } from '../src/generated/types.ts';
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
  // BOUNDED at both ends, and the bound is the point: `ENDPOINTS` now follows `ApiResponses` and repeats every
  // operation id on a line that starts the same way (`  listInstances: { method: …`). A slice from the responses
  // header to the *end of the file* would therefore read a route entry as a response entry, and a missing
  // response would pass -- a gate made vacuous by the arrival of a good neighbour. That is a finding, not a
  // side effect, so the slice stops where the route table starts and the stop is asserted rather than assumed.
  const from = output.indexOf('export interface ApiResponses {');
  const to = output.indexOf('export const ENDPOINTS = {');
  assert.ok(from >= 0, 'the generated file has no ApiResponses map to read');
  assert.ok(to > from, 'ENDPOINTS is not emitted after ApiResponses, so the bounded slice below proves nothing');
  const responses = output.slice(from, to);
  for (const op of ops) {
    assert.ok(responses.includes(`  ${op.operationId}: {`), `${op.operationId} declares no responses in the generated file`);
    assert.ok(output.includes(`  /** ${op.method} ${op.path} */`), `${op.operationId} is not identified by method and path`);
    for (const status of Object.keys(op.responses)) {
      if (!/^\d{3}$/.test(status)) continue;
      assert.ok(responses.includes(`'${status}':`), `${op.operationId} is missing status ${status}`);
    }
  }
});

/* ------------------------------------------------------------------ the route table (#258) */

/** The text of the `ENDPOINTS` object literal and nothing else -- including its `satisfies` guard. */
function endpointsRegion(output: string): string {
  const start = output.indexOf('export const ENDPOINTS = {');
  assert.notEqual(start, -1, 'the generated file declares no ENDPOINTS table at all');
  const end = output.indexOf('} as const satisfies Record<OperationId, Endpoint>;', start);
  assert.notEqual(end, -1, 'ENDPOINTS is not emitted with the `satisfies` guard that makes it total');
  return output.slice(start, end + '} as const satisfies Record<OperationId, Endpoint>;'.length);
}

test('the route table is the document, entry for entry -- no more, no fewer', () => {
  const block = endpointsRegion(generate());
  const ops = operationsOf(spec);
  assert.ok(ops.length >= 36, 'the document must still describe the surface this table routes');
  for (const op of ops) {
    assert.ok(
      block.includes(`  ${op.operationId}: { method: '${op.method.toLowerCase()}', path: '${op.path}' },`),
      `${op.operationId} has no route in ENDPOINTS, or not the one the document writes`,
    );
  }
  // The other direction, which is the half that catches a stale entry: a key the document no longer declares
  // fails to compile (the `satisfies` guard refuses a name outside `OperationId`), and this asserts the same
  // thing from the text side so the failure is a sentence a maintainer can read.
  const keys = [...block.matchAll(/^ {2}(\w+): \{ method:/gm)].map((m) => m[1] as string);
  const declared = new Set(ops.map((o) => o.operationId));
  const extra = keys.filter((k) => !declared.has(k));
  assert.deepEqual(extra, [], `ENDPOINTS routes operations the document does not declare: ${extra.join(', ')}`);
  assert.equal(keys.length, ops.length, `ENDPOINTS holds ${String(keys.length)} entries for ${String(ops.length)} operations -- a duplicate key or a missing one`);
});

test('the shipped route table is the one a transport imports', () => {
  // Runtime parity, not text parity: `packages/ui`'s driver reads this *value*, so what has to be true is that
  // the object committed in `generated/types.ts` is the object the committed spec produces. A hand edit to a
  // path, a verb, or a key fails here, and fails `api:types:check` from the other side, byte for byte.
  const ops = operationsOf(spec);
  const table = ENDPOINTS as unknown as Record<string, { method: string; path: string }>;
  assert.equal(Object.keys(table).length, ops.length, 'the shipped table and the document disagree about how many operations there are');
  for (const op of ops) {
    assert.deepEqual(table[op.operationId], { method: op.method.toLowerCase(), path: op.path }, `${op.operationId}: the shipped route is not the document's`);
  }
  // And every templated hole is a parameter the operation declares `in: path`, so `ParamsOf<O>` can fill it.
  // Without this the table could route a URL no caller is able to complete.
  for (const op of ops) {
    const item = (spec.paths as SpecDocument)[op.path] as SpecDocument;
    const entry = item[op.method.toLowerCase()] as SpecDocument;
    const declared = new Set([...((item.parameters ?? []) as SpecDocument[]), ...((entry?.parameters ?? []) as SpecDocument[])]
      .filter((p) => p?.in === 'path')
      .map((p) => String(p.name)));
    for (const hole of op.path.matchAll(/\{(\w+)\}/g)) {
      assert.ok(declared.has(String(hole[1])), `${op.operationId}: {${String(hole[1])}} is templated but never declared \`in: path\``);
    }
  }
});

test('an operation added to the document arrives in the table; one deleted leaves it', () => {
  const added = endpointsRegion(generate(withOperation('probeOperation', 'get', '/api/v1/probe'), 'probe-added'));
  assert.ok(added.includes(`  probeOperation: { method: 'get', path: '/api/v1/probe' },`), 'a new operation produced no new route');

  const removed = endpointsRegion(generate(withoutOperation('listInstances'), 'probe-removed'));
  assert.equal(removed.includes('listInstances:'), false, 'a deleted operation left its route behind');
});

test('the emitter refuses a route it cannot fill, or a name it already declares', () => {
  // A templated hole with no `in: path` declaration is a URL with a hole in it: `ParamsOf` cannot close it, so
  // the transport would send `/api/v1/instances/{ghost}` and read the server's 404 as an answer. The emitter
  // refuses instead of emitting a route nobody can complete.
  const ghost = withOperation('ghosted', 'get', '/api/v1/instances/{ghost}');
  assert.throws(() => generate(ghost, 'ghost-hole'), /\{ghost\} is templated in the path but not declared there as a required/, 'an unfillable template was emitted anyway');

  // A component named like the emitter's own declarations would make the generated file declare that name
  // twice -- and `--check` would bless it, because the file it compares against already carries the duplicate.
  // Refusing at emit time names the component to rename instead.
  for (const name of ['Endpoint', 'ENDPOINTS', 'ApiResponses', 'OperationId', 'PathParamsOf', 'ROUTES_ARE_FILLABLE', 'RequiredParamKeys']) {
    assert.throws(
      () => generate(withComponent(name, { type: 'string' }), `clash-${name}`),
      new RegExp(`"${name}" is a name this emitter declares`),
      `${name} was emitted beside the emitter's own declaration`,
    );
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
  //
  // REQUIRED, and that is the point of #247 rather than a side effect of it. The document used to declare
  // `environments` optional on a component named `Instance` that was the stored row everywhere else in the
  // code, and the drift ledger filed the disagreement. Both operations that return it build
  // `{ ...record, environments: await store.listInstanceEnvironments(id) }` unconditionally
  // (apps/control-plane/src/capabilities.ts:259, :348), so the response always carries the rows -- and the
  // shape is now GENERATED from that composition, as `InstanceResponse`, instead of being hand-written beside
  // it. An optional marker on a field the server always sends is a client written against a lie.
  assert.match(output, / {2}environments: Array<\{/);
  // `Instance` is the record and has no rows of its own; the assembled response is a different name. One
  // shape, one definition -- and the two definitions are checked to be genuinely different shapes.
  const record = /export interface Instance \{[\s\S]*?\n\}/.exec(output)?.[0] ?? '';
  assert.ok(record.length > 0, 'the record interface was not emitted at all');
  // A MEMBER named `environments`, not the word anywhere: the record's `state` description legitimately says
  // "`InstanceResponse.environments` is what actually happened per place", and prose is not a field.
  assert.ok(!/^ {2}environments:/m.test(record), 'Instance is InstanceSchema: a stored row, no environment rows');
  const response = /export interface InstanceResponse \{[\s\S]*?\n\}/.exec(output)?.[0] ?? '';
  assert.ok(/^ {2}environments:/m.test(response), 'InstanceResponse is the assembled response: it carries them');
  assert.notEqual(record, response, 'one name, two shapes -- the defect #247 was raised about');
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

test('the shipped document has no unheard keywords -- the quoting bug is repaired, not excused', () => {
  // This test used to PIN the defect: it asserted the two flow scalars in `openapi.yaml` parsed as a truncated
  // description plus a bogus schema keyword, and said in its own comment that the right response on failure was
  // to delete the pointers once the strings were quoted. They are quoted now, so the honest replacement is the
  // stronger claim rather than a smaller list: nothing in the shipped document goes unheard.
  // The mechanism stays covered above by `a keyword the emitter does not read is reported, not swallowed`,
  // which mutates a synthetic document and cannot be satisfied by an empty repository.
  const found = unexpressedKeywords(spec);
  assert.deepEqual(found, [], `the document still carries keywords no emitter reads: ${JSON.stringify(found)}`);
  // And the consequence, asserted in the other direction now: both sentences arrive whole.
  const text = generate();
  assert.match(text, /\/\*\* The transport's receipt, so delivery is a fact about the row \(D46\)\. \*\//, 'the receipt description is complete');
  assert.match(text, /\/\*\* Catalog identifier, e\.g\. starter-web \*\//, 'the template description is complete');
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

/** The document plus one operation, written the way the smallest honest operation is written. */
function withOperation(id: string, method: string, path: string): SpecDocument {
  const doc = structuredClone(spec) as SpecDocument;
  const paths = doc.paths as Record<string, SpecDocument>;
  const item = paths[path] ?? {};
  item[method] = { operationId: id, security: [], responses: { '200': { description: 'A probe.' } } };
  paths[path] = item;
  return doc;
}

/** The document minus one operation, and minus any path item that only that operation was in. */
function withoutOperation(id: string): SpecDocument {
  const doc = structuredClone(spec) as SpecDocument;
  const paths = doc.paths as Record<string, SpecDocument>;
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(item)) {
      if ((op as SpecDocument)?.operationId === id) delete item[method];
    }
    if (Object.keys(item).length === 0) delete paths[path];
  }
  return doc;
}
