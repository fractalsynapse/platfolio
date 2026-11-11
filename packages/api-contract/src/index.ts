import { parse as parseYaml } from 'yaml';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import ajvFormatsModule from 'ajv-formats';

// ajv-formats is CommonJS with `exports.default`; under verbatimModuleSyntax the default import binds the
// module namespace there, so the call sites disagree between Node's interop and TypeScript's. Handle both
// shapes rather than picking the one that happens to work locally -- ambient-module differences are exactly
// what makes a check pass on a laptop and fail in CI.
type FormatsPlugin = (ajv: Ajv) => void;
const addFormats: FormatsPlugin = typeof ajvFormatsModule === 'function'
  ? (ajvFormatsModule as unknown as FormatsPlugin)
  : (ajvFormatsModule as unknown as { default: FormatsPlugin }).default;

/**
 * The OpenAPI document as an executable check (D41).
 *
 * A spec that nothing validates against is documentation with a file extension, and documentation drifts
 * silently: it agrees with yesterday's code and contradicts today's. So the spec is loaded here, compiled to
 * validators, and used in two directions -- response bodies are checked against it, and the set of handlers
 * is checked against it, so a handler added without a design entry fails just as loudly as an entry whose
 * route was deleted.
 *
 * Deliberate limits, stated rather than hidden:
 * - `$ref` is resolved by inlining, and a reference cycle throws instead of recursing. Fine for DTO schemas,
 *   wrong for a self-referential tree; that would need real `$ref` support, and saying so beats pretending.
 * - Ajv runs in non-strict mode because OpenAPI adds annotation keywords (`example`, `description`,
 *   `format`) that JSON Schema does not own. Non-strict hides typos, so the checks that mode would have
 *   caught -- `required` naming a property that does not exist, dangling refs, undeclared path parameters --
 *   are asserted explicitly in `checkSpec`.
 */

export interface SpecOperation {
  operationId: string;
  method: string;
  path: string;
  /** `'anonymous-none'` means the operation declared no security at all -- a finding, not a state. */
  security: string[] | 'undeclared';
  responses: Record<string, unknown>;
}

export interface RouteManifestEntry {
  method: string;
  /** In the spec's own notation, so `{instanceId}` matches rather than `:instanceId`. */
  path: string;
  operationId: string;
}

export type SpecDocument = Record<string, any>;

export function loadSpec(text: string): SpecDocument {
  const doc = parseYaml(text) as SpecDocument | undefined;
  // An array is `typeof object` in JS, so the naive guard would let a YAML list through and report the wrong
  // failure ("missing openapi version") for a document that is simply not a mapping.
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('spec did not parse to an object');
  if (typeof doc.openapi !== 'string') throw new Error('spec is missing an `openapi:` version');
  if (!doc.paths || typeof doc.paths !== 'object') throw new Error('spec has no `paths:` section -- an API with no operations is not a spec');
  return doc;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function operationsOf(doc: SpecDocument): SpecOperation[] {
  const out: SpecOperation[] = [];
  for (const [path, item] of Object.entries<SpecDocument>(doc.paths ?? {})) {
    for (const [method, op] of Object.entries<SpecDocument>(item ?? {})) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!op || typeof op !== 'object') continue;
      const security: string[] | 'undeclared' = Array.isArray(op.security)
        ? op.security.flatMap((entry) => Object.keys(entry ?? {}))
        : 'undeclared';
      out.push({
        operationId: String(op.operationId ?? ''),
        method: method.toUpperCase(),
        path,
        security,
        responses: (op.responses ?? {}) as Record<string, unknown>,
      });
    }
  }
  return out;
}

/** Follows `#/components/...` pointers, inlining the target. A cycle is refused, not followed. */
function deref(node: unknown, doc: SpecDocument, trail: string[] = []): any {
  if (Array.isArray(node)) return node.map((n) => deref(n, doc, trail));
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  if (typeof record.$ref === 'string') {
    const ref = record.$ref;
    if (trail.includes(ref)) throw new Error(`un-inlinable $ref cycle: ${[...trail, ref].join(' -> ')}`);
    const target = pointerAt(doc, ref);
    if (target === undefined) throw new Error(`dangling $ref: ${ref}`);
    const { $ref: _ignored, ...rest } = record;
    return { ...deref(target, doc, [...trail, ref]), ...rest };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) out[k] = deref(v, doc, trail);
  return out;
}

function pointerAt(doc: SpecDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let cursor: unknown = doc;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = decodeURIComponent(rawSegment).replace(/~1/g, '/').replace(/~0/g, '~');
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) cursor = (cursor as Record<string, unknown>)[segment];
    else return undefined;
  }
  return cursor;
}

const validatorCache = new WeakMap<object, Map<string, { validate: ValidateFunction; errors: ErrorObject[] }>>();

