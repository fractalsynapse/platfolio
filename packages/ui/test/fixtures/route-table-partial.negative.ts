import type { OperationTable } from '../../src/index.ts';

/**
 * NEGATIVE FIXTURE — expected to FAIL compilation. #258.
 *
 * The route table is a seam, so it stays injectable. What it is not is *partial*: `OperationTable` is
 * `Readonly<Record<OperationId, Endpoint>>`, so naming two operations and leaving every other operation the
 * document declares unnamed is not a shorter table, it is a table that does not type. That is the difference
 * between "the shell brings configuration" and "the shell brings a second copy of the routes, smaller than the
 * first" -- the second one answers 404 for whatever its author forgot, in a screen nobody re-tests. How many
 * operations that is on any given day is `scripts/check-api.ts`'s to report, not this file's to remember.
 *
 * No cast here: a cast would silence the error this fixture exists to produce.
 */
export const handWrittenPartialTable: OperationTable = {
  listInstances: { method: 'get', path: '/api/v1/instances' },
  getInstance: { method: 'get', path: '/api/v1/instances/{instanceId}' },
};
