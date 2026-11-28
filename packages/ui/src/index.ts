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

// `consumes`/`produces` are validated against the ids the registry actually holds, and `contract.ts` now reads
// that table directly: the seeding this file used to do was the only thing making the check work, which meant
// anything importing `registry.ts` without importing this barrel -- like `scripts/check-ui.ts` -- saw an empty id
// set and refused every component that declared a signal. Measured; see the note in contract.ts. The call stays
// for callers outside the package graph that need to describe a platform's own ids.
import { declareKnownSignalIds } from './contract.ts';
import { SIGNAL_IDS } from './signals.ts';
declareKnownSignalIds(SIGNAL_IDS);

export type { ComponentId } from './registry.ts';
export { componentById, documentProblems, isRegistryImmutable, registeredComponentIds, registrySize, UnknownComponentError } from './registry.ts';

export type {
  ContextSwitcherProps, FreshnessLabelProps, InstanceDetailProps, InstanceListProps, InstanceRowProps, InstanceStateProps,
} from './components/instances.ts';
export {
  contextSwitcher, freshnessLabel, INSTANCE_COMPONENTS, instanceDetail, instanceList, instanceRow, instanceState,
} from './components/instances.ts';
export { ROLLUP_IS_NOT_THE_TRUTH, statePresentation, STATE_PRESENTATION, type InstanceState, type StateTone } from './components/instance-state.ts';
export { ageAt, ageIsDoubtful, ageLabel, STALE_AFTER_SECONDS, transportWord, useClock } from './components/freshness.ts';
export { fieldLabel, schemaPropertyNames } from './components/props.ts';
export { AGE_UNKNOWN, STALE_SUFFIX } from './components/copy.ts';
export {
  isSelectableEnvironment, SELECTABLE_ENVIRONMENTS, unservedEnvironments,
  type InstanceDetail, type InstanceEnvironmentRow, type InstanceRow as InstanceRowModel, type LatestAttestation,
  type SelectableEnvironment, type TeamMembership,
} from './components/view-models.ts';
export { COMPONENT_CLASSES, COMPONENT_RULES, isComponentClass, renderComponentCss } from './components/style.ts';

export type { ScreenDocument, ScreenNode } from './screens/screen.ts';
export {
  capabilityParityProblems, reachableOperations, renderScreen, screenLayoutTree, screenPlacements, screenSlots,
} from './screens/screen.ts';
export { INSTANCE_LIST_SCREEN, SCREENS } from './screens/index.ts';
export { InstanceListScreen } from './screens/instance-list.tsx';

export type { SignalsProviderProps } from './signals-context.ts';
export { SignalsContext, SignalsProvider, useEmit, useSignalRetention, useSignalValue, useSignals } from './signals-context.ts';

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

/**
 * The first two modules inside the declared web boundary that are not prose (D65): the browser's `AuthSource` for
 * the `platfolio-web` PKCE client, and the one function a page calls to build its SDK context and signal registry.
 *
 * Re-exported at the package entry rather than left as deep paths for one reason: the singleton guarantee in
 * `shell.tsx` is only a guarantee if there is one obvious door. `AuthSource` itself stays where it was declared —
 * `sdk/transport.ts` — and is not duplicated here; `TokenSet`/`IssuerRequest`/`Digest`/`RandomBytes`/`HandoffStore`
 * are this boundary's own vocabulary and appear nowhere else. What a native or desktop shell does with any of it is
 * UI-OD3's question, not this file's.
 */
export {
  authPolicy,
  createBrowserAuthSource,
  createTokenBag,
  createVerifierWith,
  endpointsForIssuer,
  isHubSignInCallback,
  pkceChallengeWith,
  type BrowserAuthConfig,
  type BrowserAuthSource,
  type Digest,
  type HandoffStore,
  type HubSignIn,
  type IssuerEndpoints,
  type IssuerRequest,
  type IssuerResponse,
  type RandomBytes,
  type TokenBag,
  type TokenSet,
} from './web/browser-auth.ts';
export {
  createShellContext,
  resetShellContextForTests,
  ShellContextConflict,
  shellContextCount,
  type ShellCapabilities,
  type ShellContext,
  type ShellEndpoints,
} from './web/shell.tsx';

/**
 * The browser authentication policy, re-exported at the package entry (D65; see the header of
 * `web/browser-auth-policy.ts` for why the declarations live there and not in `scripts/browser-auth.ts`).
 *
 * These are the words a shell must not retype: the client's name, its scope, its callback path, the PKCE method,
 * where a token may live, what logout clears, and — since D67 — the one pair of values that is *not* a token and
 * may still be persisted across the redirect. `apps/site` reads `WEB_CLIENT_ID` and `REQUIRED_SCOPE` from here
 * rather than from the operator script, because a client bundle that imports `scripts/` imports `node:crypto`, and
 * that is the failure the policy module's header records. `web/browser-auth.ts`'s own `authPolicy` object is the
 * same facts as one value for a reviewer; these are the same facts for code.
 */
export {
  API_CLIENT_ID,
  CALLBACK_PATH,
  HANDOFF_KEYS,
  HANDOFF_STORAGE,
  LOGOUT_CLEAR,
  PKCE_METHOD,
  RECOMMENDED_STORE,
  REQUIRED_SCOPE,
  TOKEN_STORAGE,
  WEB_CLIENT_ID,
  endSessionUrl,
  isPkceVerifier,
  isTokenShapedName,
  refreshAt,
  refreshSkewSeconds,
  type HandoffField,
  type PkcePair,
  type StorageLocation,
  type TokenKind,
} from './web/browser-auth-policy.ts';

export { StarterLaunchScreen } from './screens/starter-launch.tsx';

export { Workspace } from './workspace/workspace.tsx';
export { workspacePaths, workspaceReturnPath } from './workspace/routes.ts';
export { WorkspaceEntry } from './workspace/workspace-entry.tsx';
export { PublicHeader } from './workspace/public-header.tsx';
export { Breadcrumbs } from './workspace/breadcrumbs.tsx';
export { WorkspaceHeading } from './workspace/workspace-heading.tsx';
export { WorkspacePanel } from './workspace/workspace-panel.tsx';
export { TemplateCard } from './workspace/template-card.tsx';
export { describeTemplate, templatePaths, TEMPLATE_CATEGORIES } from './workspace/template-presentation.ts';
export { MainContext } from './layout/main-context.tsx';
export { PrivateSetupGate } from './workspace/private-setup-gate.tsx';
