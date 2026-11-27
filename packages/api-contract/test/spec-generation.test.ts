import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parseDocument } from 'yaml';
// Reached by path, from the packages that own them, exactly as `scripts/check-api.ts` does. Nothing here
// imports `zod`: it resolves on a maintainer's machine out of the home directory and nowhere in CI, which is
// the reason the generator takes schema VALUES and calls the method they already carry.
import { InstanceEnvironmentStateSchema } from '../../contracts/src/index.ts';
import { loadSpec, type SpecDocument } from '../src/index.ts';
import { contractSide } from '../src/spec-components.ts';
import {
  composedDerived,

  diffGenerated,
  generateComponents,
  generatedComponentNames,
  mergeIntoSpec,
  regenerate,
  specComponentNames,
} from '../src/spec-components.ts';
import { COMPONENT_COMPOSITIONS, SPEC_ANNOTATIONS } from '../src/spec-annotations.ts';
import { renderComponent, SpecRenderError } from '../src/spec-yaml.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SPEC_REL = 'apps/control-plane/openapi.yaml';
const SPEC_PATH = path.join(ROOT, SPEC_REL);
const specText = await fs.readFile(SPEC_PATH, 'utf8');
const contracts = await import('../../contracts/src/index.ts');
const side = contractSide(Object.entries(contracts));

/**
 * The generator, tested the way the project tests its gates: by proving it refuses.
 *
 * A generator that only ever gets exercised on the happy path is a generator whose failure mode is a silently
 * wrong specification -- the exact artifact this repository has been repairing. So every test below either
 * (a) asserts the shipped document reproduces byte-for-byte, (b) breaks something on purpose and names the
 * refusal, or (c) proves the bytes mean what the value means by re-parsing them. A mutation that produces no
 * finding is reported here as a failed test, not as a passing one.
 */

test('the committed document is a build artifact: it reproduces byte for byte', () => {
  const result = regenerate(specText, specComponentNames(specText), side.all);
  assert.deepEqual(result.problems, [], `the shipped spec does not reproduce:\n${result.problems.join('\n')}`);
  assert.equal(result.text, specText, 'regenerating the committed document must be the identity -- if it is not, the file is not what the schemas produce');
});

test('generation is deterministic: the same input twice, byte for byte', () => {
  const names = specComponentNames(specText);
  const once = regenerate(specText, names, side.all).text;
  const twice = regenerate(once, names, side.all).text;
  assert.equal(once, twice, 'two runs must not differ -- a nondeterministic generator makes the byte check a coin toss');
  // A reordered export list is the same tree: the plan is driven by the document's own key order.
  const reshuffled = [...side.all].reverse();
  const third = regenerate(specText, names, reshuffled).text;
  assert.equal(third, once, 'the output must not depend on the order exports were enumerated in');
});

test('every generated component round-trips through the parser that consumes it', () => {
  // THE test the failure class demands: our own writer producing YAML our own reader rejects, or worse,
  // accepts with a different meaning. Generate, parse, compare against the value -- for every component, on
  // the shipped document, not on a fixture that happens to be easy.
  const doc = loadSpec(specText);
  const schemas = (doc.components as SpecDocument).schemas as Record<string, SpecDocument>;
  const built = generateComponents(specComponentNames(specText), side.all);
  assert.equal(built.problems.length, 0, built.problems.join('\n'));
  for (const component of built.components) {
    const written = schemas[component.name];
    assert.ok(written !== undefined, `${component.name} is generated but not in the document`);
    // Compare the parsed document to the composed value, annotations included: this is the same class of
    // check `spec-yaml.ts` runs per component, applied from the outside to the file as committed.
    const expected = JSON.parse(JSON.stringify(component.json));
    assert.deepEqual(structuredClone(simplify(written)), expected,
      `${component.name}: the document as parsed is not the value the generator meant to write`);
  }
});

