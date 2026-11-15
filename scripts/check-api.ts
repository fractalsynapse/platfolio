/**
 * `pnpm run api:check` -- the OpenAPI rule made mechanical (D41).
 *
 * Four questions, all answerable from the repo alone:
 *   1. Is the spec internally true? (examples that violate their own schema, dangling refs, `required`
 *      naming undeclared properties, undeclared path parameters, operations with no security declaration.)
 *   2. Does the implementation match it? (route manifest vs spec operations, in both directions.)
 *   3. Is anything that would make the answer a lie skipped? (the route manifest is imported, not faked; if
 *      the app module is absent the check reports SKIPPED, not passed.)
 *   4. Is the spec re-inventing a shape that a StandardSchema already defines? (#247 -- AGENTS.md says the
 *      schema is the source and the spec is generated or compared against it. This is that comparison: the
 *      code side is emitted from the definitions themselves, never from a list of field names, and every
 *      tolerated difference is named with a reason that goes stale the moment the drift is fixed. Property
 *      names and required-ness are refused on; types, enums and bounds are counted and printed, because the
 *      measured difference there is partly dialect and a hundred lines of `minLength` would bury the five
 *      findings that matter. `--strict` refuses the tolerated ones too -- see KNOWN_DRIFT.)
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  checkRouteManifest,
  checkSpec,
  loadSpec,
  operationsOf,
  type RouteManifestEntry,
} from '../packages/api-contract/src/index.ts';
import {
  checkParityLedger,
  checkSchemaParity,
  checkUnmatchedLedger,
  deriveSchemas,
  KNOWN_DRIFT,
  type ParityReport,
  summariseConstraints,
} from '../packages/api-contract/src/schema-parity.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPEC_PATH = path.join(ROOT, 'apps/control-plane/openapi.yaml');
const ROUTES_MODULE = path.join(ROOT, 'apps/control-plane/src/routes.ts');
const CONTRACTS_MODULE = path.join(ROOT, 'packages/contracts/src/index.ts');

/**
 * `--strict` refuses the differences the drift ledger currently tolerates. It is how the list gets walked down:
 * the fix is a change to the spec or to the schema, and the deletion of one entry here, and until the last entry
 * goes this is the command that says so. It is not in `verify`, because a gate nobody can pass is a gate that
 * gets turned off.
 */
const STRICT = process.argv.includes('--strict');

/** How many lines of the reported (not refused) tiers to print. A cap on noise, not on what is counted. */
const SHAPE_PREVIEW = 10;

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

let parityState = 'SKIPPED';
let parity: ParityReport | undefined;
if (!existsSync(CONTRACTS_MODULE)) {
  console.log('  schemas: SKIPPED -- packages/contracts/src/index.ts is absent, so spec-vs-schema drift is unverified');
} else {
  const exported = Object.entries(await import(CONTRACTS_MODULE));
  const derivation = deriveSchemas(exported);
  parity = checkSchemaParity(doc, derivation.derived);
  parityState = 'checked';

  const compared = new Set(parity.matched);
  const unused = derivation.derived.filter((d) => !compared.has(d.name));
  console.log(`  schemas: ${String(derivation.derived.length)} definition(s) derived from packages/contracts, `
    + `${String(parity.matched.length)} compared against a component of the same name, ${String(unused.length)} with no component of that name`
    + (derivation.skippedNonSchema.length ? ` (${derivation.skippedNonSchema.join(', ')} end in "Schema" but are not schemas)` : ''));
  console.log(`  components: ${String(parity.matched.length + parity.unmatched.length)} in the spec -- matched ${String(parity.matched.length)} [${parity.matched.join(', ')}]`);
  console.log(`               unmatched ${String(parity.unmatched.length)} [${parity.unmatched.join(', ')}]`);

  problems.push(...derivation.undervisitable.map((u) =>
    `${u.source} is the code-side definition of ${u.name} but no JSON Schema could be emitted from it (${u.reason}). `
    + 'An unexamined shape is not a match: express the constraint in a form zod can serialise, or this gate cannot check it and neither can a generated client.'));

  const ledger = checkParityLedger(parity.structural, KNOWN_DRIFT, { strict: STRICT });
  for (const finding of ledger.unexpected) problems.push(`spec vs schema (#247): ${finding.message}`);
  for (const stale of ledger.stale) {
    problems.push(`KNOWN_DRIFT entry ${stale.key} describes a difference that no longer exists -- "${stale.reason.replace(/\s+/g, ' ')}" -- so the drift is fixed and the entry must be deleted`);
  }
  problems.push(...checkUnmatchedLedger(parity));
  if (STRICT) console.log(`  mode: STRICT -- the drift ledger is not honouring differences in this run (${String(ledger.unexpected.length)} refused)`);

  if (ledger.tolerated.length) {
    console.log(`  drift ledger: ${String(ledger.tolerated.length)} structural difference(s) tolerated, each with a reason that expires when the drift is fixed:`);
    for (const finding of ledger.tolerated) {
      const reason = KNOWN_DRIFT.find((entry) => entry.key === finding.key)?.reason ?? '(none)';
      console.log(`   - ${finding.message}`);
      console.log(`     tolerated because ${reason.replace(/\s+/g, ' ')}`);
    }
    console.log('     \`pnpm run api:check:strict\` refuses these too; that is the command the list is walked down with.');
  }
  if (parity.semantic.length) {
    console.log(`  shape differences reported, not refused on: ${String(parity.semantic.length)} (property types and enum value sets).`);
    for (const line of parity.semantic.slice(0, SHAPE_PREVIEW)) {
      console.log(`   - ${line.component}${line.pointer || '/'}: ${line.detail}`);
    }
    if (parity.semantic.length > SHAPE_PREVIEW) console.log(`   ... and ${String(parity.semantic.length - SHAPE_PREVIEW)} more`);
  }
  if (parity.constraints.length) {
    const byKeyword = summariseConstraints(parity.constraints);
    console.log(`  constraint keywords the two sides write differently: ${String(parity.constraints.length)} difference(s) over the ${String(parity.matched.length)} compared components.`);
    console.log(`   ${byKeyword.map((row) => `${row.keyword}: ${String(row.onlyInSchema)} schema-only, ${String(row.onlyInSpec)} spec-only, ${String(row.different)} unlike`).join('; ')}`);
    console.log('   Counted, not refused on: `minLength: 1` on every id is effort the schema put in that the document did not. '
      + 'The ones worth reading are the `unlike` figures -- a bound written two different ways is a client that disagrees with a server about what is valid.');
    for (const row of parity.constraints.filter((c) => c.way === 'different').slice(0, SHAPE_PREVIEW)) {
      console.log(`   - ${row.component}${row.pointer || '/'}: ${row.detail}`);
    }
    const unlike = parity.constraints.filter((c) => c.way === 'different').length;
    if (unlike > SHAPE_PREVIEW) console.log(`   ... and ${String(unlike - SHAPE_PREVIEW)} more written differently`);
  }
}

if (problems.length) {
  console.error(`\napi:check failed with ${String(problems.length)} problem(s):`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`  api:check passed (${String(ops.length)} operations, route manifest ${routeState}, schema parity ${parityState}${parity ? `: ${String(parity.matched.length)} compared` : ''})`);
