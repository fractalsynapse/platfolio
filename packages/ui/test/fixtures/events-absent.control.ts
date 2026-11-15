import type { Transport } from '../../src/sdk/transport.ts';

/**
 * POSITIVE CONTROL, and the trip-wire for the whole of rule 5's "not yet".
 *
 * Today this file compiles, and the reason it compiles is the reason the placeholder is honest: the only
 * `Transport` implementation in this package is `PollTransport`, and its `kind` is `'poll'`. The last line asks
 * the type system to produce the *union of drivers this package can actually build*, and asserts that union does
 * **not** contain `'events'`.
 *
 * On the day `apps/control-plane/openapi.yaml` grows `GET …/events` and `POST …/events/ticket` (D64's required
 * work, designed there first under D41), whoever adds `src/sdk/events.ts` will make `Exclude` resolve to
 * `never` → this file stops compiling → gate §9.10c's control goes red and says so.
 *
 * That is the property this fixture exists to have. A check that only ever passes is not a check; it is a
 * sentence in a test file. The failure here is *the correct outcome* at that future moment, and the message
 * names the file to edit.
 */
type Driver = typeof import('../../src/sdk/index.ts');

/** Every transport implementation this package exports, by name. */
type ExportedTransportNames = {
  [K in keyof Driver]: Driver[K] extends new (...args: never[]) => Transport ? K : never;
}[keyof Driver];

/**
 * The `kind` each exported driver reports, read off the instance type. Not written out: a literal `'poll'` here
 * would be a second description of "which drivers exist", which is the defect every gate in this repository
 * exists to prevent, and it would keep passing while a new driver was added beside it.
 */
type BuildableKinds = InstanceType<Driver[ExportedTransportNames]>['kind'];

/**
 * The assertion. If someone exports a class whose instances are `Transport`s and report `kind: 'events'`,
 * `'events'` becomes assignable here, `EXCLUDES_EVENTS` stops being `true`, and the `satisfies` fails.
 */
type ExcludesEvents = 'events' extends BuildableKinds ? false : true;

export const EXCLUDES_EVENTS: ExcludesEvents = true;

/**
 * Compile-time evidence, not a runtime one: a value whose type only exists when the assertion holds. Reviewers
 * reading this should note it does **not** import a list of driver names — that would be a second description of
 * "what drivers exist", of exactly the kind every gate in this repository exists to prevent.
 */
export const tripwire: {
  'the events driver is a placeholder; if this line no longer compiles, §4 operations landed and 11 §4/R5 must be re-read': true;
} = { 'the events driver is a placeholder; if this line no longer compiles, §4 operations landed and 11 §4/R5 must be re-read': EXCLUDES_EVENTS };
