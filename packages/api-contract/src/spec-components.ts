import { isPair, parseDocument, type Pair, type Scalar, type YAMLMap } from 'yaml';
import { COMPONENT_COMPOSITIONS, SPEC_ANNOTATIONS, type ComponentAnnotation, type ComponentComposition, type PropertyAnnotation } from './spec-annotations.ts';
import { renderComponent, SpecRenderError, type NodeKind } from './spec-yaml.ts';
import { deriveSchemas, type DerivedSchema, type Derivation, type UndervisitableSchema } from './schema-parity.ts';

/**
 * The component definitions the OpenAPI document is built from (#247).
 *
 * AGENTS.md's rule is that a shape shared with a capability contract keeps the StandardSchema as its source,
 * and the specification is *generated or compared against it -- never re-invented*. Until now the document
 * did that in spirit: nine of its eighteen components restated, by hand, what a zod definition in
 * `packages/contracts` already says, and a gate compared the two and filed what it found. This module is the
 * other half of the sentence. It asks each definition for its own JSON Schema, adds what only the document
 * knows (see `spec-annotations.ts` for why that lives there and not in `.describe()`), and writes the result
 * into the component's place in the file.
 *
 * It deliberately **never imports `zod`**, and neither does the script that runs it. `toJSONSchema` is a
 * method on the schema *value*, obtained by importing `packages/contracts` -- which declares zod properly --
 * the same way `schema-parity.ts` already reaches it. Measured: a bare `zod` specifier resolves from
 * `packages/api-contract` and `scripts/` only via `/home/adrian/node_modules/zod`, outside the repository, so
 * an import here would work on a laptop and fail in CI. Avoiding the import is therefore not a style choice;
 * `packages/api-contract/test/spec-components.test.ts` fails the build if one appears.
 *
 * Three guarantees, each of which is a refusal rather than a fallback:
 *
 *  1. **Anything inexpressible is refused, naming the definition, the component and the pointer** -- a
 *     definition whose `toJSONSchema` throws (a `.transform()`, `z.date()`, a recursive shape), a keyword the
 *     YAML writer does not own, a composition whose sources have gone, an annotation pointing at a property
 *     the generated shape does not have. The generator does not approximate, because a document that
 *     approximates the schema is the defect this replaces.
 *  2. **Output is byte-deterministic.** Keyword order is fixed, property order is the definition's, prose is
 *     written as the value says it. No timestamps, no randomness. Byte equality is what `spec:check`
 *     compares; anything that varied between runs would make that gate a coin toss.
 *  3. **Only the generated components are touched.** The merge splices character ranges read from the YAML
 *     AST, so `paths:`, security schemes, response prose and the hand-written components survive byte for
 *     byte -- which is what makes comparing the whole file the right freshness check.
 */

/** One component the generator owns, with the definitions it came from. */
export interface GeneratedComponent {
  /** The component name in `components.schemas`. */
  name: string;
  /** Every schema export that produced it, so a refusal and a reader can name the source. */
  sources: string[];
  /** The composed shape, annotations applied. What the document will say. */
  json: Record<string, unknown>;
  /** Maintenance prose, emitted as YAML comments inside the block. */
  note: string[];
  /** Where to insert the block when the document does not have it yet. */
  insertAfter?: string;
}

export interface GenerateResult {
  components: GeneratedComponent[];
  /** The spec component names the generator owns: name-matched by convention, plus the compositions. */
  generated: string[];
  /** Every problem found, in the order the plan lists them. Non-empty means: do not write. */
  problems: string[];
}

const byNameOf = (derived: DerivedSchema[]) => new Map(derived.map((d) => [d.name, d]));

/**
 * The set of components the generator owns.
 *
 * A spec component is generated when a `XxxSchema` export exists whose name is `Xxx` -- the convention the
 * parity gate already uses, so the two cannot disagree about what is shared -- or when
 * `COMPONENT_COMPOSITIONS` names it. Everything else is hand-written and must appear in
 * `UNMATCHED_COMPONENTS` with a reason; that ledger is what stops a component escaping comparison by
 * losing its twin.
 */
