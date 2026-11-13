import { parse as parseYaml } from 'yaml';
import { ManifestSchema, type Manifest } from './schema.ts';

/**
 * Compose as an input adapter (D29, [13](../../../docs/design/13-compose-first-and-execution.md)).
 *
 * A hosted platform is authored as a Compose document plus an `x-platfolio` block. This module reads that
 * document and lands it on the intermediate model the validators, renderers and `buildPlan` already
 * consume, so nothing downstream learns about the change of format.
 *
 * The deliberate constraint is that we accept a documented subset and REFUSE the rest by name. Compose is
 * permissive; a hosting control plane that quietly drops a field produces a system that differs from the
 * file the tenant read, which is the failure mode this whole project keeps paying for. Generous in, strict
 * in what maps, and the report says which.
 */

/** Field-level problems. Same shape as the manifest validator's issues, on purpose. */
export interface ComposeIssue { path: string; code: string; message: string }

export interface ParsedCompose { manifest?: Manifest; issues: ComposeIssue[] }

/** Compose service keys we map. Anything absent from both lists is reported as unknown, not ignored. */
const SERVICE_ACCEPTED = ['image', 'build', 'command', 'entrypoint', 'working_dir', 'environment', 'expose', 'ports', 'healthcheck', 'volumes', 'depends_on', 'deploy', 'labels', 'networks', 'restart'];

/** Refused with a reason: they cannot be honoured on the hosting provider, or they breach an invariant. */
const REFUSED: Record<string, string> = {
  env_file: 'values arrive from a file at run time; platfolio models a secret as a name with a declared source and never reads values (D29). Declare names under x-platfolio.secrets instead.',
  secrets: 'top-level Compose secrets are file-mounted content platfolio cannot hold. Declare secret names under x-platfolio.secrets.',
  configs: 'same reason as secrets: content platfolio must not store.',
  privileged: 'cannot be granted on a shared hosting platform.',
  cap_add: 'kernel capabilities are not controllable per tenant on the provider.',
  cap_drop: 'kernel capabilities are not controllable per tenant on the provider.',
  security_opt: 'not expressible on the provider.',
  network_mode: 'host/container networking has no provider equivalent; use the service network.',
  pid: 'not expressible on the provider.',
  ipc: 'not expressible on the provider.',
  devices: 'no device access on the provider.',
  device_requests: 'no device access on the provider (GPU workloads are out of scope).',
  runtime: 'no custom OCI runtime on the provider.',
  ulimits: 'not settable through the provider API surface we drive.',
  sysctls: 'not settable through the provider API surface we drive.',
  tmpfs: 'ephemeral mounts are not persistent storage; declare a volume or expect the filesystem to be writable.',
  extends: 'inherited definitions make the hosted shape unreadable; merge explicitly with -f overlays.',
  include: 'platfolio needs the set of files explicit in its own record; merge overlays with -f instead.',
};

const MANAGED_KINDS: Record<string, 'postgres' | 'redis'> = { postgres: 'postgres', redis: 'redis' };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const asNum = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** `registry/repo:tag@sha256:<hex>` -> { image, digest }. */
function splitImage(value: string): { image: string; digest?: string } {
  const at = value.indexOf('@');
  if (at < 0) return { image: value };
  return { image: value.slice(0, at), digest: value.slice(at + 1) };
}

