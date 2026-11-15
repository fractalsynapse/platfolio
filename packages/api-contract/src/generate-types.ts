import { createHash } from 'node:crypto';
import { type SpecDocument } from './index.ts';

/**
 * The client-side half of the spec-first rule (D41, and the maintainer's: types used by a client are generated
 * from the spec, not hand-written beside it).
 *
 * `generateApiTypes` turns an OpenAPI 3.1 document into one TypeScript module: every component schema, every
 * operation's parameters, its request body, and its response bodies per status code. It is deliberately a small
 * emitter rather than a dependency: the vocabulary this spec writes in is known and narrow, the output has to be
 * reviewable line by line, and a generator nobody can read is how a type system quietly starts lying.
 *
 * Three rules do the safety work:
 *
 * - **It refuses instead of approximating.** A construct it cannot express throws, naming the position in the
 *   document. The alternative -- emitting `unknown` or `any` for the awkward case -- produces a file that
 *   compiles and a client that trusts a placeholder. The brief that asked for this gate says it in one line: no
 *   `unknown` standing in for a real shape. The emitter's tests falsify that from both sides.
 * - **Nothing here is hand-maintained.** Not one field list, not one enum literal: every type comes out of the
 *   document. Which is also why there is no union of error codes: the spec declares `error` as a free-form
 *   string, and inventing a code list the document does not carry would be a second copy of a fact -- the defect
 *   this repository keeps paying for.
 * - **It is deterministic.** Sorted components, spec order within a component, statuses ascending, no
 *   timestamps, and a digest of the input bytes in the header. So `--check` can compare the committed file
 *   against what the committed spec produces, byte for byte, and any difference is a real difference.
 */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export interface GenerateOptions {
  /** Path of the spec as it appears in the generated header, relative to the repository root. */
  specPath: string;
  /** Raw text of the spec, so the header records which input the output reproduces from. */
  source: string;
}