export function generatedComponentNames(
  specComponentNames: readonly string[],
  derived: DerivedSchema[],
  compositions: readonly ComponentComposition[] = COMPONENT_COMPOSITIONS,
): string[] {
  const byName = byNameOf(derived);
  // A composition is generated whether or not the document has it yet: `mergeIntoSpec` inserts it after its
  // anchor. Requiring the block to exist first would mean hand-writing the shape the generator exists to
  // write, and the plan would be a description of the file rather than the reason for it.
  return [...new Set([...specComponentNames.filter((name) => byName.has(name)), ...compositions.map((c) => c.component)])].sort();
}

/**
 * The code side, once: every name-matched definition plus every composed shape.
 *
 * `check-api.ts`, `gen-api-spec.ts` and the parity tests all call THIS, and that is the point. A gate and a
 * test that build the comparison set differently will disagree in exactly the direction that matters -- the
 * test green while the gate is blind, or the gate right while the test pins the old truth. The first run of
 * the generator did exactly that: `InstanceResponse` was composed for the gate and unknown to the test, and
 * the ledger correctly reported a component with no definition beside it.
 */
export function contractSide(exportEntries: Iterable<readonly [string, unknown]>): Derivation & { all: DerivedSchema[] } {
  const derivation = deriveSchemas(exportEntries);
  return { ...derivation, all: [...derivation.derived, ...composedDerived(derivation.derived)] };
}

/**
 * The compositions as *definitions*, for the parity gate.
 *
 * `InstanceResponse` has no `InstanceResponseSchema` export, so a name-matched comparison would file it as
 * hand-written and demand a reason for it. It is not hand-written: it is `InstanceSchema` plus the rows the
 * handler attaches. Returning the composed shape here -- raw, with no annotations applied -- keeps the
 * parity gate an independent check of the document against the definitions, rather than a check of the
 * document against the generator's own output. The byte comparison in `spec:check` is what covers
 * annotations; this is what covers structure.
 */
export function composedDerived(derived: DerivedSchema[], compositions: readonly ComponentComposition[] = COMPONENT_COMPOSITIONS): DerivedSchema[] {
  const byName = byNameOf(derived);
  const out: DerivedSchema[] = [];
  for (const composition of compositions) {
    const base = byName.get(stripSuffix(composition.base));
    if (!base) continue; // generateComponents reports the missing definition; two reports help nobody
    const json = structuredClone(base.json) as Record<string, unknown>;
    const problems: string[] = [];
    // A refused composition is left out rather than reported twice: `generateComponents` names the problem,
    // and a second copy of the same refusal in the parity output would only make it louder, not clearer.
    if (compose(composition.component, json, composition, byName, problems) !== null && problems.length === 0) {
      out.push({
        name: composition.component,
        source: [composition.base, ...composition.adds.map((add: { array: string }) => add.array)].join(' + '),
        json,
      });
    }
  }
  return out;
}

