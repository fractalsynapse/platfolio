/**
 * The template catalog: which published repository *is* which template, and how to read it.
 *
 * There is no bundled copy of a template in this repository any more, and that is the whole point. The three
 * `fractalsynapse/platfolio-*` repositories used to be *generated artifacts* of a `templates/` directory
 * (D38), and the gap between the two copies was maintained by a publisher and a parity checker whose combined
 * job was to keep one fiction in step with another. They drifted all day: the registry consolidation (D58)
 * deleted `.platfolio/environment.yaml` from the bundled copy and left it live in all three published
 * repositories, where `applyInventory` still merged it into the plan beside the new root registry -- two
 * registries per platform, surviving in exactly the place a tenant forks.
 *
 * The maintainer's ruling (2026-11-14) ends the arrangement:
 *
 * > "These template repositories are currently and will ALWAYS be public and open source so there is no need
 * > for credentials to clone them and they are small so there is not a size bottleneck. I still favor removing
 * > the hardcoded templates and using and aligning the REAL templates that people actually use. This tests the
 * > core Platfolio platform and the basic templates, so it is a double win with very little cost."
 *
 * So a template is now consumed the way a tenant's platform is consumed: through the source-control seam
 * (D22), at a ref, one file at a time. `apps/control-plane` does exactly this in
 * `POST …/instances/{id}/plan/from-repository` -- `ctx.scm.readFile({repo, ref, path})` -- and this module is
 * the same mechanism with the credential part left to the caller, because reading a *public* repository needs
 * none (D4: no token here, and no token in the tests).
 *
 * Two consequences worth stating rather than discovering:
 *
 * 1. **`sourcePaths` is a declaration, not a listing.** The seam reads one file at one ref; it does not
 *    enumerate a tree, and nothing here shells out to `git ls-tree` to work around that -- a second way of
 *    reading a repository is the failure this change exists to end. So the files whose contents count as
 *    "the template's own source" are named per entry. If a template gains a source file, the acceptance test
 *    fails with that name in the message until the entry names it: the coupling is loud and in the safe
 *    direction (a reference nobody reads *silently passes* is the failure mode; a new file nobody listed is a
 *    red test).
 * 2. **`ref` is a branch, deliberately.** D29 pins a *plan* to a commit, and the product path keeps that rule
 *    (`templateRef.commitSha`). The acceptance test reads `main` on purpose: its subject is the artifact people
 *    fork today, not a frozen commit. The blob SHAs of everything it read are reported, so "what did this
 *    green check actually look at" stays answerable after the fact.
 */
import { parse as parseYaml } from 'yaml';

/** A published template, as the catalog names it (D45: `Instance.template` holds `name`). */
export interface TemplateCatalogEntry {
  /** The catalog name a tenant's instance cites. */
  readonly name: string;
  /** The repository that IS this template. Public, anonymous, no credential to read. */
  readonly repo: string;
  /** What it is, for the log line and the PR body. */
  readonly label: string;
  /** The ref the acceptance reads. See consequence 2 in the header comment. */
  readonly ref: string;
  /** The platform description. Required: a template nobody can parse is not a template. */
  readonly composePath: string;
  /** The platform's own environment registry (D58). Required, same reason. */
  readonly inventoryPath: string;
  /**
   * The development overlay, when the platform is developed at all (D51). Absent is a legitimate state --
   * `shared-identity` is `mode: hosted` and ships no overlay -- but "absent" is decided here rather than
   * inferred from a read that happened to fail.
   */
  readonly devOverlayPath?: string;
  /** The files whose text counts as this template's own source (consequence 1). */
  readonly sourcePaths: readonly string[];
}

/** The whole catalog. Ordered: the acceptance test reports in this order. */
export const TEMPLATE_CATALOG: readonly TemplateCatalogEntry[] = [
  {
    name: 'starter-web',
    repo: 'fractalsynapse/platfolio-starter-web',
    label: 'web service (public UI + API, managed Postgres)',
    ref: 'main',
    composePath: 'compose.yaml',
    inventoryPath: 'environment.yaml',
    devOverlayPath: 'compose.dev.yaml',
    sourcePaths: ['Dockerfile', 'src/server.mjs'],
  },
  {
    name: 'starter-worker',
    repo: 'fractalsynapse/platfolio-starter-worker',
    label: 'worker (no inbound, retained volume)',
    ref: 'main',
    composePath: 'compose.yaml',
    inventoryPath: 'environment.yaml',
    devOverlayPath: 'compose.dev.yaml',
    sourcePaths: ['Dockerfile', 'src/worker.mjs'],
  },
  {
    name: 'shared-identity',
    repo: 'fractalsynapse/platfolio-shared-identity',
    label: 'shared identity (Keycloak, provides identity)',
    ref: 'main',
    composePath: 'compose.yaml',
    inventoryPath: 'environment.yaml',
    // mode: hosted (D51): operated, not developed, so there is no overlay and nothing to compile.
    sourcePaths: [],
  },
];

