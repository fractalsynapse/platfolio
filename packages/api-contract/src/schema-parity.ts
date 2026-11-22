import { resolveNode, type SpecDocument } from './index.ts';

/**
 * Spec components versus code-side schema definitions (#247).
 *
 * The rule this file exists to make mechanical is AGENTS.md's: where a shape is shared with a capability
 * contract, the StandardSchema definition is the source and the spec is *generated or compared against it --
 * never re-invented*. This file was the comparison half, written when the generation half did not exist: nine
 * of the eighteen components in `apps/control-plane/openapi.yaml` restated, by hand, a shape that also existed
 * as a zod definition in `packages/contracts`, and nothing between them was checked. A field added to one side,
 * or flipped from required to optional, moved the contract and the runtime type apart in silence.
 *
 * Those nine components are now GENERATED (`spec-components.ts`), which changes what this file is for without
 * making it redundant. The two roles are different and both are needed:
 *
 *  - **This file is the independent check.** It compares the committed document against the definitions using
 *    the derivation alone -- no annotations, no generator, no renderer. `spec:check` compares bytes the
 *    generator wrote; if the renderer ever dropped a property or reordered a `required` list into a different
 *    meaning, byte equality would still hold (both sides written by the same buggy code) and only this
 *    comparison would see it. That is not hypothetical: the first drafts of the writer produced exactly that
 *    class of mistake -- a `|-` block that folded prose into newlines, a splice that ate a blank line -- and
 *    each was caught by re-parsing, which is the same muscle.
 *  - **It is still the only check for a component that is compared but not generated.** `api:check` refuses one
 *    outright, so the case is closed in the shipped tree; add a `Foo` component beside a `FooSchema` and the
 *    plan must claim it or the build says why not.
 *
 * Three layers, deliberately separated, because the measured drift was never uniform:
 *
 *  - **Structure (fatal).** Property name sets and required-ness, recursing through nested objects and array
 *    items, in both directions. This is the property list a client is typed against: a field the spec declares
 *    and the schema does not produce is a field a UI reads as `undefined`; a field the schema requires and the
 *    spec leaves optional is a field that can be missing from a 200. Measured on the shipped tree now: zero --
 *    and it can only stay zero because the generator owns those blocks.
 *  - **Shape (reported, counted).** Property `type` and enum value sets. It used to be eight differences, the
 *    sharpest being three components whose `action` the document restricted to `apply | destroy` while
 *    `AttestationSchema.action` said `apply | check | drift | suspend | export` -- two definitions of one
 *    vocabulary, neither a subset of the other. That vocabulary has since been settled, and generation makes
 *    the split unwritable: the document now carries the enum the definition has.
 *  - **Constraints (counted, never refused on).** `minLength`, `maxLength`, `pattern`, the numeric and item
 *    bounds. It used to be 71 differences, 49 of them `minLength: 1` written by the schema and nowhere in the
 *    document -- effort, not disagreement -- and five the two sides writing one bound differently, of which
 *    `Instance.name` was the live one: 80 characters in the document, 40 in the definition, a form that
 *    validates and a server that refuses. The `unlike` figure is 0 now, because there is no longer a second
 *    description to disagree with. What remains is 5, measured, and every one of them is `only-in-spec`:
 *    `Instance.desiredPlanHash` and `.lastAppliedPlanHash` -- and the same two on `InstanceResponse`, which
 *    inherits them -- carrying `^[0-9a-f]{64}$` where `InstanceSchema` says only `z.string()`, and
 *    `DispatchIntent.nonce` carrying `maxLength: 64` where the definition says `min(16)`. Those are the
 *    annotation sidecar speaking where the definition is silent: the API's promise, enforced by Ajv at the
 *    boundary. (`format: date-time` is deliberately NOT in this layer -- it is an annotation, and OpenAPI and
 *    JSON Schema do not owe each other the same text for those; what keeps a `description` from smuggling a
 *    constraint into this layer is `ANNOTATION_KEYWORDS` in `spec-components.ts`.) The histogram is now a measurement of the sidecar's footprint: if it
 *    grows, someone wrote a constraint into the document that no definition backs, and this number is what
 *    makes that visible in review instead of in a client that disagrees with a server.
 *
 * Refusing on the third layer would have buried the five structural findings under a list nobody reads, so the
 * counts are printed on every run and the numbers themselves are the signal: 49 was a shape-drawing gap, and
 * `unlike: 5` was a client disagreeing with a server. Both are now 0, and `unlike` going non-zero again is the
 * finding worth reading.
 *
 * What this file refuses to do:
 *  - carry a hand-written list of field names. That would be a third copy of the same fact, which is the defect
 *    #247 is about. The code side is derived by asking each schema for its own JSON Schema, in the OpenAPI 3.1
 *    dialect, so it comes from the definition and not from a description of it.
 *  - pass `any` or a cast around a mismatch. `SchemaValue` is a narrow structural interface, not a cast.
 *  - let an exemption rot. Every tolerated finding and every unmatched component must be *named with a reason*,
/** The narrow view this gate needs of a schema value: enough to emit JSON Schema, nothing more. */
export interface SchemaValue {
  toJSONSchema(params: { target: string }): unknown;
}

