import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
// The definitions are imported by path, from the package that owns them, the way `scripts/check-api.ts` reaches
// them -- not through a new dependency edge. `@platfolio/api-contract` is imported by the running control plane,
// and wiring the contracts package into its runtime graph to satisfy a test would be the cheaper-looking wrong
// answer. Nothing here imports `zod` either: a bare `zod` import resolves on this machine out of the maintainer's
// home directory and would resolve nowhere in CI, so the mutations below are built from schemas that already exist.
import { AttestationSchema, InstanceSchema, InvitationSchema } from '../../contracts/src/index.ts';
import { loadSpec, type SpecDocument } from '../src/index.ts';
import {
  checkParityLedger,
  checkSchemaParity,
  checkUnmatchedLedger,
  deriveSchemas,
  KNOWN_DRIFT,
  summariseConstraints,
  UNMATCHED_COMPONENTS,
  type DerivedSchema,
} from '../src/schema-parity.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const spec = loadSpec(await fs.readFile(path.join(ROOT, 'apps/control-plane/openapi.yaml'), 'utf8'));
const contracts = await import('../../contracts/src/index.ts');
const derivation = deriveSchemas(Object.entries(contracts));

/**
 * The gate over the real tree.
 *
 * These tests are the difference between "a script printed something once" and a rule: the shipped spec and the
 * shipped schemas must produce no structural finding the ledger does not already name, and the ledger must
 * contain nothing that has stopped being true. Both directions are asserted, because a drift list rots in one
 * direction only, and that direction is silent.
 */
test('the committed spec and the committed schemas agree, except where the ledger says otherwise', () => {
  const report = checkSchemaParity(spec, derivation.derived);
  const verdict = checkParityLedger(report.structural);

  assert.deepEqual(
    verdict.unexpected.map((f) => f.key),
    [],
    `unexpected spec-vs-schema drift:\n${verdict.unexpected.map((f) => ` - ${f.message}`).join('\n')}`,
  );
  assert.deepEqual(verdict.stale.map((e) => e.key), [], 'KNOWN_DRIFT carries entries for drift that has been fixed -- delete them');
  for (const entry of KNOWN_DRIFT) {
    assert.ok(entry.reason.trim().split(/\s+/).length >= 8, `${entry.key}: a tolerated difference needs a reason an outsider can act on`);
  }
  // Nothing may be silently unexamined: every component is either compared or accounted for as unmatched.
  const components = Object.keys((spec.components as SpecDocument).schemas as object);
  assert.equal(report.matched.length + report.unmatched.length, components.length);
});

test('the comparison covers the components it claims to, and says what it does not', () => {
  const report = checkSchemaParity(spec, derivation.derived);
  // A floor with named members rather than a snapshot: the set grows when someone gives a shape a definition,
  // and every addition is compared from then on.
  for (const name of ['Instance', 'Attestation', 'AttestationRecord', 'DispatchIntent', 'BindingRecord', 'CapabilityOffer', 'CapabilityShare', 'Invitation', 'AuditEntry']) {
    assert.ok(report.matched.includes(name), `${name} must be compared against a schema definition of the same name`);
  }
  assert.deepEqual(checkUnmatchedLedger(report), [], 'every unmatched component must be declared with a reason, and every declaration must still be unmatched');
  for (const declaration of UNMATCHED_COMPONENTS) {
    assert.ok(declaration.reason.trim().split(/\s+/).length >= 8, `${declaration.component} is declared unmatched without a reason worth reading`);
  }
});

test('a field added to the schema side only is refused, naming it', () => {
  // The real code path: the definition gains a property and the document knows nothing about it.
  const widened = InstanceSchema.extend({ provisionedBy: InstanceSchema.shape.provider });
  const report = checkSchemaParity(spec, replace(derivation.derived, 'Instance', emit(widened)));
  const key = 'Instance|/properties/provisionedBy|in-code-only';
  const finding = report.structural.find((f) => f.key === key);
  assert.ok(finding, `expected a finding naming provisionedBy, got ${JSON.stringify(report.structural.map((f) => f.key))}`);
  assert.match(finding.message, /provisionedBy/);
  assert.match(finding.message, /code-side schema/);
  // And nothing in the ledger covers it, so it fails the build rather than being filed away.
  assert.equal(checkParityLedger(report.structural).unexpected.some((f) => f.key === key), true);
});

test('a field added to the spec side only is refused, naming it', () => {
  const mutated = structuredClone(spec) as SpecDocument;
  const schemas = (mutated.components as SpecDocument).schemas as Record<string, SpecDocument>;
  const invitation = schemas.Invitation as SpecDocument;
  const properties = invitation.properties as Record<string, SpecDocument>;
  properties.deliveryAttempt = { type: 'integer' };
  invitation.required = [...(invitation.required as string[]), 'deliveryAttempt'];

  const report = checkSchemaParity(mutated, derivation.derived);
  const key = 'Invitation|/properties/deliveryAttempt|in-spec-only';
  const finding = report.structural.find((f) => f.key === key);
  assert.ok(finding, `expected a finding naming deliveryAttempt, got ${JSON.stringify(report.structural.map((f) => f.key))}`);
  assert.match(finding.message, /deliveryAttempt/);
  assert.match(finding.message, /nothing produces/);
  assert.equal(checkParityLedger(report.structural).unexpected.some((f) => f.key === key), true);
});

