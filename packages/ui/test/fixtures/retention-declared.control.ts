import { z } from 'zod';
import { makeSignal } from '../../src/signals.ts';

/**
 * POSITIVE CONTROL for `retention-omitted.negative.ts`.
 *
 * A negative fixture that fails to compile proves nothing on its own: it could be failing because of a typo, a
 * bad import, or a missing `--moduleResolution` flag, and the gate would still read it as "the compiler refused
 * the omission". This file is the same declaration with `retention` written out, in the same fixture directory,
 * compiled by the same `tsc` invocation, and it **must** succeed.
 *
 * `scripts/check-ui.ts` §9.4b runs both and fails if either answer is wrong. That pair is what turns "the
 * fixture did not compile" into "the compiler objects specifically to a missing retention".
 */
export const declared = makeSignal({
  name: 'context.switched',
  payload: z.object({ teamSlug: z.string() }).strict(),
  retention: 'replay',
});
