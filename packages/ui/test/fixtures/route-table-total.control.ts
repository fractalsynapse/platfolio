import { ENDPOINTS, type Endpoint } from '@platfolio/api-contract/generated/types';
import { PollTransport, type OperationTable } from '../../src/index.ts';

/**
 * POSITIVE CONTROL for `route-table-partial.negative.ts`, and the reason that refusal means anything: the same
 * type, the same compiler, the same flags, and this file **must** succeed.
 *
 * It also states the constructive half of #258. `ENDPOINTS` satisfies `OperationTable` with no cast and no
 * help, because the guard that built the table is the same `Record<OperationId, Endpoint>` this assignment
 * reads. So the shell's only job is the base URL (D47) and the driver's routes arrive checked rather than
 * assembled — which is what the second declaration below does with nothing but an origin.
 */
export const totalTable: OperationTable = ENDPOINTS;

/**
 * A driver needs an origin and nothing else. Loopback port 1 is not a host: it proves the constructor's shape,
 * and constructing performs no request — this fixture is compiled, never run.
 */
export const driverNeedsOnlyAnOrigin = new PollTransport({ baseUrl: 'http://127.0.0.1:1' });

/** One route, read off the generated table rather than written out beside it. */
export const instanceRoute: Endpoint = ENDPOINTS.getInstance;