/** Every repository the catalog names. `check-project.ts` compares this against what the tree is allowed to name. */
export const TEMPLATE_REPOSITORIES: readonly string[] = TEMPLATE_CATALOG.map((t) => t.repo);

export function templateCatalogEntry(name: string): TemplateCatalogEntry {
  const found = TEMPLATE_CATALOG.find((t) => t.name === name);
  if (!found) {
    throw new Error(`"${name}" is not in the template catalog (${TEMPLATE_CATALOG.map((t) => t.name).join(', ')}). A template is a published repository, so adding one is a repository plus an entry here -- not a directory in platfolio.`);
  }
  return found;
}

/** One file as the seam returns it. The shape both `GitScm.readRepositoryFile` and `ScmService.readFile` satisfy. */
export interface RepositoryFileContent {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly content: string;
}

/**
 * The seam, as this module needs it: read one file of one repository at one ref.
 *
 * A function rather than an interface, so the caller supplies whichever driver the deployment chose
 * (`PLATFOLIO_SCM_DRIVER=git` -> `GitScm`, `github-app` -> `ctx.scm.readFile`) without this module knowing
 * which. It must fail by THROWING: the callers here distinguish a refusal from an absence, so a reader that
 * returned empty content for a failure would turn a red test green.
 */
export type RepositoryFileReader = (request: { repo: string; ref: string; path: string }) => Promise<RepositoryFileContent>;

/**
 * The seam's "that path is not in that ref" answer, recognised structurally.
 *
 * Structural, not `instanceof`: `apps/control-plane` catches the same class to make the same distinction
 * ("A missing overlay is a legitimate state ... Any OTHER read failure is not"), and a catalog that reached
 * for the class would be reaching across the package boundary for a type it does not own. `failure.kind` is
 * the contract's own field (`RepositoryFailure`), and `ref-not-found` is deliberately NOT folded in here --
 * a ref that does not exist means we could not read the repository, which is never an acceptable answer.
 */
function isAbsent(error: unknown): boolean {
  const failure = (error as { failure?: { kind?: unknown } })?.failure;
  return failure?.kind === 'not-found' || failure?.kind === 'not-a-file';
}

/** Everything read from one repository at one ref, with the blob SHA of each file as evidence. */
export interface RepositorySource {
  readonly repo: string;
  readonly ref: string;
  /** The platform description. */
  readonly compose: string;
  /** The generated production overlay, when the repository commits one (D54: a fork need not). */
  readonly prodOverlay?: string;
  /** The platform's environment registry (D58), when it has one. */
  readonly inventory?: string;
  /** The development overlay, when the catalog names one and the repository has it. */
  readonly devOverlay?: string;
  /** The declared source files, keyed by path. */
  readonly sources: Readonly<Record<string, string>>;
  /** path -> blob SHA, for every file actually read. Reported by the acceptance test. */
  readonly blobs: Readonly<Record<string, string>>;
}

async function read(readFile: RepositoryFileReader, repo: string, ref: string, path: string): Promise<RepositoryFileContent | undefined> {
  try {
    return await readFile({ repo, ref, path });
  } catch (error) {
    // Absent is a state of the repository. Anything else -- a bad ref, a refusal, a dead network -- is the
    // caller's problem to see, and propagates with the driver's own words. That is the difference between
    // "this template has no dev overlay" and "we never looked", and #130 was filed over exactly that blur.
    if (isAbsent(error)) return undefined;
    throw error;
  }
}

/**
 * Read one repository at one ref: the platform description, its overlay and registry, and the named sources.
 *
 * `compose.yaml` is required and read first: every other path is only interesting once there is a platform
 * description to talk about, and a template without one should fail on THAT, not on a missing overlay.
 */
