export type {
  ApiError, AuthSource, EventsTransportPlaceholder, Freshness, FreshnessSource, Loaded, Failed, Pending,
  OperationResult, Result, State, Transport, TransportKind, Unsubscribe, ObservedAt,
} from './transport.ts';
export { formatAge, isLoaded, REQUIRED_PUSH_OPERATIONS } from './transport.ts';
export type { Endpoint, OperationTable, PollTransportConfig } from './poll.ts';
// `ENDPOINTS` itself is deliberately NOT re-exported here. The route table has one owner — the generated
// contract module — and a second name for it in this barrel is how it becomes a global every screen reaches
// for. A driver reads it (`poll.ts`, the only file gate §9.2 permits to), and anything that genuinely needs
// the table imports it from `@platfolio/api-contract/generated/types` the way it imports every other generated
// type (rule 1). What this package exports is the seam: the entry shape, the total table type, and the two
// helpers that turn an operation id plus `ParamsOf` into a request.
export { createPublicMarketplaceCatalog, endpointFor, fillPath, PollTransport, queryString } from './poll.ts';
export type { SdkContextValue, UseOperationInput, UseOperationResult } from './use-operation.ts';
export { SdkContext, SdkProvider, useOperation } from './use-operation.ts';
export { applyResult, initial, isRefresh } from './state.ts';
