/**
 * The obligation rules a platform registry must satisfy, in one place.
 *
 * These rules lived inside `scripts/check-environment-registry.ts` while every registry they governed was a
 * file in this tree. That is no longer true: the three published templates carry their own `environment.yaml`
 * in their own repositories, read through the source-control seam (see `template-catalog.ts`). Two consumers
 * now need exactly the same answer --
 *
 *  - `scripts/check-environment-registry.ts`, for the registries that live here (ours, and any other platform
 *    directory that ever lands in this tree), and
 *  - `packages/manifest/test/templates.test.ts`, for the published template registries,
 *
 * and a rule spelled twice in two programs is the duplication this project keeps paying to remove. So the
 * predicate is exported and the callers only decide *which* registries to feed it.
 *
 * Note what these rules are for: `applyInventory` merges a registry into the plan, so a row is an input to a
 * deployment, not documentation. An obligation that contradicts itself does not merely read badly -- it
 * decides whether a tenant is asked to type something the platform was going to resolve anyway.
 */

/** A registry row, as far as these rules care. Both callers have richer shapes of their own. */
export interface RegistryRow {
  name?: string;
  kind?: string;
  secret?: boolean;
  required?: boolean;
  default?: unknown;
  database?: string;
  output?: string;
  from?: string;
}

/**
 * One problem string per contradiction, in the row's own words. Empty means every row holds together.
 *
 * The `kind` field is the load-bearing one (D33): `value`/`secret` are things an operator supplies or leaves
 * defaulted, `reference`/`output` are wiring the platform resolves. Rules follow from that split rather than
 * from taste:
 *  - `secret: true` is a custody claim (D4) and must agree with `kind: secret` in both directions;
 *  - a secret cannot carry a default, because defaults are committed and credentials are not;
 *  - wiring cannot be `required`, because nothing is being asked of anyone -- and wiring that names no
 *    database, or names a capability without an output, resolves to nothing at deploy time.
 */
export function checkRegistryObligations(rows: readonly RegistryRow[]): string[] {
  const problems: string[] = [];
  for (const e of rows) {
    const name = e.name ?? '(unnamed entry)';
    const kind = e.kind ?? (e.secret ? 'secret' : 'value');
    if (!['value', 'secret', 'reference', 'output'].includes(kind)) {
      problems.push(`${name}: kind "${kind}" is not one of value | secret | reference | output`);
      continue;
    }
    if (kind === 'secret' && e.secret !== true) problems.push(`${name}: kind is secret but secret: ${String(e.secret)} -- the custody claim and the obligation disagree (D4)`);
    if (kind !== 'secret' && e.secret === true) problems.push(`${name}: secret: true with kind "${kind}" -- a credential cannot be a default, a reference, or an output`);
    if (kind === 'secret' && e.default !== undefined) problems.push(`${name}: a secret declares a default value; defaults are for non-credentials precisely because they are committed (D4)`);
    if (kind === 'reference' && !e.database) problems.push(`${name}: kind is reference but names no database to resolve from -- this is the field a tenant is never asked to type, so a dangling reference is a deploy that fails at boot`);
    if (kind === 'output' && !(e.from ?? '').includes('#')) problems.push(`${name}: kind is output but \`from\` is not capability#output (D34)`);
    if ((kind === 'reference' || kind === 'output') && e.required === true) problems.push(`${name}: wiring cannot be required of an operator -- it is resolved by the platform, not supplied`);
  }
  return problems;
}
