import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { enabledEnvironments, serviceEnvironments, type EnvName } from './environments.ts';
import { looksLikeCredential, type Issue } from './validate.ts';
import { ManifestSchema, type Manifest, type ServiceSpec } from './schema.ts';

/**
 * The environment inventory (D33, issue #92).
 *
 * Compose and the manifest describe topology. This describes **obligations**: what a build needs, whether
 * each thing is a secret the tenant must supply, a plain value with a default, provider-resolved wiring, or
 * an output another instance provides. Without it, "is this instance ready to deploy?" has no answer and
 * every onboarding checklist is invented per platform.
 *
 * The field that carries the design is `kind`. Two of its four values are wiring rather than obligations,
 * and the whole point of that distinction is that wiring must never appear on the panel telling a tenant
 * what to type -- a provider-resolved database URL is not something they supply, and listing it makes the
 * checklist wrong in the direction that wastes their time.
 */

const Name = z.string().regex(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i, 'letters, digits, dot, underscore, hyphen');
const Envs = z.array(z.enum(['production', 'staging', 'preview'])).optional();

/** Shared metadata; `strict()` on each member is what turns a stray key into a refusal. */
const Base = {
  name: Name,
  /** Which environments this applies to. Omitted means every enabled environment. */
  environments: Envs,
  description: z.string().min(1).optional(),
};

export const InventoryEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...Base,
    kind: z.literal('value'),
    /** Plain configuration. Defaults live here precisely because they are not secret. */
    default: z.string().optional(),
    service: Name.optional(),
  }).strict(),
  z.object({
    ...Base,
    kind: z.literal('secret'),
    required: z.boolean().default(true),
    rotate: z.enum(['on-demand', 'quarterly', 'annual']).optional(),
    service: Name.optional(),
  }).strict(),
  z.object({
    ...Base,
    kind: z.literal('reference'),
    /** Resolved by the provider from a declared database; never a value anyone types. */
    service: Name,
    database: Name,
    output: Name.optional(),
  }).strict(),
  z.object({
    ...Base,
    kind: z.literal('output'),
    /** `capability#output`, e.g. `identity#issuer` -- a capability, not an instance id (D34). */
    from: z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)?#[a-z0-9_-]+$/i, 'expected capability#output'),
    service: Name.optional(),
  }).strict(),
]);

export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;
export interface ParsedInventory { entries: InventoryEntry[]; issues: Issue[] }

/** A key name that is secret-shaped, or a default that looks like a credential, is a refusal. */
function credentialShaped(name: string, value?: string): boolean {
  if (looksLikeCredential(name)) return true;
  if (!value) return false;
  // High-entropy strings and known prefixes never belong in a plain value, even if the key is innocent.
  return /^(?:[A-Za-z0-9+/]{32,}={0,2}|AKIA[0-9A-Z]{16}|sk_(?:live|test)_[0-9A-Za-z]{16,}|ghp_[0-9A-Za-z]{20,}|sha256:[0-9a-f]{40,})/.test(value.trim());
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse `.platfolio/environment.yaml` (or an `x-platfolio.environment` array). Every entry that fails the
 * subset is refused by name rather than dropped -- a silently ignored obligation becomes a deploy that fails
 * somewhere else, three layers away, which is the failure this project keeps meeting.
 */
export function parseInventory(source: string): ParsedInventory {
  const issues: Issue[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(source, { uniqueKeys: true });
  } catch (error) {
    return { entries: [], issues: [{ path: '(document)', code: 'yaml-parse', message: (error as Error).message }] };
  }
  const raw = Array.isArray(doc) ? doc : isRecord(doc) && Array.isArray(doc.entries) ? doc.entries : null;
  if (!raw) {
    return { entries: [], issues: [{ path: '(document)', code: 'inventory-shape', message: 'an inventory is a list of entries, or an object with an entries list' }] };
  }

  const entries: InventoryEntry[] = [];
  for (const [index, item] of raw.entries()) {
    const parsed = InventoryEntrySchema.safeParse(item);
    if (parsed.success) { entries.push(parsed.data); continue; }
    // Give the specific complaint when it is one we understand: a value on a secret entry is the single
    // most likely authoring mistake, and "unrecognized key" teaches nothing.
    if (isRecord(item) && item.kind === 'secret' && ('value' in item || 'default' in item)) {
      issues.push({ path: `entries[${String(index)}]`, code: 'inventory-secret-carries-value', message: 'a secret entry carries a name and metadata only; the value exists solely inside the request that writes it into the tenant execution plane (D32)' });
      continue;
    }
    if (isRecord(item) && typeof item.kind !== 'string') {
      issues.push({ path: `entries[${String(index)}]`, code: 'inventory-kind-missing', message: 'every entry needs kind: value | secret | reference | output; there is no safe default' });
      continue;
    }
    issues.push({ path: `entries[${String(index)}]`, code: 'inventory-invalid', message: parsed.error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('; ') });
  }
  return { entries, issues };
}

/**
 * Check an inventory against the platform it belongs to. Cross-checking against topology is the reason this
 * is a separate step: a reference to a database the manifest never declares, or an environment the platform
 * disabled, is valid YAML and meaningless hosting.
 */
export function validateInventory(entries: InventoryEntry[], manifest: Manifest): Issue[] {
  const issues: Issue[] = [];
  const enabled = enabledEnvironments(manifest);
  const services = manifest.spec.services;
  const databaseName = manifest.spec.resources?.database?.name;

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name.toUpperCase())) {
      issues.push({ path: entry.name, code: 'inventory-duplicate', message: `"${entry.name}" is declared more than once` });
    }
    seen.add(entry.name.toUpperCase());

    if (entry.kind === 'value' && credentialShaped(entry.name, entry.default)) {
      issues.push({ path: entry.name, code: 'inventory-credential-in-value', message: 'looks like a credential; declare it as kind: secret so it is never stored in a repository (D33)' });
    }
    for (const env of entry.environments ?? []) {
      if (!enabled.includes(env as EnvName)) {
        issues.push({ path: entry.name, code: 'inventory-unknown-environment', message: `applies to "${env}", which this platform has not enabled (${enabled.join(', ')})` });
      }
    }
    const scoped = 'service' in entry ? entry.service : undefined;
    if (scoped) {
      const svc: ServiceSpec | undefined = services[scoped];
      if (!svc) {
        issues.push({ path: entry.name, code: 'inventory-unknown-service', message: `targets service "${scoped}", which the manifest does not declare` });
        continue;
      }
      for (const env of entry.environments ?? enabled) {
        if (enabled.includes(env as EnvName) && !serviceEnvironments(svc, enabled).includes(env as EnvName)) {
          issues.push({ path: entry.name, code: 'inventory-service-not-placed', message: `"${scoped}" does not exist in "${env}", so it cannot receive "${entry.name}"` });
        }
      }
    }
    if (entry.kind === 'reference') {
      if (!databaseName) {
        issues.push({ path: entry.name, code: 'inventory-no-declared-database', message: `references "${entry.database}" but the platform declares no database resource` });
      } else if (entry.database !== databaseName) {
        issues.push({ path: entry.name, code: 'inventory-unknown-database', message: `references "${entry.database}"; the declared database is "${databaseName}"` });
      }
    }
  }
  return issues;
}

