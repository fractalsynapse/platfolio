import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { checkRouteManifest, checkSpec, declaredResponseKeys, loadSpec, operationsOf, validateResponse, type SpecDocument } from '../src/index.ts';

const SPEC_PATH = path.resolve(import.meta.dirname, '../../../api/control-plane.openapi.yaml');
const spec = loadSpec(await fs.readFile(SPEC_PATH, 'utf8'));

/** Deep-copy then mutate, so each test breaks one thing in a real document rather than inventing a toy one. */
const mutate = (edit: (doc: SpecDocument) => void): SpecDocument => {
  const clone = structuredClone(spec) as SpecDocument;
  edit(clone);
  return clone;
};

test('the shipped spec is internally true', () => {
  assert.deepEqual(checkSpec(spec), [], 'the canonical spec must pass its own checks before it can check anything');
  const ops = operationsOf(spec);
  assert.equal(ops.length, 4);
  assert.deepEqual(ops.map((o) => o.operationId).sort(), ['getHealth', 'getReady', 'getVersion', 'getWhoami']);
  // The public half says so explicitly rather than by omission -- that is what the security check is for.
  assert.deepEqual(ops.filter((o) => Array.isArray(o.security) && o.security.length === 0).map((o) => o.operationId).sort(), ['getHealth', 'getReady', 'getVersion']);
  // Coverage of the surface: every operation's declared responses, so a new status code shows up in a diff.
  assert.deepEqual(declaredResponseKeys(spec).sort(), ['getHealth:200', 'getReady:200', 'getReady:503', 'getVersion:200', 'getWhoami:200', 'getWhoami:401', 'getWhoami:403']);
});

test('response validation accepts truth and rejects a body that merely looks plausible', () => {
  const good = { subject: 'user-1', issuer: 'http://localhost:8080/realms/platfolio', audience: ['platfolio-api'], clientId: 'cli', scope: ['platfolio.user'], expiresAt: '2026-12-01T00:00:00Z', tenantAuthority: false };
  assert.equal(validateResponse(spec, 'getWhoami', 200, good).ok, true);

  const tenantAuthorityTrue = { ...good, tenantAuthority: true };
  assert.equal(validateResponse(spec, 'getWhoami', 200, tenantAuthorityTrue).ok, false, 'tenantAuthority is `const: false` -- a body asserting tenant authority is a bug, caught at the boundary');

  assert.equal(validateResponse(spec, 'getWhoami', 200, { ...good, token: 'eyJhbGciOi...' }).ok, false, 'additionalProperties:false: a handler echoing the raw token must fail the spec');
  assert.equal(validateResponse(spec, 'getWhoami', 200, { ...good, scope: undefined }).ok, false, 'required scope absent');
  assert.equal(validateResponse(spec, 'getWhoami', 401, { error: 'unauthenticated', message: 'x'.repeat(400) }).ok, false, 'message is bounded so a provider error cannot be dumped into a response');
  assert.equal(validateResponse(spec, 'getHealth', 200, { status: 'ok', livenessToken: 'short' }).ok, false, 'livenessToken pattern is enforced');
  assert.equal(validateResponse(spec, 'nope', 200, {}).ok, false, 'an unknown operationId is a finding, not a pass');
});

