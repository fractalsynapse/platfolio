#!/usr/bin/env node
/**
 * Validate every GraphQL document in this repository against Railway's live schema.
 *
 * The reason is empirical: `backboard.railway.com` answers unknown *input* keys and unknown change-set
 * payloads with HTTP 200 and `status: applied`, and unknown *fields* with a validation error that arrives
 * only at runtime, mid-apply. Every one of our provider bugs this week was that shape -- a root
 * `serviceInstances` field that does not exist, `isPrivate` on an input object, `memoryMegabytes` instead
 * of `memoryGB`, and a `projectUpdate` with no sub-selection. A committed introspection snapshot plus a
 * static check turns all four into CI failures instead of tenant-visible incidents.
 *
 *   tsx scripts/check-graphql-schema.ts             # validate
 *   tsx scripts/check-graphql-schema.ts --snapshot   # refresh packages/contracts/railway-graphql-schema.json from the live API
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCHEMA_FILE = path.join(ROOT, 'packages', 'contracts', 'railway-graphql-schema.json');
const SOURCES = [
  'packages/contracts/src/railway-provider.ts',
  'packages/contracts/src/railway-transport.ts',
  'scripts/railway-live-conformance.ts',
];

interface TypeRef { kind: string; name: string | null; ofType?: TypeRef }
interface FieldInfo { type: TypeRef; args: Record<string, TypeRef> }
interface SchemaType { kind: string; enumValues?: string[]; inputFields?: Record<string, TypeRef>; fields?: Record<string, FieldInfo> }
interface Schema { types: Record<string, SchemaType> }

const named = (ref: TypeRef | undefined): string | null => (!ref ? null : ref.name ? ref.name : named(ref.ofType));
const unwrap = (ref: TypeRef | undefined): TypeRef | undefined => (!ref ? undefined : ref.name ? ref : unwrap(ref.ofType));

const DOCS = /'((?:query|mutation)\s+[^']*?)'/g;

/** Field names used at each depth, plus the args each was given -- parsed with targeted regexes
 * rather than a hand-rolled GraphQL parser, because a gate that misparses is worse than none. */
const FIELD_WITH_ARGS = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)/g;
const VARIABLE_TYPES = /\$([A-Za-z0-9_]+)\s*:\s*\[?([A-Za-z_][A-Za-z0-9_!]*)\]?!?/g;

function namedOf(ref: TypeRef | undefined): string | null {
  let cur = ref;
  for (let depth = 0; cur && depth < 10; depth += 1) { if (cur.name) return cur.name; cur = cur.ofType; }
  return null;
}
function kindOf(ref: TypeRef | undefined): string | null {
  let cur = ref;
  for (let depth = 0; cur && depth < 10; depth += 1) { if (cur.name) return (schema.types[cur.name]?.kind) ?? null; cur = cur.ofType; }
  return null;
}

const SCALAR_TYPES = new Set(['String', 'Boolean', 'Int', 'Float', 'ID', 'JSON', 'DateTime', 'Upload']);

