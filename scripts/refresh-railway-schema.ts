#!/usr/bin/env node
/**
 * Refresh `api/railway-schema.json` from Railway's live introspection.
 *
 * Needs a workspace token in `.secrets/railway-workspace.token` (untracked; the credential-hygiene gate
 * refuses to track it). Introspection is public, but the token keeps the request inside the grant we
 * already hold rather than adding a second credential path. Run this when the provider starts using new
 * fields, and let `graphql:check` tell you whether the snapshot went stale.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'api', 'railway-schema.json');
const TOKEN_FILE = path.join(ROOT, '.secrets', 'railway-workspace.token');

if (!fs.existsSync(TOKEN_FILE)) {
  console.error(`error: ${path.relative(ROOT, TOKEN_FILE)} not found; introspection needs a grant`);
  process.exit(1);
}
if (!fs.realpathSync(OUT).startsWith(fs.realpathSync(ROOT))) {
  console.error('error: refusing to write outside the repository');
  process.exit(1);
}

const QUERY = `{ __schema { types { kind name enumValues { name }
  inputFields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  fields { name args { name type { kind name ofType { kind name ofType { kind name } } } }
    type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } }`;

const body = JSON.stringify({ query: QUERY });
const raw = execFileSync('curl', ['-sS', 'https://backboard.railway.com/graphql/v2',
  '-H', `Authorization: Bearer ${fs.readFileSync(TOKEN_FILE, 'utf8').trim()}`,
  '-H', 'Content-Type: application/json', '--data-binary', body], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const parsed = JSON.parse(raw) as { data?: { __schema: { types: unknown[] } }, errors?: { message: string }[] };
if (parsed.errors) {
  console.error(`error: introspection failed: ${parsed.errors.map((e) => e.message).join('; ').slice(0, 200)}`);
  process.exit(1);
}

type RawRef = { kind: string; name: string | null; ofType?: RawRef | null };
function ref(t: RawRef | null | undefined, depth = 0): unknown {
  if (!t || depth > 10) return null;
  return t.name ? { kind: t.kind, name: t.name } : { kind: t.kind, ofType: ref(t.ofType, depth + 1) };
}

const types: Record<string, unknown> = {};
for (const raw of parsed.data?.__schema.types ?? []) {
  const ty = raw as { kind: string; name: string; enumValues?: { name: string }[] | null; inputFields?: { name: string; type: RawRef }[] | null; fields?: { name: string; args: { name: string; type: RawRef }[]; type: RawRef }[] | null };
  if (ty.name.startsWith('__')) continue;
  const entry: Record<string, unknown> = { kind: ty.kind };
  if (ty.enumValues?.length) entry.enumValues = ty.enumValues.map((e) => e.name);
  if (ty.inputFields?.length) entry.inputFields = Object.fromEntries(ty.inputFields.map((f) => [f.name, ref(f.type)]));
  if (ty.fields?.length) entry.fields = Object.fromEntries(ty.fields.map((f) => [f.name, { type: ref(f.type), args: Object.fromEntries(f.args.map((a) => [a.name, ref(a.type)])) }]));
  types[ty.name] = entry;
}

fs.writeFileSync(OUT, JSON.stringify({ types }, null, 0));
console.log(`refreshed ${path.relative(ROOT, OUT)}: ${Object.keys(types).length} types, ${fs.statSync(OUT).size} bytes`);
