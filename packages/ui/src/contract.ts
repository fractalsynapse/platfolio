import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { OperationId } from '@platfolio/api-contract/generated/types';
import { isValueBearingKey } from '@platfolio/page-schema/page';
import type { LayoutSlot } from './layout/index.ts';
import { SIGNAL_IDS, type SignalId } from './signals.ts';

/**
 * The component contract (11 §1, rules 1/3/4/6). A component is a *registered contract*, not a file that
 * returns JSX: the registration is the thing §9 checks and the render is incidental.
 *
 * **This file is a boundary, and its header states the invariant it defends (D13, D14, gate §9.6).** A
 * `ComponentContract` is resolved from a closed table that is fixed when the bundle is built. Nothing in this
 * package can be handed a component, a registry, or a module specifier at runtime — not a URL, not a server
 * response, not a tenant-authored page document. [10's Tier 2 boundary](../../../docs/design/10-cordis-kernel-and-extension-seams.md)
 * is a security property here, not a style preference: an in-process extension shares the heap of the user's
 * session, which is cross-tenant XSS with a nicer name, and platfolio's own compromise would otherwise be
 * equivalent to compromising every tenant it can dispatch to.
 *
 * What the type refuses, one field at a time:
 *
 * - `reads?: OperationId[]` is typed from `packages/api-contract`'s **generated** table. A component cannot
 *   name an operation the specification does not have, and cannot render server data it did not declare
 *   (rule 1 — #247 at a higher altitude).
 * - `slots: readonly LayoutSlot[]` is required, not optional. Placement in a slot the contract does not list
 *   is a contract violation, not ugliness (rule 2).
 * - `draftable?: readonly string[]` is an **allowlist**. A field is never drafted unless named here, and a
 *   named path that is value-bearing is refused at registration — by `isValueBearingKey`, the same predicate
 *   `packages/page-schema` uses, not a second secret list invented here (D63, rule 4).
 * - `consumes`/`produces` are typed `SignalId`, so an undeclared emit is a type error at registration rather
 *   than a surprise at runtime (rule 3).
 */

export interface ComponentContract<P extends object = object> {
  /** The only handle a page document has on the component. Stable across releases: a stored document either
   *  renders or fails loudly, and never silently drifts into a different widget. */
  readonly id: string;
  /** Props in the same StandardSchemaV1 mechanism as the manifest and the API, so server form and mobile form
   *  share one validation implementation. */
  readonly props: StandardSchemaV1<unknown, P>;
  /** The API operations whose results this component may render. Absent means "renders no server data", which
   *  is a claim the freshness gate then holds it to. */
  readonly reads?: readonly OperationId[];
  /** Signals (§3). Declaring is required to use: an undeclared `emit`/`subscribe` fails at registration. */
  readonly consumes?: readonly SignalId[];
  readonly produces?: readonly SignalId[];
  /** Layouts the component promises to behave inside (§2). Required: there is no "it fits anywhere" default. */
  readonly slots: readonly LayoutSlot[];
  /** Draft persistence, as an ALLOWLIST (§5). A path is never drafted unless it appears here. */
  readonly draftable?: readonly string[];
  /**
   * Pure render: no `fetch`, no storage, no `document`/`window` (11 §1 rule 1). Web-only behaviour belongs
   * beside it under `src/web/`, which gate §9.2 audits as the declared boundary.
   */
  readonly render: (props: P) => React.ReactNode;
}

/**
 * The erased form, for a table that holds heterogeneous components.
 *
 * It used to say `ComponentContract<object>`. That does not work, and the reason is the kind of claim an empty
 * registry can never discover: `render` is a *property* whose type is a function, so under
 * `strictFunctionTypes` its parameter is checked contravariantly, and a concrete
 * `(props: { instances: readonly InstanceRow[] }) => ReactNode` is assignable to `(props: object) => ReactNode`
 * and to nothing else of that shape. Measured as TS2375 on the first table with components in it; an index
 * signature (`{ [field: string]: any }`) fails the same way, because "has every key" and "has these keys" are
 * different claims to the compiler.
 *
 * So the erased props are `any`, which is the one type that is bivariant in both directions, and the loss is
 * bounded and deliberate: this is the view `contractProblems`, `documentProblems` and the registry walk, and all
 * three validate through the component's own StandardSchema at run time. Concrete callers still go through
 * `ComponentContract<P>` -- which is why `defineComponent` is generic and screens take typed props.
 *
 * The alternative that would keep the type honest is a second generic parameter for the erased view, and the
 * alternative that would keep it *simple* is declaring `render` as a method (`render(props: P): ReactNode`),
 * which TypeScript treats bivariantly. Neither is a change a UI branch makes on its own: 11 §1 writes this
 * interface as the contract, so the shape is its owners' call. Reported, with the failing form left in this
 * comment so nobody re-invents it.
 */
