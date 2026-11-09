import type { Manifest, ServiceSpec } from './schema.ts';
import { requiredSecrets, type Issue } from './validate.ts';
import { enabledEnvironments, serviceEnvironments } from './environments.ts';

export interface Rendered {
  /** Path relative to the render root -> content. Byte-for-byte deterministic. */
  files: Record<string, string>;
  requiredSecrets: { service: string; name: string; source: string }[];
  notes: string[];
}

/**
 * A single env entry, resolved per target. Keeping references structured rather than pre-substituted
 * is the point: Railway resolves `db.DATABASE_URL`, Compose needs an actual host/port URL, and
 * emitting one target's syntax into the other is how you get "invalid interpolation format".
 */
export type EnvEntry =
  | { kind: 'literal'; name: string; value: string }
  | { kind: 'resource-ref'; name: string; resource: string; field: string }
  | { kind: 'secret'; name: string; source: string };

export interface IntermediateService {
  name: string;
  image: string;
  digest: string;
  port: number;
  command?: string | undefined;
  build?: string | undefined;
  preDeploy?: string | undefined;
  healthPath?: string | undefined;
  rootDirectory?: string | undefined;
  replicas: number;
  limits?: { cpu: number; memoryMB: number } | undefined;
  domains: string[];
  dependsOn: string[];
  environments: string[];
  entries: EnvEntry[];
}

export interface Intermediate {
  platform: string;
  version: string;
  projectName: string;
  services: IntermediateService[];
  database?: { name: string; kind: string } | undefined;
  cache?: { name: string; kind: string } | undefined;
  storage?: { name: string; region?: string | undefined } | undefined;
  volumes: { name: string; service: string; mountPath: string }[];
}

function byName<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

export function toIntermediate(m: Manifest): Intermediate {
  const entriesFor = (_name: string, svc: ServiceSpec): EnvEntry[] => {
    const out: EnvEntry[] = [];
    for (const [key, value] of Object.entries(svc.env).sort(([a], [b]) => a.localeCompare(b))) {
      out.push({ kind: 'literal', name: key, value });
    }
    if (m.spec.resources.database) out.push({ kind: 'resource-ref', name: 'DATABASE_URL', resource: m.spec.resources.database.name, field: 'DATABASE_URL' });
    if (m.spec.resources.cache) out.push({ kind: 'resource-ref', name: 'REDIS_URL', resource: m.spec.resources.cache.name, field: 'REDIS_URL' });
    if (m.spec.resources.storage) out.push({ kind: 'literal', name: 'BUCKET_NAME', value: m.spec.resources.storage.name });
    for (const s of byName(svc.secrets, (x) => x.name)) out.push({ kind: 'secret', name: s.name, source: s.source });
    return out;
  };
  const enabled = enabledEnvironments(m);
  return {
    platform: m.metadata.name,
    version: m.metadata.version,
    projectName: `${m.metadata.name}-managed`,
    services: byName<IntermediateService>(Object.entries(m.spec.services).map(([name, svc]) => ({
      name,
      image: svc.image,
      digest: svc.digest,
      port: svc.port,
      command: svc.start,
      build: svc.build,
      preDeploy: svc.preDeploy,
      healthPath: svc.healthPath,
      rootDirectory: svc.rootDirectory,
      replicas: svc.replicas,
      limits: svc.limits === undefined ? undefined : { cpu: svc.limits.cpu, memoryMB: svc.limits.memoryMB },
      domains: [...svc.domains].sort(),
      dependsOn: [...svc.dependsOn].sort(),
      environments: serviceEnvironments(svc, enabled),
      entries: entriesFor(name, svc),
    })), (s) => s.name),
    database: m.spec.resources.database ? { name: m.spec.resources.database.name, kind: m.spec.resources.database.kind } : undefined,
    cache: m.spec.resources.cache ? { name: m.spec.resources.cache.name, kind: m.spec.resources.cache.kind } : undefined,
    storage: m.spec.resources.storage ? { name: m.spec.resources.storage.name, region: m.spec.resources.storage.region ?? undefined } : undefined,
    volumes: byName(m.spec.resources.volumes.map((v) => ({ name: v.name, service: v.service, mountPath: v.mountPath })), (v) => v.name),
  };
}

/**
 * Staging host derived from a declared production host, rendered explicitly rather than left to
 * provider behaviour: one host cannot be claimed by two environments.
 */
export function stagingHost(host: string, prefix: string): string {
  if (host.startsWith('*.')) return `*.${prefix}${host.slice(2)}`;
  const parts = host.split('.');
  if (parts.length < 2) return `${prefix}${host}`;
  return [`${prefix}${parts[0]}`, ...parts.slice(1)].join('.');
}