export function generateApiTypes(doc: SpecDocument, options: GenerateOptions): string {
  const digest = createHash('sha256').update(options.source).digest('hex').slice(0, 16);
  const out: string[] = [header(options.specPath, digest, String(doc.openapi), versionOf(doc))];

  const components = schemasOf(doc);
  for (const name of Object.keys(components).sort()) {
    const schema = components[name];
    if (!schema) continue;
    out.push(componentDeclaration(name, schema, `#/components/schemas/${name}`));
  }

  const operations = operationsOf(doc);
  out.push(interfaceBlock(
    ['The declared parameters of each operation, keyed by operationId. Path parameters are required because the',
     'spec requires them; query parameters carry the optionality the spec gives them.'],
    'ApiParameters',
    operations.map((op) => [`  /** ${op.where} */`, `  ${key(op.id)}: ${parametersObject(op)};`]),
  ));
  out.push(interfaceBlock(
    ['The request body each operation accepts, keyed by operationId. Operations with no request body are absent,',
     'so `RequestBodyOf` resolves to `undefined` for them rather than to a shape they never declare.'],
    'ApiRequestBodies',
    operations
      .filter((op) => op.body !== undefined)
      .map((op) => [`  /** ${op.where} */`, `  ${key(op.id)}: ${embed(typeExpression(op.body, `#/paths/${op.id}/requestBody`), 2)};`]),
  ));
  out.push(interfaceBlock(
    ['Every response body the spec declares, per operation and status code. A status with no content -- the 204',
     'that secret delivery answers with -- is `void`: the spec says there is no body, which is a different claim',
     'from an unchecked one.'],
    'ApiResponses',
    operations.map((op) => [`  /** ${op.where} */`, `  ${key(op.id)}: {\n${statusMembers(op)}\n  };`]),
  ));
  out.push(HELPERS);

  return `${out.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

const HELPERS = [
  '/** Every operationId in the document -- the key type of the three maps above. */',
  'export type OperationId = keyof ApiResponses;',
  '',
  '/** The request body of one operation, or `undefined` where the spec declares none. */',
  'export type RequestBodyOf<O extends OperationId> = O extends keyof ApiRequestBodies ? ApiRequestBodies[O] : undefined;',
  '',
  '/** The path and query parameters of one operation, or an empty record where it takes none. */',
  'export type ParamsOf<O extends OperationId> = O extends keyof ApiParameters ? ApiParameters[O] : Record<string, never>;',
  '',
  '/** The body type the spec declares for one operation at one status. */',
  'export type ResponseOf<O extends OperationId, S extends keyof ApiResponses[O]> = ApiResponses[O][S];',
  '',
  '/** The 2xx status codes one operation declares, exactly as the map writes them: quoted three-digit strings. */',
  'export type SuccessStatuses<O extends OperationId> = Extract<keyof ApiResponses[O], \'200\' | \'201\' | \'202\' | \'204\'>;',
  '',
  '/** The success body of an operation -- whatever its declared 2xx statuses produce, unionled. */',
  'export type SuccessOf<O extends OperationId> = { [S in SuccessStatuses<O>]: ApiResponses[O][S] }[SuccessStatuses<O>];',
].join('\n');

function versionOf(doc: SpecDocument): string {
  const info = doc.info as SpecDocument | undefined;
  return String(info?.version ?? '');
}

function header(specPath: string, digest: string, openapi: string, apiVersion: string): string {
  return [
    '/**',
    ' * GENERATED FILE -- DO NOT EDIT. The writer is `scripts/gen-api-types.ts` (the emitter lives in',
    ' * packages/api-contract/src/generate-types.ts) and it is the only one: nothing here is worth editing by',
    ' * hand, because every line reproduces from the specification.',
    ' *',
    ` * Source: ${specPath} (OpenAPI ${openapi}, info.version ${apiVersion})`,
    ` * Input digest: sha256/${digest}`,
    ' *',
    ' * Reproduce it with `pnpm run api:types`. `pnpm run api:types:check` fails when this file stops matching',
    ' * what the committed spec produces, which is the only way a generated type deserves to be trusted.',
    ' *',
    " * These are the document's types, not the runtime's. `packages/contracts` holds the StandardSchema",
    ' * definitions the server validates against, and `pnpm run api:check` compares the two shape sets (#247)',
    ' * so this file cannot silently describe a shape the server stopped producing.',
    ' *',
    ' * Import note, because the document names one component `Error`: a bare `import type { Error } from` this',
    ' * file shadows the global `Error` TYPE in the importing module (the value, `new Error(…)`, is untouched --',
    ' * measured, not reasoned from habit). Someone who wants both should write `import type { Error as ApiError }`,',
    ' * or reach for the whole surface with `import type * as Api` and use `Api.Error`.',
    ' */',
  ].join('\n');
}

function schemasOf(doc: SpecDocument): Record<string, SpecDocument> {
  const components = doc.components as SpecDocument | undefined;
  return (components?.schemas ?? {}) as Record<string, SpecDocument>;
}

/** A component becomes a named declaration: an interface when it is an object with fields, an alias otherwise. */
function componentDeclaration(name: string, schema: SpecDocument, pointer: string): string {
  const doc = commentLines(describeText(schema.description));
  const safe = identifier(name);
  const body = hasProperties(schema)
    ? `export interface ${safe} ${objectLiteral(schema, pointer)}`
    : `export type ${safe} = ${typeExpression(schema, pointer, true)};`;
  return `${doc}${body}`;
}

function commentLines(text: string): string {
  return text ? `/** ${text} */\n` : '';
}

/**
 * The TypeScript type for one schema node, rendered RELATIVE: the first line carries no leading indent (it is
 * placed after `key: ` or `= `), and continuation lines are indented from that column. `embed` shifts them to
 * where the type is actually being written, so one renderer handles a top-level component and a DTO four
 * levels deep without the depth bookkeeping that made the first draft unreadable.
 *
 * `atRoot` marks a position where a union needs no parentheses -- `export type X = A | B;` is fine, and
 * anywhere a `[]` could bind to the wrong member, `(A | B)` is what was meant.
 */
export function typeExpression(schema: unknown, pointer: string, atRoot = false): string {
  if (schema === true) {
    throw refuse(pointer, 'a boolean `true` schema means "anything", which has no honest type here; declare the shape in the spec instead');
  }
  if (schema === false) return 'never';
  if (!isPlainObject(schema)) throw refuse(pointer, `schema node is not an object (it is ${typeof schema})`);
  const node = schema as SpecDocument;

  if (typeof node.$ref === 'string') return refToType(node.$ref, pointer);
  if (Array.isArray(node.oneOf)) return joinVariants(node.oneOf, `${pointer}/oneOf`, atRoot, ' | ');
  if (Array.isArray(node.anyOf)) return joinVariants(node.anyOf, `${pointer}/anyOf`, atRoot, ' | ');
  if (Array.isArray(node.allOf)) return joinVariants(node.allOf, `${pointer}/allOf`, atRoot, ' & ');
  if ('const' in node) return literalExpression(node.const, pointer);
  if (Array.isArray(node.enum)) return enumExpression(node.enum, node, pointer);

  if (hasProperties(node)) return objectLiteral(node, pointer);
  const types = declaredTypes(node, pointer);
  if (types.length === 0) {
    const extra = node.additionalProperties;
    if (extra !== undefined && extra !== false) {
      return `Record<string, ${typeExpression(extra, `${pointer}/additionalProperties`, true)}>`;
    }
    throw refuse(pointer, 'declares no type, no properties and no enum -- refusing to emit `unknown` for a shape the spec does not describe');
  }
  return union(types.map((t) => scalarOrContainer(t, node, pointer)), atRoot);
}

function joinVariants(members: unknown[], pointer: string, atRoot: boolean, separator: string): string {
  const parts = members.map((m, i) => typeExpression(m, `${pointer}/${String(i)}`, true));
  return union(parts, atRoot, separator);
}

function scalarOrContainer(type: string, node: SpecDocument, pointer: string): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const items = node.items;
      if (items === undefined) throw refuse(pointer, 'type array with no items schema');
      return arraySuffix(typeExpression(items, `${pointer}/items`, true));
    }
    case 'object': {
      const extra = node.additionalProperties;
      if (extra && isPlainObject(extra)) return `Record<string, ${typeExpression(extra, `${pointer}/additionalProperties`, true)}>`;
      if (extra === true) throw refuse(pointer, 'an object whose values are unconstrained has no honest type here');
      // `additionalProperties: false` with no properties is an object that must be empty.
      return 'Record<string, never>';
    }
    default:
      throw refuse(pointer, `unsupported type "${type}"`);
  }
}

function enumExpression(values: unknown[], node: SpecDocument, pointer: string): string {
  const parts = values.map((v) => literalExpression(v, pointer));
  // OpenAPI 3.1 writes a nullable enum as `type: [string, "null"]`; the null is a member of the value set.
  if (declaredTypes(node, pointer).includes('null')) parts.push('null');
  return union(parts, true);
}

function literalExpression(value: unknown, pointer: string): string {
  if (typeof value === 'string') return `'${value.replaceAll("'", "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  throw refuse(pointer, `a const/enum member of type ${typeof value} is not expressible as a literal type`);
}

/**
 * Object literals are emitted multi-line so a reviewer reads a DTO the way the spec wrote it.
 *
 * The shape guard lives here rather than at the one call site that looked like it needed it: a component is
 * declared straight from the document, and a check only the property path runs is a check a top-level
 * declaration can walk past. That is how "refuse what you cannot represent" quietly becomes "represent it wrong".
 */
function objectLiteral(node: SpecDocument, pointer: string): string {
  const declared = declaredTypes(node, pointer);
  if (declared.length > 0 && !declared.includes('object')) {
    throw refuse(pointer, `declares properties together with type "${declared.join('|')}"`);
  }
  const properties = node.properties as Record<string, SpecDocument>;
  const required = new Set(Array.isArray(node.required) ? node.required.filter((r): r is string => typeof r === 'string') : []);
  const members: string[] = [];
  for (const [name, schema] of Object.entries(properties)) {
    const doc = isPlainObject(schema) ? describeText(schema.description) : '';
    if (doc) members.push(`  /** ${doc} */`);
    members.push(`  ${key(name)}${required.has(name) ? '' : '?'}: ${embed(typeExpression(schema, `${pointer}/properties/${name}`), 2)};`);
  }
  const extra = node.additionalProperties;
  if (extra === true) throw refuse(pointer, 'an object with additionalProperties: true has no honest closed type here');
  if (extra && isPlainObject(extra)) {
    members.push(`  [key: string]: ${embed(typeExpression(extra, `${pointer}/additionalProperties`), 2)};`);
  }
  if (members.length === 0) return '{}';
  return `{\n${members.join('\n')}\n}`;
}

/**
 * Move every line but the first to sit under the column the type starts at.
 *
 * A multi-line type written on a member line indented two spaces must have its own members at four and its
 * closing brace back at two; without this, nesting drifts one level wider per level and the file stops being
 * reviewable.
 */
function embed(text: string, column: number): string {
  if (!text.includes('\n') || column === 0) return text;
  const pad = ' '.repeat(column);
  return text.split('\n').map((line, i) => (i === 0 || line.trim() === '' ? line : pad + line)).join('\n');
}

function union(parts: string[], atRoot: boolean, separator = ' | '): string {
  const unique = [...new Set(parts)];
  if (unique.length === 0) return 'never';
  const joined = unique.join(separator);
  // A one-member union never needs parentheses, at root or not.
  if (unique.length === 1) return joined;
  return atRoot ? joined : `(${joined})`;
}

/**
 * Arrays: `T[]` for a single-token member, `Array<…>` for anything with structure.
 *
 * `{\n  a: string;\n}[]` would be legal but reads wrong, and `A | B[]` is a plain bug -- the suffix binds to
 * the last member only, so a union of two shapes becomes one shape plus an array of the other.
 */
function arraySuffix(inner: string): string {
  if (inner.includes('\n')) return `Array<${inner}>`;
  return inner.includes(' | ') || inner.includes(' & ') ? `(${inner})[]` : `${inner}[]`;
}

function refToType(ref: string, pointer: string): string {
  const match = /^#\/components\/schemas\/([\w-]+)$/.exec(ref);
  if (!match) throw refuse(pointer, `only local component-schema refs are emittable as names, got ${ref}`);
  return identifier(String(match[1]));
}

function declaredTypes(node: SpecDocument, pointer: string): string[] {
  const { type } = node;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) {
    for (const t of type) {
      if (typeof t !== 'string') throw refuse(pointer, `the type list contains a non-string member ${JSON.stringify(t)}`);
    }
    return type as string[];
  }
  return [];
}

function hasProperties(node: SpecDocument): boolean {
  const properties = node.properties;
  return isPlainObject(properties) && Object.keys(properties).length > 0;
}

/** An interface member or object key: quoted when the spec's name is not a bare identifier. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `'${name.replaceAll("'", "\\'")}'`;
}

/** A spec name that is not a TypeScript identifier gets a safe one; its comment keeps the original visible. */
export function identifier(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `_${name.replace(/[^A-Za-z0-9_$]/g, '_')}`;
}

interface Operation {
  id: string;
  where: string;
  parameters: Array<{ name: string; required: boolean; schema: unknown }>;
  body: unknown;
  responses: Array<{ status: string; schema: unknown }>;
}

function operationsOf(doc: SpecDocument): Operation[] {
  const out: Operation[] = [];
  for (const [path, item] of Object.entries<SpecDocument>(doc.paths ?? {})) {
    const shared = Array.isArray(item?.parameters) ? (item.parameters as SpecDocument[]) : [];
    for (const [method, op] of Object.entries<SpecDocument>(item ?? {})) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!isPlainObject(op)) continue;
      const id = String(op.operationId ?? '');
      if (!id) throw refuse(`#/paths${path}/${method}`, 'operation with no operationId -- the generated maps are keyed by it');
      const params = [...shared, ...(Array.isArray(op.parameters) ? (op.parameters as SpecDocument[]) : [])];
      out.push({
        id,
        where: `${method.toUpperCase()} ${path}`,
        parameters: params
          .filter((p) => p?.in === 'path' || p?.in === 'query')
          .map((p) => ({ name: String(p.name), required: p.required === true, schema: p.schema })),
        body: (op.requestBody as SpecDocument | undefined)?.content?.['application/json']?.schema,
        responses: Object.entries((op.responses ?? {}) as Record<string, unknown>).map(([status, entry]) => ({
          status,
          schema: responseSchema(entry, doc, `#/paths${path}/${method}/responses/${status}`),
        })),
      });
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function parametersObject(op: Operation): string {
  if (op.parameters.length === 0) return 'Record<string, never>';
  const members = op.parameters.map((p) => {
    const type = p.schema === undefined ? 'string' : embed(typeExpression(p.schema, `#/paths/${op.id}/parameters/${p.name}`), 4);
    return `    ${key(p.name)}${p.required ? '' : '?'}: ${type};`;
  });
  return `{\n${members.join('\n')}\n  }`;
}

function statusMembers(op: Operation): string {
  return op.responses
    .filter((r) => /^\d{3}$/.test(r.status))
    .sort((a, b) => Number(a.status) - Number(b.status))
    .map((r) => `    ${key(r.status)}: ${r.schema === undefined ? 'void' : embed(typeExpression(r.schema, `#/paths/${op.id}/responses/${r.status}`), 4)};`)
    .join('\n');
}

/**
 * A response entry is normally a `$ref` into `components.responses`, whose body is a `$ref` into a component.
 * Resolved here rather than through the package's shared walker because the emitter needs the schema node
 * itself, and a response object also carries headers and descriptions that are not the body.
 */
function responseSchema(entry: unknown, doc: SpecDocument, where: string): unknown {
  let node = entry;
  for (let hops = 0; hops < 8; hops += 1) {
    if (!isPlainObject(node)) break;
    if (typeof node.$ref !== 'string') break;
    node = pointerLookup(doc, node.$ref, where);
  }
  if (!isPlainObject(node)) return undefined;
  const content = node.content as Record<string, SpecDocument> | undefined;
  return content?.['application/json']?.schema;
}

function pointerLookup(doc: SpecDocument, ref: string, where: string): unknown {
  if (!ref.startsWith('#/')) throw refuse(where, `only local refs are emittable, got ${ref}`);
  let cursor: unknown = doc;
  for (const raw of ref.slice(2).split('/')) {
    const segment = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlainObject(cursor) || !(segment in cursor)) throw refuse(where, `dangling ref ${ref}`);
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function interfaceBlock(summary: string[], name: string, entries: string[][]): string {
  const body = entries.flat();
  return [
    '/**',
    ...summary.map((line) => ` * ${line}`),
    ' *',
    ' * GENERATED -- `pnpm run api:types:check` fails if this file stops reproducing from the committed spec.',
    ' */',
    `export interface ${name} {`,
    ...(body.length ? body : ['  // no operations in the current document']),
    '}',
  ].join('\n');
}

/**
 * Keywords a schema node may carry that the emitted type has no obligation to express.
 *
 * Anything OUTSIDE this set, on a node the emitter recognised as a schema, is something the document says that
 * no generated client will ever see. This is a vocabulary, not an exemption list: it exists so a typo in a
 * keyword is reported instead of quietly dropped.
 */
const KNOWN_SCHEMA_KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'const', '$ref',
  'additionalProperties', 'oneOf', 'anyOf', 'allOf', 'not', 'nullable',
  'description', 'title', 'default', 'example', 'deprecated', 'readOnly', 'writeOnly', 'format',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'propertyNames', 'contains',
  'discriminator', 'externalDocs', 'xml', '$defs', 'definitions',
]);

/**
 * Schema-node keywords the document carries and nothing downstream reads.
 *
 * Found the hard way: a YAML flow mapping whose `description` value contains an unquoted comma-and-colon
 * parses as a short description plus a NEW KEY named after the rest of the sentence. Ajv runs non-strict, so
 * validation passes; `checkSpec` walks known keywords, so the integrity check passes; the prose simply stops
 * reaching anyone. An emitter that said nothing about the keyword it ignored would have kept that quiet forever.
 */
export function unexpressedKeywords(doc: SpecDocument): string[] {
  const found: string[] = [];
  const visit = (node: unknown, where: string, depth: number): void => {
    if (depth > 12) return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${where}[${String(i)}]`, depth + 1));
      return;
    }
    if (!isPlainObject(node)) return;
    const schemaLike = typeof node.type === 'string' || node.properties !== undefined || node.$ref !== undefined
      || node.items !== undefined || node.enum !== undefined || node.const !== undefined;
    if (schemaLike) {
      for (const name of Object.keys(node)) {
        if (KNOWN_SCHEMA_KEYWORDS.has(name) || name.startsWith('x-')) continue;
        found.push(`${where}: "${name}" holds ${JSON.stringify(node[name])}`);
      }
    }
    for (const [name, value] of Object.entries(node)) visit(value, `${where}.${name}`, depth + 1);
  };
  visit(schemasOf(doc), 'components.schemas', 0);
  visit(doc.paths ?? {}, 'paths', 0);
  return found.sort();
}

/**
 * Collapse a spec description to one comment line: descriptions are prose, comments are not a paragraph engine.
 *
 * Prose does arrive in odd shapes, and the flattening is what keeps the emitter from writing a broken comment
 * out of a valid document -- `unexpressedKeywords` is the check that says when the document itself is not valid.
 */
function describeText(description: unknown): string {
  if (typeof description !== 'string') return '';
  return inline(description.trim().replace(/\s+/g, ' '));
}

/** Neutralise anything that could close the comment it is being written into. */
function inline(text: string): string {
  return text.replaceAll('*/', '* /').replaceAll('/*', '/ *');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every refusal names where in the document it came from, so the fix is findable without a debugger. */
function refuse(pointer: string, message: string): Error {
  return new Error(`cannot generate a type for ${pointer || '<root>'}: ${message}`);
}
