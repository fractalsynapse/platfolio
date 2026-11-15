import { contractProblems, type AnyComponentContract } from './contract.ts';
import { contextSwitcher, freshnessLabel, instanceDetail, instanceList, instanceRow, instanceState } from './components/instances.tsx';

/**
 * The component registry — **a security boundary, not a lookup table (D13, D14, D63, gate §9.6).**
 *
 * Invariant, stated where it can be checked:
 *
 * 1. **Every component this process can render was fixed when this module was evaluated.** `COMPONENTS` is a
 *    closed literal; `registry()` copies it into a frozen `Map` and the module exports **no** `register`,
 *    `add`, `set`, `load`, `extend`, `delete` or `clear`. A component cannot be added at runtime, so it cannot
 *    be added by a response.
 * 2. **Nothing here imports a specifier that is not first-party source.** No dynamic `import()` appears in this
 *    package, and gate §9.6 (`scripts/check-ui.ts`) fails the build if one is added — including
 *    `import(url)`, `await import(...)`, `new Function`, and a `URL` built from a response and handed to a
 *    loader. [10's Tier 2 boundary](../../../docs/design/10-cordis-kernel-and-extension-seams.md) is a
 *    security property: an in-process extension shares the heap of the user's session, which is cross-tenant
 *    XSS with a nicer name.
 * 3. **Page documents are data.** A document names a component `id` and a props object. It cannot carry code,
 *    an expression that evaluates, or a module specifier. An unknown `id` is a thrown error at validation —
 *    11 §9.5's "fails loudly, not as an empty div" — because an empty div is a defect a user discovers and a
 *    reviewer does not.
 *
 * Making the registry *look* generic enough to accept a remote specifier would be the single cheapest way to
 * undo D4, so the refusal is written into the type (`ComponentId` is a union of the literal keys) as well as
 * into the gate.
 */

/**
 * The closed set. Adding a component means editing this object, which puts it in a diff, a review and a test —
 * that is the whole mechanism, and it is deliberately not more convenient than that.
 *
 * It was empty on purpose for one commit (11 § Consequences for the plan: a gate added after four screens exist
 * audits nothing), and it is populated now that the screens have landed. What did **not** change is the shape of
 * the boundary: still a literal, still no mutator export, still `ComponentId = keyof typeof COMPONENTS`, so a
 * remote specifier is refused by type as well as by grep. What did change is which gates have a subject: §9.5 now
 * resolves real ids and re-validates a stored document, and §9.11 has `reads` declarations to compare. Both were
 * NOT RUN and said so; both run now, and `test/gates-falsify.test.ts` has a mutation for each.
 *
 * The keys are the contracts' own `id` strings and `CACHE` below throws when a key and its contract disagree, so
 * this table cannot quietly become a second list of component names beside the components — #247's shape, one file
 * down. Six components, each declared in `components/instances.tsx` with its `reads`, `slots` and signal lists.
 */
const COMPONENTS = {
  'context.switcher': contextSwitcher,
  'freshness.label': freshnessLabel,
  'instance.detail': instanceDetail,
  'instance.list': instanceList,
  'instance.row': instanceRow,
  'instance.state': instanceState,
} as const satisfies Record<string, AnyComponentContract>;

export type ComponentId = keyof typeof COMPONENTS;

/** Every id this process can render. The parity gate and the page-document check both read this, nothing else. */
export function registeredComponentIds(): ComponentId[] {
  return Object.keys(COMPONENTS) as ComponentId[];
}

/**
 * An immutable lookup, not a frozen `Map`.
 *
 * `Object.freeze(new Map())` returns `true` from `Object.isFrozen` and still accepts `.set()`: a Map's entries
 * live in internal slots that freezing the wrapper does not reach. The first version of this module claimed
 * `isFrozenRegistry()` proved the registry could not be widened, and the claim was false in exactly the way
 * (`test/registry.test.ts` caught it; the function is now `isRegistryImmutable()` and no alias survives)
 * `test/registry.test.ts` was written to catch — a guard that reports it is guarding and guards nothing, which
 * is `FakeInfraProvider({ without })` again and the reason 11 §3 prices a one-sided assertion so highly.
 *
 * So: entries are copied into a frozen plain object behind a `null` prototype (no `__proto__`/`constructor`
 * keys to collide with a component id), and the only accessor is `get`. There is no reachable mutation path to
 * freeze shut.
 */