/** One spec component paired with the schema definition derived from code that shares its name. */
export interface DerivedSchema {
  /** The spec component name, e.g. `Instance`. */
  name: string;
  /** The export it was derived from, e.g. `InstanceSchema`, so a finding names its source file's vocabulary. */
  source: string;
  /** JSON Schema in the OpenAPI 3.1 dialect, emitted by the definition itself. */
  json: Record<string, unknown>;
}

/** A schema definition whose JSON Schema could not be emitted -- never treated as agreement. */
export interface UndervisitableSchema {
  source: string;
  name: string;
  reason: string;
}

export interface Derivation {
  derived: DerivedSchema[];
  /** Exported names ending in `Schema` that are not schema values at all (a function named `dropSchema`). */
  skippedNonSchema: string[];
  undervisitable: UndervisitableSchema[];
}

/**
 * Enumerate the code side from the module's real exports.
 *
 * Convention does the naming: `XxxSchema` is the definition of the shape whose API name is `Xxx`, which is
 * how every DTO in `packages/contracts` is already written and how `packages/contracts/api.json` records it.
 * A value that ends in `Schema` but is not a schema (there are two: `dropSchema`, `safeSchema`) is skipped and
 * reported, not guessed at.
 */
export function deriveSchemas(exportEntries: Iterable<readonly [string, unknown]>): Derivation {
  const derived: DerivedSchema[] = [];
  const skippedNonSchema: string[] = [];
  const undervisitable: UndervisitableSchema[] = [];

  for (const [key, value] of [...exportEntries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!key.endsWith('Schema')) continue;
    if (!isSchemaValue(value)) {
      skippedNonSchema.push(key);
      continue;
    }
    const name = key.slice(0, -'Schema'.length);
    try {
      const json = value.toJSONSchema({ target: 'openapi-3.1' });
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        undervisitable.push({ source: key, name, reason: 'emitted JSON Schema is not an object' });
        continue;
      }
      derived.push({ name, source: key, json: json as Record<string, unknown> });
    } catch (error) {
      // A constraint zod cannot serialise (a bare `.refine()` on an object) is not agreement: the gate says it
      // cannot see inside this definition rather than passing it for want of a comparison.
      undervisitable.push({ source: key, name, reason: (error as Error).message.split('\n')[0] ?? 'toJSONSchema failed' });
    }
  }
  return { derived, skippedNonSchema, undervisitable };
}

function isSchemaValue(value: unknown): value is SchemaValue {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { toJSONSchema?: unknown }).toJSONSchema === 'function'
  );
}

/** The canonical identity of one structural finding: stable text, so the ledger and the diff can be compared. */
export interface Finding {
  /** `<component>|<json-pointer>|<kind>` -- the ledger keys on this, so it must not carry incidental wording. */
  key: string;
  message: string;
}