test('a field made optional on one side is refused, naming it, in both directions', () => {
  // The document loosens: `name` leaves `required` while the definition still demands it.
  const loosenedSpec = structuredClone(spec) as SpecDocument;
  const instance = ((loosenedSpec.components as SpecDocument).schemas as Record<string, SpecDocument>).Instance as SpecDocument;
  instance.required = (instance.required as string[]).filter((r) => r !== 'name');
  const loosened = checkSchemaParity(loosenedSpec, derivation.derived);
  const inSpec = 'Instance|/required/name|optional-in-spec-required-in-code';
  const optionalInSpec = loosened.structural.find((f) => f.key === inSpec);
  assert.ok(optionalInSpec, `expected a requiredness finding for name, got ${JSON.stringify(loosened.structural.map((f) => f.key))}`);
  assert.match(optionalInSpec.message, /\bname\b/);
  assert.equal(checkParityLedger(loosened.structural).unexpected.some((f) => f.key === inSpec), true);

  // The definition loosens: `teamId` becomes optional in code while the document still requires it.
  const loosenedSchema = InstanceSchema.extend({ teamId: InstanceSchema.shape.teamId.optional() });
  const widenedReport = checkSchemaParity(spec, replace(derivation.derived, 'Instance', emit(loosenedSchema)));
  const inCode = 'Instance|/required/teamId|required-in-spec-optional-in-code';
  const optionalInCode = widenedReport.structural.find((f) => f.key === inCode);
  assert.ok(optionalInCode, `expected a requiredness finding for teamId, got ${JSON.stringify(widenedReport.structural.map((f) => f.key))}`);
  assert.match(optionalInCode.message, /\bteamId\b/);
  assert.equal(checkParityLedger(widenedReport.structural).unexpected.some((f) => f.key === inCode), true);
});

test('a nested field is compared too, not just the top level', () => {
  // `templateRef` is an inline object on both sides; drift inside it must surface at its own pointer.
  const widened = InstanceSchema.extend({
    templateRef: InstanceSchema.shape.templateRef.unwrap().extend({ ref: InstanceSchema.shape.provider }).optional(),
  });
  const report = checkSchemaParity(spec, replace(derivation.derived, 'Instance', emit(widened)));
  const finding = report.structural.find((f) => f.key === 'Instance|/properties/templateRef/properties/ref|in-code-only');
  assert.ok(finding, `expected a finding inside templateRef, got ${JSON.stringify(report.structural.map((f) => f.key))}`);
  assert.match(finding.message, /templateRef\.ref/);
});

test('a property whose type disagrees is reported as a keyword difference', () => {
  // Swap a string field for a number field taken from another real definition -- no invented schema vocabulary.
  const changed = InstanceSchema.extend({ teamId: AttestationSchema.shape.durationMs });
  const report = checkSchemaParity(spec, replace(derivation.derived, 'Instance', emit(changed)));
  const difference = report.semantic.find((d) => d.component === 'Instance' && d.pointer === '/properties/teamId');
  assert.ok(difference, `expected a semantic difference for teamId, got ${JSON.stringify(report.semantic.map((d) => `${d.component}${d.pointer}`))}`);
  assert.match(difference.detail, /type: spec string vs schema integer/);
});

test('the keyword layer reports the drift the structural layer cannot see', () => {
  const report = checkSchemaParity(spec, derivation.derived);
  // Measured on the shipped pair: the action vocabulary in the document and in the definitions is not the same
  // set. Refusing on it here would bury the structural findings; printing the count is what keeps it visible.
  const actions = report.semantic.filter((d) => d.pointer === '/properties/action');
  assert.ok(actions.length >= 2, `expected the action enum drift to be reported, got ${JSON.stringify(report.semantic.map((d) => `${d.component}${d.pointer}`))}`);
  for (const difference of actions) {
    assert.match(difference.detail, /apply, destroy/);
    assert.match(difference.detail, /check/);
  }
});

test('deleting a schema definition does not quietly remove its component from comparison', () => {
  const withoutInstance = derivation.derived.filter((d) => d.name !== 'Instance');
  const report = checkSchemaParity(spec, withoutInstance);
  assert.ok(report.unmatched.includes('Instance'), 'Instance is now unmatched and must show up as such');
  assert.ok(!report.matched.includes('Instance'));
  const problems = checkUnmatchedLedger(report);
  assert.ok(problems.some((p) => p.includes('Instance')), `expected a problem naming Instance, got ${JSON.stringify(problems)}`);
});