export type AnyComponentContract = ComponentContract<any>;

/** Props a registered contract accepts, so a fixture never writes a prop object out by hand. */
export type PropsOf<C> = C extends ComponentContract<infer P> ? P : never;

/** A slot is legal for a component only if its contract lists it. */
export type SlotFor<C> = C extends { readonly slots: readonly (infer S)[] } ? S : never;

/**
 * Compile-time refusals. A reviewer should be able to *name* the violation a component committed, and the
 * cheapest place to name it is the compiler. `test/contract-type.test.ts` turns each of these into an
 * executable assertion by running `tsc` over fixtures that break one rule each.
 */
export type NeverField<K extends string> = { readonly [P in K]?: never };

/** A component that carries behaviour must have a headless variant (11 §1 rule 5) — asserted at registration. */
export interface HeadlessVariant<P extends object> {
  readonly renderHeadless: (props: P) => HeadlessNode;
}

export interface HeadlessNode {
  readonly role: string;
  readonly ariaLabel?: string;
  readonly children?: readonly HeadlessNode[];
}

/** What registration refuses, as data a test can enumerate and a message can name. */
export class ContractViolation extends Error {
  readonly id: string;
  readonly problems: readonly string[];
  constructor(id: string, problems: readonly string[]) {
    super(`component "${id}" violates its contract:\n - ${problems.join('\n - ')}`);
    this.name = 'ContractViolation';
    this.id = id;
    this.problems = problems;
  }
}

/**
 * The last property segment of a `draftable` path, which is the part a name predicate can act on.
 * `profile.token` and `token` both answer `token`.
 */
export function draftableLeaf(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1] ?? path;
}

/**
 * Every reason this declaration may not be registered, gathered rather than short-circuited: a reviewer who
 * fixes one problem and re-runs should not be told about the second one by CI an hour later.
 *
 * The `draftable` walk calls `isValueBearingKey`, which is a NAME test — the residual limit `docs/ui-architecture.md`
 * § Open gaps 1 states and refuses to paper over. A credential under a neutral key is invisible here. What
 * closes that half is the props schema: a component whose `draftable` path names a prop is only allowed to
 * draft it if the prop exists, so the schema is checked too.
 */
export function contractProblems<C extends AnyComponentContract>(contract: C): string[] {
  const problems: string[] = [];

  if (typeof contract.id !== 'string' || contract.id.length === 0) problems.push('id must be a non-empty string');
  if (!contract.props || typeof contract.props !== 'object' || !('~standard' in contract.props)) {
    problems.push('props must be a StandardSchemaV1 — a hand-written interface is #247 wearing a .tsx extension (rule 1)');
  }
  if (!Array.isArray(contract.slots) || contract.slots.length === 0) {
    problems.push('slots is required and non-empty: there is no "fits anywhere" default (rule 2)');
  }

  if (contract.reads !== undefined) {
    if (!Array.isArray(contract.reads)) problems.push('reads must be a readonly array of generated OperationIds');
  }

  for (const [field, ids] of [['consumes', contract.consumes], ['produces', contract.produces]] as const) {
    if (ids === undefined) continue;
    if (!Array.isArray(ids)) {
      problems.push(`${field} must be a readonly array of SignalIds`);
      continue;
    }
    for (const id of ids) {
      if (!KNOWN_SIGNAL_IDS.has(id)) problems.push(`${field} names "${String(id)}", which is not in the signal registry (11 §3 acceptance (b))`);
    }
  }

  for (const path of contract.draftable ?? []) {
    const leaf = draftableLeaf(path);
    if (isValueBearingKey(leaf)) {
      problems.push(`draftable path "${path}" is value-bearing (${JSON.stringify(leaf)} matches the page-schema predicate) — a draft must never hold a secret value (D4, D53)`);
    }
  }

  // Rule 4's second half: a drafted field must be a field. If the props schema will not say what it accepts,
  // the allowlist cannot be checked against it, and an unchecked allowlist is a denylist with better comments.
  //
  // Guarded on the schema having been reported already. `propertyNames` dereferences `['~standard']`, so with
  // `props: undefined` it threw a bare TypeError out of `contractProblems` and the caller never saw the
  // named violation it was supposed to get — the check existed and reported the wrong thing.
  const propNames = problems.length > 0 || !contract.props ? null : propertyNames(contract.props);
  if (contract.draftable?.length) {
    if (propNames === null) {
      if (contract.props && typeof contract.props === 'object' && '~standard' in contract.props) {
        problems.push('draftable is declared but the props schema exposes no property names, so the allowlist cannot be checked');
      }
    } else {
      for (const path of contract.draftable) {
        const root = path.split('.')[0] ?? path;
        if (!propNames.includes(root)) problems.push(`draftable path "${path}" is not a prop of this component (allowlist of what? not of this schema)`);
      }
    }
  }

  return problems;
}