interface Registry {
  readonly size: number;
  readonly ids: readonly string[];
  get(id: string): AnyComponentContract | undefined;
}

const CACHE: Registry = (() => {
  const entries = Object.entries(COMPONENTS) as [string, AnyComponentContract][];
  const problems: string[] = [];
  for (const [id, contract] of entries) {
    if (contract.id !== id) problems.push(`registry key "${id}" does not match the contract id "${contract.id}"`);
    for (const problem of contractProblems(contract)) problems.push(`${id}: ${problem}`);
  }
  if (problems.length) {
    throw new Error(`component registry is invalid:\n - ${problems.join('\n - ')}`);
  }
  const index: Record<string, AnyComponentContract> = Object.create(null) as Record<string, AnyComponentContract>;
  for (const [id, contract] of entries) index[id] = contract;
  return Object.freeze({
    size: entries.length,
    ids: Object.freeze(entries.map(([id]) => id)),
    get: (id: string): AnyComponentContract | undefined =>
      // Own-property only. An inherited lookup would answer for `constructor`, `toString`, and anything else a
      // page document could name.
      Object.prototype.hasOwnProperty.call(index, id) ? index[id] : undefined,
  });
})();

export class UnknownComponentError extends Error {
  constructor(id: string) {
    super(
      `page document names component "${id}", which is not in the build-time registry. `
      + `Known ids: ${registeredComponentIds().length === 0 ? '(none yet — this package ships contracts, not screens)' : registeredComponentIds().join(', ')}. `
      + 'Rendering an unknown id as an empty element is gate §9.5 failing silently.',
    );
    this.name = 'UnknownComponentError';
  }
}

/** Resolve by id or throw. There is no "return undefined and let the caller decide" door. */
export function componentById(id: string): AnyComponentContract {
  const found = CACHE.get(id);
  if (!found) throw new UnknownComponentError(id);
  return found;
}

/**
 * Validate a stored page document against the registry before anything renders it (11 §9.5's "yesterday's
 * document" fixture). Returns every problem at once for the same reason `contractProblems` does.
 */
export function documentProblems(doc: { readonly component: string; readonly props?: unknown }): string[] {
  const problems: string[] = [];
  const found = CACHE.get(doc.component);
  if (!found) {
    problems.push(`unknown component "${doc.component}"`);
    return problems;
  }
  const result = found.props['~standard'].validate(doc.props);
  if (result instanceof Promise) {
    problems.push(`${doc.component}: props schema is asynchronous, so validation cannot gate a render`);
  } else if (result.issues) {
    for (const issue of result.issues) problems.push(`${doc.component}: ${(issue.path ?? []).map(String).join('.')}: ${issue.message}`);
  }
  return problems;
}

/**
 * The refusal that makes this a *closed* registry rather than an open one with good manners: nothing may be
 * added after module evaluation, and this is asserted by test rather than promised by comment.
 */
/**
 * Can this registry be widened after module evaluation? **It attempts the widening and reports whether it
 * stuck**, rather than asking `Object.isFrozen` of the wrapper.
 *
 * That distinction is the whole function. `Object.freeze(new Map())` satisfies `Object.isFrozen` and still
 * accepts `.set()`, because a Map keeps its entries in internal slots the freeze does not reach — so the first
 * version of this guard returned `true` for a registry that was, in fact, open. A security check whose answer is
 * computed from the wrong question is worse than no check, because it is reported as passing.
 *
 * Returns `true` only when the probe id is absent afterwards. `false` means the Tier 2 boundary moved, and every
 * caller treats that as fatal.
 */
export function isRegistryImmutable(): boolean {
  const probe = '__platfolio_registry_probe__';
  const store = CACHE as unknown as Record<string, unknown>;
  try {
    store[probe] = {};
  } catch {
    // A strict-mode assignment to a frozen object throws. That is the wanted outcome.
    return true;
  }
  return store[probe] === undefined;
}

/** How many components this process can render. Reported by §9.5 so an empty registry says so out loud. */
export function registrySize(): number {
  return CACHE.size;
}
