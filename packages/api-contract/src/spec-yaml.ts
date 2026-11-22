import { parseDocument } from 'yaml';

/**
 * The deterministic YAML writer the OpenAPI component generator emits through (#247).
 *
 * WHY THIS FILE EXISTS INSTEAD OF `stringify` FROM `yaml`: measured on `apps/control-plane/openapi.yaml`,
 * `parseDocument(text) -> String(doc)` is NOT byte-identical (85,130 bytes in, 89,216 out with the default
 * options, 85,190 with `lineWidth: 0`), because the library rewrites flow collections
 * (`tags: [operational]` becomes `tags: [ operational ]`) and re-folds long scalars. A document that is
 * partly generated and partly hand-written therefore cannot be re-emitted wholesale without a diff of pure
 * formatting. So the generator splices: it replaces only the character range of each component it owns, and
 * every other byte of the file is carried through unchanged. That needs an emitter whose bytes are a pure
 * function of the value, which is what this file is.
 *
 * Four rules make it safe to hand-write YAML at all:
 *
 *  - **The output is re-parsed and compared before it is trusted.** `renderComponent` renders, parses the
 *    result back with the real YAML parser, and deep-compares it against the value it meant to write. A
 *    quoting or indentation mistake is therefore a build failure AT THE POINT OF GENERATION, not a document
 *    that silently means something else. That is deliberate: more than one patch in this repository's recent
 *    history wrote invalid YAML from guessed indentation and nothing noticed until a parser did.
 *  - **Indentation is absolute, never re-applied.** Every node is rendered with the column it will be written
 *    at, passed down by the caller. There is no "render, then shift the string" step, because shifting is
 *    the step that produces keys at the wrong depth and colliding map entries.
 *  - **A schema node's keywords come from a fixed vocabulary, in a fixed order,** and an unknown keyword is
 *    refused rather than appended. A *property* map is not a schema node: its keys are field names, written
 *    in definition order -- which is why `NodeKind` exists instead of guessing from the shape of the object.
 *  - **Anything the generator was not told how to write is refused, naming the component and the pointer** --
 *    the same discipline `generate-types.ts` applies to the document. Refusing beats approximating.
 *
 * The house style reproduced here is the one already in the document: leaf schema nodes on one flow line
 * (`id: { type: string, minLength: 1 }`), prose as a clipped block scalar, `required`/`enum` inline.
 */

/** The canonical order of schema keywords. Anything outside it is refused, not silently ordered. */
const KEY_ORDER = [
  'type', 'title', 'description', 'format', 'contentMediaType',
  'pattern', 'enum', 'const', 'default', 'examples', 'example',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength',
  'minItems', 'maxItems', 'uniqueItems',
  'items', 'prefixItems',
  'oneOf', 'anyOf', 'allOf', 'not',
  'required', 'properties', 'propertyNames', 'additionalProperties', 'unevaluatedProperties',
  'deprecated', 'readOnly', 'writeOnly', 'nullable', 'discriminator',
] as const;

const KEY_RANK = new Map<string, number>(KEY_ORDER.map((key, i) => [key, i]));

/** Schema-valued keywords: their value is itself a schema, so the child gets the schema vocabulary. */
const SCHEMA_CHILDREN = new Set(['items', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'not']);
const SCHEMA_LISTS = new Set(['oneOf', 'anyOf', 'allOf', 'prefixItems']);

/** A construct this emitter will not write. Names the component and the pointer, so the refusal is actionable. */
export class SpecRenderError extends Error {
  constructor(component: string, pointer: string, detail: string) {
    super(`${component}${pointer === '' ? ' /<root>' : pointer}: ${detail}`);
    this.name = 'SpecRenderError';
  }
}

/**
 * `schema` -- keys are JSON Schema keywords.
 * `members` -- the value of `properties`: keys are field names.
 * `value` -- data the schema does not own (an `example`), written as YAML data, never as a schema.
 */
export type NodeKind = 'schema' | 'members' | 'value';