/** Build every generated component: the definitions' own JSON Schema, then the composition, then the annotations. */
export function generateComponents(
  specComponentNames: readonly string[],
  derived: DerivedSchema[],
  annotations: Record<string, ComponentAnnotation> = SPEC_ANNOTATIONS,
  compositions: readonly ComponentComposition[] = COMPONENT_COMPOSITIONS,
  undervisitable: readonly UndervisitableSchema[] = [],
): GenerateResult {
  const byName = byNameOf(derived);
  const names = generatedComponentNames(specComponentNames, derived, compositions);
  const components: GeneratedComponent[] = [];
  const problems: string[] = [];

  for (const name of names) {
    const annotation = annotations[name] satisfies ComponentAnnotation | undefined;
    const composition = compositions.find((c) => c.component === name);
    const base = byName.get(composition ? stripSuffix(composition.base) : name);
    if (!base) {
      // A component the generator owns must have a definition. Silence here is how a renamed export becomes
      // an unexamined shape -- the same failure as an exemption.
      problems.push(`${name}: the generator owns this component, but no ${composition ? composition.base : `${name}Schema`} export produced a schema to emit. Restore the definition, or delete the component from the plan and declare it in UNMATCHED_COMPONENTS with a reason.`);
      continue;
    }
    const built = buildOne(name, base, composition, byName, annotation, problems, annotations, compositions, undervisitable);
    if (built) components.push(built);
  }

  // Prose that no longer lands is a finding. Same design as the drift ledger: an entry that stops describing
  // reality fails the build rather than rotting into a description of something that is gone.
  for (const key of Object.keys(annotations).sort()) {
    if (!names.includes(key)) {
      problems.push(`SPEC_ANNOTATIONS.${key}: nothing generates ${key} any more -- the component was renamed, deleted, or never in the plan. Delete the annotation or name the definition it belongs to; do not leave prose describing a shape that is not there.`);
    }
  }
  for (const composition of compositions) {
    if (composition.adds.length === 0) {
      problems.push(`COMPONENT_COMPOSITIONS.${composition.component} adds nothing: an entry with no fields is a plan for a component that is only the record, and the record already has a name.`);
    }
  }
  return { components, generated: names, problems };
}

function buildOne(
  name: string,
  base: DerivedSchema,
  composition: ComponentComposition | undefined,
  byName: Map<string, DerivedSchema>,
  annotation: ComponentAnnotation | undefined,
  problems: string[],
  annotations: Record<string, ComponentAnnotation>,
  compositions: readonly ComponentComposition[],
  undervisitable: readonly UndervisitableSchema[],
): GeneratedComponent | null {
  const json = structuredClone(base.json) as Record<string, unknown>;
  const sources = [base.source];

  if (composition) {
    const composed = compose(name, json, composition, byName, problems, undervisitable);
    if (composed === null) return null;
    sources.push(...composition.adds.map((a) => a.array));
  }

  // A composed response is the record plus the rows, so it inherits the record's prose: the same sentence
  // about `name` or `createdAt` must not be typed twice, once per component, which is the duplication #247
  // was raised about. What the response says about itself wins where both speak.
  const merged = annotationsFor(name, annotation, annotations, compositions);
  for (const [path, value] of Object.entries(merged.properties).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const target = resolvePath(name, json, path, problems);
    if (target === null) continue;
    for (const [keyword, want] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const clash = applyAnnotation(name, path, target, keyword, want);
      if (clash) problems.push(clash);
    }
  }
  // The provenance line is part of the generated bytes, and it is the FIRST thing a reader of the document
  // sees inside the block: a spec that is half generated has to say which half, or the next person edits the
  // artifact and wonders why the edit came back. It lives inside the block rather than above the key because
  // the splice replaces the key's line onward -- a comment above the key would survive each run and stack.
  const provenance = `GENERATED by scripts/gen-api-spec.ts from ${sources.join(' + ')} (packages/contracts). Do not hand-edit: pnpm run spec:check fails on a difference, and the prose lives in packages/api-contract/src/spec-annotations.ts.`;
  return { name, sources, json, note: [provenance, ...merged.note], ...(composition?.after === undefined ? {} : { insertAfter: composition.after }) };
}

/**
 * The annotations that apply to a component: its own, plus the base's when the component is a composition.
 *
 * Inheritance is by *component name*, not by copying the map: `InstanceResponse` is `InstanceSchema` plus the
 * environment rows, so every property the record has is the same field with the same meaning, and the prose
 * belongs to the field. A property the response adds names the response's own entry, which wins -- the
 * assembled view is allowed to say something the row does not.
 */
function annotationsFor(
  name: string,
  own: ComponentAnnotation | undefined,
  annotations: Record<string, ComponentAnnotation>,
  compositions: readonly ComponentComposition[],
): { properties: Record<string, PropertyAnnotation>; note: string[] } {
  const composition = compositions.find((c) => c.component === name);
  const base = composition === undefined ? undefined : annotations[stripSuffix(composition.base)];
  const properties: Record<string, PropertyAnnotation> = { ...(base?.properties ?? {}), ...(own?.properties ?? {}) };
  return { properties, note: [...(base?.note ?? []), ...(own?.note ?? [])] };
}