const yamlQuote = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const tsString = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const cam = (name: string): string => name.split(/[-_.\s]+/).map((p, i) => (i === 0 ? p : p[0]!.toUpperCase() + p.slice(1))).join('');

export function renderCompose(m: Manifest): Rendered {
  const i = toIntermediate(m);
  const L: string[] = [
    '# Generated by platfolio from a Platform Manifest. Do not edit by hand.',
    '# Local development parity with the hosted stack. Secrets resolve from the environment;',
    '# nothing in this file may hold a value.',
    `name: ${yamlQuote(i.platform)}`,
    '',
    'services:',
  ];
  for (const s of i.services) {
    L.push(`  ${s.name}:`, `    image: ${yamlQuote(`${s.image}@${s.digest}`)}`);
    if (s.command) L.push(`    command: ${yamlQuote(s.command)}`);
    L.push('    environment:');
    for (const e of s.entries) {
      if (e.kind === 'literal') L.push(`      ${e.name}: ${yamlQuote(e.value)}`);
      else if (e.kind === 'secret') L.push(`      ${e.name}: "$$\{${e.name}:-}"`);
      else if (e.kind === 'resource-ref' && e.resource === i.database?.name && e.field === 'DATABASE_URL') L.push(`      ${e.name}: ${yamlQuote(`postgresql://postgres:postgres@${e.resource}:5432/${e.resource.replace(/-/g, '_')}`)}`);
      else if (e.kind === 'resource-ref' && e.resource === i.cache?.name && e.field === 'REDIS_URL') L.push(`      ${e.name}: ${yamlQuote(`redis://${e.resource}:6379`)} `);
      else L.push(`      ${e.name}: ""`);
    }
    if (s.healthPath) L.push('    healthcheck:', `      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:${s.port}${s.healthPath}"]`, '      interval: 10s', '      retries: 6');
    L.push(`    expose: ["${s.port}"]`);
    const mounts = i.volumes.filter((v) => v.service === s.name);
    if (mounts.length) { L.push('    volumes:'); for (const v of mounts) L.push(`      - ${v.name}:${v.mountPath}`); }
    if (s.dependsOn.length) L.push(`    depends_on: [${s.dependsOn.map((d) => `"${d}"`).join(', ')}]`);
  }
  if (i.database) {
    L.push(`  ${i.database.name}:`, '    image: "postgres:16-alpine"', '    environment:', '      POSTGRES_PASSWORD: "postgres"', `      POSTGRES_DB: "${i.database.name.replace(/-/g, '_')}"`, '    volumes:', `      - ${i.database.name}-data:/var/lib/postgresql/data`);
  }
  if (i.cache) L.push(`  ${i.cache.name}:`, '    image: "redis:7-alpine"');
  const volNames = [...i.volumes.map((v) => v.name), ...(i.database ? [`${i.database.name}-data`] : [])].sort();
  if (volNames.length) { L.push('', 'volumes:'); for (const v of volNames) L.push(`  ${v}:`); }
  return { files: { 'docker-compose.yml': `${L.join('\n')}\n` }, requiredSecrets: requiredSecrets(m), notes: ['Compose resolves secrets from the local environment ($$ escapes interpolation so platfolio never stores a value).'] };
}

export function renderRailwayIaC(m: Manifest): Rendered {
  const i = toIntermediate(m);
  const enabled = enabledEnvironments(m);
  const L: string[] = [
    '// Generated by platfolio from a Platform Manifest. Do not edit by hand.',
    '// Railway Infrastructure as Code: committed to the tenant repository and applied by the tenant',
    '// workflow with the tenant token, never by platfolio (docs/design/04).',
    "import { defineRailway, project, service, postgres, redis, bucket, volume, image, preserve } from 'railway/iac';",
    '',
    'export default defineRailway((ctx) => {',
  ];
  const ids: string[] = [];
  if (i.database) { L.push(`  const ${cam(i.database.name)} = postgres(${tsString(i.database.name)});`); ids.push(cam(i.database.name)); }
  if (i.cache) { L.push(`  const ${cam(i.cache.name)} = redis(${tsString(i.cache.name)});`); ids.push(cam(i.cache.name)); }
  if (i.storage) { L.push(`  const ${cam(i.storage.name)} = bucket(${tsString(i.storage.name)}${i.storage.region ? `, { region: ${tsString(i.storage.region)} }` : ''});`); ids.push(cam(i.storage.name)); }
  for (const v of i.volumes) L.push(`  const ${cam(v.name)} = volume(${tsString(v.name)});`);
  if (i.volumes.length) L.push('');  const prefix = m.spec.dns?.stagingPrefix ?? 'staging-';
  for (const s of i.services) {
    const guarded = s.environments.length < enabled.length;
    const pad = guarded ? '    ' : '  ';
    if (guarded) L.push(`  let ${cam(s.name)}: ReturnType<typeof service> | undefined;`);
    if (guarded) L.push(`  if (${s.environments.map((e) => `ctx.isEnvironment(${tsString(e)})`).join(' || ')}) {`);
    L.push(`${pad}  const ${cam(s.name)} = service(${tsString(s.name)}, {`);
    L.push(`${pad}    source: image(${tsString(`${s.image}@${s.digest}`)}),`);
    if (s.command) L.push(`${pad}    start: ${tsString(s.command)},`);
    if (s.build) L.push(`${pad}    build: ${tsString(s.build)},`);
    if (s.preDeploy) L.push(`${pad}    preDeployCommand: ${tsString(s.preDeploy)},`);
    if (s.healthPath) L.push(`${pad}    healthcheck: ${tsString(s.healthPath)},`);
    if (s.rootDirectory) L.push(`${pad}    rootDirectory: ${tsString(s.rootDirectory)},`);
    L.push(`${pad}    env: {`);
    for (const e of s.entries) {
      if (e.kind === 'literal') L.push(`${pad}      ${e.name}: ${tsString(e.value)},`);
      else if (e.kind === 'secret') L.push(`${pad}      ${e.name}: preserve(), // value lives in Railway; platfolio never sees it`);
      else L.push(`${pad}      ${e.name}: ${cam(e.resource)}.env.${e.field}, // SDK shape: references resolve through .env`);
    }
    L.push(`${pad}    },`);
    const mounts = i.volumes.filter((v) => v.service === s.name);
    if (mounts.length) L.push(`${pad}    volumeMounts: { ${mounts.map((v) => `${tsString(v.mountPath)}: ${cam(v.name)}`).join(', ')} },`);
    if (s.domains.length) {
      // Domains are NOT emitted into the authoring file: Railway's CLI rejects custom-domain
      // registration in configuration ("Custom-domain registration is not supported by Railway
      // configuration", measured with `railway config plan`), so IaC that declares them is refused
      // outright. They are created through the API by the provider instead. The hosts are still
      // listed here as a comment so the exported file remains a complete description of intent, and
      // staging derivation is preserved for the checklist and the tenant's own DNS work.
      // Only the environments this service is actually placed in (D23): a production-only service must
      // not gain a staging host even in a comment, or the next reader will assume it has one.
      const hosts = s.domains.flatMap((d) => [
        ...(s.environments.includes('production') ? [`${d}:${s.port} (production)`] : []),
        ...(s.environments.includes('staging') ? [`${stagingHost(d, prefix)}:${s.port} (staging)`] : []),
      ]).join('; ');
      L.push(`${pad}  // domains declared in the manifest, applied via the API, not this file: ${hosts}`);
    }
    L.push(s.replicas === 1 ? `${pad}    replicas: 1,` : `${pad}    replicas: ctx.environment === 'production' ? ${s.replicas} : 1,`);
    L.push(`${pad}  });`);
    if (guarded) L.push('  }');
    ids.push(guarded ? `${cam(s.name)} ?? null` : cam(s.name));
  }
  L.push('', `  return project(${tsString(i.projectName)}, {`, `    resources: [${ids.join(', ')}].filter((r): r is NonNullable<typeof r> => r !== null),`, '  });', '});', '');
  const withLimits = i.services.filter((s) => s.limits);
  if (withLimits.length) {
    L.push('// Declared in the manifest but NOT expressible in Railway IaC; the tenant workflow applies', '// them out of band via serviceInstanceLimitsUpdate. Recorded here so they are not lost:');
    for (const s of withLimits) L.push(`//   ${s.name}: cpu ${s.limits!.cpu} / memory ${s.limits!.memoryMB}MB`);
    L.push('');
  }
  return {
    files: { '.railway/railway.ts': L.join('\n') },
    requiredSecrets: requiredSecrets(m),
    notes: ['Resource ceilings are not expressible in Railway IaC; they are applied out of band and recorded as comments rather than silently dropped.'],
  };
}

export function renderAll(m: Manifest): Rendered {
  const a = renderCompose(m);
  const b = renderRailwayIaC(m);
  return { files: { ...a.files, ...b.files }, requiredSecrets: a.requiredSecrets, notes: [...a.notes, ...b.notes] };
}
export type { Issue };