/** `/healthz` out of `["CMD","curl","-fsS","http://127.0.0.1:8080/healthz"]`. */
function healthPathOf(healthcheck: unknown): string | undefined {
  if (!isRec(healthcheck)) return undefined;
  const test = healthcheck.test;
  const candidates = Array.isArray(test) ? test.map(String) : [String(test ?? '')];
  for (const token of candidates) {
    const m = /https?:\/\/[^/]+(\/[^"'\s]*)/.exec(token);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function portOf(svc: Rec): number | undefined {
  for (const entry of asArr(svc.ports)) {
    if (typeof entry === 'number') return entry;
    if (typeof entry === 'string') {
      const parts = entry.split(':');
      const last = parts.at(-1) ?? '';
      const port = asNum(last.split('/')[0]);
      if (port) return port;
    }
    if (isRec(entry)) {
      const cp = asNum(entry.container_port ?? entry.target);
      if (cp) return cp;
    }
  }
  const exposed = asArr(svc.expose).map((e) => asNum(String(e).split('/')[0])).filter((n): n is number => typeof n === 'number');
  return exposed[0];
}

/** Compose memory forms (`512m`, `1g`, bytes) to MB; anything unparseable is refused rather than guessed. */
function memoryMBOf(value: unknown, path: string, issues: ComposeIssue[]): number | undefined {
  if (typeof value === 'number') return Math.max(1, Math.round(value / 1_048_576));
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*([bkmg]?)b?$/i.exec(value.trim());
  const n = m ? Number(m[1]) : undefined;
  if (!n) { issues.push({ path, code: 'compose-memory-unreadable', message: `memory limit "${value}" is not in a form we can map; use e.g. "512m" or bytes` }); return undefined; }
  const unit = (m?.[2] ?? 'b').toLowerCase();
  const factor: Record<string, number> = { b: 1 / 1_048_576, k: 1 / 1024, m: 1, g: 1024 };
  return Math.max(1, Math.round(n * (factor[unit] ?? 1)));
}

/**
 * Refuse anything we cannot honour, and collect what we can. Bind mounts get their own message because
 * they are the one field a silent downgrade would make data loss of: a host path is not a named volume.
 */
function scanService(name: string, svc: Rec, issues: ComposeIssue[]): void {
  const base = `services.${name}`;
  for (const key of Object.keys(svc)) {
    if (key.startsWith('x-')) continue;
    if (REFUSED[key]) { issues.push({ path: `${base}.${key}`, code: 'compose-unsupported', message: REFUSED[key] }); continue; }
    if (!SERVICE_ACCEPTED.includes(key)) { issues.push({ path: `${base}.${key}`, code: 'compose-unknown-field', message: `Compose field "${key}" is not in the supported subset, so it would be dropped; refusing instead` }); }
  }
  for (const vol of asArr(svc.volumes)) {
    const spec = typeof vol === 'string' ? vol : isRec(vol) ? String(vol.source ?? '') : '';
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~')) {
      issues.push({ path: `${base}.volumes`, code: 'compose-bind-mount', message: `bind mount "${spec}" has no hosted equivalent and would silently become an empty volume; declare a named volume instead` });
    }
  }
}

/** Read a Compose document (or an ordered list of overlay documents, merged as Compose merges) into a manifest. */
export function parseCompose(texts: string | string[]): ParsedCompose {
  const issues: ComposeIssue[] = [];
  const list = Array.isArray(texts) ? texts : [texts];
  const docs: Rec[] = [];
  for (const [index, text] of list.entries()) {
    let doc: unknown;
    try {
      doc = parseYaml(text, { uniqueKeys: true });
    } catch (error) {
      issues.push({ path: `file[${String(index)}]`, code: 'compose-yaml', message: (error as Error).message });
      continue;
    }
    if (!isRec(doc)) { issues.push({ path: `file[${String(index)}]`, code: 'compose-shape', message: 'a Compose document must be a mapping' }); continue; }
    docs.push(doc);
  }
  if (issues.length) return { issues };

  const merged: Rec = {};
  const services: Rec = {};
  for (const doc of docs) {
    const docServices = isRec(doc.services) ? doc.services : {};
    for (const [name, svc] of Object.entries(docServices)) {
      if (!isRec(svc)) { issues.push({ path: `services.${name}`, code: 'compose-shape', message: 'a service definition must be a mapping' }); continue; }
      const prior = services[name] ?? {};
      const next: Rec = { ...prior, ...svc };
      // `!reset` is Compose's own way to remove an inherited key (the prod overlay uses it to drop a dev
      // build:). The YAML library surfaces it as an unresolved tag string, so the merge -- which is ours,
      // so the file set stays explicit -- has to interpret it rather than keep the sentinel as a value.
      for (const key of Object.keys(next)) if (next[key] === '!reset null') delete next[key];
      services[name] = next;
    }
    for (const [k, v] of Object.entries(doc)) if (k !== 'services') merged[k] = v;
  }

  const xp = isRec(merged['x-platfolio']) ? merged['x-platfolio'] as Rec : {};
  const requires = isRec(xp.requires) ? xp.requires as Rec : {};
  const resources = isRec(xp.resources) ? xp.resources as Rec : {};
  const meta = isRec(xp.metadata) ? xp.metadata as Rec : {};

  const outServices: Rec = {};
  // Declared separately from the mounts discovered below, and copied: this array was the *same object* as
  // resources.volumes, so every mount pushed into it mutated the declaration. The dedupe then compared a
  // list against itself and reported one volume where the author wrote two views of one disk.
  const declaredVolumes: Rec[] = Array.isArray(resources.volumes) ? [...(resources.volumes as Rec[])] : [];
  const mounts: Rec[] = [];
  for (const [name, raw] of Object.entries(services)) {
    const svc = raw as Rec;
    scanService(name, svc, issues);
    const svcX = isRec(svc['x-platfolio']) ? svc['x-platfolio'] as Rec : {};

    // A managed marker turns a service into a provider-provisioned resource: locally it is a container,
    // hosted it is the provider's managed equivalent. Same name, same interface, different guarantees.
    const managed = typeof svcX.managed === 'string' ? svcX.managed : undefined;
    if (managed) {
      const kind = MANAGED_KINDS[managed];
      if (!kind) { issues.push({ path: `services.${name}.x-platfolio.managed`, code: 'compose-managed-unknown', message: `"${managed}" is not a managed kind we support (${Object.keys(MANAGED_KINDS).join(', ')})` }); continue; }
      const bucket = kind === 'postgres' ? 'database' : 'cache';
      (resources as Rec)[bucket] = { name, kind };
      continue;
    }

    const image = typeof svc.image === 'string' ? svc.image : undefined;
    if (!image) {
      issues.push({ path: `services.${name}.image`, code: 'compose-image-unpinned', message: 'no image: the hosted model needs the prod overlay (compose.prod.yaml) to supply the release pipeline\'s pinned image' });
      continue;
    }
    const { image: repo, digest } = splitImage(image);
    if (!digest) {
      issues.push({ path: `services.${name}.image`, code: 'compose-image-unpinned', message: `"${repo}" has no @sha256 digest; a tag is mutable and a plan that trusts one can be moved under a tenant (D16)` });
      continue;
    }
    const deploy = isRec(svc.deploy) ? svc.deploy as Rec : {};
    const limits = isRec(deploy.resources) && isRec((deploy.resources as Rec).limits) ? ((deploy.resources as Rec).limits) as Rec : undefined;
    const port = portOf(svc);
    if (!port) issues.push({ path: `services.${name}`, code: 'compose-port-missing', message: 'no container port discoverable from ports/expose' });

    outServices[name] = {
      image: repo,
      digest,
      port,
      ...(healthPathOf(svc.healthcheck) ? { healthPath: healthPathOf(svc.healthcheck) } : {}),
      // A Compose `command` is canonically a LIST (`["start", "--x"]`), and a string is the other accepted
      // form. Reading only the string form silently dropped every list-valued command, which is how the
      // hosted Keycloak came up with no arguments at all and printed its own usage text -- the provider had a
      // correct `startCommand` path waiting for a value that never arrived. Elements containing whitespace are
      // quoted because Railway parses this string with a shell.
      ...(() => {
        const command = svc.command;
        if (typeof command === 'string') return command.length > 0 ? { start: command } : {};
        if (!Array.isArray(command) && !Array.isArray(svc.entrypoint) && typeof svc.entrypoint !== 'string') return {};
        // Entrypoint and command are composed into ONE provider start command, and the reason is a semantics
        // clash measured on 2026-11-13 by running the same description twice: Docker appends `command` to the
        // image's ENTRYPOINT, while Railway's `startCommand` REPLACES both and is run as a shell. Writing the
        // full path as the command worked on Railway and produced `Unknown option: '/opt/keycloak/bin/kc.sh'`
        // locally; writing the bare argument worked locally and produced an instant exit with no logs there.
        // Stating both parts is the only form that means the same thing in each runtime, which is what D50's
        // "one specification" actually requires -- it is not about file locations, it is about the semantics
        // surviving the move.
        const parts = [...(Array.isArray(svc.entrypoint) ? svc.entrypoint : typeof svc.entrypoint === 'string' ? [svc.entrypoint] : []),
          ...(Array.isArray(command) ? command : typeof command === 'string' ? [command] : [])].map(String);
        if (parts.length === 0) return {};
        return { start: parts.map((p) => (/\s/.test(p) ? `"${p.replace(/"/g, '\"')}"` : p)).join(' ') };
      })(),
      ...(typeof svcX.preDeploy === 'string' ? { preDeploy: svcX.preDeploy } : {}),
      ...(typeof svcX.rootDirectory === 'string' ? { rootDirectory: svcX.rootDirectory } : {}),
      ...(asNum(deploy.replicas) ? { replicas: asNum(deploy.replicas) } : {}),
      ...(limits ? { limits: { cpu: asNum(limits.cpus) ?? 1, ...(memoryMBOf(limits.memory, `services.${name}.deploy.resources.limits.memory`, issues) ? { memoryMB: memoryMBOf(limits.memory, `services.${name}.deploy.resources.limits.memory`, issues) } : {}) } } : {}),
      env: Object.fromEntries(Object.entries(isRec(svc.environment) ? svc.environment as Rec : {}).map(([k, v]) => [k, String(v ?? '')])),
      secrets: Array.isArray(svcX.secrets) ? svcX.secrets : [],
      references: Array.isArray(svcX.references) ? svcX.references : [],
      ...(Array.isArray(svcX.environments) ? { environments: svcX.environments } : {}),
      ...(typeof svcX.ownership === 'string' ? { ownership: svcX.ownership } : {}),
      domains: Array.isArray(svcX.domains) ? svcX.domains : [],
      dependsOn: Array.isArray(svc.depends_on) ? svc.depends_on.map(String) : Object.keys(isRec(svc.depends_on) ? svc.depends_on as Rec : {}),
      public: svcX.public === true,
    };
    for (const vol of asArr(svc.volumes)) {
      const spec = typeof vol === 'string' ? vol : '';
      const [vname, mount] = spec.split(':');
      if (vname && mount) mounts.push({ name: vname, service: name, mountPath: mount });
    }
  }

  const identity = isRec(xp.identity) ? xp.identity : { mode: 'none', clients: [] };
  const built = {
    apiVersion: 'platfolio.dev/v1alpha1',
    kind: 'Platform',
    metadata: {
      name: meta.name, version: meta.version, title: meta.title, summary: meta.summary,
      kind: meta.kind ?? (() => {
        // `archetype` as authored input is retired (D51), but a document still carrying one is a maintenance
        // item we can name exactly rather than a schema failure that reads like corruption. The legacy label
        // maps to kind+mode; `shared-service` becomes a web platform in hosted mode, because sharing lives in
        // `provides`, not in a shape.
        const legacy = typeof meta.archetype === 'string' ? meta.archetype : undefined;
        if (legacy === undefined) return 'web';
        issues.push({
          path: 'x-platfolio.metadata.archetype',
          code: 'legacy-archetype',
          message: `archetype: ${legacy} is retired (D51); declare kind and mode -- web|worker crossed with development|hosted. Interpreted as kind=${legacy === 'worker' ? 'worker' : 'web'}, mode=${legacy === 'shared-service' ? 'hosted' : 'development'}`,
        });
        return legacy === 'worker' ? 'worker' : 'web';
      })(),
        // Recorded so the validator knows the shape was translated rather than declared (D51): the kind and
        // mode rules bind documents that speak the new vocabulary, and a legacy document gets the warning
        // naming what to write instead -- nothing more.
        legacyShape: typeof meta.archetype === 'string' ? true : undefined,
        mode: meta.mode ?? (() => {
        // A document that never declared a mode is read from what it actually asks for, not from the schema
        // default: `development` implies staging, and every pre-D51 example (including ours and the tests) has
        // staging switched off, so defaulting the new field would have converted a vocabulary change into a
        // wall of refusals about a rule those documents never opted into.
        const envs = isRec(xp.environments) ? xp.environments : {};
        const staging = isRec(envs.staging) && envs.staging.enabled === true;
        return staging ? 'development' : 'hosted';
      })(),
      ...(typeof meta.repository === 'string' ? { repository: meta.repository } : {}),
      ...(typeof meta.license === 'string' ? { license: meta.license } : {}),
    },
    spec: {
      requires: { platfolio: typeof requires.platfolio === 'string' ? requires.platfolio : '>=0.1.0 <1', ...(typeof requires.migrationWindow === 'string' ? { migrationWindow: requires.migrationWindow } : {}) },
      // D34 had to be authorable here or the capability model was unreachable in the format it was
      // designed for: `provides` and `capabilities` were only reaching the manifest through hand-written
      // YAML, which is precisely the path D29 retired.
      ...(isRec(xp.provides) ? { provides: xp.provides } : {}),
      ...(Array.isArray(xp.capabilities) ? { capabilities: xp.capabilities } : {}),
      identity,
      environments: isRec(xp.environments) ? xp.environments : { production: { enabled: true }, staging: { enabled: false } },
      resources: { ...resources, volumes: mergeVolumes({ volumes: declaredVolumes }, mounts as { name: string; service: string; mountPath: string }[]) },
      services: outServices,
      dns: isRec(xp.dns) ? xp.dns : {},
      lifecycle: isRec(xp.lifecycle) ? xp.lifecycle : { onSuspend: 'scale-to-zero', onEject: [], onDelete: { graceDays: 30, backupAgeOutDays: 90 } },
      ...(isRec(xp.observability) ? { observability: xp.observability } : {}),
      ...(isRec(xp.release) ? { release: xp.release } : {}),
    },
  };

  if (issues.length) return { issues };
  // Parse into the *validated* model, not a hand-built object: the intermediate schema carries defaults
  // (replicas, ownership, dependsOn) that the plan builder reads as present. Handing back a shape that
  // only looks right is how an adapter drifts from the model it claims to target.
  const checked = ManifestSchema.safeParse(built);
  if (!checked.success) {
    return {
      issues: issues.concat(checked.error.issues.map((i) => ({
        path: i.path.map(String).join('.'), code: 'compose-schema', message: i.message,
      }))),
    };
  }
  return { manifest: checked.data as Manifest, issues };
}

/**
 * The prod overlay: the same services, images replaced by the release pipeline's pinned coordinates, and
 * no build sections. Generated output -- editing it by hand is the drift the regenerate-and-compare gate
 * exists to catch, which is why the header says so.
 */
export function renderProdOverlay(baseText: string, pins: Record<string, { image: string; tag: string; digest: string }>): string {
  const base = parseYaml(baseText, { uniqueKeys: true });
  const services = isRec(base) && isRec((base as Rec).services) ? ((base as Rec).services) as Rec : {};
  const lines: string[] = [
    '# GENERATED by the platfolio release pipeline -- do not edit by hand (D29).',
    '# Regenerate and compare: a hand edit here is a pinned image the release job did not build.',
    'services:',
  ];
  for (const [name, svc] of Object.entries(services)) {
    const pin = pins[name];
    if (!isRec(svc) || !pin) continue;
    lines.push(`  ${name}:`);
    // Tag AND digest, not digest alone: measured against the API, `repo@sha256:…` is accepted and then
    // never deploys (E26), so a generated overlay that omits the tag would look pinned and be inert.
    lines.push(`    image: ${pin.image}:${pin.tag}@${pin.digest}`);
    // !reset is Compose's own way to remove an inherited key; without it a dev build: section would leak
    // into the hosted model and the release job's digest would be ignored in favour of local source.
    if (isRec(svc) && svc.build !== undefined) lines.push('    build: !reset null');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * An explicit `x-platfolio.resources.volumes` entry and a Compose mount describe the same disk, so they must
 * become one plan entry. The earlier code concatenated both, and the duplicate built from the mount string
 * carries no `retention` — so a volume declared to survive also appeared as a plain entry that teardown was
 * free to delete, with whichever matched first deciding whether a tenant's state lived. That is a data-loss
 * bug shaped like a merge, and the template test found it by declaring both, which is exactly what an author
 * writing Compose would naturally do.
 */
export function mergeVolumes(
  declared: { volumes?: Record<string, unknown>[] },
  derived: { name: string; service: string; mountPath: string }[],
): Record<string, unknown>[] {
  const explicit = (declared.volumes ?? []).map((v) => ({ ...v }));
  const byMount = new Map<string, number>();
  explicit.forEach((v, index) => { if (typeof v.mountPath === 'string') byMount.set(v.mountPath, index); });
  for (const mount of derived) {
    const at = byMount.get(mount.mountPath);
    if (at !== undefined) {
      // The declaration wins every field it states; the mount only supplies what is absent.
      const existing = explicit[at]!;
      if (typeof existing.service !== 'string') existing.service = mount.service;
      if (typeof existing.name !== 'string') existing.name = mount.name;
      continue;
    }
    explicit.push({ ...mount });
  }
  return explicit;
}