/** A keyword-level difference: reported with a count, not refused on. */
export interface SemanticDifference {
  component: string;
  pointer: string;
  detail: string;
  /** Set on a constraint difference, so the caller can count by keyword instead of by line. */
  keyword?: string;
  /** Which way it differs: written on one side only, or written differently on both. */
  way?: 'only-in-spec' | 'only-in-schema' | 'different';
}

/**
 * Constraint keywords the two sides may legitimately write with different effort.
 *
 * `minLength: 1` appears on nearly every string in `packages/contracts` and on hardly any of them in the
 * document; refusing on that would put the structural findings under a hundred lines of noise. Counting them is
 * the alternative to hiding them: the number is printed, and a number that moves is visible to anyone reading
 * the gate. `format`, `description`, `example` and `default` are not counted at all -- they are annotations, and
 * OpenAPI 3.1 and JSON Schema genuinely do not owe each other the same text there.
 */
const CONSTRAINT_KEYWORDS = [
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minItems', 'maxItems',
] as const;

export interface ParityReport {
  /** Components compared against a derived schema definition. */
  matched: string[];
  /** Spec components with no schema definition sharing their name. */
  unmatched: string[];
  structural: Finding[];
  semantic: SemanticDifference[];
  /** Constraint keywords the two sides do not write the same way. Counted, never refused on. */
  constraints: SemanticDifference[];
  derived: DerivedSchema[];
  undervisitable: UndervisitableSchema[];
  skippedNonSchema: string[];
}

export function checkSchemaParity(doc: SpecDocument, derived: DerivedSchema[]): ParityReport {
  const components = (doc.components as SpecDocument | undefined)?.schemas as Record<string, unknown> | undefined;
  const byName = new Map(derived.map((d) => [d.name, d]));
  const report: ParityReport = {
    matched: [],
    unmatched: [],
    structural: [],
    semantic: [],
    constraints: [],
    derived,
    undervisitable: [],
    skippedNonSchema: [],
  };
  if (!components) return report;

  for (const name of Object.keys(components)) {
    const pair = byName.get(name);
    if (!pair) {
      report.unmatched.push(name);
      continue;
    }
    report.matched.push(name);
    const specNode = resolveNode(components[name], doc);
    comparePair(name, specNode, pair.json, report);
  }
  // A derived schema whose name matches nothing in the spec is not a finding: `packages/contracts` describes
  // provider plans and email messages that are not HTTP shapes at all. It is counted, in the caller's output.
  report.matched.sort();
  report.unmatched.sort();
  return report;
}

function comparePair(component: string, spec: unknown, code: unknown, report: ParityReport): void {
  compareNode(component, '', spec, code, report);
}

const STRUCTURAL = {
  inSpecOnly: 'in-spec-only',
  inCodeOnly: 'in-code-only',
  requiredInSpecOnly: 'required-in-spec-optional-in-code',
  requiredInCodeOnly: 'optional-in-spec-required-in-code',
  shape: 'shape-divergence',
} as const;

/**
 * One recursive walk over two schema trees. `pointer` is a JSON-pointer-ish path used in messages and ledger
 * keys; the root is `''` so a top-level finding reads `Instance|/|in-spec-only` rather than `Instance|properties`.
 */
function compareNode(component: string, pointer: string, spec: unknown, code: unknown, report: ParityReport): void {
  const specObj = isObjectSchema(spec);
  const codeObj = isObjectSchema(code);
  if (specObj && codeObj) {
    compareObject(component, pointer, spec, code, report);
    return;
  }
  if (specObj !== codeObj && (hasProperties(spec) || hasProperties(code))) {
    // One side is a documented object and the other is not: their field lists cannot be compared, which is
    // precisely the drift this gate is for, not a dialect difference to normalise away.
    push(report, component, pointer, STRUCTURAL.shape,
      `${label(component, pointer)} is an object with declared properties on one side (${describe(specObj, spec)}) and not on the other (${describe(codeObj, code)})`);
    return;
  }
  compareKeywords(component, pointer, spec, code, report);
  descend(component, pointer, spec, code, report);
}

