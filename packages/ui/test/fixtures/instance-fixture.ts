import type { InstanceResponse } from '@platfolio/api-contract/generated/types';

/**
 * One `InstanceResponse`, built from the **generated** type rather than a hand-written shape.
 *
 * This file exists so the fixtures share one instance literal instead of each restating the fields of a server
 * DTO — which is rule 1's prohibition, in a test directory, where no gate would be looking. It is typed
 * `InstanceResponse` (imported, not copied), so when the contract changes this fixture stops compiling and the
 * author is sent to the spec rather than left holding a stale object.
 */
export const oneInstance: InstanceResponse = {
  id: '01EXAMPLE',
  teamId: '01TEAM',
  name: 'starter-web',
  template: 'starter-web',
  // Deliberately not `live`: that value is in the contract's own state enum, and the freshness gate in
  // scripts/check-ui.ts refuses the word in *this package's source*. Using a different state here keeps the
  // fixture out of the way of the rule it is meant to exercise.
  state: 'degraded',
  provider: 'railway',
  createdAt: '2026-11-15T09:00:00.000Z',
  updatedAt: '2026-11-15T09:30:00.000Z',
  environments: [{
    instanceId: '01EXAMPLE',
    environment: 'production',
    state: 'degraded',
    updatedAt: '2026-11-15T09:30:00.000Z',
  }],
};
