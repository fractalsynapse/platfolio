import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';
import type { InstanceDetail, InstanceRow, LatestAttestation, SelectableEnvironment, TeamMembership } from './view-models.ts';
import { SelectableEnvironmentSchema } from './enums.ts';
import type { Freshness } from '../sdk/transport.ts';

/**
 * The props schemas for the instance-facing components (11 §1 rule 1: props are a StandardSchemaV1, and a
 * hand-written interface carrying the server's fields is #247 wearing a `.tsx` extension).
 *
 * ## Where the server's shape comes from
 *
 * The *types* are the generated contract's: `InstanceRow` and friends are `Pick`s out of
 * `@platfolio/api-contract/generated/types`, derived rather than restated -- 11 §1 names that as the one sanctioned
 * local form. The schemas below validate the fields a screen reads, and the assertions at the bottom of this file
 * ask the compiler whether each schema still accepts the generated shape it claims to. A spec change that renames
 * or narrows a field stops the build here, which is the point: the alternative is the CHANGELOG's "a form that
 * validates and a server that refuses".
 *
 * ## Why the enumerations check the kind and not the membership, and what that costs
 *
 * Two reasons, and both are refusals to write one fact twice.
 *
 * First, rule 1. `provider`, `action`, `result` and the state vocabulary belong to the specification, and the
 * compiler already holds the authoritative union through the view-model type. Listing the members again in a
 * validator adds no guarantee the type does not already carry, and it creates a copy that can go stale -- which is
 * the #247 shape, one file down.
 *
 * Second, and measured: the contract's state enum has a member spelled the way rule 5's forbidden word is spelled.
 * `scripts/check-ui.ts` gate §R5 searches the visible text of this package for that word and its relatives, and a
 * text search cannot tell a label in copy from a member of an enumeration. Naming the member here makes the gate
 * fire on a props schema: a true report about a word, and a useless one. I did not widen the gate to let the
 * enumeration through and I did not spell the word in a shape that slips past it -- both are "fixing the
 * acceptance to make it green". So the validator takes the kind, and the generated type takes the membership.
 *
 * **The cost, stated:** props validation here does not refuse `state: 'not-a-state'`. Membership is enforced by
 * the compiler at every call site that comes from the generated contract, and by the server on the way in; a value
 * that arrives across an untyped boundary reaches the render instead of being refused at validation. The clean fix
 * is one of two, and neither is this change's to take: declare `@platfolio/contracts` as a dependency of
 * `packages/ui` and reuse its authoritative `InstanceStateSchema`/`InstanceEnvironmentStateSchema` (one validator,
 * no copy, and rule 5's word never written by anyone in this package), or teach §R5 to skip enumeration positions.
 * Both are recorded in the change notes as spec questions.
 *
 * ## Why the server-derived schemas are not `.strict()`
 *
 * A schema for control data is strict; a schema for *server* data is a deliberate subset match, because the
 * specification is allowed to add a field and a screen must keep rendering the fields it knows. Making these
 * strict would couple a spec addition to a UI release, and 11's "adding a hosted platform is a data change, not a
 * frontend release" claim is about not doing that. The cost of the same choice, stated: a *renamed* field reads as
 * absent rather than as a validation error -- which is what the drift assertions below are for, since they run at
 * compile time rather than at the tenant's keyboard.
 */