function compareObject(component: string, pointer: string, spec: unknown, code: unknown, report: ParityReport): void {
  const specProps = propertyNames(spec);
  const codeProps = propertyNames(code);
  const specRequired = new Set(requiredNames(spec));
  const codeRequired = new Set(requiredNames(code));

  for (const name of sorted(specProps)) {
    if (!codeProps.includes(name)) {
      push(report, component, `${pointer}/properties/${name}`, STRUCTURAL.inSpecOnly,
        `${label(component, `${pointer}/properties/${name}`)} is declared in the spec and in no field of ${component} in the code-side schema -- a client typed from the spec reads a property nothing produces`);
      continue;
    }
    if (specRequired.has(name) !== codeRequired.has(name)) {
      const at = `${pointer}/required/${name}`;
      if (specRequired.has(name)) {
        push(report, component, at, STRUCTURAL.requiredInSpecOnly,
          `${label(component, `${pointer}/properties/${name}`)} is required in the spec but optional in the code-side schema -- a 200 may legitimately arrive without it`);
      } else {
        push(report, component, at, STRUCTURAL.requiredInCodeOnly,
          `${label(component, `${pointer}/properties/${name}`)} is required in the code-side schema but optional in the spec -- the generated client cannot trust it to be there`);
      }
    }
    compareNode(component, `${pointer}/properties/${name}`, propertyOf(spec, name), propertyOf(code, name), report);
  }
  for (const name of sorted(codeProps)) {
    if (specProps.includes(name)) continue;
    push(report, component, `${pointer}/properties/${name}`, STRUCTURAL.inCodeOnly,
      `${label(component, `${pointer}/properties/${name}`)} is in the code-side schema and absent from the spec -- the response carries a field the contract does not allow, and "additionalProperties: false" on the component means Ajv rejects it at runtime`);
  }
  compareKeywords(component, pointer, spec, code, report);
  descend(component, pointer, spec, code, report);
}

/** Types and enums: same walk, different severity. */
function compareKeywords(component: string, pointer: string, spec: unknown, code: unknown, report: ParityReport): void {
  const specType = normalisedType(spec);
  const codeType = normalisedType(code);
  if (specType !== undefined && codeType !== undefined && specType !== codeType) {
    report.semantic.push({ component, pointer: pointer || '/', detail: `type: spec ${specType} vs schema ${codeType}` });
  }
  const specEnum = enumValues(spec);
  const codeEnum = enumValues(code);
  if (specEnum && codeEnum) {
    if (specEnum.join('|') !== codeEnum.join('|')) {
      report.semantic.push({ component, pointer: pointer || '/', detail: `enum: spec [${specEnum.join(', ')}] vs schema [${codeEnum.join(', ')}]` });
    }
  } else if (codeEnum && !specEnum) {
    report.semantic.push({ component, pointer: pointer || '/', detail: `the schema constrains this value to [${codeEnum.join(', ')}] and the spec declares no enum` });
  } else if (specEnum && !codeEnum) {
    report.semantic.push({ component, pointer: pointer || '/', detail: `the spec constrains this value to [${specEnum.join(', ')}] and the schema declares no enum` });
  }
  compareConstraints(component, pointer, spec, code, report);
}

/**
 * Constraint keywords, counted rather than refused on.
 *
 * This is the layer where "the spec is generated from the schema" and "the spec was written by hand beside it"
 * look identical at a glance: both sides say `name: string`, and only the bounds disagree. It is measured here
 * so the disagreement is a number somebody sees, and normalised nowhere else so it cannot leak upward into the
 * structural findings as noise.
 */
