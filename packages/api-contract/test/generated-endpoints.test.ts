import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadSpec, type SpecDocument } from '../src/index.ts';
import { generateApiTypes } from '../src/generate-types.ts';

/**
 * The compile-time half of #258, proved by mutation rather than by argument.
 *
 * `ENDPOINTS` is emitted `as const satisfies Record<OperationId, Endpoint>`, and the claim attached to that
 * phrase is the whole reason the table is worth having: an operation the document declares and the table does
 * not is a compile error, and a route the document no longer declares is a compile error too. A claim like that
 * cannot be asserted with a sentence -- `docs/ui-architecture.md` rule 3 prices exactly that habit ("had been
 * passing without testing anything"), so each direction is done to the committed file here and the compiler's
 * answer is what the test reads.
 *
 * ## How the mutants are made, and why none of them touches the tree
 *
 * A copy of `generated/types.ts` is written into a temporary directory beside a `tsconfig.json` that *extends
 * the repository's root config*. So the refusal happens under the flags this repository actually type-checks
 * with -- `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` -- instead of a
 * second list of flags invented here, which would be one more fact with two owners and would drift the first
 * time the root config is tightened. The working tree is never mutated, so nothing here can leave a planted
 * violation behind for another agent's gate to trip over.
 *
 * ## The positive control is not decoration
 *
 * Case 1 compiles the unmutated committed bytes. Without it, a refusal could be a broken import, a missing
 * library, or a `tsconfig` that resolved to nothing, and every "the compiler refused it" below would mean
 * nothing at all. This is the same reason `packages/ui` pairs every `*.negative.ts` fixture with a
 * `*.control.ts`.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT_REL = 'packages/api-contract/src/generated/types.ts';
const SPEC_REL = 'apps/control-plane/openapi.yaml';
const committed = fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8');
const specText = fs.readFileSync(path.join(ROOT, SPEC_REL), 'utf8');
const spec = loadSpec(specText);

/** One route line, and the response-map block for the same operation. Both appear exactly once. */
const ROUTE_LINE = "  listInstances: { method: 'get', path: '/api/v1/instances' },\n";
const RESPONSE_BLOCK = "  /** GET /api/v1/instances */\n  listInstances: {\n    '200': InstanceResponse[];\n    '401': Error;\n  };\n";
/** The two anchors the fillability mutants need: a templated route, and the parameter that fills it. */
const TEMPLATED_ROUTE = "  getInstance: { method: 'get', path: '/api/v1/instances/{instanceId}' },\n";
const PATH_PARAM_BLOCK = '  getInstance: {\n    instanceId: string;\n  };\n';

for (const [label, needle] of [['route line', ROUTE_LINE], ['response block', RESPONSE_BLOCK], ['templated route line', TEMPLATED_ROUTE], ['path parameter block', PATH_PARAM_BLOCK]] as const) {
  assert.equal(committed.split(needle).length - 1, 1, `the ${label} anchor does not appear exactly once in ${OUT_REL}: the mutations below would mutate nothing`);
}

function compile(name: string, text: string): { code: number; output: string } {
  // In-repo on purpose: a compile probe outside the repository cannot inherit the repo compiler flags, and
  // `os.tmpdir()` is /tmp in CI but inside the tree on a dev box whose TMPDIR is set -- which is exactly how this
  // file passed locally and failed on the runner (TS2688 'Cannot find type definition file for node', TS6059
  // 'not under rootDir'). The path must not be an input to the answer the test is measuring.
  const dir = fs.mkdtempSync(path.join(ROOT, `.tmp-probe-${name}-`));
  try {
    fs.writeFileSync(path.join(dir, 'mutant.ts'), text, 'utf8');
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      `${JSON.stringify({ extends: path.join(ROOT, 'tsconfig.json'), compilerOptions: { noEmit: true }, files: ['mutant.ts'], include: [] }, null, 2)}\n`,
      'utf8',
    );
    try {
      const out = execFileSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(dir, 'tsconfig.json')], { stdio: 'pipe', cwd: ROOT, encoding: 'utf8' });
      return { code: 0, output: out };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const mutate = {
  'missing-entry': (t: string): string => t.replace(ROUTE_LINE, ''),
  'extra-entry': (t: string): string => t.replace(ROUTE_LINE, `${ROUTE_LINE}  notAnOperation: { method: 'get', path: '/api/v1/nope' },\n`),
  'operation-deleted': (t: string): string => t.replace(RESPONSE_BLOCK, ''),
  'uppercase-verb': (t: string): string => t.replace(ROUTE_LINE, "  listInstances: { method: 'GET', path: '/api/v1/instances' },\n"),
  'path-drift': (t: string): string => t.replace(ROUTE_LINE, "  listInstances: { method: 'get', path: '/api/v1/instancez' },\n"),
  'hole-renamed': (t: string): string => t.replace(TEMPLATED_ROUTE, "  getInstance: { method: 'get', path: '/api/v1/instances/{id}' },\n"),
  'optional-path-parameter': (t: string): string => t.replace(PATH_PARAM_BLOCK, '  getInstance: {\n    instanceId?: string;\n  };\n'),
};

