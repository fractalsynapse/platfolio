import { ManifestSchema, RENDERER_VERSION, SUPPORTED_API_VERSIONS } from './schema.ts';
import { enabledEnvironments, serviceEnvironments } from './environments.ts';
import { satisfiesRange } from '@platfolio/contracts';
import type { Manifest, ServiceSpec } from './schema.ts';

export interface Issue {
  path: string;
  code: string;
  message: string;
}

/**
 * Credential-looking keys must be declared as secrets, never assigned as literals. Matching is on
 * whole `_`-separated segments: `OIDC_CLIENT_SECRET` and `ANTHROPIC_API_KEY` are credentials, while
 * `CONTEXT_BUDGET_TOKENS` is a token *count* and must not be flagged. A substring match produced a
 * false positive on the second form, which is how a validator teaches people to route around it.
 */
const CREDENTIAL_SEGMENT = /^(SECRET|SECRETS|TOKEN|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|KEY|CERT)$/i;
const CREDENTIAL_WORD = /^(API|APP|AUTH|CLIENT|PRIVATE|SIGNING|ACCESS|REFRESH|SESSION|ENCRYPTION|ENCRYPTIONKEY|WEBHOOK)$/i;
/**
 * A quantity word anywhere in the key means the credential-looking segment is a count or window
 * (`CONTEXT_BUDGET_TOKENS`, `RATE_LIMIT_WINDOW_SECONDS`), not a secret. Without this, the validator
 * flags legitimate config and people learn to disable the validator.
 */
const QUANTITY_SEGMENT = /^(BUDGET|COUNT|LIMIT|LIMITER|MAX|MIN|SIZE|WINDOW|THRESHOLD|QUOTA|AMOUNT|NUMBER|AMOUNT|DAYS|HOURS|MINUTES|SECONDS|MILLISECONDS|MICROSECONDS|MS|BYTES|KB|MB|GB|TOKENS|MS)$|^(TOKEN|KEY|SECRET)_?COUNT$/i;
export function looksLikeCredential(key: string): boolean {
  const segments = key.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.some((s) => QUANTITY_SEGMENT.test(s))) return false;
  const last = segments[segments.length - 1]!;
  if (!CREDENTIAL_SEGMENT.test(last)) return false;
  if (last === 'KEY' || last === 'TOKEN') {
    return segments.length === 1 || CREDENTIAL_WORD.test(segments[segments.length - 2]!);
  }
  return true;
}
const PLACEHOLDER_VALUE = /(^|[-_.])(placeholder|todo|tbd|change[-_.]?me|replace[-_.]?me|fill[-_.]?me|your[-_.]?here|secret[-_.]?here|x{3,})([-_.]|$)/i;
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)+$/i;

function servicesOf(m: Manifest): [string, ServiceSpec][] {
  return Object.entries(m.spec.services);
}