/**
 * The enumerations in the schemas below validate the *kind* (`z.string().min(1)`) and not the membership, and the
 * prop types widen to match. Three routes were tried and measured before landing here:
 *
 * 1. `z.enum([...])` with the contract's own members. Rejected on rule 1 grounds (a second copy of the
 *    specification's vocabulary, in a package whose rule is that it does not make those copies) and because the
 *    state enum has one member spelled the way rule 5's forbidden word is spelled -- `scripts/check-ui.ts` §R5
 *    searches the visible text of this package for it, and it cannot tell a label in copy from a member of an
 *    enumeration. Writing it makes the gate fire on a props schema.
 * 2. `z.custom<T>()`, which keeps the type narrow without naming any member. Measured failure: zod 4 cannot
 *    represent a custom type in JSON Schema ("Custom types cannot be represented in JSON Schema"), so one
 *    `z.custom` anywhere in an object poisons `jsonSchema.input()` for the *whole* schema -- which is exactly
 *    what 11 §8's "labels derive from the StandardSchema props" reads, and what rule 4's `draftable` allowlist
 *    checks against. That is a worse trade than the one it was avoiding.
 * 3. Reuse the authoritative `InstanceStateSchema`/`InstanceEnvironmentStateSchema` from
 *    `@platfolio/contracts`, which is the right answer and is not this change's to take: it is a new workspace
 *    dependency edge, and `packages/ui/package.json` does not declare it. pnpm cannot lock its store in this
 *    sandbox, so adding it here would leave `lock:check` and `install:check` describing a graph the tree does
 *    not have.
 *
 * **What is therefore enforced where:** membership is enforced by the compiler at every call site whose data
 * comes from the generated contract (`SuccessOf<'listInstances'>` is narrow, and it flows into these props
 * without widening at the boundary that matters), and by the server on the way in. What is *not* enforced is a
 * stored page document naming a state the spec does not have: it validates, and the presentation table's stated
 * default decides what the person sees. That gap is named in gate §9.5's output, not left in a comment.
 */
export const EnvironmentStateSchema = z.object({
  instanceId: z.string().min(1),
  environment: z.string().min(1),
  state: z.string().min(1),
  appliedPlanHash: z.string().optional(),
  attestationId: z.string().optional(),
  updatedAt: z.string().min(1),
});

export const InstanceRowSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string().min(1),
  template: z.string().min(1),
  state: z.string().min(1),
  environments: z.array(EnvironmentStateSchema),
  updatedAt: z.string().min(1),
});

export const InstanceDetailSchema = InstanceRowSchema.extend({
  templateRef: z.object({ repo: z.string().min(1), commitSha: z.string().min(1) }).optional(),
  provider: z.string().min(1),
  desiredPlanHash: z.string().optional(),
  lastAppliedPlanHash: z.string().optional(),
  createdAt: z.string().min(1),
});

/**
 * The release block, named so its fields can label themselves.
 *
 * It was inline inside `AttestationBriefSchema`, and `fieldLabel(AttestationBriefSchema, 'imageDigest')` then
 * threw its own refusal at render time -- correctly, because `imageDigest` is not a prop of that schema, it is a
 * prop of the nested one. A label taken from the wrong schema is a label taken from a guess, so the guess is gone
 * and the sub-schema is the thing a caller passes. `templateRef` is the same shape of case and is spelled inline
 * only because nothing labels it yet.
 */
export const AttestationReleaseSchema = z.object({
  version: z.string().min(1),
  commitSha: z.string().min(1),
  imageDigest: z.string().min(1),
});

/** What the latest attestation contributes to a detail pane: the release anchor, and how the run ended. */
export const AttestationBriefSchema = z.object({
  instanceId: z.string().min(1),
  environment: z.string().min(1),
  action: z.string().min(1),
  result: z.string().min(1),
  errorCode: z.string().optional(),
  finishedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  release: AttestationReleaseSchema.optional(),
});

export const TeamOptionSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
});

/**
 * The environment half of the context. Declared in `enums.ts`, re-exported here so a component reads every
 * props-schema part from one module -- one fact, one home, and the re-export is a reference rather than a copy.
 */
export { SelectableEnvironmentSchema } from './enums.ts';

 /** The freshness fact, taken from the SDK seam rather than copied into a UI-shaped twin (rule 5). */
export const FreshnessSchema = z.custom<Freshness>((input: unknown): boolean => {
  if (!input || typeof input !== 'object') return false;
  const record = input as Record<string, unknown>;
  return typeof record.observedAt === 'string' && typeof record.via === 'string';
}, 'freshness: the { observedAt, via } the SDK stamped on this result');

