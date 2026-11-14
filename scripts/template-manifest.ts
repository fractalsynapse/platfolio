/**
 * The template publication manifest: which source directory becomes which repository, and which paths a
 * published repository must stop shipping.
 *
 * This lives in its own module because two programs need exactly the same answer -- the publisher, and the
 * parity check that catches what the publisher cannot see. Duplicating the list would mean the checker verifies
 * a different set of repositories than the thing being published, which is the least useful kind of gate.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface TemplateEntry {
  /** Directory under `templates/`. */
  dir: string;
  /** Repository name within the publishing organization. */
  repo: string;
  label: string;
  /** The files that would be published, read from disk. A function, so the publisher and the checker each read
   * the current tree rather than sharing a snapshot taken at import time. */
  files: () => Record<string, string>;
}

/**
 * Every file under a template directory, including dotfiles (`.dockerignore` is part of a buildable template).
 * The comment here used to name `.platfolio/environment.yaml` as the reason dotfiles mattered; that path is
 * retired (D58) and is now exactly what `RETIRED_PATHS` below removes from published repositories.
 */
function collect(dir: string): Record<string, string> {
  const root = join('templates', dir);
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel)).sort()) {
      const full = join(root, rel, entry);
      const key = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(key);
      else out[key] = readFileSync(full, 'utf8');
    }
  };
  if (existsSync(root)) walk('');
  return out;
}

export const TEMPLATES: TemplateEntry[] = [
  { dir: 'starter-web', repo: 'platfolio-starter-web', label: 'web service (public UI + API, managed Postgres)', files: () => collect('starter-web') },
  { dir: 'starter-worker', repo: 'platfolio-starter-worker', label: 'worker (no inbound, retained volume)', files: () => collect('starter-worker') },
  { dir: 'shared-identity', repo: 'platfolio-shared-identity', label: 'shared identity (Keycloak, provides identity)', files: () => collect('shared-identity') },
];

/**
 * Paths a published template must STOP shipping.
 *
 * Declared, not derived by diffing the published tree, because the derivation is the dangerous direction: a fork
 * adds files (its own Dockerfile, CI workflow, README) and a publisher that deleted "anything not in the source"
 * would eat a tenant's work on the next publish. Retiring a path is therefore an explicit, reviewable act -- and
 * `check-template-publication.ts` reports any published file that is neither in the source nor listed here, so
 * the list cannot silently become incomplete either.
 *
 * `.platfolio/environment.yaml` is here because the registry consolidation (D58) deleted it from `templates/`
 * while it stayed live in all three published repositories, where `applyInventory` still merges it into the plan
 * beside the new root registry: the exact duplication the change was made to remove, surviving in the one place a
 * tenant actually forks.
 */
export const RETIRED_PATHS = ['.platfolio/environment.yaml'];
