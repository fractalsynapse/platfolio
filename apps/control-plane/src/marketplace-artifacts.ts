import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { MarketplaceArtifactGrant } from '@platfolio/contracts';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const namespacePattern = /^releases\/[a-z0-9-]{1,100}\/(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const servicePattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const indexes = new Set(['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json']);
const manifests = new Set(['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json']);
const accept = [...indexes, ...manifests].join(', ');
const grantLifetime = 15 * 60 * 1000;

export interface ArtifactConfig {
  origin: string;
  backend: string;
  key: string;
}

export function artifactConfigFromEnv(env: NodeJS.ProcessEnv): ArtifactConfig | undefined {
  const origin = env.PLATFOLIO_ARTIFACT_ORIGIN;
  const backend = env.PLATFOLIO_ARTIFACT_BACKEND;
  const key = env.PLATFOLIO_ARTIFACT_KEY;
  if (!origin && !backend && !key) return;
  if (!origin || !backend || !key || key.length < 32) throw new Error('Configure the artifact registry origin, backend and its signing key together.');
  const external = new URL(origin);
  const internal = new URL(backend);
  if (external.origin !== origin || internal.origin !== backend ||
      (external.protocol !== 'https:' && !(external.protocol === 'http:' && external.hostname === '127.0.0.1')) ||
      !['https:', 'http:'].includes(internal.protocol) || external.origin === internal.origin) {
    throw new Error('Use distinct origins for the marketplace registry and its private backend.');
  }
  return { origin, backend, key };
}

export function artifactNamespace(platformId: string, version: string): string {
  const namespace = `releases/${platformId}/${version}`;
  if (!namespacePattern.test(namespace)) throw new Error('Invalid release namespace');
  return namespace;
}

interface ArtifactImage {
  repo: string;
  tag: string;
  digest: string;
}
type ArtifactAccess = { namespace: string; expires: number } &
  ({ operation: 'push' } | { operation: 'pull'; images: ArtifactImage[] });

export function artifactImages(config: Pick<ArtifactConfig, 'origin'>, namespace: string, references: readonly string[]): ArtifactImage[] {
  const prefix = `${new URL(config.origin).host}/${namespace}/`;
  const repositories = new Set<string>();
  return references.map((reference) => {
    if (!reference.startsWith(prefix)) throw new Error('Use an image in this release namespace');
    const [name, digest] = reference.slice(prefix.length).split('@');
    const [service, tag] = name?.split(':') ?? [];
    if (!service || !servicePattern.test(service) || !tag || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag) ||
        !digest || !digestPattern.test(digest) || reference !== `${prefix}${service}:${tag}@${digest}` || repositories.has(service)) {
      throw new Error('Supply one tagged and digest-pinned image per image repository');
    }
    repositories.add(service);
    return { repo: namespace + '/' + service, tag, digest };
  });
}

export function issueArtifactGrant(config: ArtifactConfig, namespace: string, images?: ArtifactImage[], now = Date.now()): MarketplaceArtifactGrant {
  const expires = now + grantLifetime;
  const access: ArtifactAccess = images ? { operation: 'pull', namespace, images, expires } : { operation: 'push', namespace, expires };
  const payload = Buffer.from(JSON.stringify(access)).toString('base64url');
  const signature = createHmac('sha256', config.key).update(payload).digest('base64url');
  return { registry: config.origin, namespace, username: 'platfolio', password: payload + '.' + signature, expiresAt: new Date(expires).toISOString() };
}

export function verifyArtifactGrant(config: ArtifactConfig, authorization: string | undefined, now = Date.now()): ArtifactAccess | undefined {
  if (!authorization?.startsWith('Basic ') || authorization.length > 16384) return;
  const raw = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  const match = /^platfolio:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(raw);
  if (!match) return;
  const payload = match[1]!;
  const signature = createHmac('sha256', config.key).update(payload).digest('base64url');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(match[2]!))) return;
  const access = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ArtifactAccess;
  if (access.expires <= now || !namespacePattern.test(access.namespace)) return;
  return access;
}

export function registryAuthorization(grant: Pick<MarketplaceArtifactGrant, 'username' | 'password'>): string {
  return 'Basic ' + Buffer.from(`${grant.username}:${grant.password}`).toString('base64');
}

interface OciGraph { manifests: Set<string>; blobs: Set<string> }
type OciDescriptor = { digest?: unknown; size?: unknown; urls?: unknown };

function descriptor(value: OciDescriptor): { digest: string; size: number } {
  if (!value || typeof value.digest !== 'string' || !digestPattern.test(value.digest) ||
      typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0 || value.urls !== undefined) {
    throw new Error('OCI descriptors must reference digest-addressed content in this registry');
  }
  return { digest: value.digest, size: value.size };
}

export async function readArtifactGraph(origin: string, image: ArtifactImage, request = fetch, headers?: Headers): Promise<OciGraph> {
  const result: OciGraph = { manifests: new Set(), blobs: new Set() };
  const wire = new Headers(headers);
  wire.set('accept', accept);
  const options = { headers: wire, redirect: 'error', signal: AbortSignal.timeout(25_000) } as const;
  const pending = [{ digest: image.digest, size: undefined as number | undefined }];
  const blobSizes = new Map<string, number>();
  while (pending.length) {
    const item = pending.pop()!;
    if (result.manifests.has(item.digest)) continue;
    if (result.manifests.size >= 160) throw new Error('Too many nested OCI manifests');
    const response = await request(`${origin}/v2/${image.repo}/manifests/${item.digest}`, options);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('A pinned OCI manifest is missing');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024 || (item.size !== undefined && bytes.length !== item.size) ||
        'sha256:' + createHash('sha256').update(bytes).digest('hex') !== item.digest) {
      throw new Error('An OCI manifest did not match its descriptor');
    }
    const type = response.headers.get('content-type')?.split(';')[0] ?? '';
    const document = JSON.parse(bytes.toString('utf8')) as {
      schemaVersion?: number; manifests?: OciDescriptor[]; config?: OciDescriptor; layers?: OciDescriptor[];
    };
    if (document.schemaVersion !== 2) throw new Error('Unsupported OCI manifest version');
    if (indexes.has(type) && Array.isArray(document.manifests) && document.manifests.length > 0) {
      pending.push(...document.manifests.map(descriptor));
    } else if (manifests.has(type) && document.config && Array.isArray(document.layers)) {
      for (const entry of [document.config, ...document.layers].map(descriptor)) {
        const previous = blobSizes.get(entry.digest);
        if (previous !== undefined && previous !== entry.size) throw new Error('OCI blob sizes disagree');
        blobSizes.set(entry.digest, entry.size);
      }
    } else {
      throw new Error('Unsupported OCI image manifest');
    }
    if (pending.length > 320 || blobSizes.size > 2048) throw new Error('The OCI image exceeds release graph limits');
    result.manifests.add(item.digest);
  }
  for (const [digest, size] of blobSizes) {
    const response = await request(`${origin}/v2/${image.repo}/blobs/${digest}`, { ...options, method: 'HEAD' });
    if (!response.ok || response.headers.get('content-length') !== String(size)) throw new Error('An OCI image blob is missing or incomplete');
    result.blobs.add(digest);
  }
  return result;
}