/** Post-schema rules the manifest spec says the schema alone cannot express. */
export function validateManifest(unknown: unknown): Issue[] {
  const issues: Issue[] = [];
  const parsed = ManifestSchema.safeParse(typeof unknown === 'string' ? {} : unknown);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ path: i.path.join('.') || '(root)', code: 'schema', message: i.message });
    }
    // Schema failures stop here: the semantic rules below assume a well-formed document.
    return issues;
  }
  const m = parsed.data;

  if (!SUPPORTED_API_VERSIONS.includes(m.apiVersion as (typeof SUPPORTED_API_VERSIONS)[number])) {
    issues.push({ path: 'apiVersion', code: 'unsupported-api-version', message: `renderer supports ${SUPPORTED_API_VERSIONS.join(', ')}` });
  }
  if (!satisfiesRange(RENDERER_VERSION, m.spec.requires.platfolio)) {
    issues.push({
      path: 'spec.requires.platfolio',
      code: 'renderer-version-window',
      message: `renderer ${RENDERER_VERSION} does not satisfy "${m.spec.requires.platfolio}"; the platform needs a newer platfolio`,
    });
  }

  // 1. No secret values, anywhere. Two independent nets: env keys that look like credentials, and a
  // raw scan of the document for inline values assigned to such keys.
  for (const [svcName, svc] of servicesOf(m)) {
    const declared = new Set(svc.secrets.map((s) => s.name));
    for (const [key, value] of Object.entries(svc.env)) {
      if (looksLikeCredential(key)) {
        issues.push({ path: `spec.services.${svcName}.env.${key}`, code: 'secret-value-inline', message: `"${key}" looks like a credential; declare it under secrets[] with a value source instead of assigning "${value.length > 6 ? `${value.slice(0, 3)}…` : 'a value'}"` });
      }
        // A value we cannot resolve must not become a value we deploy. Unresolved references used to be
      // written as placeholder strings in fixtures (see OD11); the renderer would faithfully ship them,
      // the app would fail to start, and the controller would report an unhealthy deploy as if that were
      // the app's fault. Reject at parse, with the path.
      if (PLACEHOLDER_VALUE.test(value)) {
        issues.push({ path: `spec.services.${svcName}.env.${key}`, code: 'placeholder-value', message: `"${value}" is a placeholder, not a value; resolve it from a declared resource, or supply a real value (cross-instance references are the subject of OD11)` });
      }
    if (/^(DATABASE_URL|REDIS_URL|MONGO_URL|MYSQL_URL)$/i.test(key)) {
        issues.push({ path: `spec.services.${svcName}.env.${key}`, code: 'resource-ref-inline', message: 'connection URLs come from declared resources; remove it and reference spec.resources' });
      }
    }
    for (const s of svc.secrets) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(s.name)) issues.push({ path: `spec.services.${svcName}.secrets.${s.name}`, code: 'secret-name-form', message: 'secret names are SCREAMING_SNAKE_CASE' });
    }
    if (declared.size !== svc.secrets.length) issues.push({ path: `spec.services.${svcName}.secrets`, code: 'duplicate-secret-name', message: 'a secret name is declared twice' });
  }
  // A second, independent net over the raw document keys: catches a credential-shaped key holding a
  // value anywhere, including sections this validator does not otherwise read. Walks the parsed
  // structure rather than regexing text, so values like `sha256:<64 hex>` cannot be misread.
  const seenPaths = new Set<string>();
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { for (const [i, item] of node.entries()) walk(item, `${path}[${i}]`); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0 && looksLikeCredential(k) && !['preserve', 'shared-variable', 'customer-held'].includes(v)) {
          const at = `${path}.${k}`;
          if (!seenPaths.has(at) && !/^spec\.services\..*\.env\./.test(at)) {
            seenPaths.add(at);
            issues.push({ path: at, code: 'secret-value-inline', message: `"${k}" carries a literal value; declare it under secrets[] with a value source` });
          }
        }
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(unknown, '');

  // 2. Images are pinned by digest, and carry a tag alongside it. Railway requires `repo:tag@digest`:
  // a tagless digest reference is accepted by the API and then never deploys (measured 2026-11-08).
  for (const [name, svc] of servicesOf(m)) {
    const lastSlash = svc.image.lastIndexOf('/');
    if (!svc.image.slice(lastSlash + 1).includes(':')) {
      issues.push({ path: `spec.services.${name}.image`, code: 'image-tag-missing', message: `"${svc.image}" has no tag; pin as "repo:tag@sha256:…", because a tagless digest reference never deploys on Railway` });
    }
  }

  // 2b. Mutable tags are still refused even when a digest is present.
  for (const [name, svc] of servicesOf(m)) {
    if (/:(latest|main|stable|edge|next)$/.test(svc.image)) {
      issues.push({ path: `spec.services.${name}.image`, code: 'mutable-tag', message: `refusing mutable tag on ${svc.image}; pin by digest` });
    }
  }

  // 3. Environment scope per service (D23) and the host-overlap rule evaluated within each
  // environment: a production-only host and a staging host are not in conflict, because they never
  // exist in the same environment.
  const enabled = enabledEnvironments(m);
  const scope = new Map<string, string[]>();
  for (const [name, svc] of servicesOf(m)) {
    const where = serviceEnvironments(svc, enabled);
    scope.set(name, where);
    for (const e of svc.environments ?? []) {
      if (!enabled.includes(e)) issues.push({ path: `spec.services.${name}.environments`, code: 'environment-not-enabled', message: `"${e}" is used by service "${name}" but the platform does not enable it` });
    }
    if ((svc.environments?.length ?? 0) === 0 && svc.environments !== undefined) {
      issues.push({ path: `spec.services.${name}.environments`, code: 'service-environments-empty', message: 'an explicit environments list may not be empty' });
    }
    if (svc.environments && svc.environments.length > 0 && !svc.environments.includes('production')) {
      issues.push({ path: `spec.services.${name}.environments`, code: 'staging-only-service', message: `"${name}" would exist only outside production; a managed instance must have a production placement (or the environment should not be enabled)` });
    }
    if (svc.ownership === 'external' && (svc.environments?.length ?? 0) > 1 && svc.environments?.includes('staging')) {
      issues.push({ path: `spec.services.${name}`, code: 'external-staging-cost', message: `external service "${name}" is scoped to staging as well; state it deliberately, since a staging copy of upstream software is billed` });
    }
  }

  for (const env of enabled) {
    interface ApexRecord { wildcard?: string; }
    const apexes = new Map<string, ApexRecord>();
    const hostEntries: { service: string; host: string }[] = [];
    const ensure = (key: string): ApexRecord => {
      const found = apexes.get(key) ?? {};
      apexes.set(key, found);
      return found;
    };
    for (const [name, svc] of servicesOf(m)) {
      if (!scope.get(name)?.includes(env)) continue;
      for (const host of svc.domains) {
        if (!HOST.test(host)) {
          if (env === 'production') issues.push({ path: `spec.services.${name}.domains`, code: 'host-form', message: `"${host}" is not a valid host (no scheme, port, or path)` });
          continue;
        }
        hostEntries.push({ service: name, host });
        if (host.startsWith('*.')) ensure(host.slice(2)).wildcard = name;
      }
    }
    for (const { service, host } of hostEntries) {
      if (host.startsWith('*.')) continue;
      const labels = host.split('.');
      if (labels.length < 2) continue;
      const parent = labels.slice(1).join('.');
      const record = apexes.get(parent);
      if (record?.wildcard && record.wildcard !== service) {
        issues.push({
          path: `spec.services.${service}.domains`,
          code: 'wildcard-conflict',
          message: `in "${env}": "${host}" is already covered by "*.${parent}" owned by service "${record.wildcard}"; the provider cannot overlap a wildcard with a concrete host on different services`,
        });
      }
    }
  }

  // 4. Environment rules.
  const services = Object.entries(m.spec.services);
  if (services.length === 0) issues.push({ path: 'spec.services', code: 'no-services', message: 'a manifest must declare at least one service' });

  const { production, staging, preview } = m.spec.environments;
  if (!production.enabled) issues.push({ path: 'spec.environments.production.enabled', code: 'no-production', message: 'production must be enabled' });
  if (staging.enabled && !staging.branch) issues.push({ path: 'spec.environments.staging.branch', code: 'staging-branch-missing', message: 'an enabled staging environment needs a branch' });
  if (preview.enabled && !production.enabled) issues.push({ path: 'spec.environments.preview.enabled', code: 'preview-needs-production', message: 'preview environments require production' });

  // Bucket regions are checked against the set the provider SDK actually accepts, so a typo is a
  // validation failure here rather than an `as never` cast in generated code.
  const BUCKET_REGIONS = new Set(['sjc', 'iad', 'ams', 'sin']);
  const store = m.spec.resources.storage;
  if (store?.region && !BUCKET_REGIONS.has(store.region)) {
    issues.push({ path: 'spec.resources.storage.region', code: 'unknown-region', message: `"${store.region}" is not a provider region (${[...BUCKET_REGIONS].join(', ')})` });
  }

  // 5. Volume mounts must name a real service.
  for (const v of m.spec.resources.volumes) {
    if (!(v.service in m.spec.services)) issues.push({ path: `spec.resources.volumes.${v.name}.service`, code: 'unknown-service', message: `volume "${v.name}" mounts into unknown service "${v.service}"` });
  }
  for (const [, svc] of servicesOf(m)) {
    for (const dep of svc.dependsOn) {
      if (!(dep in m.spec.services)) issues.push({ path: `spec.services.${Object.keys(m.spec.services).find((k) => m.spec.services[k] === svc)}.dependsOn`, code: 'unknown-dependency', message: `dependsOn "${dep}" is not a service in this manifest` });
    }
  }

  // 6. Archetype rules (docs/design/03 § Archetype defaults).
  const publicCount = services.filter(([, s]) => s.domains.length > 0).length;
  if (m.metadata.archetype === 'api-service') {
    if (services.length > 2) issues.push({ path: 'spec.services', code: 'archetype-api-service', message: `api-service expects an API plus at most one worker, got ${services.length}` });
    if (services.some(([, s]) => /(:3000|_web|frontend)$/i.test(s.image))) issues.push({ path: 'spec.services', code: 'archetype-api-service', message: 'api-service should not ship a web frontend; use full-stack-web' });
  }
  if (m.metadata.archetype === 'worker') {
    // The shape's whole point is that nothing connects inbound: a worker exposing a host is either mislabelled
    // or about to be reachable without anyone deciding it. Hosts live on services, so that is the check.
    const exposed = services.filter(([, s]) => s.domains.length > 0).map(([name]) => name);
    if (exposed.length > 0) issues.push({ path: 'spec.services', code: 'archetype-worker', message: `a worker archetype takes no inbound connections, but ${exposed.join(', ')} ${exposed.length === 1 ? 'publishes' : 'publish'} a host; use api-service or full-stack-web if it serves traffic` });
  }
  if (m.metadata.archetype === 'shared-service') {
    // A team service exists to be reached by other applications: one reachable thing, kept small so its
    // blast radius is legible. Binding (D34) is how consumers find it.
    if (publicCount === 0) issues.push({ path: 'spec.services', code: 'archetype-shared-service', message: 'a shared service must expose at least one public service, or nothing can bind to it' });
    if (services.length > 2) issues.push({ path: 'spec.services', code: 'archetype-shared-service', message: `a shared service should stay at 1-2 services; this declares ${String(services.length)}` });
  }
  if (m.metadata.archetype === 'full-stack-web') {
    if (services.length < 2) issues.push({ path: 'spec.services', code: 'archetype-full-stack', message: 'full-stack-web needs at least a UI and an API service' });
    if (publicCount === 0) issues.push({ path: 'spec.services', code: 'archetype-full-stack', message: 'full-stack-web needs at least one service with a domain (session/cookie origin rules derive from it)' });
  }

  // 7. Identity clients must name real services, and hosted realms need domains to derive redirects.
  for (const c of m.spec.identity.clients) {
    if (!(c.service in m.spec.services)) issues.push({ path: `spec.identity.clients.${c.service}`, code: 'unknown-service', message: `identity client references unknown service "${c.service}"` });
  }
  if (m.spec.identity.mode === 'hosted-realm' && m.spec.identity.clients.length === 0) {
    issues.push({ path: 'spec.identity.clients', code: 'hosted-realm-needs-clients', message: 'hosted-realm mode needs at least one client' });
  }
  if (m.spec.identity.mode === 'byo-oidc') {
    for (const [name, svc] of services) {
      if (!('OIDC_ISSUER' in svc.env)) issues.push({ path: `spec.services.${name}.env`, code: 'byo-oidc-wiring', message: 'byo-oidc mode expects OIDC_ISSUER/CLIENT_ID wiring to be declared (values are injected; names are declared here)' });
      break; // one report is enough to explain the rule
    }
  }
  return issues;
}

/** Required secrets across the platform, for the connect checklist (names only). */
export function requiredSecrets(m: Manifest): { service: string; name: string; source: string; environments: string[] }[] {
  const enabled = enabledEnvironments(m);
  const out: { service: string; name: string; source: string; environments: string[] }[] = [];
  for (const [service, svc] of Object.entries(m.spec.services)) {
    const where = serviceEnvironments(svc, enabled);
    for (const s of svc.secrets) out.push({ service, name: s.name, source: s.source, environments: [...where] });
  }
  return out.sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name));
}
