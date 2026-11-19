import { ManifestSchema, RENDERER_VERSION, SUPPORTED_API_VERSIONS } from './schema.ts';
import { enabledEnvironments, serviceEnvironments, stagingHost, effectiveDomains } from './environments.ts';
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

  // 3b. Per-environment domains (D68). The host a service serves in each environment, said once. Derivation
  // (`stagingHost`) is the fallback; a declaration wins it. Everything refused here is a case the model cannot
  // state safely without a second copy of one fact, so it is refused rather than defaulted -- the project's
  // standing rule. The prefix is read exactly as `buildPlan` reads it and hosts are resolved through the same
  // `effectiveDomains` the plan uses, so the validator and the plan cannot disagree about a hostname.
  {
    const prefix = m.spec.dns?.stagingPrefix ?? 'staging';
    // A host claimed by more than one (service, environment) is two definitions of one binding. Recording EVERY
    // public service's effective hosts lets a declared staging host collide with another service's *derived*
    // host, which the brief names explicitly. But the refusal fires only when a DECLARATION is involved: with no
    // `environmentDomains` anywhere, this reproduces the old world where derivation already gives each public
    // service a distinct host, so existing platforms and templates are unaffected -- the collision check cannot
    // newly refuse a tree that never declared a per-environment host.
    type Claim = { service: string; environment: string; declared: boolean };
    const claims = new Map<string, Claim[]>();
    const addClaim = (host: string, c: Claim): void => {
      const at = claims.get(host) ?? [];
      at.push(c);
      claims.set(host, at);
    };
    for (const env of enabled) {
      for (const [name, svc] of servicesOf(m)) {
        if (!svc.public || !scope.get(name)?.includes(env)) continue;
        const declaredHere = svc.environmentDomains?.[env] !== undefined;
        for (const host of effectiveDomains(svc, env, prefix)) {
          if (!HOST.test(host)) continue; // host-form is reported in the declaration loop below and the base loop above
          addClaim(host, { service: name, environment: env, declared: declaredHere });
        }
      }
    }
    const reported = new Set<string>();
    for (const [host, at] of claims) {
      if (at.length < 2 || !at.some((c) => c.declared)) continue;
      const oneService = at.every((c) => c.service === at[0]!.service);
      const key = oneService ? `${at[0]!.service}\u0000${host}` : `${host}`;
      if (reported.has(key)) continue;
      reported.add(key);
      const message = oneService
        ? `service "${at[0]!.service}" binds "${host}" in ${at.map((c) => `"${c.environment}"`).join(' and ')} -- one host cannot answer two environments (D57); name a distinct host per environment, or let derivation do it`
        : `host "${host}" is bound by ${at.length} services in environment "${at[0]!.environment}" (${[...new Set(at.map((c) => c.service))].map((s) => `"${s}"`).join(', ')}) -- a declared host colliding with another service's host is two definitions of one binding`;
      // The path names the participant that actually DECLARED the host, so the fix points at the line to edit.
      const offender = at.find((c) => c.declared) ?? at[0]!;
      issues.push({
        path: `spec.services.${offender.service}.environmentDomains.${offender.environment}["${host}"]`,
        code: 'environment-domains-conflict',
        message,
      });
    }
    for (const [name, svc] of servicesOf(m)) {
      const where = serviceEnvironments(svc, enabled);
      for (const [envName, declared] of Object.entries(svc.environmentDomains ?? {})) {
        const path = `spec.services.${name}.environmentDomains.${envName}`;
        if (!enabled.some((e) => e === envName)) {
          issues.push({ path, code: 'environment-domains-unknown-environment', message: `service "${name}" declares per-environment hosts for "${envName}", which the platform does not enable (enabled: ${enabled.join(', ') || 'none'}) -- name an enabled environment, or drop the declaration` });
        } else if (envName === 'production') {
          issues.push({ path, code: 'environment-domains-production-is-domains', message: `service "${name}" declares \`environmentDomains.production\`, but production hosts already live in \`domains\` -- one list, one home (D50). Put production hosts in \`domains\`; this field is for environments whose host the rule derives (${where.filter((e) => e !== 'production').join(', ') || 'none'})` });
        } else if (!where.some((e) => e === envName)) {
          issues.push({ path, code: 'environment-domains-unplaced-environment', message: `service "${name}" declares hosts for "${envName}" but is not deployed there (it is in: ${where.join(', ') || 'none'}) -- dead configuration that reads like a decision (D56's rule, applied to hosts)` });
        }
        if (!Array.isArray(declared)) continue;
        if (declared.length === 0) {
          issues.push({ path, code: 'environment-domains-empty', message: `service "${name}" declares an empty host list for "${envName}"; a public service with no host in an environment it runs is unreachable there -- drop the key to let derivation apply, or name the hosts` });
          continue;
        }
        // The derived list the declaration would replace. A declaration identical to it is a second copy of the
        // rule it overrides -- refused, because it drifts the moment the prefix or the base host moves (D57).
        const derived = svc.domains.map((h) => stagingHost(h, prefix));
        if (envName !== 'production' && declared.length === derived.length && declared.every((h, i) => h === derived[i])) {
          issues.push({ path, code: 'environment-domains-redundant', message: `service "${name}" declares hosts for "${envName}" identical to what derivation already produces (${derived.join(', ') || 'none'}) -- delete the declaration; a stated copy of \`stagingHost()\` is a second source of truth that moves when the prefix moves (D57)` });
        }
        for (const host of declared) {
          if (!HOST.test(host)) {
            issues.push({ path, code: 'host-form', message: `service "${name}" declares "${host}" as a "${envName}" host, which is not a valid hostname (no scheme, port, or path)` });
          }
        }
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

  // 5e. Per-environment values (D56). An override naming an environment the service is not placed in is dead
  // configuration -- worse than absent, because it reads like a decision and is never executed. And a
  // credential-shaped NAME is refused whatever its value: "it is only the staging value" is how a committed
  // secret gets past a review (D4).
  {
    const enabledHere = enabledEnvironments(m);
    for (const [name, svc] of servicesOf(m)) {
      const placed: string[] = serviceEnvironments(svc, enabledHere);
      for (const [envName, overrides] of Object.entries(svc.environmentValues ?? {})) {
        if (!placed.includes(envName)) {
          issues.push({
            path: `spec.services.${name}.environmentValues.${envName}`,
            code: 'environment-values-unplaced-environment',
            message: `overrides environment "${envName}" but the service is not deployed there (it is in: ${placed.join(', ') || 'none'}) -- dead configuration that reads like a decision`,
          });
        }
        for (const [key, value] of Object.entries(overrides)) {
          if (value.length === 0) {
            issues.push({ path: `spec.services.${name}.environmentValues.${envName}.${key}`, code: 'environment-value-empty', message: `overrides "${key}" with an empty string in "${envName}" -- delete the entry to drop an inherited value, or give it a real one; an empty literal is how a service boots with a config it cannot see` });
          }
          if (/(SECRET|TOKEN|_KEY$|PASSWORD|CREDENTIAL)/.test(key)) {
            issues.push({ path: `spec.services.${name}.environmentValues.${envName}.${key}`, code: 'environment-value-is-secret-name', message: `"${key}" is credential-shaped and belongs in the service's secrets list by NAME, not in a per-environment value map (D4)` });
          }
        }
      }
    }
  }

  // 6. Platform kind and mode (D51). Rules are about direction and lifecycle, never service counts. The ones
  // being deleted here said "an api-service has at most 2 services", "full-stack-web needs at least 2",
  // "a shared service should stay at 1-2": those described our own example manifests, not the platform, and
  // would have refused a tenant's legitimate third worker while accepting a badly-shaped two-service mess.
  const publicCount = services.filter(([, s]) => s.domains.length > 0).length;
  if (m.metadata.kind === 'worker') {
    // The distinction is inbound direction, and it is the whole reason the kind exists: a worker that publishes
    // a host is either mislabelled or about to be reachable without anyone deciding it.
    const exposed = services.filter(([, s]) => s.domains.length > 0).map(([name]) => name);
    if (exposed.length > 0) issues.push({ path: 'spec.services', code: 'kind-worker-exposed', message: `a worker platform accepts no inbound connections, but ${exposed.join(', ')} ${exposed.length === 1 ? 'publishes' : 'publish'} a host. If this service serves traffic it is kind: web; if it does not, remove the domains` });
  } else if (publicCount === 0) {
    // A web platform that exposes nothing is a worker with a lie in its metadata: no hostname, no path anyone
    // can probe, and a deployment that reports live while nothing can reach it.
    issues.push({ path: 'spec.services', code: 'kind-web-unreachable', message: `kind: web requires at least one service with domains; none of ${services.map(([n]) => n).join(', ')} accepts connections. Declare kind: worker if that is intended` });
  }
  if (m.metadata.mode === 'development' && !m.spec.environments.staging.enabled) {
    // The rule the shipped templates violated until D51: starter-web and starter-worker are starting points for
    // CHANGE, and a fork whose only environment is production has nowhere to put a change before it reaches
    // users. Enabling staging is one line; discovering that later costs the first deploy.
    issues.push({ path: 'spec.environments.staging', code: 'mode-development-staging', message: 'mode: development means someone changes this platform, so staging must be enabled -- that is where a change goes before production' });
  }
  if (m.metadata.mode === 'hosted' && (m.spec.environments.staging.enabled || m.spec.environments.preview.enabled)) {
    issues.push({ path: 'spec.environments', code: 'mode-hosted-extra-env', message: 'mode: hosted is operated, not developed: production only. A staging copy of something nobody is changing costs money and attention for no signal (docs/design/03)' });
  }
  if (m.spec.provides !== undefined && m.metadata.kind !== 'web') {
    // Sharing is a declaration (`spec.provides`, D34), not a shape -- which is why `shared-service` stopped
    // being a kind. But an offering has to be reachable to be consumed.
    issues.push({ path: 'spec.provides', code: 'provides-requires-web', message: `a platform offering the capability "${m.spec.provides.name}" must be reachable by other platforms, so it is kind: web -- this one is kind: worker` });
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