function validatorFor(doc: SpecDocument, schema: unknown) {
  let byKey = validatorCache.get(doc);
  if (!byKey) {
    byKey = new Map();
    validatorCache.set(doc, byKey);
  }
  const resolved = deref(schema, doc);
  const key = JSON.stringify(resolved);
  let compiled = byKey.get(key);
  if (!compiled) {
    // Non-strict because OpenAPI owns keywords JSON Schema does not (`example`, `description`, `format`).
    // What that hides is asserted explicitly in checkSpec instead of left to a validator mode.
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(resolved) as ValidateFunction & { errors?: ErrorObject[] };
    compiled = { validate, get errors() { return validate.errors ?? []; } };
    byKey.set(key, compiled);
  }
  return compiled;
}

export interface BodyCheck {
  ok: boolean;
  errors: string[];
}

/** Validate a response body against the schema the spec declares for this operation and status. */
export function validateResponse(doc: SpecDocument, operationId: string, status: number, body: unknown): BodyCheck {
  const ops = operationsOf(doc);
  const op = ops.find((o) => o.operationId === operationId);
  if (!op) return { ok: false, errors: [`operationId "${operationId}" is not in the spec`] };
  const raw = op.responses[String(status)] ?? op.responses.default;
  if (!raw) return { ok: false, errors: [`spec declares no ${status} response for ${operationId}`] };
  // Resolve the response itself first: `401: { $ref: '#/components/responses/Unauthenticated' }` is the normal
  // way to write it, and reading `content` off the un-resolved node yields nothing -- which the code below
  // treats as "no schema to check" and reports as valid. A response silently escaping validation is the worst
  // failure this file can have, because it makes the gate look like it passed.
  const entry = deref(raw, doc) as SpecDocument;
  const schema = jsonSchemaFor(entry);
  if (schema === undefined && raw !== undefined && (typeof raw === 'object' && '$ref' in (raw as object))) {
    return { ok: false, errors: [`${operationId} ${status}: resolved to a response with no application/json schema -- refusing to call that valid`] };
  }
  if (schema === undefined) return { ok: true, errors: [] };
  const { validate } = validatorFor(doc, schema);
  const ok = validate(body);
  // Read the errors AFTER the call, through the function's own property. Destructuring `errors` alongside
  // `validate` grabbed the getter before anything had failed, so every rejection came back with an empty list:
  // `/version` in the container answered 500 with `getVersion 200: ` and no reason. A gate that cannot explain
  // itself is worse than no gate, because the next engineer turns it off.
  return { ok, errors: ok ? [] : describeErrors(validate.errors ?? []) };
}

function jsonSchemaFor(response: SpecDocument): unknown {
  const content = response.content as Record<string, SpecDocument> | undefined;
  const json = content?.['application/json'];
  return json?.schema;
}

function describeErrors(errors: unknown[]): string[] {
  return errors.map((e) => {
    const err = e as { instancePath?: string; message?: string; keyword?: string };
    return `${err.instancePath || '<root>'}: ${err.message ?? err.keyword ?? 'invalid'}`;
  });
}

/**
 * Everything that must be true of the spec itself, independent of any implementation. This is where the
 * rule "the spec is the validation mechanism" earns its keep: a spec with a typo, an undeclared parameter or
 * an example that violates its own schema cannot validate anything.
 */
