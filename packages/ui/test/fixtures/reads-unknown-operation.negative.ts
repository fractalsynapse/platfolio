import { defineComponent } from '../../src/contract.ts';
import { z } from 'zod';

/**
 * NEGATIVE FIXTURE — expected to FAIL compilation. Gate §9.1b.
 *
 * Rule 1: a component names the operations whose results it renders, and those names come from the table
 * generated from `apps/control-plane/openapi.yaml`. `listTeamEvents` is 11 §4's *required but absent* push
 * operation; naming it here is the act this fixture refuses — a UI that compiles against an endpoint that does
 * not exist, which is rule 5's "never describe planned behaviour as delivered" arriving as a type instead of as
 * copy.
 *
 * Why a fixture and not a runtime check: `packages/ui` has no runtime list of operation ids, and importing the
 * one that could produce it (`loadSpec`/`operationsOf`) is forbidden by 11 §6 acceptance (c). So the compiler is
 * the only thing holding this line, and the compiler is what this asserts.
 */
export const c = defineComponent({
  id: 'example.panel',
  props: z.object({ id: z.string() }).strict(),
  // `reads` is typed `readonly OperationId[]`. This element is not one. No cast: a cast would silence the very
  // error the gate is looking for.
  reads: ['listInstances', 'listTeamEvents'],
  slots: ['stack'],
  render: () => null,
});