test('the control: the committed generated file compiles under the repository flags', () => {
  const { code, output } = compile('control', committed);
  assert.equal(code, 0, `the unmutated ${OUT_REL} did not compile, so every refusal below is meaningless:\n${output.slice(0, 800)}`);
});

test('a route table missing an operation the document declares does not compile', () => {
  const { code, output } = compile('missing-entry', mutate['missing-entry'](committed));
  assert.notEqual(code, 0, 'DID NOT BITE: ENDPOINTS dropped an operation the response map still declares and the compiler said nothing');
  assert.match(output, /error TS1360/);
  assert.match(output, /Property 'listInstances' is missing/);
  assert.match(output, /Record<keyof ApiResponses, Endpoint>/, 'the refusal should name the guard, not just the shape');
});

test('a route table carrying an entry the document does not declare does not compile', () => {
  const { code, output } = compile('extra-entry', mutate['extra-entry'](committed));
  assert.notEqual(code, 0, 'DID NOT BITE: an invented route was accepted');
  assert.match(output, /error TS2353/);
  assert.match(output, /'notAnOperation' does not exist in type 'Record<keyof ApiResponses, Endpoint>'/);
});

test('deleting an operation without deleting its route does not compile', () => {
  // The direction the issue asked for by name: the specification loses an operation, `OperationId` shrinks
  // with it, and the route left in the table is now a property of nothing. `api:types:check` also fails, but
  // this is the failure that makes a *partial regeneration* impossible rather than merely stale.
  const { code, output } = compile('operation-deleted', mutate['operation-deleted'](committed));
  assert.notEqual(code, 0, 'DID NOT BITE: a stale route for a deleted operation was accepted');
  assert.match(output, /error TS2353/);
  assert.match(output, /'listInstances' does not exist in type/);
});

test('a verb spelled as HTTP spells it rather than as the document does does not compile', () => {
  // Why the union is the document's own: `'GET'` would be *valid HTTP* and invalid here, and a table that
  // accepted both spellings would be a second description of the verb rather than a reading of the path item.
  const { code, output } = compile('uppercase-verb', mutate['uppercase-verb'](committed));
  assert.notEqual(code, 0, 'DID NOT BITE: the method union accepted an uppercase spelling');
  assert.match(output, /error TS2820/);
  assert.match(output, /HttpMethod/);
});

test('a route whose templated hole no required parameter names does not compile', () => {
  // Completeness is not fillability. `path: string` accepts any template, so the shape guard above cannot see
  // this one, and the consequence is not a compile error at the call site but a transport that refuses a
  // request no caller could ever have typed -- a lie that surfaces when somebody clicks.
  const { code, output } = compile('hole-renamed', mutate['hole-renamed'](committed));
  assert.notEqual(code, 0, 'DID NOT BITE: `{id}` was accepted where the operation declares `{instanceId}`');
  assert.match(output, /ROUTES_ARE_FILLABLE|a route templates a hole that operation does not declare as a required parameter/);
  assert.match(output, /"id"/, 'the refusal should name the hole that cannot be filled');
});

test('a path parameter made optional does not compile', () => {
  // The same proof from the other side: a hole the caller is allowed to leave empty is a route the transport
  // cannot complete either, and `PathParamsOf` reads the template while `RequiredParamKeys` reads the optionality.
  const { code, output } = compile('optional-path-parameter', mutate['optional-path-parameter'](committed));
  assert.notEqual(code, 0, 'DID NOT BITE: an optional path parameter was accepted against a templated route');
  assert.match(output, /a route templates a hole that operation does not declare as a required parameter/);
  assert.match(output, /"instanceId"/);
});

test('a hand-edited path is invisible to the compiler, which is why the byte gate exists', () => {
  // Stated as a limitation and tested as one. `/api/v1/instancez` is a legal `string`: the `satisfies` guard
  // checks the *shape* of a route and the *key* of a route, not whether the document contains that path. The
  // mutation that matters here is therefore refused by `api:types:check`, and this asserts that refusal from
  // the same comparison the gate makes -- regenerate, compare -- without editing the working tree.
  const drifted = mutate['path-drift'](committed);
  const { code } = compile('path-drift', drifted);
  assert.equal(code, 0, 'the compiler unexpectedly refused a path typo, so the note below is wrong');

  const regenerated = generateApiTypes(spec as SpecDocument, { specPath: SPEC_REL, source: specText });
  assert.equal(regenerated.includes(ROUTE_LINE), true, 'the emitter no longer produces the route line this test mutates');
  assert.notEqual(drifted, regenerated, 'DID NOT BITE: a hand-edited path would have reproduced from the spec');
});