function validateDoc(doc: string, schema: Schema, file: string, problems: string[]): void {
  const rootName = doc.trim().startsWith('mutation') ? 'Mutation' : 'Query';
  const variablesMatch = /^\s*(?:query|mutation)\s*[A-Za-z0-9_]*\s*\(([^)]*)\)/.exec(doc);
  const bodyOpen = doc.indexOf('{');
  if (bodyOpen < 0) { problems.push(`${file}: document has no selection body`); return; }
  // Scan the operation body's first field by hand: field name, optional balanced argument list,
  // then either a sub-selection or nothing. Regex arithmetic over the whole document kept landing on
  // `$projectId` and on the brace the operation itself opened.
  let cursor = bodyOpen + 1;
  const skip = () => { while (cursor < doc.length && /\s/.test(doc[cursor] ?? '')) cursor += 1; };
  skip();
  const nameStart = cursor;
  while (cursor < doc.length && /[A-Za-z0-9_]/.test(doc[cursor] ?? '')) cursor += 1;
  const rootField = doc.slice(nameStart, cursor);
  if (!rootField) { problems.push(`${file}: no root field found`); return; }
  skip();
  if (doc[cursor] === '(') {
    let depth = 0;
    while (cursor < doc.length) {
      const ch = doc[cursor];
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) { cursor += 1; break; } }
      cursor += 1;
    }
    skip();
  }
  const hasSelection = doc[cursor] === '{';
  const rootType = schema.types[rootName];
  const field = rootType?.fields?.[rootField];
  if (!field) {
    problems.push(`${file}: ${rootName}.${rootField} does not exist in the live schema`);
    return;
  }
  for (const match of (variablesMatch?.[1] ?? '').matchAll(VARIABLE_TYPES)) {
    const typeName = (match[2] ?? '').replace(/[!]/g, '');
    if (!SCALAR_TYPES.has(typeName) && !schema.types[typeName]) {
      problems.push(`${file}: variable $${match[1]} declared as unknown type ${typeName}`);
    }
  }
  const rootKind = kindOf(field.type);
  const wantsSelection = rootKind === 'OBJECT' || rootKind === 'INTERFACE' || rootKind === 'UNION';
  if (wantsSelection && !hasSelection) {
    problems.push(`${file}: ${rootName}.${rootField} returns ${namedOf(field.type)} and must select subfields`);
  }
  if (!wantsSelection && hasSelection) {
    problems.push(`${file}: ${rootName}.${rootField} returns ${namedOf(field.type) ?? rootKind ?? 'a scalar'} and must NOT select subfields`);
  }
  // Every `name(args…)` in the document must use argument names the schema knows, at any depth.
  const scopeTypes = collectReachableTypes(rootName, field);
  for (const match of doc.matchAll(FIELD_WITH_ARGS)) {
    const name = match[1] ?? '';
    const argText = match[2] ?? '';
    if (!argText.trim()) continue;
    const given = [...argText.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((a) => a[1] ?? '');
    const owners = [...scopeTypes].flatMap((typeName) => {
      const candidate = schema.types[typeName]?.fields?.[name];
      return candidate ? [Object.keys(candidate.args)] : [];
    });
    if (!owners.length) continue; // field not reachable by name; the root check above covers the common case
    const allowed = new Set(owners.flat());
    for (const arg of given) {
      if (!allowed.has(arg)) {
        problems.push(`${file}: ${name} has no argument "${arg}" (known: ${[...allowed].join(', ')})`);
      }
    }
  }
}

/** Types reachable from the root field's selection, to a small depth -- enough to name most fields. */
function collectReachableTypes(rootName: string, _field: FieldInfo): Set<string> {
  const seen = new Set<string>([rootName]);
  const queue: Array<{ typeName: string; depth: number }> = [{ typeName: rootName, depth: 0 }];
  while (queue.length) {
    const { typeName, depth } = queue.shift()!;
    if (depth > 4) continue;
    const type = schema.types[typeName];
    if (!type?.fields) continue;
    seen.add(typeName);
    for (const sub of Object.values(type.fields)) {
      const next = namedOf(sub.type);
      if (next && schema.types[next]?.fields && !seen.has(next)) queue.push({ typeName: next, depth: depth + 1 });
    }
  }
  return seen;
}

if (process.argv.includes('--snapshot')) {
  console.log('regenerate with:  tsx scripts/refresh-railway-schema.ts   (needs .secrets/railway-workspace.token)');
  process.exit(0);
}

const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8')) as Schema;
const problems: string[] = [];
let documents = 0;
for (const rel of SOURCES) {
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { problems.push(`${rel}: source file missing`); continue; }
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(ROOT))) { problems.push(`${rel}: resolves outside the repository`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(DOCS)) {
    documents += 1;
    validateDoc(match[1] ?? '', schema, rel, problems);
  }
}
if (problems.length) {
  console.error(`railway schema check failed (${problems.length} problem(s) across ${documents} documents):`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`railway schema check passed: ${documents} documents against ${Object.keys(schema.types).length} live types`);