function compareConstraints(component: string, pointer: string, spec: unknown, code: unknown, report: ParityReport): void {
  if (!isSchemaNode(spec) || !isSchemaNode(code)) return;
  for (const keyword of CONSTRAINT_KEYWORDS) {
    const a = (spec as Record<string, unknown>)[keyword];
    const b = (code as Record<string, unknown>)[keyword];
    if (a === undefined && b === undefined) continue;
    if (a === undefined) {
      report.constraints.push({ component, pointer: pointer || '/', detail: `${keyword}: the schema declares ${JSON.stringify(b)} and the spec declares none`, keyword, way: 'only-in-schema' });
      continue;
    }
    if (b === undefined) {
      report.constraints.push({ component, pointer: pointer || '/', detail: `${keyword}: the spec declares ${JSON.stringify(a)} and the schema declares none`, keyword, way: 'only-in-spec' });
      continue;
    }
    if (String(a) !== String(b)) {
      report.constraints.push({ component, pointer: pointer || '/', detail: `${keyword}: spec ${JSON.stringify(a)} vs schema ${JSON.stringify(b)}`, keyword, way: 'different' });
    }
  }
}

/** Constraint differences grouped by keyword and direction -- the shape the caller prints. */
export function summariseConstraints(constraints: SemanticDifference[]): Array<{ keyword: string; onlyInSchema: number; onlyInSpec: number; different: number }> {
  const byKeyword = new Map<string, { keyword: string; onlyInSchema: number; onlyInSpec: number; different: number }>();
  for (const difference of constraints) {
    const keyword = difference.keyword ?? 'unknown';
    const row = byKeyword.get(keyword) ?? { keyword, onlyInSchema: 0, onlyInSpec: 0, different: 0 };
    if (difference.way === 'only-in-schema') row.onlyInSchema += 1;
    else if (difference.way === 'only-in-spec') row.onlyInSpec += 1;
    else row.different += 1;
    byKeyword.set(keyword, row);
  }
  return [...byKeyword.values()].sort((a, b) => (a.keyword < b.keyword ? -1 : 1));
}

/** Everything below the object node: nested properties, array items, map values. */
function descend(component: string, pointer: string, spec: unknown, code: unknown, report: ParityReport): void {
  for (const [side, node] of [['spec', spec], ['schema', code]] as const) {
    if (!isSchemaNode(node)) continue;
    for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
      if (node[keyword] !== undefined) {
        // Not compared: this document does not use composition today, and a walker that quietly skips a node it
        // cannot compare is how "the gate passed" stops meaning anything. Saying so keeps it a decision.
        report.semantic.push({ component, pointer: pointer || '/', detail: `${side} declares ${keyword}, which this comparison does not descend into` });
      }
    }
  }
  const specItems = (spec as Record<string, unknown> | null)?.items;
  const codeItems = (code as Record<string, unknown> | null)?.items;
  if (specItems !== undefined || codeItems !== undefined) {
    compareNode(component, `${pointer}/items`, specItems, codeItems, report);
  }
  const specExtra = (spec as Record<string, unknown> | null)?.additionalProperties;
  const codeExtra = (code as Record<string, unknown> | null)?.additionalProperties;
  if (isSchemaNode(specExtra) && isSchemaNode(codeExtra)) {
    compareNode(component, `${pointer}/additionalProperties`, specExtra, codeExtra, report);
  }
}

function push(report: ParityReport, component: string, pointer: string, kind: string, message: string): void {
  report.structural.push({ key: `${component}|${pointer || '/'}|${kind}`, message });
}

function label(component: string, pointer: string): string {
  const path = pointer.split('/').filter(Boolean).filter((s) => s !== 'properties').join('.');
  return path ? `${component}.${path}` : component;
}

function describe(isObject: boolean, node: unknown): string {
  if (isObject) return 'object with properties';
  const t = normalisedType(node);
  return t ? String(t) : 'no declared type';
}

function isObjectSchema(node: unknown): boolean {
  if (!isSchemaNode(node)) return false;
  const record = node as Record<string, unknown>;
  const type = record.type;
  if (type === 'object') return true;
  if (Array.isArray(type) && type.includes('object')) return true;
  return hasProperties(record);
}

function hasProperties(node: unknown): boolean {
  return isSchemaNode(node) && Object.keys((node as Record<string, unknown>).properties as object | undefined ?? {}).length > 0;
}