/**
 * A rendered node in one of exactly three shapes, so no caller has to guess:
 *  - `inline` -- goes after `key: ` on the parent's line
 *  - `block` -- the parent writes a bare `key:` then these lines, already absolutely indented
 *  - `literal` -- a multi-line scalar: the parent writes `key: |-` then these lines at +2, and the parser
 *    hands the lines back joined by newlines
 *  - `folded`  -- wrapped prose: the parent writes `key: >-` and the parser rejoins the lines with SPACES, so
 *    a sentence wrapped for reading is the same string it was before the wrap
 *
 * `literal` and `folded` are not interchangeable and picking wrong is a silent meaning change: measured, a
 * `|-` block written from word-wrapped prose reads back with newlines inside the sentence. The round-trip
 * comparison at the bottom of this file is what caught it here, and it is what keeps it caught.
 */
type Out =
  | { style: 'inline'; text: string }
  | { style: 'block'; lines: string[] }
  | { style: 'literal'; lines: string[] }
  | { style: 'folded'; lines: string[] };

export interface RenderOptions {
  /** The component name, so every refusal names what to fix. */
  component: string;
  /** Column of the component's own key. 4 for a member of `components.schemas`. */
  indent: number;
  /**
   * Maintenance prose written as YAML comments inside the block, under the component's key.
   *
   * Comments are part of the generated bytes. That is the only way a partly generated document keeps the
   * notes it already has: prose a reader needs and a schema cannot express arrives as data
   * (`spec-annotations.ts`), so it is written deterministically and checked, instead of being lost to the
   * splice or typed by hand where nothing can see it move.
   */
  note?: string[];
}