export async function readRepositorySource(input: {
  readFile: RepositoryFileReader;
  repo: string;
  ref: string;
  /** Extra source paths to read. The catalog supplies these for a template. */
  sourcePaths?: readonly string[];
  /** Read `compose.prod.yaml` as well. Used by the install path, where the pin is the point. */
  prodOverlay?: boolean;
  /** Read the development overlay, and treat its absence as the answer rather than a failure. */
  devOverlay?: boolean;
  /** Read the platform registry, and treat its absence as the answer. */
  inventory?: boolean;
}): Promise<RepositorySource> {
  const { readFile, repo, ref } = input;
  const compose = await read(readFile, repo, ref, 'compose.yaml');
  if (!compose) {
    throw new Error(`${repo}@${ref.slice(0, 12)} has no compose.yaml: that is the platform description, and without it there is nothing to parse, validate or host.`);
  }
  const blobs: Record<string, string> = { [compose.path]: compose.sha };
  const sources: Record<string, string> = {};

  const prod = input.prodOverlay ? await read(readFile, repo, ref, 'compose.prod.yaml') : undefined;
  if (prod) blobs[prod.path] = prod.sha;
  const inv = input.inventory ? await read(readFile, repo, ref, 'environment.yaml') : undefined;
  if (inv) blobs[inv.path] = inv.sha;
  const dev = input.devOverlay ? await read(readFile, repo, ref, 'compose.dev.yaml') : undefined;
  if (dev) blobs[dev.path] = dev.sha;

  for (const path of input.sourcePaths ?? []) {
    const file = await read(readFile, repo, ref, path);
    // A declared source that is NOT there is a lie in the catalog, and the catalog is the thing under test.
    // Absent is therefore a failure here, unlike the optional composition files above whose absence is a real
    // state of a platform: `shared-identity` legitimately has no overlay, but a template entry that names
    // `src/server.mjs` is claiming the published repository contains it.
    if (!file) throw new Error(`${repo}@${ref.slice(0, 12)} has no "${path}", which the template catalog names as one of its sources. Either the published repository lost it or the entry is wrong -- both mean the acceptance is no longer reading the real template.`);
    sources[path] = file.content;
    blobs[path] = file.sha;
  }

  return {
    repo,
    ref,
    compose: compose.content,
    ...(prod === undefined ? {} : { prodOverlay: prod.content }),
    ...(inv === undefined ? {} : { inventory: inv.content }),
    ...(dev === undefined ? {} : { devOverlay: dev.content }),
    sources,
    blobs,
  };
}

/** Read one catalog entry. `ref` overrides the catalog's ref (the acceptance keeps the default). */
export async function readTemplate(
  readFile: RepositoryFileReader,
  entry: TemplateCatalogEntry,
  ref: string = entry.ref,
): Promise<RepositorySource> {
  return readRepositorySource({
    readFile,
    repo: entry.repo,
    ref,
    sourcePaths: entry.sourcePaths,
    devOverlay: entry.devOverlayPath !== undefined,
    inventory: true,
  });
}

/** Every catalog entry, read. The acceptance test's single read point. */
export async function readCatalog(readFile: RepositoryFileReader): Promise<Map<string, RepositorySource>> {
  const out = new Map<string, RepositorySource>();
  for (const entry of TEMPLATE_CATALOG) out.set(entry.name, await readTemplate(readFile, entry));
  return out;
}

/**
 * The documents that describe the platform, in the order `parseCompose` wants them: description, then the
 * generated pin. A production overlay is NOT one of these documents on purpose -- the dev overlay changes
 * topology (a local database container, a source mount), and rendering a plan from it would build a plan for
 * the laptop instead of for the provider.
 */
export function composeDocuments(source: RepositorySource): string[] {
  return source.prodOverlay === undefined ? [source.compose] : [source.compose, source.prodOverlay];
}

/** Service names from the platform description, for pinning every service a release would build. */
export function composeServiceNames(compose: string): string[] {
  const doc = parseYaml(compose) as { services?: Record<string, unknown> } | null;
  return Object.keys(doc?.services ?? {});
}

/** Every file that counts as this template's own text: the composition it read plus the sources it named. */
export function templateTexts(source: RepositorySource, includeDevOverlay = true): string[] {
  const texts = [source.compose, ...Object.values(source.sources)];
  if (includeDevOverlay && source.devOverlay !== undefined) texts.push(source.devOverlay);
  return texts;
}