function isSchemaNode(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

function propertyNames(node: unknown): string[] {
  if (!isSchemaNode(node)) return [];
  const props = (node as Record<string, unknown>).properties;
  if (!isSchemaNode(props)) return [];
  return Object.keys(props);
}

function propertyOf(node: unknown, name: string): unknown {
  if (!isSchemaNode(node)) return undefined;
  const props = (node as Record<string, unknown>).properties;
  return isSchemaNode(props) ? (props as Record<string, unknown>)[name] : undefined;
}

function requiredNames(node: unknown): string[] {
  if (!isSchemaNode(node)) return [];
  const required = (node as Record<string, unknown>).required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === 'string') : [];
}

/** `type: ['string','null']` and `type: 'string'` plus `nullable` are dialect, not disagreement about shape. */
function normalisedType(node: unknown): string | undefined {
  if (!isSchemaNode(node)) return undefined;
  const type = (node as Record<string, unknown>).type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) {
    const kept = type.filter((t): t is string => typeof t === 'string' && t !== 'null').sort();
    return kept.length === 1 ? kept[0] : (kept.length > 1 ? kept.join('|') : undefined);
  }
  return undefined;
}

function enumValues(node: unknown): string[] | undefined {
  if (!isSchemaNode(node)) return undefined;
  const values = (node as Record<string, unknown>).enum;
  if (!Array.isArray(values) || values.length === 0) return undefined;
  if (!values.every((v) => typeof v === 'string')) return undefined;
  return [...(values as string[])].sort();
}

function sorted(list: readonly string[]): string[] {
  return [...list].sort();
}

/**
 * Structural findings tolerated today -- which, as of #247, is nothing: the list is empty.
 *
 * It used to hold one entry, `Instance|/properties/environments|in-spec-only`, and the drift it described was
 * real: the spec's `Instance` was the assembled response (`{ ...record, environments }`) while
 * `InstanceSchema` is the stored row. The fix was the one that entry itself named -- give the assembled
 * response its own component -- and `InstanceResponse` is now generated as `InstanceSchema` plus the
 * environment rows (`spec-annotations.ts` COMPONENT_COMPOSITIONS), so there is no difference left to
 * tolerate. The entry is gone because `checkParityLedger` fails the build when a listed difference stops
 * existing: that is what made the deletion forced rather than a favour.
 *
 * The mechanism stays, because the condition it guards has not gone away in general. A component that shares
 * its name with a definition is *generated*, and `api:check` refuses one that is compared but not generated;
 * a tolerance can therefore only be granted to a shape the generator does not own. Adding an entry here is
 * now a deliberate act of saying "this shape has two descriptions and I cannot fix it this week" -- so it
 * needs the reason an outsider could act on, and it expires the moment the drift does.
 *
 * And it still reads as the concession it is: `pnpm run api:check:strict` refuses everything in this list.
 * With the list empty the two modes agree, which is the state the flag was built to walk the tree toward.
 */

export interface KnownDrift {
  /** Exactly the `Finding.key` this entry covers. */
  key: string;
  /** Why this is tolerated rather than fixed, and where the fix belongs. */
  reason: string;
}

export const KNOWN_DRIFT: KnownDrift[] = [];


export interface LedgerVerdict {
  /** Findings not covered by the ledger -- these are the ones that fail the build. */
  unexpected: Finding[];
  /** Ledger entries whose finding no longer exists -- stale, and a failure in its own right. */
  stale: KnownDrift[];
  /** Findings the ledger covers: reported, not refused on. */
  tolerated: Finding[];
  /** Whether the ledger was honoured at all. */
  strict: boolean;
}

/**
 * Split the measured findings against the ledger.
 *
 * `strict` is the flag the drift is walked down with: the tolerated findings join the ones that fail, so
 * `api:check:strict` describes the tree the ledger is conceding today. The ledger is not consulted to excuse
 * anything in that mode -- only to say which of its entries have already been paid off.
 */
