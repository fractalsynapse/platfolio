import { createHash } from 'node:crypto';
import { CONTRACT_NAME, CONTRACT_VERSION } from '@platfolio/contracts';
import { createDispatchStore, handleDispatchApi, type DispatchStore } from './dispatch-api.ts';
import http from 'node:http';

/**
 * platfolio's own liveness surface (M1 step 6).
 *
 * Deliberately almost nothing in it. It answers the two questions a platform needs about a control plane --
 * is it up, and which build is this -- and holds no credentials, no database and no tenant data, so the
 * container image can be built, deployed and restarted without touching anything a tenant owns. The real
 * control plane will mount routes beside these, not replace them.
 */
export interface BuildInfo {
  version: string;
  commit: string;
  buildTime: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export interface ServerOptions {
  /** Dispatch/attestation store; omit for a liveness-only server. */
  dispatch?: { store: DispatchStore; token: string | undefined };
}

export function createServer(info: BuildInfo, options: ServerOptions = {}): http.Server {
  const livenessToken = createHash('sha256').update(`${info.commit}\u0000${info.version}`).digest('hex').slice(0, 16);
  return http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const dispatch = options.dispatch;
    // /api/v1/* is answered before the method guard below: it is the only POST surface, and putting it
    // after would reply 405 to every attestation the runner posts.
    if (dispatch && path.startsWith('/api/v1/')) {
      void handleDispatchApi(req, res, { store: dispatch.store, token: dispatch.token });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...JSON_HEADERS, allow: 'GET, HEAD' });
      res.end('{"error":"method-not-allowed"}');
      return;
    }
    if (path === '/healthz') {
      // A fixed payload on purpose: an operator can compare liveness between instances without reading a
      // value that varies per deployment.
      res.writeHead(200, JSON_HEADERS);
      res.end(`{"status":"ok","livenessToken":"${livenessToken}"}`);
      return;
    }
    if (path === '/version') {
      res.writeHead(200, JSON_HEADERS);
      // The provider contract this build speaks is part of platfolio's identity: an operator comparing a
      // tenant's instance state against a control-plane version needs to know which contract produced it.
      res.end(JSON.stringify({
        name: 'status-api',
        version: info.version,
        commit: info.commit,
        buildTime: info.buildTime,
        providerContract: { name: CONTRACT_NAME, version: CONTRACT_VERSION },
      }));
      return;
    }
    if (path === '/readyz') {
      // Readiness is liveness here: there is no dependency to wait on. When this service gains a database or
      // a queue this must report the dependency, not stay green.
      res.writeHead(200, JSON_HEADERS);
      res.end('{"status":"ready"}');
      return;
    }
    res.writeHead(404, JSON_HEADERS);
    res.end('{"error":"not-found"}');
  });
}