/**
 * The explicit composition: a record's own shape, plus the rows the handler attaches to it.
 *
 * `Instance.environments` was the last measured drift in this repository (#247). The spec's `Instance` was
 * the assembled response while `InstanceSchema` is the stored row, because the handler builds
 * `{ ...record, environments: await store.listInstanceEnvironments(id) }`
 * (`apps/control-plane/src/capabilities.ts:257, :348`). Adding the field to the record to satisfy the
 * document would have made the store lie -- `InstanceSchema` is `.strict()` -- so the response gets its own
 * name, built from both definitions.
 *
 * `properties`, `required` and `additionalProperties` all come from `toJSONSchema()`. The only thing written
 * by hand is the property name the handler uses, which is the fact no schema states: that a response is a
 * record plus its environment rows.
 */
function compose(
  component: string,
  base: Record<string, unknown>,
  composition: ComponentComposition,
  byName: Map<string, DerivedSchema>,
  problems: string[],
  undervisitable: readonly UndervisitableSchema[] = [],
): Record<string, unknown> | null {
  if (base.type !== 'object' || !isPlainObject(base.properties)) {
    problems.push(`${component}: ${composition.base} does not emit an object with properties, so it cannot be composed. A response assembled from a non-object record is a modelling decision, not something this generator can write.`);
    return null;
  }
  const properties = base.properties as Record<string, unknown>;
  const required = Array.isArray(base.required) ? [...base.required] : [];
  for (const add of composition.adds) {
    if (Object.hasOwn(properties, add.property)) {
      problems.push(`${component}: ${composition.base} already emits "${add.property}", so the composition adds nothing. Delete the addition from COMPONENT_COMPOSITIONS -- the drift it was modelling is gone.`);
      return null;
    }
    const item = byName.get(stripSuffix(add.array));
    if (!item) {
      // Two different causes, and only one of them is "the export went away". A definition that exists but
      // cannot be serialised -- a `.transform()` anywhere inside it, `z.date()`, a recursive shape -- is the
      // more common one and the more dangerous to misreport: "not a schema export" would send a maintainer
      // hunting for a deleted file when the answer is a line of zod that JSON Schema cannot hold.
      const skipped = undervisitable.find((u) => u.source === add.array);
      problems.push(skipped === undefined
        ? `${component}: COMPONENT_COMPOSITIONS names ${add.array}, which is not a schema export the derivation can see. ${component} would describe a shape nothing defines.`
        : `${component}: ${add.array} exists but no JSON Schema could be emitted from it (${skipped.reason}), so ${component} would describe a shape nothing can check. Express the constraint in a form zod can serialise -- a transform has no JSON Schema, and neither does this document.`);
      return null;
    }
    properties[add.property] = { type: 'array', items: structuredClone(item.json) };
    // The handlers always attach the rows, so the field is always there: `required`, and a client typed from
    // the document can read it without a `?.` and without guessing whether the list endpoint forgot.
    required.push(add.property);
  }
  base.required = required;
  return base;
}

/**
 * Write one annotation keyword onto one node.
 *
 * The rule, in both directions: the sidecar may say what the definition does not, and may never contradict
 * it. A clash is a refusal, not an override -- an override is #247 with a new owner, the document silently
 * becoming the stricter of two descriptions of one shape. `Instance.name` used to allow 80 characters in the
 * document and 40 in the server; there is now no place for that sentence to be written twice.
 */
function applyAnnotation(component: string, path: string, node: Record<string, unknown>, keyword: string, want: unknown): string | null {
  if (!ANNOTATION_KEYWORDS.has(keyword)) {
    return `${component} /${path}: "${keyword}" is not an annotation this generator writes. Prose, `
      + '`format`, `example` and `deprecated` are the document\'s own knowledge; a constraint belongs in the definition, so the response and the validator agree about what is valid`';
  }
  if (Object.hasOwn(node, keyword)) {
    return JSON.stringify(node[keyword]) === JSON.stringify(want)
      ? null
      : `${component} /${path} /${keyword}: the annotation says ${JSON.stringify(want)} and the schema emits ${JSON.stringify(node[keyword])}. One shape, one definition: fix the definition and delete the annotation, or delete the annotation -- never let the document disagree with the code that produces the response`;
  }
  node[keyword] = want;
  return null;
}

