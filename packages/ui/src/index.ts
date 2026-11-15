/**
 * `@platfolio/ui` — the foundation, and only the foundation (D63, 11 § Consequences for the plan).
 *
 * What this package is: the component contract, the design tokens (as CSS custom properties, per D63 — there
 * is no `packages/tokens`), the five layout primitives with the containment matrix as data, the typed signal
 * registry with mandatory retention, the SDK seam with one transport driver, and the gates that hold all of
 * them. What it is **not**: a screen. There are zero pages here, and the component registry is deliberately
 * empty, because a gate added after four screens exist audits nothing.
 *
 * Import discipline, so the next file does not guess: the API surface is reached as
 * `@platfolio/api-contract/generated/types` — a workspace dependency declared in `package.json`, the way
 * `apps/control-plane` consumes it. `scripts/check-api.ts` imports the same package by relative path because a
 * script lives outside the workspace graph and has no manifest of its own; that is the script convention, not
 * the package convention, and copying it into `packages/**` would hide a dependency edge from the lockfile gate
 * (which is how #247 resolves-on-my-machine-but-fails-CI happens).
 */

export type {
  AnyComponentContract, ComponentContract, HeadlessNode, HeadlessVariant, NeverField, PropsOf, SlotFor,
} from './contract.ts';
export { ContractViolation, declareKnownSignalIds, defineComponent, draftableLeaf } from './contract.ts';

// `consumes`/`produces` are validated against the ids the registry actually holds. Seeded here rather than
// imported inside contract.ts, because signals.ts must not depend on the contract layer and this module is the
// one place both are already in scope. A module-load side effect, so it is fixed at build time like everything
// else in this package (gate §9.6).
import { declareKnownSignalIds } from './contract.ts';
import { SIGNAL_IDS } from './signals.ts';
declareKnownSignalIds(SIGNAL_IDS);

export type { ComponentId } from './registry.ts';
export { componentById, documentProblems, isRegistryImmutable, registeredComponentIds, registrySize, UnknownComponentError } from './registry.ts';

export type {
  AnySignal, PayloadOf, Retention, RetentionOf, Signal, SignalBus, SignalDeclaration, SignalId, SignalMeta,
} from './signals.ts';
export {
  createSignalBus, makeSignal, payloadPropertyNames, REPLAY_SIGNAL_IDS, SIGNAL_IDS, SIGNALS, SignalDeclarationError, UnknownSignalError,
} from './signals.ts';

export * from './layout/index.ts';

export * from './sdk/index.ts';

export * from './tokens.ts';


export { WEB_BOUNDARY_DIR } from './web/index.ts';
