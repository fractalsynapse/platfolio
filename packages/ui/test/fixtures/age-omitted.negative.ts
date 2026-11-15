import type { Loaded } from '../../src/index.ts';
import { oneInstance } from './instance-fixture.ts';

/**
 * NEGATIVE FIXTURE — this file is expected to FAIL compilation.
 *
 * Gate §9.10b: rule 5 says **every render shows its age**, and 11 §9.10 says the mechanism is "type-level — the
 * data hook's result includes age by construction". This file is the test of that claim. It builds a
 * successfully-loaded operation result with the data and none of the freshness, which is precisely what a
 * screen would do if `freshness` were optional: render a green "deployed" badge with no statement of when that
 * was learned.
 *
 * `Loaded<O>` makes `freshness` a required member, so the object below is missing a property the type demands.
 * If someone relaxes it to `freshness?:` to quiet a call site, this fixture starts compiling and the gate fails
 * the build — which is the point. The positive control is `age-carried.control.ts`, the same object with the
 * field present, which must keep compiling.
 *
 * No cast and no `@ts-expect-error`, for the same reason as the retention fixture: either would silence the
 * error the gate is looking for.
 */
export const badge = {
  operation: 'listInstances',
  params: {},
  status: 'loaded',
  data: [oneInstance],
  // `freshness` omitted: no observedAt, no `via`, so no age and no honest label.
} satisfies Loaded<'listInstances'>;

/**
 * This fixture carries exactly **one** intentional error.
 *
 * An earlier draft also held a helper that destructured `freshness` off a `Loaded`, to show the rule delivers
 * the fact as well as forbidding its absence. That was a mistake in the fixture and a hole in the gate: when
 * `Loaded.freshness` was relaxed to optional during falsification, the omission *stopped* being an error and the
 * helper *started* being one — `freshness is possibly undefined`. The fixture still failed to compile, the
 * message still contained the word `freshness`, and §9.10b reported PASS while the rule it guards was broken.
 *
 * One error per negative fixture. The "rule 5 also delivers the age" half belongs in a control file, where a
 * compile failure means what it says.
 */