test('a schema whose JSON Schema cannot be emitted is a finding, not a pass', () => {
  // Measured against zod 4.6.7: a `.refine()` still serialises -- the constraint is dropped, the fields survive,
  // so the comparison keeps working -- but a `.transform()` throws ("Transforms cannot be represented in JSON
  // Schema"). That throw has to become a named problem, because a definition nobody can inspect is
  // indistinguishable from a definition nobody checked.
  const transformed = InvitationSchema.transform((value) => value.id);
  const result = deriveSchemas([['InvitationSchema', transformed]]);
  assert.equal(result.derived.length, 0);
  assert.equal(result.undervisitable.length, 1);
  assert.match(result.undervisitable[0]?.reason ?? '', /transform/i);

  const refined = InvitationSchema.refine((value) => value.id !== '', 'no empty id');
  const kept = deriveSchemas([['InvitationSchema', refined]]);
  assert.equal(kept.derived.length, 1, 'a refine does not hide the fields: the comparison still sees them');
  assert.ok(Object.keys((kept.derived[0]?.json.properties ?? {}) as object).length > 5);
});

test('the derivation comes from the exports, not from a list kept beside them', () => {
  const names = derivation.derived.map((d) => d.name);
  // Every `XxxSchema` export is derived, so adding a definition widens what the gate compares with no edit here.
  for (const name of ['Instance', 'CapabilityOffer', 'DispatchIntent', 'BindingRecord', 'Invitation']) {
    assert.ok(names.includes(name), `${name}Schema must be derived from the package's exports`);
  }
  // The two exports that end in "Schema" without being schemas are skipped and named, not compared as empties.
  assert.deepEqual(derivation.skippedNonSchema.sort(), ['dropSchema', 'safeSchema']);
  assert.equal(derivation.undervisitable.length, 0, 'every shipped definition must be inspectable by the gate');
  for (const derived of derivation.derived) {
    assert.ok(derived.source.endsWith('Schema'), `${derived.name} must name the export it came from`);
    assert.ok(Object.keys(derived.json).length > 0, `${derived.source} emitted an unusable schema`);
  }
});

/** Emit a definition the way the gate does, so a test mutation travels the same path as the shipped ones. */
function emit(schema: { toJSONSchema(params: { target: string }): unknown }): unknown {
  return schema.toJSONSchema({ target: 'openapi-3.1' });
}

test('the ledger is a concession, not a different measurement -- strict mode refuses the same findings', () => {
  const report = checkSchemaParity(spec, derivation.derived);
  const lenient = checkParityLedger(report.structural);
  const strict = checkParityLedger(report.structural, KNOWN_DRIFT, { strict: true });

  assert.equal(strict.tolerated.length, 0, 'strict mode must tolerate nothing');
  assert.deepEqual(strict.unexpected.map((f) => f.key).sort(), report.structural.map((f) => f.key).sort(),
    'strict mode refuses exactly what was measured, no more and no less');
  assert.equal(lenient.unexpected.length + lenient.tolerated.length, strict.unexpected.length,
    'the two modes partition one set of findings; they do not compute two sets');
  assert.equal(strict.stale.length, lenient.stale.length, 'staleness is checked the same way in both modes');
  assert.ok(strict.unexpected.length > 0, 'if this ever goes zero, the ledger and its entries should be deleted along with the flag');
});

test('the constraint layer counts what the structural layer cannot see, without refusing on it', () => {
  const report = checkSchemaParity(spec, derivation.derived);
  assert.ok(report.constraints.length > 0, 'the shipped pair differs on bounds; the count must not be zero by accident');
  const summary = summariseConstraints(report.constraints);
  // The interesting ones are where both sides wrote a bound and wrote it differently -- `Instance.name` allows
  // 80 characters in the document and 40 in the definition, which is a client and a server disagreeing.
  const unlike = report.constraints.filter((c) => c.way === 'different');
  assert.ok(unlike.some((c) => c.component === 'Instance' && /maxLength: spec 80 vs schema 40/.test(c.detail)),
    `expected the name-length disagreement, got ${JSON.stringify(unlike.map((c) => c.detail))}`);
  assert.equal(summary.reduce((n, row) => n + row.onlyInSchema + row.onlyInSpec + row.different, 0), report.constraints.length,
    'the histogram must account for every difference it counted');
  // Bounds never become structural findings: that would make `minLength` noise bury the real drift.
  assert.equal(report.structural.filter((f) => f.key.includes('minLength')).length, 0);
});

/** Replace one derived component's emitted schema, keeping the rest of the real set intact. */
function replace(derived: DerivedSchema[], name: string, json: unknown): DerivedSchema[] {
  if (!isJsonObject(json)) {
    throw new Error(`${name}: expected an emitted JSON Schema object, got ${JSON.stringify(json)}`);
  }
  return derived.map((d) => (d.name === name ? { ...d, json } : d));
}

/** A predicate rather than a cast: the test would otherwise accept anything and assert nothing. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