export function checkSpec(doc: SpecDocument): string[] {
  const problems: string[] = [];
  const ops = operationsOf(doc);
  if (ops.length === 0) problems.push('spec declares no operations');

  const schemes = Object.keys((doc.components as SpecDocument | undefined)?.securitySchemes ?? {});
  const seenIds = new Map<string, string>();
  for (const op of ops) {
    const where = `${op.method} ${op.path}`;
    if (!op.operationId) {
      problems.push(`${where}: no operationId -- the route manifest and the spec cannot be matched without it`);
    } else {
      const prior = seenIds.get(op.operationId);
      if (prior) problems.push(`duplicate operationId "${op.operationId}" on ${where} and ${prior}`);
      seenIds.set(op.operationId, where);
    }
    if (op.security === 'undeclared') {
      problems.push(`${where}: declares no security. Public operations must say so with an explicit "security: []", so an open endpoint is a reviewed choice and never an oversight`);
    } else {
      for (const scheme of op.security) if (!schemes.includes(scheme)) problems.push(`${where}: security scheme "${scheme}" is not in components.securitySchemes`);
    }
    for (const [status, raw] of Object.entries(op.responses)) {
      // checkSpec never throws: a document that is broken is exactly the input it exists to describe. The
      // deref below raises on a dangling $ref or a cycle, and letting that escape would turn the diagnostic
      // into a crash -- so it becomes a finding instead. (validateResponse is allowed to throw, because its
      // caller is a running server with a spec that already passed this check.)
      let entry: SpecDocument;
      try {
        entry = deref(raw, doc) as SpecDocument;
      } catch (error) {
        problems.push(`${where} ${status}: ${(error as Error).message}`);
        continue;
      }
      const schema = jsonSchemaFor(entry);
      const example = entry.content?.['application/json']?.example;
      if (schema !== undefined && example !== undefined) {
        try {
          const { ok, errors } = validateAgainst(doc, schema, example);
          if (!ok) problems.push(`${where} ${status}: its own example violates its schema -- ${errors.join('; ')}`);
        } catch (error) {
          problems.push(`${where} ${status}: schema is not usable -- ${(error as Error).message}`);
        }
      }
      if (schema === undefined && entry.description === undefined) problems.push(`${where} ${status}: no schema and no description`);
      // A response may legitimately have no body (204, 304). It may not declare a payload in a media type the
      // gate does not read: that is how a status code stops being validated while still looking documented.
      const content = entry.content as Record<string, SpecDocument> | undefined;
      if (content && Object.keys(content).length > 0 && jsonSchemaFor(entry) === undefined && !['204', '304'].includes(status)) {
        problems.push(`${where} ${status}: declares content (${Object.keys(content).join(', ')}) with no application/json schema -- nothing would be validated`);
      }
    }
  }

  walkSchemas(doc, (node, where) => {
    if (node.type === 'object' && node.properties && Array.isArray(node.required)) {
      const props = Object.keys(node.properties as Record<string, unknown>);
      for (const name of node.required as string[]) {
        if (!props.includes(name)) problems.push(`${where}: required property "${name}" is not declared in properties`);
      }
    }
    if (node.$ref !== undefined && typeof node.$ref === 'string' && pointerAt(doc, node.$ref) === undefined) {
      problems.push(`${where}: dangling $ref "${node.$ref}"`);
    }
  });

  for (const [path, item] of Object.entries<SpecDocument>(doc.paths ?? {})) {
    const declared = new Set((item?.parameters ?? []).map((p: SpecDocument) => p?.name));
    for (const raw of path.matchAll(/\{(\w+)\}/g)) {
      const name = raw[1] ?? '';
      const inOp = Object.entries<SpecDocument>(item ?? {}).some(([method, op]) =>
        HTTP_METHODS.includes(method.toLowerCase()) && (op?.parameters ?? []).some((p: SpecDocument) => p?.name === name));
      if (!declared.has(name) && !inOp) problems.push(`${path}: template parameter {${name}} has no matching parameter declaration`);
    }
  }

  const serverPath = String((doc.servers as SpecDocument[] | undefined)?.[0]?.url ?? '');
  if (serverPath.includes('{') && !serverPath.includes('://') && !serverPath.startsWith('/')) {
    problems.push(`servers[0].url looks malformed: ${serverPath}`);
  }
  return problems;
}

function validateAgainst(doc: SpecDocument, schema: unknown, value: unknown): BodyCheck {
  const { validate } = validatorFor(doc, schema);
  const ok = validate(value);
  return { ok, errors: ok ? [] : describeErrors(validate.errors ?? []) };
}

/** Every schema node in the document, with a human-readable location for messages. */
function walkSchemas(node: unknown, visit: (schema: Record<string, unknown>, where: string) => void, where = '<root>'): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => walkSchemas(child, visit, `${where}[${String(i)}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record.type === 'string' || record.properties !== undefined || record.$ref !== undefined || record.items !== undefined) visit(record, where);
  for (const [key, value] of Object.entries(record)) walkSchemas(value, visit, `${where}.${key}`);
}

/**
 * Drift, in both directions. Handlers are matched by operationId plus method and path in the spec's own
 * notation, so a rename is a finding rather than a silent miss.
 */
export function checkRouteManifest(doc: SpecDocument, routes: RouteManifestEntry[]): string[] {
  const problems: string[] = [];
  const ops = operationsOf(doc).filter((o) => o.operationId);
  const byId = new Map(ops.map((o) => [o.operationId, o]));
  const routeIds = new Set(routes.map((r) => r.operationId));

  for (const op of ops) {
    const route = routes.find((r) => r.operationId === op.operationId);
    if (!route) {
      problems.push(`spec operation "${op.operationId}" (${op.method} ${op.path}) has no route -- the spec describes an endpoint that does not exist`);
      continue;
    }
    if (route.method.toUpperCase() !== op.method) problems.push(`${op.operationId}: route method ${route.method} != spec ${op.method}`);
    if (route.path !== op.path) problems.push(`${op.operationId}: route path ${route.path} != spec ${op.path}`);
  }
  for (const route of routes) {
    if (!byId.has(route.operationId)) {
      problems.push(`route ${route.method.toUpperCase()} ${route.path} (operationId "${route.operationId}") is not in the spec -- handlers do not define the API (D41)`);
    }
  }
  if (routes.length && routeIds.size !== routes.length) problems.push('two routes share an operationId');
  return problems;
}

/** All response schemas the spec declares, for tests that assert coverage of the surface. */
export function declaredResponseKeys(doc: SpecDocument): string[] {
  return operationsOf(doc).flatMap((op) => Object.keys(op.responses).map((status) => `${op.operationId}:${status}`));
}