/** Render one component -- `Instance:` plus its body -- ready to splice into the document. */
export function renderComponent(name: string, value: unknown, options: RenderOptions): string {
  const out = render(value, options.indent + 2, `/${name}`, 'schema', options);
  const pad = ' '.repeat(options.indent);
  const note = (options.note ?? [])
    .map((line) => `${pad}  ${line.startsWith('#') ? line : `# ${line}`}`)
    .join('\n');
  const key = `${pad}${name}:`;
  const head = note === '' ? key : `${key}\n${note}`;
  const text = out.style === 'inline'
    ? `${head} ${out.text}`
    : out.style === 'literal' || out.style === 'folded'
      ? `${head} ${out.style === 'folded' ? '>-' : '|-'}\n${out.lines.map((l) => `${' '.repeat(options.indent + 2)}${l}`).join('\n')}`
      : `${head}\n${out.lines.join('\n')}`;

  assertRoundTrips(name, text, value, options.indent);
  return text;
}

function render(value: unknown, column: number, pointer: string, kind: NodeKind, options: RenderOptions): Out {
  if (Array.isArray(value)) return renderList(value, column, pointer, kind, options);
  if (typeof value === 'string') {
    // Only a `description` is reformatted. Every other string is a value the schema produced -- a pattern, an
    // enum member, a `$ref` -- and changing how one of those is written changes what it means.
    const prose = lastSegment(pointer) === 'description' ? proseLines(value) : null;
    if (prose !== null) return { style: prose.style, lines: prose.lines };
    return { style: 'inline', text: scalarText(value, options.component, pointer) };
  }
  if (isRecord(value)) return renderMap(value, column, pointer, kind, options);
  return { style: 'inline', text: scalarText(value, options.component, pointer) };
}

/**
 * Long prose becomes a block scalar, wrapped at word boundaries.
 *
 * The hand-written document already reads this way, and a 430-character `description:` line is not something
 * a reviewer can compare against anything. Only `description` is folded, and only when it is long, because a
 * folded scalar is still a string the parser must hand back unchanged -- which `assertRoundTrips` verifies on
 * every component, so a wrap that loses a space or a newline is a build failure at the point of generation
 * rather than a document that reads differently from the value.
 */
/** The keyword or field a pointer ends on -- `…/properties/name/description` -> `description`. */
function lastSegment(pointer: string): string {
  const parts = pointer.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * How a `description` should be written, or `null` when it fits on one line as a scalar.
 *
 * `literal` when the text itself carries line breaks -- those are the author's, and folding would replace them
 * with spaces. `folded` when a long sentence had to be wrapped to fit the page, which the parser undoes.
 */
function proseLines(value: string): { style: 'literal' | 'folded'; lines: string[] } | null {
  if (value.includes('\n')) return { style: 'literal', lines: value.split('\n') };
  if (value.length <= 88) return null;
  const wrapped = wrapLines(value);
  return wrapped === null ? null : { style: 'folded', lines: wrapped };
}

/** Word-wrap at 88 columns. A single word longer than the width aborts the fold -- folding cannot help it. */
function wrapLines(value: string): string[] | null {
  const words = value.split(' ');
  if (words.some((w) => w.length > 88)) return null;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current === '') current = word;
    else if (`${current} ${word}`.length <= 88) current = `${current} ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current !== '') lines.push(current);
  return lines.length > 1 ? lines : null;
}

function renderMap(node: Record<string, unknown>, column: number, pointer: string, kind: NodeKind, options: RenderOptions): Out {
  const keys = Object.keys(node);
  if (keys.length === 0) return { style: 'inline', text: '{}' };

  if (kind !== 'schema') return { style: 'block', lines: keyLines(node, keys, column, pointer, kind, options) };

  assertKnownKeywords(keys, options.component, pointer);
  const ordered = schemaOrder(keys);
  const flow = flowForm(node, ordered, options, pointer);
  if (flow !== null) return { style: 'inline', text: flow };
  return { style: 'block', lines: keyLines(node, ordered, column, pointer, kind, options) };
}

function keyLines(node: Record<string, unknown>, keys: string[], column: number, pointer: string, kind: NodeKind, options: RenderOptions): string[] {
  const inner = column + 2;
  const lines: string[] = [];
  for (const key of keys) {
    const childPointer = `${pointer}/${key}`;
    const child = render(node[key], inner, childPointer, childKind(kind, key), options);
    const prefix = `${' '.repeat(column)}${key}`;
    if (child.style === 'inline') {
      lines.push(`${prefix}: ${child.text}`);
      continue;
    }
    if (child.style === 'literal' || child.style === 'folded') {
      lines.push(`${prefix}: ${child.style === 'folded' ? '>-' : '|-'}`, ...child.lines.map((l) => `${' '.repeat(inner)}${l}`));
      continue;
    }
    lines.push(`${prefix}:`, ...child.lines);
  }
  return lines;
}

/** `properties` holds field names; composition/`items` hold schemas; everything else holds data. */
function childKind(parent: NodeKind, key: string): NodeKind {
  if (parent === 'members') return 'schema';
  if (parent !== 'schema') return 'value';
  if (key === 'properties') return 'members';
  if (SCHEMA_CHILDREN.has(key) || SCHEMA_LISTS.has(key)) return 'schema';
  return 'value';
}

function renderList(list: unknown[], column: number, pointer: string, kind: NodeKind, options: RenderOptions): Out {
  if (list.length === 0) return { style: 'inline', text: '[]' };
  if (list.every(isScalarValue)) {
    return { style: 'inline', text: `[${list.map((v) => scalarText(v, options.component, pointer)).join(', ')}]` };
  }
  const itemKind: NodeKind = kind === 'value' ? 'value' : 'schema';
  const inner = column + 2;
  // A mapping written after `- ` begins two columns right of the dash; its own lines keep their columns.
  const lines: string[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = render(list[i], inner + 2, `${pointer}/[${String(i)}]`, itemKind, options);
    const dash = `${' '.repeat(inner)}-`;
    if (item.style === 'inline') {
      lines.push(`${dash} ${item.text}`);
      continue;
    }
    if (item.style === 'literal' || item.style === 'folded') {
      lines.push(`${dash} ${item.style === 'folded' ? '>-' : '|-'}`, ...item.lines.map((l) => `${' '.repeat(inner + 4)}${l}`));
      continue;
    }
    const [first, ...rest] = item.lines;
    lines.push(`${dash} ${(first ?? '').trimStart()}`, ...rest);
  }
  return { style: 'block', lines };
}

/**
 * The one-line form the document prefers for schema nodes with no nested schema.
 * `null` means "this node must be a block": a nested schema, a multi-line string, or too much text.
 */
function flowForm(node: Record<string, unknown>, keys: string[], options: RenderOptions, pointer: string): string | null {
  const parts: string[] = [];
  for (const key of keys) {
    const value = node[key];
    if (isRecord(value)) return null;
    if (Array.isArray(value)) {
      if (!value.every(isScalarValue)) return null;
      parts.push(`${key}: [${value.map((v) => scalarText(v, options.component, `${pointer}/${key}`)).join(', ')}]`);
      continue;
    }
    if (typeof value === 'string' && value.includes('\n')) return null;
    parts.push(`${key}: ${scalarText(value, options.component, `${pointer}/${key}`)}`);
  }
  if (parts.length === 0) return null;
  const flow = `{ ${parts.join(', ')} }`;
  return flow.length <= 110 ? flow : null;
}

function schemaOrder(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ra = KEY_RANK.get(a) ?? UNRANKED;
    const rb = KEY_RANK.get(b) ?? UNRANKED;
    return ra !== rb ? ra - rb : (a < b ? -1 : 1);
  });
}

const UNRANKED = Number.MAX_SAFE_INTEGER;

function assertKnownKeywords(keys: string[], component: string, pointer: string): void {
  for (const key of keys) {
    if (KEY_RANK.has(key) || key.startsWith('x-')) continue;
    throw new SpecRenderError(component, pointer,
      `"${key}" is not a keyword this generator writes -- the schema produced a construct the document cannot carry, or an annotation invented a constraint. Express it in the definition instead of teaching the emitter to hide it`);
  }
}

/** A scalar as text. Multi-line strings are intercepted by `render` before they reach here. */
function scalarText(value: unknown, component: string, pointer: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      throw new SpecRenderError(component, pointer, 'a multi-line string reached a place that needs a scalar, where a block scalar cannot be written');
    }
    return quote(value);
  }
  throw new SpecRenderError(component, pointer, `${typeof value} cannot be written as a YAML scalar`);
}

/**
 * A string as YAML text: plain when nothing can misread it, single-quoted otherwise, with YAML's doubled
 * `''` escape. The parser round-trip in `assertRoundTrips` is what proves the choice, not this comment.
 */
function quote(value: string): string {
  if (value.length === 0) return "''";
  if (plainSafe(value)) return value;
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * A plain scalar is legal only when nothing in it can be read as structure or as another type.
 *
 * The allowed alphabet is deliberately narrow -- letters, digits, `_`, space, `/`, `.`, `-` -- rather than
 * "everything except the characters YAML happens to reserve". Measured reason: a description containing a
 * comma or a parenthesis inside a FLOW mapping (`{ type: string, description: Normalised (trimmed and
 * case-folded) on write., minLength: 3 }`) reads as something other than what was written, and a blacklist
 * has to be exactly right to catch that. A whitelist only has to be conservative. Everything else is
 * quoted, which is what the hand-written document already does for prose.
 */
function plainSafe(value: string): boolean {
  if (AMBIGUOUS.has(value.toLowerCase())) return false;
  if (!/^[A-Za-z][A-Za-z0-9_ .\/-]*$/.test(value)) return false;
  if (value.trimEnd() !== value) return false;
  if (/^\d+$/.test(value) || /^\d*\.\d+$/.test(value)) return false;
  return true;
}

/** Strings YAML would otherwise read as a boolean, a null, or a number. */
const AMBIGUOUS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~', '']);

/**
 * Prove the bytes mean the value.
 *
 * The component text is dedented, parsed by the real YAML parser, and deep-compared against the value the
 * schema produced -- key-sorted, so an ordering choice in the writer cannot fail a fair comparison and a
 * semantic difference cannot pass one. This is what turns "I think the indentation is right" into a measured
 * fact, and it runs on every component before anything is written to disk.
 */
function assertRoundTrips(component: string, text: string, value: unknown, indent: number): void {
  const dedented = text.split('\n')
    .map((line) => (line.trim() === '' ? '' : line.slice(Math.min(indent, line.length - line.trimStart().length))))
    .join('\n');
  const doc = parseDocument(`${dedented}\n`, { logLevel: 'silent' });
  if (doc.errors.length) {
    throw new SpecRenderError(component, '', `the generated YAML does not parse: ${doc.errors.map((e) => e.message).join('; ')}`);
  }
  const parsed = (doc.toJS() as Record<string, unknown>)[component];
  const want = JSON.parse(JSON.stringify(value ?? null)) as unknown;
  if (JSON.stringify(sortKeys(parsed)) !== JSON.stringify(sortKeys(want))) {
    throw new SpecRenderError(component, '', 'the generated YAML re-parses to a different value than the schema produced -- refusing to write a document that does not mean what the definition means\n'
      + `  wanted: ${JSON.stringify(want)?.slice(0, 600)}\n  read  : ${JSON.stringify(sortKeys(parsed))?.slice(0, 600)}`);
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalarValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
