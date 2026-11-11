/**
 * `pnpm run api:check` -- the OpenAPI rule made mechanical (D41).
 *
 * Three questions, all answerable from the repo alone:
 *   1. Is the spec internally true? (examples that violate their own schema, dangling refs, `required`
 *      naming undeclared properties, undeclared path parameters, operations with no security declaration.)
 *   2. Does the implementation match it? (route manifest vs spec operations, in both directions.)
 *   3. Is anything that would make the answer a lie skipped? (the route manifest is imported, not faked; if
 *      the app module is absent the check reports SKIPPED, not passed.)
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkRouteManifest, checkSpec, loadSpec, operationsOf, type RouteManifestEntry } from '../packages/api-contract/src/index.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC_PATH = path.join(ROOT, 'api/control-plane.openapi.yaml');
const ROUTES_MODULE = path.join(ROOT, 'apps/control-plane/src/routes.ts');

const problems: string[] = [];
if (!existsSync(SPEC_PATH)) {
  console.error(`api:check -- no spec at ${path.relative(ROOT, SPEC_PATH)}. The rule is spec-first; there is nothing to check against.`);
  process.exit(1);
}

const doc = loadSpec(await fs.readFile(SPEC_PATH, 'utf8'));
problems.push(...checkSpec(doc));
const ops = operationsOf(doc);
console.log(`  spec: ${ops.length} operation(s), openapi ${String(doc.openapi)}`);

let routeState = 'SKIPPED';
if (existsSync(ROUTES_MODULE)) {
  const mod = (await import(ROUTES_MODULE)) as { ROUTE_MANIFEST?: RouteManifestEntry[] };
  const routes = mod.ROUTE_MANIFEST;
  if (!Array.isArray(routes)) {
    problems.push(`${path.relative(ROOT, ROUTES_MODULE)} must export ROUTE_MANIFEST as an array of {method, path, operationId}`);
  } else {
    problems.push(...checkRouteManifest(doc, routes));
    routeState = 'checked';
    console.log(`  routes: ${String(routes.length)} declared in the app manifest`);
  }
} else {
  console.log(`  routes: SKIPPED -- ${path.relative(ROOT, ROUTES_MODULE)} does not exist yet, so drift is unverified`);
}

if (problems.length) {
  console.error(`\napi:check failed with ${String(problems.length)} problem(s):`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`  api:check passed (${String(ops.length)} operations, route manifest ${routeState})`);