/**
 * What the sidecar may say. Deliberately narrow, and narrower than "any keyword YAML can hold".
 *
 * `description`/`title`/`example`/`deprecated` are annotations in the JSON Schema sense: they assert nothing
 * about validity. `format` and `pattern`/`maxLength` are here for one measured reason -- this document already
 * used them where the definition is silent (`format: date-time` on `z.string()` timestamps, `^[0-9a-f]{64}$` on
 * `InstanceSchema.desiredPlanHash`, `maxLength: 64` on `DispatchIntent.nonce`), they are enforced by Ajv at the
 * HTTP boundary, and dropping them would have quietly loosened the contract the day generation started. Where
 * the definition DOES state one of them, the clash check refuses -- so this list can add knowledge, never
 * overrule it.
 *
 * Numeric bounds are NOT on the list: a `minimum` the definition does not declare is a validation rule invented
 * in the wrong file, and the first draft of this allowlist let one through. Enum membership is not either --
 * an enum is the shape, and the shape belongs to the schema. A new entry here should be a decision written down
 * in the CHANGELOG, not a convenience.
 */
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'example', 'deprecated', 'format', 'pattern', 'maxLength', 'minLength']);

/**
 * Walk a dotted property path through the generated shape.
 *
 * `templateRef.commitSha` descends `properties`; `environments.items.state` crosses an `items`. A segment
 * that is not there is a refusal naming the whole path: prose about a field that has moved is worse than no
 * prose, because it reads as documentation.
 */
function resolvePath(component: string, root: Record<string, unknown>, path: string, problems: string[]): Record<string, unknown> | null {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length; i += 1) {
    const next = descend(cursor, segments[i] ?? '');
    if (next === null) {
      problems.push(`${component}: SPEC_ANNOTATIONS.${component}.${path} names "${segments.slice(0, i + 1).join('.')}", which the generated shape does not have -- the property was renamed, removed, or never emitted, so this prose now documents nothing. Delete it or re-point it.`);
      return null;
    }
    cursor = next;
  }
  return cursor;
}

/** One step down a generated shape: a property, or across `items`/`additionalProperties` into a nested schema. */
function descend(node: Record<string, unknown>, segment: string): Record<string, unknown> | null {
  const next = segment === 'items'
    ? node.items
    : segment === 'additionalProperties'
      ? node.additionalProperties
      : isPlainObject(node.properties) ? (node.properties as Record<string, unknown>)[segment] : undefined;
  return isPlainObject(next) ? next : null;
}

/* ---------------------------------------------------------------------------------------------
 * Merging into the document, and the freshness comparison.
 * ------------------------------------------------------------------------------------------- */

export interface MergeResult {
  text: string;
  /** The components whose bytes were written (or would be, in `--check` mode). */
  written: string[];
  /** Refusals: constructs the generator would not emit. Non-empty means the text is not trustworthy. */
  problems: string[];
}

/** One component's location in the document, as character offsets. */
interface BlockRange {
  keyStart: number;
  valueEnd: number;
}

