import { z } from 'zod';
import { makeSignal } from '../../src/signals.ts';

/**
 * NEGATIVE FIXTURE — this file is expected to FAIL compilation.
 *
 * `scripts/check-ui.ts` §9.4b runs `tsc` over exactly this file and refuses the build if it *compiles*, and
 * also refuses it if it fails for any reason that does not name `retention`. Both halves matter: a fixture
 * that failed on an unrelated typo would leave the gate green while proving nothing — the coin-flip defect
 * `docs/ui-architecture.md` records under rule 3, reproduced inside a negative test.
 *
 * The claim under test is narrow and load-bearing: **retention has no default.** Not "the docs say it is
 * mandatory". The declaration below is well-formed TypeScript in every other respect, and must still be
 * rejected.
 *
 * There is deliberately **no cast, no `as never`, and no `@ts-expect-error`** here. A cast would silence the
 * very error the gate is looking for and turn §9.4b into a check that passes because it was written to.
 */
export const undeclared = makeSignal({
  name: 'context.switched',
  payload: z.object({ teamSlug: z.string() }).strict(),
  // `retention` omitted. Nothing here can supply it: `SignalDeclaration` declares the field as required,
  // `makeSignal` has no default parameter, and no `??` appears anywhere in signals.ts.
});