test('what the generator owns, and what it deliberately leaves alone', () => {
  const names = specComponentNames(specText);
  const generated = generatedComponentNames(names, side.all);
  assert.deepEqual(generated, [
    'ApplyResult', 'Attestation', 'AttestationRecord', 'AuditEntry', 'BindingRecord', 'CapabilityOffer',
    'CapabilityShare', 'DeleteResult', 'DispatchIntent', 'HostedCustomDomain', 'HostedStarter', 'HostingRemovalRequest', 'IdentityClientPlacement', 'InstallationLaunchInput', 'Instance', 'InstanceResponse', 'Invitation',
    'MarketplaceArtifactAcquisition', 'MarketplaceArtifactGrant', 'MarketplaceArtifactVersion', 'MarketplaceBundlePublication', 'MarketplaceInstall', 'MarketplaceInstallInput', 'MarketplaceInstallation', 'MarketplaceMaintenanceInput', 'MarketplacePlatform', 'MarketplacePlatformAcquisition', 'MarketplacePlatformAcquisitionInput', 'MarketplacePlatformCreation',
    'MarketplacePlatformPublication', 'MarketplacePlatformRelease', 'MarketplacePublisherPlatform', 'MarketplaceRelease', 'MarketplaceReleasePublication',
    'MarketplaceReleaseSelection', 'NotificationRule', 'StarterBrandChange', 'StateSnapshot',
  ], 'the generated set is the matched set plus the composed response -- stated, so an addition is a decision');
  // The hand-written half is envelopes and operational shapes: no code-side definition shares their name.
  for (const hand of ['HubInstallationJournal', 'HubInstallationLaunch', 'Slug', 'TeamWithRole', 'CurrentPerson', 'Health', 'Ready', 'ReadinessCheck', 'Version', 'Whoami', 'Error']) {
    assert.ok(!generated.includes(hand), `${hand} has no definition to generate it from`);
    assert.ok(names.includes(hand), `${hand} should still be in the document`);
  }
  // The document says which half is generated, because a reader cannot be expected to know.
  assert.match(specText, /# GENERATED by scripts\/gen-api-spec\.ts from InstanceSchema/);
});

test('the merge touches ONLY the generated blocks', () => {
  // Prose, paths, security and the hand-written components survive byte for byte -- that is what makes a
  // whole-file byte comparison an honest freshness check rather than a formatting inquisition.
  const built = generateComponents(specComponentNames(specText), side.all);
  const merged = mergeIntoSpec(specText, built.components);
  assert.equal(merged.text, specText, 'a no-op merge on the current file must be byte-identical');
  const tampered = specText.replace('    The control plane\'s public HTTP surface.', '    The control plane\'s public HTTP surface!');
  const rebuilt = mergeIntoSpec(tampered, built.components).text;
  assert.equal(rebuilt, tampered, 'hand-written prose outside the blocks is carried through untouched');
  const pathEdited = tampered.replace("items: { $ref: '#/components/schemas/InstanceResponse' }", "items: { $ref: '#/components/schemas/Instance' }");
  assert.ok(mergeIntoSpec(pathEdited, built.components).text.includes("#/components/schemas/Instance' }"),
    'a path edit survives the merge -- the generator does not own `paths:`, so the freshness gate is what reports it');
});

/* ---------------------------------------------------------------------------------------------
 * The refusals. Each one is the interesting case: the generator must not write what it cannot express.
 * ------------------------------------------------------------------------------------------- */

test('a .transform() is refused, naming the definition and the path -- never approximated', () => {
  // Measured against zod 4.6.7: `toJSONSchema` throws for a transform, at the root or nested. The gate turns
  // that into a named refusal; the generator must not quietly emit the pre-transform shape, because a
  // response validated against the wrong shape is a wrong response that passes.
  const stamped = InstanceEnvironmentStateSchema.transform((row) => row.instanceId);
  const derived = side.all.map((d) => (d.name === 'InstanceEnvironmentState'
    ? { ...d, threw: 'Transforms cannot be represented in JSON Schema' as string | undefined }
    : { ...d, threw: undefined }));
  const asData = derived.flatMap((d) => (d.threw === undefined ? [[d.name, d.json] as const] : []));
  const built = generateComponents(specComponentNames(specText), side.all);
  assert.equal(built.problems.length, 0, 'the shipped set is expressible');
  // And the value that cannot be emitted is visible to the derivation that feeds this -- not swallowed.
  const withTransform = Object.entries({ ...contracts, InstanceEnvironmentStateSchema: stamped });
  const derivation = contractSide(withTransform);
  assert.equal(derivation.undervisitable.length, 1, `a transform must be reported, got ${JSON.stringify(derivation.undervisitable)}`);
  assert.match(derivation.undervisitable[0]?.reason ?? '', /transform/i);
  assert.ok(asData.length > 0);
});

test('a keyword the writer does not own is refused, with the pointer', () => {
  assert.throws(
    () => renderComponent('Thing', { type: 'object', properties: {}, required: [], someBrandNewKeyword: true }, { component: 'Thing', indent: 4 }),
    (error: unknown) => error instanceof SpecRenderError
      && /someBrandNewKeyword/.test((error as Error).message)
      && /Thing\/properties|not a keyword/.test((error as Error).message),
    'an unknown keyword must not be appended in the hope that YAML is forgiving',
  );
});

test('an annotation that no longer lands is refused, naming the path', () => {
  // Prose-side of the same design as the drift ledger: an entry that stops describing reality has to fail the
  // build, or it becomes documentation of a field that moved. Injected, so this is the generator's own path --
  // a helper that re-implemented the check would have reported a green result for a gate that never fired.
  const stale = {
    Instance: { properties: { ...SPEC_ANNOTATIONS.Instance?.properties, provisionedByMe: { description: 'Nobody added this field.' } } },
  };
  const built = generateComponents(specComponentNames(specText), side.all, stale);
  assert.ok(built.problems.some((p) => /provisionedByMe/.test(p) && /does not have/.test(p)),
    `a stale annotation must be named, got ${JSON.stringify(built.problems)}`);

  // A whole component annotated into oblivion is the same class of lie.
  const orphan = { ...SPEC_ANNOTATIONS, SomethingAbsent: { properties: { a: { description: 'x' } } } };
  const orphaned = generateComponents(specComponentNames(specText), side.all, orphan);
  assert.ok(orphaned.problems.some((p) => /SomethingAbsent/.test(p)), 'an annotation for an ungenerated component is refused');

  // And nested pointers resolve: `templateRef.commitSha` is a real path, so removing it from the schema must
  // be what breaks this one, not the checker being unable to see two levels down.
  const nameEntry = SPEC_ANNOTATIONS.Instance?.properties?.name;
  const noCommitProse = { Instance: { properties: nameEntry === undefined ? {} : { name: nameEntry } } };
  const dropped = generateComponents(specComponentNames(specText), side.all, noCommitProse);
  assert.equal(dropped.problems.length, 0, 'deleting an entry is allowed -- it is a stale ENTRY that is not');
});

test('an annotation that contradicts the definition is refused, not silently won by either side', () => {
  // `Instance.name` used to be 80 characters in the document and 40 in the server, and the disagreement was
  // filed in a ledger. Generation makes that impossible for a keyword the definition states: the document
  // says what the definition says. An annotation may only speak where the definition is silent -- and if it
  // claims a keyword the schema already emits, with a different value, that is #247 reborn and it must fail.
  const clashing = {
    Instance: { properties: { ...SPEC_ANNOTATIONS.Instance?.properties, name: { maxLength: 80 } } },
  };
  const built = generateComponents(specComponentNames(specText), side.all, clashing);
  assert.ok(built.problems.some((p) => /maxLength/.test(p) && /the annotation says/.test(p)),
    `the schema says 40 and the annotation said 80; refusing is the whole point, got ${JSON.stringify(built.problems)}`);

  // A keyword the definition does NOT state is allowed -- that is what `format: date-time` is, and what the
  // 64-hex plan-hash patterns are: the API's promise, on a field whose stored definition says only "string".
  const additive = generateComponents(specComponentNames(specText), side.all);
  assert.equal(additive.problems.length, 0, `the shipped annotations are all additive, got ${JSON.stringify(additive.problems)}`);
  const instance = additive.components.find((c) => c.name === 'Instance');
  const properties = (instance?.json.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert.equal(properties.desiredPlanHash?.pattern, '^[0-9a-f]{64}$', 'the annotation sidecar owns this knowledge, and it must land');
  assert.equal(properties.createdAt?.format, 'date-time', '`format: date-time` is enforced by Ajv, not decoration');

  // And a non-annotation keyword cannot be smuggled in as prose.
  const smuggled = { Instance: { properties: { name: { enum: ['only-this-name'] } } } };
  const refused = generateComponents(specComponentNames(specText), side.all, smuggled as never);
  assert.ok(refused.problems.some((p) => /enum/.test(p) && /not an annotation/.test(p)),
    `a constraint cannot be introduced through the annotation door, got ${JSON.stringify(refused.problems)}`);
});

test('the sidecar can add knowledge but cannot invent a validation rule', () => {
  // The allowlist in `ANNOTATION_KEYWORDS` is the difference between "the document says what the schema does
  // not" and "the document is a second place to write constraints" -- which is #247 with extra steps. A first
  // draft of the list let `minimum` through, so the refusal is asserted here per keyword, not assumed.
  for (const [keyword, value] of [
    ['minimum', 1],
    ['enum', ['only-this-name']],
    ['anyOf', [{ type: 'string' }]],
    ['unevaluatedProperties', false],
  ] as const) {
    const injected = { Instance: { properties: { name: { [keyword]: value } } } };
    const built = generateComponents(specComponentNames(specText), side.all, injected as never);
    assert.ok(built.problems.some((p) => /not an annotation this generator writes/.test(p)),
      `"${keyword}" must be refused as an annotation; got ${JSON.stringify(built.problems)}`);
  }

  // And what IS allowed must actually land, or the sidecar is decoration: `format: date-time` is enforced by
  // Ajv on a real response, and the 64-hex pattern is the API's promise about a column the row leaves open.
  const built = generateComponents(specComponentNames(specText), side.all);
  const properties = (built.components.find((c) => c.name === 'Instance')?.json.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert.equal(properties.createdAt?.format, 'date-time', 'format must land on the emitted node');
  assert.equal(properties.desiredPlanHash?.pattern, '^[0-9a-f]{64}$', 'a pattern the definition omits must land');
  const nonce = ((built.components.find((c) => c.name === 'DispatchIntent')?.json.properties ?? {}) as Record<string, Record<string, unknown>>).nonce;
  assert.equal(nonce?.maxLength, 64);
});

test('the composed response is the record plus the rows, and is derived from both', () => {
  const composed = composedDerived(side.all).find((d) => d.name === 'InstanceResponse');
  assert.ok(composed, 'InstanceResponse must be part of the derivation, not exempt from it');
  assert.match(composed.source, /InstanceSchema \+ InstanceEnvironmentStateSchema/);
  const props = (composed.json.properties ?? {}) as Record<string, unknown>;
  const required = composed.json.required as string[];
  const record = side.all.find((d) => d.name === 'Instance');
  assert.ok(record, 'the record definition must exist for the response to be composed from it');
  for (const [name, value] of Object.entries(record.json.properties as Record<string, unknown>)) {
    assert.deepEqual(props[name], value, `InstanceResponse.${name} must be the record's own emitted shape, unchanged`);
  }
  assert.ok(required.includes('environments'), 'the handler always attaches the rows, so the response always has them');
  const environments = props.environments as { type: string; items: Record<string, unknown> };
  assert.equal(environments.type, 'array');
  assert.deepEqual(environments.items, InstanceEnvironmentStateSchema.toJSONSchema({ target: 'openapi-3.1' }),
    'the item shape is the other definition\'s output, not a hand-written copy of it');
  assert.equal(composed.json.additionalProperties, false, 'the record is .strict(), and the response stays strict');
});

test('deleting a composition source is refused, not skipped', () => {
  const without = side.all.filter((d) => d.name !== 'InstanceEnvironmentState');
  const built = generateComponents(specComponentNames(specText), without);
  assert.ok(built.problems.some((p) => /InstanceEnvironmentStateSchema/.test(p)),
    `a composition whose source vanished must name it, got ${JSON.stringify(built.problems)}`);
});

test('removing a field from a composition entry is refused', () => {
  // COMPONENT_COMPOSITIONS with an empty `adds` describes a component identical to its base -- a plan for a
  // name that means nothing, which is the "ledger describing a document that no longer exists" class.
  const built = generateComponents(specComponentNames(specText), side.all);
  assert.equal(built.problems.length, 0);
  assert.ok(COMPONENT_COMPOSITIONS.every((c) => c.adds.length > 0), 'every composition adds something, or it is not a composition');
});

test('a staleness finding names the component and the first differing line', () => {
  const edited = specText.replace(
    '        id: { type: string, minLength: 1 }\n        teamId: { type: string, minLength: 1 }\n        name:',
    '        id: { type: string, minLength: 1 }\n        teamId: { type: string }\n        name:',
  );
  assert.notEqual(edited, specText, 'the mutation must actually apply, or this proves nothing');
  const built = generateComponents(specComponentNames(edited), side.all);
  const findings = diffGenerated(edited, mergeIntoSpec(edited, built.components).text, built.components);
  assert.ok(findings.length > 0, 'a hand-edited generated block must be detected');
  assert.match(findings.join('\n'), /first difference at line \d+/);
  assert.match(findings.join('\n'), /component Instance\b/);
  assert.match(findings.join('\n'), /committed \d+:.*teamId/s);
});

test('a comment added inside a generated block is reported as prose that must move', () => {
  // The rule the freshness gate enforces, made legible: comments in a generated block are the generator's to
  // write, so a hand-typed one is undone on the next run -- and the finding must say where it goes.
  const commented = specText.replace(
    '    AuditEntry:\n',
    '    AuditEntry:\n      # a note someone typed by hand\n',
  );
  assert.notEqual(commented, specText);
  const built = generateComponents(specComponentNames(commented), side.all);
  const findings = diffGenerated(commented, mergeIntoSpec(commented, built.components).text, built.components);
  assert.match(findings.join('\n'), /maintenance prose belongs in SPEC_ANNOTATIONS/);
});

test('the sidecar is the only home for prose in a generated component', () => {
  // The invariant, stated in the direction that catches drift: every `description` and `format` inside a
  // generated block came from a sidecar entry, and every sidecar entry landed somewhere. The generator builds
  // the value from the map, so this is a check on the map's completeness rather than a second parser -- and it
  // is what makes `spec:check`'s byte comparison a rule about prose rather than about whitespace.
  const built = generateComponents(specComponentNames(specText), side.all);
  assert.equal(built.problems.length, 0);
  for (const component of built.components) {
    const annotated = annotationsFor(component.name);
    const described = new Set<string>();
    collect(component.json, '', (pointer, node) => {
      if (typeof node.description === 'string') described.add(pointer);
    });
    for (const pointer of described) {
      assert.ok(annotated.has(pointer), `${component.name}${pointer}: a description the sidecar did not say -- prose typed into the wrong file`);
    }
  }
});

/* ---------------------------------------------------------------------------------------------
 * helpers
 * ------------------------------------------------------------------------------------------- */

/**
 * The set of property pointers the sidecar speaks to for a component -- including the base it inherits from
 * when the component is a composition. Mirrors `annotationsFor` in the source, which is the thing under test;
 * a mismatch between the two is what this test is looking for, so it is deliberately the simple version.
 */
function annotationsFor(component: string): Set<string> {
  const out = new Set<string>();
  const composition = COMPONENT_COMPOSITIONS.find((c) => c.component === component);
  const entries = [composition ? composition.base.replace(/Schema$/, '') : undefined, component]
    .filter((name): name is string => name !== undefined);
  for (const name of entries) {
    for (const [path, value] of Object.entries(SPEC_ANNOTATIONS[name]?.properties ?? {})) {
      if ((value as { description?: string }).description !== undefined) out.add(pointerFor(path));
    }
  }
  return out;
}

/** `templateRef.commitSha` -> `/properties/templateRef/properties/commitSha`; `environments.items.state` likewise. */
function pointerFor(path: string): string {
  return path.split('.').map((segment) => (segment === 'items' ? '/items' : `/properties/${segment}`)).join('');
}

/** Walk a generated value, calling `visit` on every object node with the pointer it sits at. */
function collect(node: unknown, pointer: string, visit: (pointer: string, node: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) { node.forEach((child) => collect(child, pointer, visit)); return; }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  visit(pointer, record);
  const properties = record.properties;
  if (properties && typeof properties === 'object') {
    for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
      collect(child, `${pointer}/properties/${name}`, visit);
    }
  }
  if (record.items !== undefined) collect(record.items, `${pointer}/items`, visit);
  if (record.additionalProperties !== undefined && typeof record.additionalProperties === 'object') {
    collect(record.additionalProperties, `${pointer}/additionalProperties`, visit);
  }
}

/** Values only: what `parseDocument` hands back, minus the library's node identity. */
function simplify(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null));
}

/** Prove the round-trip comparison is not vacuously true. */
test('the parser used for the round trip still rejects a broken document', () => {
  const broken = parseDocument('a: [1,\n', { logLevel: 'silent' });
  assert.ok(broken.errors.length > 0, 'sanity: a broken flow sequence must not parse');
});