/** What the tenant must supply, split from what the provider resolves -- the distinction the panel depends on. */
export interface InventoryObligations {
  secrets: { service?: string; name: string; required: boolean; environments: EnvName[]; description?: string }[];
  literals: { service?: string; name: string; value: string; environments: EnvName[] }[];
  references: { service: string; variable: string; database: string; output?: string }[];
  outputs: { service?: string; name: string; from: string; environments: EnvName[] }[];
}

/** Defaults are resolved against the platform, because `environments` omitted means "every enabled one". */
export function deriveObligations(entries: InventoryEntry[], manifest: Manifest): InventoryObligations {
  const enabled = enabledEnvironments(manifest);
  const scope = (entry: InventoryEntry): EnvName[] => (entry.environments ?? enabled).filter((e): e is EnvName => enabled.includes(e as EnvName));
  const out: InventoryObligations = { secrets: [], literals: [], references: [], outputs: [] };
  for (const entry of entries) {
    if (entry.kind === 'secret') {
      out.secrets.push({ ...(entry.service ? { service: entry.service } : {}), name: entry.name, required: entry.required, environments: scope(entry), ...(entry.description ? { description: entry.description } : {}) });
    } else if (entry.kind === 'value') {
      if (entry.default === undefined) continue; // no default and no tenant action: nothing to deliver
      out.literals.push({ ...(entry.service ? { service: entry.service } : {}), name: entry.name, value: entry.default, environments: scope(entry) });
    } else if (entry.kind === 'reference') {
      out.references.push({ service: entry.service, variable: entry.name, database: entry.database, ...(entry.output ? { output: entry.output } : {}) });
    } else {
      out.outputs.push({ ...(entry.service ? { service: entry.service } : {}), name: entry.name, from: entry.from, environments: scope(entry) });
    }
  }
  return out;
}

/**
 * Fold obligations and wiring into the manifest so `buildPlan`, the renderers and the provider keep working
 * untouched. Idempotent: applying an inventory twice yields the same manifest, which matters because the
 * install flow may run again after a tenant edits the file.
 */
export function applyInventory(manifest: Manifest, entries: InventoryEntry[]): Manifest {
  const obligations = deriveObligations(entries, manifest);
  const services: Record<string, ServiceSpec> = { ...manifest.spec.services };

  const touched = new Set<string>();
  for (const literal of obligations.literals) {
    const target = literal.service ?? (Object.keys(services).length === 1 ? Object.keys(services)[0] : undefined);
    if (!target) continue; // a platform-wide default with no service is a renderer concern, not a plan value
    const svc = services[target]!;
    services[target] = { ...svc, env: { ...svc.env, [literal.name]: literal.value } };
    touched.add(target);
  }
  for (const secret of obligations.secrets) {
    const targets = secret.service ? [secret.service] : Object.keys(services);
    for (const name of targets) {
      const svc = services[name];
      if (!svc) continue;
      if (svc.secrets.some((s) => s.name === secret.name)) continue;
      services[name] = { ...svc, secrets: [...svc.secrets, { name: secret.name, source: 'preserve' as const }] };
      touched.add(name);
    }
  }
  for (const reference of obligations.references) {
    const svc = services[reference.service];
    if (!svc) continue;
    if (svc.references.some((r) => r.variable === reference.variable)) continue;
    services[reference.service] = { ...svc, references: [...svc.references, { variable: reference.variable, database: reference.database, ...(reference.output ? { output: reference.output } : {}) }] };
    touched.add(reference.service);
  }
  return ManifestSchema.parse({ ...manifest, spec: { ...manifest.spec, services } }) as Manifest;
}