test('a spec that has become fiction is refused -- one mutation per check', () => {
  // Each of these is a real way a document drifts, and the whole rule (D41) rests on them being caught.
  const cases: Array<[string, (doc: SpecDocument) => void, RegExp]> = [
    ['undeclared security', (d) => { delete d.paths['/api/v1/whoami'].get.security; }, /declares no security/],
    ['unknown scheme', (d) => { d.paths['/api/v1/whoami'].get.security = [{ notARealScheme: [] }]; }, /not in components.securitySchemes/],
    ['dangling ref', (d) => { d.paths['/healthz'].get.responses['200'].content['application/json'].schema = { $ref: '#/components/schemas/Nope' }; }, /dangling \$ref/],
    ['required not declared', (d) => { d.components.schemas.Whoami.required.push('phoneNumber'); }, /required property "phoneNumber"/],
    ['example violating its own schema', (d) => { d.paths['/healthz'].get.responses['200'].content['application/json'].example = { status: 'ok' }; }, /its own example violates/],
    ['undeclared path parameter', (d) => { d.paths['/api/v1/instances/{instanceId}'] = { get: { operationId: 'getInstance', responses: { '200': { description: 'x' } } } }; }, /no matching parameter declaration/],
    ['duplicate operationId', (d) => { d.paths['/version'].get.operationId = 'getHealth'; }, /duplicate operationId/],
    ['missing operationId', (d) => { delete d.paths['/readyz'].get.operationId; }, /no operationId/],
    ['no paths at all', (d) => { d.paths = {}; }, /declares no operations/],
    ['ref-ed response with no schema', (d) => { d.components.responses.Unauthenticated.content = { 'text/plain': { schema: { type: 'string' } } }; }, /no application\/json schema|no schema and no description/],
  ];
  for (const [name, edit, expected] of cases) {
    const problems = checkSpec(mutate(edit));
    assert.ok(problems.some((p) => expected.test(p)), `${name}: expected a problem matching ${expected.source}, got ${JSON.stringify(problems)}`);
  }
});

test('route drift is caught in both directions', () => {
  const routes = operationsOf(spec).map((o) => ({ method: o.method, path: o.path, operationId: o.operationId }));
  assert.deepEqual(checkRouteManifest(spec, routes), [], 'the matching manifest must be clean');

  const missingRoute = routes.filter((r) => r.operationId !== 'getWhoami');
  assert.match(checkRouteManifest(spec, missingRoute).join('\n'), /getWhoami.*has no route/s, 'an operation in the spec with no handler');

  const extraRoute = [...routes, { method: 'DELETE', path: '/api/v1/instances/{instanceId}', operationId: 'deleteInstance' }];
  assert.match(checkRouteManifest(extraRoute.length > 0 ? spec : spec, extraRoute).join('\n'), /is not in the spec/, 'a handler without a design entry (D41: handlers do not define the API)');

  const wrongMethod = routes.map((r) => (r.operationId === 'getHealth' ? { ...r, method: 'POST' } : r));
  assert.match(checkRouteManifest(spec, wrongMethod).join('\n'), /route method POST != spec GET/);

  const wrongPath = routes.map((r) => (r.operationId === 'getReady' ? { ...r, path: '/ready' } : r));
  assert.match(checkRouteManifest(spec, wrongPath).join('\n'), /route path \/ready != spec \/readyz/);

  const duplicated = [...routes, { method: 'GET', path: '/healthz', operationId: 'getHealth' }];
  assert.match(checkRouteManifest(spec, duplicated).join('\n'), /two routes share an operationId/);
});

test('loadSpec refuses documents that are not specs', () => {
  assert.throws(() => loadSpec('openapi: 3.1.0\n'), /no `paths:` section/);
  assert.throws(() => loadSpec('paths: {}\n'), /missing an `openapi:` version/);
  assert.throws(() => loadSpec('- just\n- a\n- list\n'), /did not parse to an object/);
});

test('a rejection names WHY, not just that -- the bug this test exists to prevent', () => {
  // Destructuring ajv's `errors` alongside `validate` captured an empty array before the call, so every
  // rejection arrived with zero reasons and a 500 whose message ended in a colon. Validating a body that is
  // wrong in three separate ways must report all three.
  const bad = { subject: '', issuer: 42, audience: [], clientId: '', scope: 'not-an-array', expiresAt: 'nope', tenantAuthority: true, extra: 'x' };
  const result = validateResponse(spec, 'getWhoami', 200, bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 3, `expected several reasons, got ${String(result.errors.length)}: ${JSON.stringify(result.errors)}`);
  assert.ok(result.errors.every((e) => e.length > 5), `every error must carry text: ${JSON.stringify(result.errors)}`);
  assert.match(result.errors.join(' '), /subject|audience|scope/, 'the messages should name the offending paths');
});