export function checkParityLedger(findings: Finding[], ledger: KnownDrift[] = KNOWN_DRIFT, options: { strict?: boolean } = {}): LedgerVerdict {
  const strict = options.strict === true;
  const keys = new Set(ledger.map((entry) => entry.key));
  const seen = new Set<string>();
  const unexpected: Finding[] = [];
  const tolerated: Finding[] = [];
  for (const finding of findings) {
    if (keys.has(finding.key) && !strict) {
      tolerated.push(finding);
      seen.add(finding.key);
    } else {
      unexpected.push(finding);
    }
  }
  // Staleness is checked in both modes: in strict mode every key was "seen" by definition, so compare against
  // the findings themselves rather than against what the ledger got to tolerate.
  const present = new Set(findings.map((f) => f.key));
  const stale = ledger.filter((entry) => !present.has(entry.key));
  return { unexpected, stale, tolerated, strict };
}

/** Names that must be tolerated structurally but may never be silent: unmatched spec components (see the caller). */
export interface UnmatchedDeclaration {
  component: string;
  reason: string;
}

export const UNMATCHED_COMPONENTS: UnmatchedDeclaration[] = [
  { component: 'Slug', reason: 'The spec names the shared slug rule; in code it is `SLUG_PATTERN` plus a `.max(40).regex()` inline on each field (persistence.ts:54), never a StandardSchema export, so there is nothing to emit JSON Schema from. Naming it a component is the spec doing what the code does not: giving the rule one place to live.' },
  { component: 'TeamWithRole', reason: 'A response DTO that composes a `Team` with the caller\'s role. `TeamSchema` exists but is a different shape, and no code definition is named TeamWithRole, so there is no counterpart to compare -- recorded here rather than matched by fuzzy name similarity.' },
  { component: 'CurrentPerson', reason: 'Assembled per request from `PersonSchema` plus identity and membership rows (capabilities.ts); no single definition carries it, so the spec is the only description of it.' },
  { component: 'Health', reason: 'Operational envelope with no capability contract behind it -- the liveness payload is built in respond.ts from commit and version.' },
  { component: 'Ready', reason: 'Readiness aggregation, a deployment concern rather than a domain record; nothing in packages/contracts declares it.' },
  { component: 'ReadinessCheck', reason: 'Element of the readiness envelope, same as Ready.' },
  { component: 'Version', reason: 'Build identity, read from the environment at boot; not a domain record and not a contract.' },
  { component: 'Whoami', reason: 'A projection of verified token claims (the `VerifiedClaims` *interface*, not a zod schema) -- the shape exists as a TypeScript type only, so there is nothing to emit JSON Schema from.' },
  { component: 'Error', reason: 'The error envelope every operation may return, built by respond.ts from redaction helpers; no zod definition shares the name.' },
];

/**
 * The unmatched set must be declared, in both directions.
 *
 * If `InstanceSchema` were deleted, `Instance` would simply stop being compared and the gate would go quiet --
 * which is the same silence as an exemption. So every unmatched component must appear in UNMATCHED_COMPONENTS
 * with a reason, and every declared entry must still be unmatched.
 */
export function checkUnmatchedLedger(
  report: ParityReport,
  declarations: UnmatchedDeclaration[] = UNMATCHED_COMPONENTS,
): string[] {
  const declared = new Map(declarations.map((d) => [d.component, d]));
  const problems: string[] = [];
  for (const name of report.unmatched) {
    if (!declared.has(name)) {
      problems.push(`${name}: a spec component with no schema definition sharing its name, and no declaration of why. Either the definition was renamed or deleted -- which silently removed it from comparison, the drift this gate exists to catch -- or it is genuinely an envelope, in which case UNMATCHED_COMPONENTS needs it with a reason.`);
    }
  }
  for (const entry of declarations) {
    if (!report.unmatched.includes(entry.component)) {
      problems.push(`UNMATCHED_COMPONENTS declares ${entry.component}, which is no longer an unmatched spec component. Delete the entry: a ledger that describes a document that no longer exists is not a ledger.`);
    }
    if (entry.reason.trim().length < 20) {
      problems.push(`UNMATCHED_COMPONENTS entry ${entry.component} carries no reason worth reading.`);
    }
  }
  return problems;
}