/** Ranges of every entry in `components.schemas`, from the parser rather than from a line count. */
function componentRanges(text: string, problems: string[]): Map<string, BlockRange> | null {
  const doc = parseDocument(text, { logLevel: 'silent' });
  if (doc.errors.length) {
    problems.push(`the committed document does not parse: ${doc.errors.map((e) => e.message).join('; ')}`);
    return null;
  }
  const schemas = schemasMap(doc.contents);
  if (schemas === null) {
    problems.push('the committed document has no components.schemas mapping');
    return null;
  }
  const ranges = new Map<string, BlockRange>();
  for (const item of schemas.items as Pair[]) {
    if (!isPair(item)) continue;
    const key = item.key as Scalar;
    const value = item.value as { range?: [number, number, number] } | null;
    if (typeof key.value !== 'string' || !key.range || !value?.range) continue;
    // `value.range[1]` runs PAST the last content character into the line break that follows it -- measured
    // on this file, where the tail after `Invitation`'s end is "\n    CurrentPerson". Cutting back to the
    // last non-whitespace character is what keeps the blank line between components out of the replaced
    // region; without it the splice swallows one newline per component and the file stops being idempotent.
    let end = value.range[1];
    while (end > value.range[0] && /\s/.test(text[end - 1] ?? '')) end -= 1;
    ranges.set(key.value, { keyStart: text.lastIndexOf('\n', key.range[0] - 1) + 1, valueEnd: end });
  }
  return ranges;
}

/**
 * Splice the generated components into the document text.
 *
 * Edits are applied last-first so the offsets that have not been touched stay valid -- the mistake a naive
 * forward pass makes, and one that produces a document that still parses while saying something else.
 * A component the document does not have yet is inserted after its anchor, so a response shape added to the
 * plan does not need a hand-written placeholder first.
 */
export function mergeIntoSpec(text: string, components: GeneratedComponent[]): MergeResult {
  const problems: string[] = [];
  const ranges = componentRanges(text, problems);
  if (ranges === null) return { text, written: [], problems };

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const written: string[] = [];
  for (const component of components) {
    const rendered = renderOne(component);
    if (!rendered.ok) {
      problems.push(rendered.problem);
      continue;
    }
    written.push(component.name);
    const existing = ranges.get(component.name);
    if (existing) {
      edits.push({ start: existing.keyStart, end: existing.valueEnd, text: rendered.text });
      continue;
    }
    const anchor = component.insertAfter === undefined ? undefined : ranges.get(component.insertAfter);
    if (!anchor) {
      problems.push(`${component.name}: the document has no ${component.name} block, and no "${component.insertAfter ?? '(anchor)'}" to insert it after. Add the component to the specification, or drop it from the plan.`);
      continue;
    }
    edits.push({ start: anchor.valueEnd, end: anchor.valueEnd, text: `\n\n${rendered.text}` });
  }

  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
  }
  return { text: out, written, problems };
}

/** A discriminated union, so a refusal cannot be a string-shaped success or an `undefined`-shaped problem. */
type Rendered = { ok: true; text: string } | { ok: false; problem: string };

/** Render one component, turning an inexpressible construct into a named problem instead of a stack trace. */
function renderOne(component: GeneratedComponent): Rendered {
  try {
    return { ok: true, text: renderComponent(component.name, component.json, { component: component.name, indent: 4, note: component.note }) };
  } catch (error) {
    if (error instanceof SpecRenderError) {
      return { ok: false, problem: `${component.name} (${component.sources.join(', ')}): the generator refuses to write this -- ${error.message}` };
    }
    throw error;
  }
}

/**
 * Compare the regenerated document against the committed one and name the first difference.
 *
 * The message is the deliverable. "The spec is stale" tells a maintainer nothing; the component, the line and
 * both texts are the fix. A difference inside a generated block is reported as that component's, because the
 * block is machine-owned; a difference outside one is reported as prose or a path the schemas do not
 * describe, which is exactly what it is -- and the byte check still catches it, so the file cannot drift from
 * the last thing that wrote it.
 */
