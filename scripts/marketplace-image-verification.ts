import { createHash } from 'node:crypto';

const imageMediaTypes = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
];
const manifestLimit = 4 * 1024 * 1024;

export async function verifyMarketplaceImage(reference: string, request: typeof fetch = fetch): Promise<void> {
  const match = /^(?:(docker\.io|ghcr\.io|quay\.io)\/)?([a-z0-9]+(?:[._-]+[a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-]+[a-z0-9]+)*)*):[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}@(sha256:[a-f0-9]{64})$/.exec(reference);
  if (!match) throw new Error('Use a tagged and digest-pinned image from a supported public registry');
  const [, registry, path, digest] = match;
  if (!path || !digest || path.length > 255) throw new Error('Invalid image reference');
  const [namespace] = path.split('/');
  if (!registry && path.includes('/') && (namespace?.includes('.') || namespace === 'localhost')) {
    throw new Error('The image registry is not supported');
  }
  const docker = !registry || registry === 'docker.io';
  const repo = docker && !path.includes('/') ? `library/${path}` : path;
  const host = docker ? 'registry-1.docker.io' : registry!;
  const manifestUrl = `https://${host}/v2/${repo}/manifests/${digest}`;
  const headers = { accept: imageMediaTypes.join(', ') };
  const options = { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(6500) } as const;
  let response = await request(manifestUrl, { ...options, headers });
  if (response.status === 401) {
    await response.body?.cancel();
    // Only public, repository-scoped pull tokens. A response challenge cannot choose an outbound origin or scope.
    const tokenUrl = new URL(docker ? 'https://auth.docker.io/token' : `https://${host}/token`);
    tokenUrl.searchParams.set('service', docker ? 'registry.docker.io' : host);
    tokenUrl.searchParams.set('scope', `repository:${repo}:pull`);
    const tokenResponse = await request(tokenUrl, options);
    if (!tokenResponse.ok) {
      await tokenResponse.body?.cancel();
      throw new Error('The image registry refused anonymous pull access');
    }
    const { token } = await tokenResponse.json() as { token?: unknown };
    if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,16384}$/.test(token)) throw new Error('Invalid public registry token');
    response = await request(manifestUrl, { ...options, headers: { ...headers, authorization: `Bearer ${token}` } });
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (response.status !== 200 || !response.body || !mediaType || !imageMediaTypes.includes(mediaType)) {
    await response.body?.cancel();
    throw new Error('The pinned image manifest is unavailable');
  }
  const reader = response.body.getReader();
  const hash = createHash('sha256');
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > manifestLimit) throw new Error('The image manifest exceeds the verification limit');
      hash.update(value);
    }
  } finally {
    await reader.cancel();
  }
  if (`sha256:${hash.digest('hex')}` !== digest) throw new Error('Image manifest bytes do not match the published digest');
}