/** Shared with `signals.ts`; one implementation of "what fields does this schema have". */
function propertyNames(schema: StandardSchemaV1<unknown, unknown> | undefined): string[] | null {
  if (!schema) return null;
  const std = schema['~standard'] as StandardSchemaV1<unknown, unknown>['~standard'] & {
    jsonSchema?: { input: (o: Record<string, never>) => Record<string, unknown> };
  };
  if (typeof std.jsonSchema?.input !== 'function') return null;
  let doc: Record<string, unknown>;
  try {
    doc = std.jsonSchema.input({});
  } catch {
    return null;
  }
  const top = doc.properties;
  if (!top || typeof top !== 'object') return [];
  return Object.keys(top as Record<string, unknown>);
}

/**
 * The ids `consumes`/`produces` may name.
 *
 * This used to be an empty set that `src/index.ts` filled at module load, on the stated belief that importing
 * `signals.ts` here would close a cycle. It would not: `signals.ts` imports `@standard-schema/spec`, `zod` and
 * `isValueBearingKey`, and nothing from the contract layer -- the cycle was assumed, never checked, and the first
 * components that declared `consumes` proved it. Measured failure: `scripts/check-ui.ts` imports
 * `packages/ui/src/registry.ts` directly (it has to -- gate §9.5 reads the live table), so `index.ts` never ran,
 * `KNOWN_SIGNAL_IDS` stayed empty, and every component with a signal list threw `ContractViolation` at
 * registration for naming a signal that was in the registry all along. A gate that cannot load its own subject
 * reports nothing, which is the failure this repository keeps naming.
 *
 * `declareKnownSignalIds` stays, so a caller outside the package graph can still describe a platform's own signal
 * ids; it is no longer the only thing that makes the check work. Named `declare…` rather than `register…` for the
 * reason gate §9.6 gives: a mutator-looking export on a registry either trips the gate or teaches the next
 * reviewer to widen it.
 */
const KNOWN_SIGNAL_IDS = new Set<string>(SIGNAL_IDS);
export function declareKnownSignalIds(ids: readonly string[]): void {
  for (const id of ids) KNOWN_SIGNAL_IDS.add(id);
}

/** Validate and freeze. The throw is the gate; the freeze is what stops a later `push` widening a contract. */
export function defineComponent<P extends object>(contract: ComponentContract<P>): ComponentContract<P> {
  // Erased through the structural shape `contractProblems` actually reads, not through a cast to
  // `ComponentContract<object>`: `render` is contravariant in props, so that cast is unsound and TS2352
  // correctly refuses it.
  const problems = contractProblems(contract as unknown as AnyComponentContract);
  if (problems.length) throw new ContractViolation(contract.id, problems);
  return Object.freeze({
    ...contract,
    ...(contract.reads === undefined ? {} : { reads: Object.freeze([...contract.reads]) }),
    ...(contract.consumes === undefined ? {} : { consumes: Object.freeze([...contract.consumes]) }),
    ...(contract.produces === undefined ? {} : { produces: Object.freeze([...contract.produces]) }),
    ...(contract.draftable === undefined ? {} : { draftable: Object.freeze([...contract.draftable]) }),
    slots: Object.freeze([...contract.slots]),
  });
}