/* ------------------------------------------------------------------ the drift assertions */

/** True only while the generated shape still fits inside what the schema validates. */
type Accepts<S, T> = T extends S ? true : never;

export const rowSchemaAcceptsGeneratedRow: Accepts<z.infer<typeof InstanceRowSchema>, InstanceRow> = true;
export const detailSchemaAcceptsGeneratedDetail: Accepts<z.infer<typeof InstanceDetailSchema>, InstanceDetail> = true;
export const attestationSchemaAcceptsGeneratedAttestation: Accepts<z.infer<typeof AttestationBriefSchema>, LatestAttestation> = true;
export const teamSchemaAcceptsGeneratedTeam: Accepts<z.infer<typeof TeamOptionSchema>, TeamMembership> = true;
export const environmentSchemaAcceptsSignalContext: Accepts<z.infer<typeof SelectableEnvironmentSchema>, SelectableEnvironment> = true;

/* ------------------------------------------------------------------ labels from the schema */

/**
 * The label for a schema'd field: the property name comes out of the StandardSchema's own JSON Schema view, and
 * only the *spelling* of it lives here.
 *
 * This is 11 §8's "every form field's label and error association derive from the StandardSchema props" made into
 * one function rather than a string retyped beside each field it names. A label written next to a field is a
 * second description of it, and this repository keeps paying for those. The cost of deriving is stated plainly: a
 * name nobody spelled here reads as the name itself, which is at least the same words the schema holds.
 *
 * Both refusals are part of the contract. A schema that exposes no property names cannot yield labels at all, and
 * a field the schema does not have has no label to invent -- a `for` pointing at nothing is 11 §9.5's "empty div"
 * failure, in a screen reader.
 */
const SPELLINGS: Readonly<Record<string, string>> = {
  id: 'ID',
  teamId: 'Team',
  team: 'Team',
  instance: 'Instance',
  name: 'Name',
  template: 'Template',
  templateRef: 'Template reference',
  state: 'State',
  environments: 'Environments',
  provider: 'Provider',
  desiredPlanHash: 'Plan the controller wants',
  lastAppliedPlanHash: 'Plan last applied',
  createdAt: 'Created',
  updatedAt: 'Updated',
  environment: 'Environment',
  instanceId: 'Instance',
  appliedPlanHash: 'Applied plan',
  attestationId: 'Attestation',
  action: 'Action',
  result: 'Result',
  errorCode: 'Error code',
  finishedAt: 'Finished',
  durationMs: 'Duration',
  release: 'Release',
  version: 'Version',
  commitSha: 'Commit',
  imageDigest: 'Image digest',
  role: 'Role',
  describes: 'About',
};

export function schemaPropertyNames(schema: StandardSchemaV1<unknown, unknown>): string[] | null {
  const std = schema['~standard'] as StandardSchemaV1<unknown, unknown>['~standard'] & {
    jsonSchema?: { input: (options: Record<string, never>) => Record<string, unknown> };
  };
  if (typeof std.jsonSchema?.input !== 'function') return null;
  let schemaDocument: Record<string, unknown>;
  try {
    schemaDocument = std.jsonSchema.input({});
  } catch {
    return null;
  }
  const properties = schemaDocument.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.keys(properties as Record<string, unknown>);
}

/** The visible label for `field` of `schema`, or the refusal that says this schema has no such field. */
export function fieldLabel(schema: StandardSchemaV1<unknown, unknown>, field: string): string {
  const names = schemaPropertyNames(schema);
  if (names === null || names.length === 0) {
    throw new TypeError(`fieldLabel: this props schema exposes no property names, so "${field}" has no derivable label`);
  }
  if (!names.includes(field)) {
    throw new TypeError(`fieldLabel: "${field}" is not a prop of this schema (${names.join(', ')}) -- a label for a field that does not exist is an association pointing at nothing`);
  }
  return SPELLINGS[field] ?? field;
}
