import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { artifactConfigFromEnv, readArtifactGraph, verifyArtifactGrant, type ArtifactConfig } from './marketplace-artifacts.ts';

function registryError(response: ServerResponse, status: number, code: string) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'docker-distribution-api-version': 'registry/2.0',
    ...(status === 401 ? { 'www-authenticate': 'Basic realm="Platfolio artifact registry"' } : {}),
  });
  response.end(JSON.stringify({ errors: [{ code, message: status === 401 ? 'Registry authorization required' : 'Artifact unavailable' }] }));
}

export function createArtifactGateway(config: ArtifactConfig, now = Date.now) {
  const graphs = new Map<string, ReturnType<typeof readArtifactGraph>>();
  return createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) registryError(response, 502, 'UNKNOWN');
      else response.destroy();
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', config.origin);
    if (url.origin !== config.origin) return registryError(response, 404, 'NAME_UNKNOWN');
    const access = verifyArtifactGrant(config, request.headers.authorization, now());
    if (!access) return registryError(response, 401, 'UNAUTHORIZED');
    if (url.pathname === '/v2/' && (request.method === 'GET' || request.method === 'HEAD')) {
      response.writeHead(200, { 'docker-distribution-api-version': 'registry/2.0', 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end('{}');
      return;
    }
    const match = /^\/v2\/(releases\/[a-z0-9-]+\/[0-9.]+\/[a-z0-9_-]+)\/(manifests|blobs)\/([A-Za-z0-9:_.-]+(?:\/[A-Za-z0-9-]*)?)$/.exec(url.pathname);
    if (!match) return registryError(response, 404, 'NAME_UNKNOWN');
    const repo = match[1]!;
    const kind = match[2] === 'manifests' ? 'manifests' : 'blobs';
    const reference = match[3]!;
    if (!repo.startsWith(access.namespace + '/')) return registryError(response, 404, 'NAME_UNKNOWN');
    const read = request.method === 'GET' || request.method === 'HEAD';
    if (access.operation === 'pull') {
      const image = access.images.find((candidate) => candidate.repo === repo);
      if (!read || !image) return registryError(response, 404, 'NAME_UNKNOWN');
      const selected = kind === 'manifests' && reference === image.tag ? image.digest : reference;
      if (kind !== 'manifests' || selected !== image.digest) {
        const key = repo + '@' + image.digest;
        let graph = graphs.get(key);
        if (!graph) {
          if (graphs.size >= 128) graphs.delete(graphs.keys().next().value!);
          graph = readArtifactGraph(config.backend, image);
          graphs.set(key, graph);
          void graph.catch(() => { if (graphs.get(key) === graph) graphs.delete(key); });
        }
        if (!(await graph)[kind].has(selected)) return registryError(response, 404, kind === 'manifests' ? 'MANIFEST_UNKNOWN' : 'BLOB_UNKNOWN');
      }
      return proxy(request, response, new URL(`/v2/${repo}/${kind}/${selected}`, config.backend));
    }

    const upload = kind === 'blobs' && /^uploads\/[A-Za-z0-9-]*$/.test(reference);
    const write = (kind === 'manifests' && request.method === 'PUT') ||
      (upload && ['POST', 'PATCH', 'PUT'].includes(request.method ?? ''));
    if (!read && !write) return registryError(response, 404, 'NAME_UNKNOWN');
    // A client may hint at a cross-repository mount. Falling back to an upload keeps the publisher
    // credential confined to the one authorized release namespace.
    const target = new URL(url.pathname, config.backend);
    for (const parameter of ['_state', 'digest']) {
      const value = url.searchParams.get(parameter);
      if (value) target.searchParams.set(parameter, value);
    }
    return proxy(request, response, target);
  }

  function proxy(request: IncomingMessage, response: ServerResponse, target: URL) {
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: RequestOptions['headers'] = {};
    for (const name of ['accept', 'content-type', 'content-length', 'content-range', 'range']) {
      const value = request.headers[name];
      if (value !== undefined) headers[name] = value;
    }
    return new Promise<void>((resolve, reject) => {
      const outgoing = transport(target, { method: request.method, headers }, (upstream) => {
        if (!upstream.statusCode || (upstream.statusCode >= 300 && upstream.statusCode < 400)) {
          upstream.resume();
          reject(new Error('The registry backend returned an unsupported redirect'));
          return;
        }
        const { location, ...upstreamHeaders } = upstream.headers;
        const forwarded: Record<string, string | string[]> = { 'cache-control': 'private, no-store' };
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'docker-distribution-api-version',
          'docker-content-digest', 'docker-upload-uuid', 'range']) {
          if (upstreamHeaders[name] !== undefined) forwarded[name] = upstreamHeaders[name];
        }
        if (location) {
          const next = new URL(location, config.backend);
          if (next.origin !== config.backend || !next.pathname.startsWith('/v2/')) {
            upstream.resume();
            reject(new Error('Invalid registry backend location'));
            return;
          }
          forwarded.location = next.pathname + next.search;
        }
        response.writeHead(upstream.statusCode, forwarded);
        void pipeline(upstream, response).then(resolve, reject);
      });
      outgoing.setTimeout(30_000, () => outgoing.destroy(new Error('Registry upstream timed out')));
      outgoing.on('error', reject);
      request.on('aborted', () => outgoing.destroy());
      response.on('close', () => { if (!response.writableFinished) outgoing.destroy(); });
      request.pipe(outgoing);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = artifactConfigFromEnv(process.env);
  if (!config) throw new Error('The artifact gateway needs artifact registry configuration');
  createArtifactGateway(config).listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '0.0.0.0');
}