export function diffGenerated(committed: string, regenerated: string, components: GeneratedComponent[]): string[] {
  if (committed === regenerated) return [];
  const byName = new Map(components.map((c) => [c.name, c]));
  const line = firstDifference(committed, regenerated);
  const problems = [`the committed document is not what the schemas produce -- first difference at line ${String(line + 1)} (committed has ${String(committed.split('\n').length)} lines)`];
  const owner = owningComponent(regenerated, line, new Set(byName.keys()));
  const [was, now] = [committed.split('\n')[line], regenerated.split('\n')[line]];
  if (owner !== null) {
    const c = byName.get(owner)!;
    problems.push(`  component ${owner}, generated from ${c.sources.join(', ')}`);
  } else {
    problems.push('  outside every generated block: paths, security, or prose the schemas do not describe');
  }
  problems.push(`  committed ${String(line + 1)}: ${JSON.stringify(was ?? '<eof>')}`);
  problems.push(`  generated ${String(line + 1)}: ${JSON.stringify(now ?? '<eof>')}`);
  if (isComment(was) || isComment(now)) {
    problems.push('  the difference is on a comment: maintenance prose belongs in SPEC_ANNOTATIONS.<component>.note, which is what writes it here. Move it there, or delete it on purpose -- the generator owns this block, so a comment typed into it is a change nobody sees being undone.');
  }
  return problems;
}

function firstDifference(a: string, b: string): number {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i += 1) if (la[i] !== lb[i]) return i;
  return 0;
}

function isComment(line: string | undefined): boolean {
  return line !== undefined && line.trimStart().startsWith('#');
}

/** Which generated block owns this line of the regenerated document. */
function owningComponent(regenerated: string, line: number, names: Set<string>): string | null {
  const lines = regenerated.split('\n');
  let owner: string | null = null;
  for (let i = 0; i <= line && i < lines.length; i += 1) {
    const match = /^ {4}([A-Za-z][\w-]*):/.exec(lines[i] ?? '');
    if (match !== null && names.has(match[1] ?? '')) owner = match[1] ?? null;
  }
  return owner;
}

/**
 * The document as the generator would write it, with two kinds of finding kept apart.
 *
 * **They are different failures and must not be confused.** A *refusal* means the generator could not produce
 * the text at all -- an inexpressible definition, a stale annotation, a composition whose source is gone --
 * and nothing may be written, not even by `--write`, because writing would mean guessing. *Staleness* means
 * the generator knew exactly what to write and the committed file says something else, which is the ordinary
 * condition of a hand-edited document and is precisely what `--write` exists to repair. Merging the two would
 * make `spec:gen` unable to fix the very drift it detects -- the mistake a first draft of this file made.
 *
 * `check-api.ts` and `spec:check` fail on both lists; `spec:gen` fails only on refusals.
 */
export interface RegenerateResult {
  text: string;
  components: GeneratedComponent[];
  /** The generator could not produce a component. Nothing is written. */
  refusals: string[];
  /** It could, and the committed document differs from it. `--write` repairs this. */
  stale: string[];
  problems: string[];
}

export function regenerate(committed: string, names: readonly string[], derived: DerivedSchema[], undervisitable: readonly UndervisitableSchema[] = []): RegenerateResult {
  const plan = generateComponents(names, derived, SPEC_ANNOTATIONS, COMPONENT_COMPOSITIONS, undervisitable);
  const merged = mergeIntoSpec(committed, plan.components);
  const refusals = [...plan.problems, ...merged.problems];
  if (refusals.length) {
    return { text: committed, components: plan.components, refusals, stale: [], problems: refusals };
  }
  const stale = diffGenerated(committed, merged.text, plan.components);
  return { text: merged.text, components: plan.components, refusals, stale, problems: [...refusals, ...stale] };
}

/** The component names the document declares, in order. */
export function specComponentNames(text: string): string[] {
  const problems: string[] = [];
  const ranges = componentRanges(text, problems);
  if (ranges === null) throw new Error(problems.join('\n'));
  return [...ranges.keys()];
}

function schemasMap(contents: unknown): YAMLMap | null {
  if (!isPlainObject(contents)) return null;
  const get = (value: unknown, key: string) => (value as { get?: (k: string, o: true) => unknown }).get?.(key, true);
  const components = get(contents, 'components');
  const schemas = get(components, 'schemas');
  return isPlainObject(schemas) && Array.isArray((schemas as { items?: unknown[] }).items) ? (schemas as unknown as YAMLMap) : null;
}

function stripSuffix(source: string): string {
  return source.endsWith('Schema') ? source.slice(0, -'Schema'.length) : source;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { NodeKind };
