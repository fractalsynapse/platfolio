import type { AttestationRecord, InstanceResponse, TeamWithRole } from '@platfolio/api-contract/generated/types';

/**
 * The view-models a screen renders, each one derived out of the **generated** contract types.
 *
 * They live here, in one file, for the reason 11 §1 rule 1 gives: a local interface with the server's fields is
 * #247 wearing a `.tsx` extension, and the sanctioned alternative -- `Pick`, `Readonly`, unions of discriminants
 * -- is only sanctioned while it *derives*. Deriving in one place means the derivation is reviewable as a set.
 * Scattered across five components, next year's edits each grow their own opinion of what an instance is, and that
 * is the two-descriptions defect with a render path on each side.
 *
 * What none of these types does: name a field the specification does not have, add a `nameLabel` or a
 * `createdAtFormatted`, or restate the state enum. When `apps/control-plane/openapi.yaml` changes a field, the
 * compiler stops this file and the change goes to the owners of the spec rather than being absorbed here quietly
 * (D41). `props.ts` is where those types meet their runtime validators, and the assertions there are what keep
 * this file from becoming the only place that remembers.
 */

/** The whole record. A detail pane may show whatever the operation returns. */
export type InstanceDetail = InstanceResponse;

/**
 * What a row shows. `template` is in it because D45 made the template part of what a person reads, and
 * `environments` because #179 made the per-place state the truth and `state` the rollup beside it.
 */
export type InstanceRow = Pick<
  InstanceResponse,
  'id' | 'teamId' | 'name' | 'template' | 'state' | 'environments' | 'updatedAt'
>;

/** One environment's row. The element type of the generated record, named so a schema can be pinned to it. */
export type InstanceEnvironmentRow = InstanceResponse['environments'][number];

/** The latest attestation for an instance, as the operation returns it (#217's release anchor lives in here). */
export type LatestAttestation = AttestationRecord;

/** A team the caller belongs to, with the role that team granted them -- `listTeams`' own generated shape. */
export type TeamMembership = Pick<TeamWithRole, 'teamId' | 'name' | 'role'>;

export type { SelectableEnvironment } from './enums.ts';
export { ENVIRONMENT_VALUES, isSelectableEnvironment, SELECTABLE_ENVIRONMENTS, unservedEnvironments } from './enums.ts';
