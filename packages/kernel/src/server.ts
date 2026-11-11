import { Context, Service } from 'cordis';
import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

/**
 * HTTP transport as a capability (`ctx.server`).
 *
 * Cordis ships no server at this tag -- the reference tree has no listener, no router, no request abstraction
 * (verified against `examples/cordis` @ v4.0.0-rc.12) -- so the seam is ours. It is deliberately thin: sockets,
 * listen/close, and method+path dispatch. Anything that knows an operationId belongs above it, in the app,
 * because the framework boundary must not acquire opinions about the API.
 *
 * The lifecycle point that matters here: the listener is closed by a disposer *yielded from* `[Service.init]`,
 * which is how Cordis expresses "stop". A server that never closes is a test suite that hangs, and a disposer
 * registered outside the fiber's effect scope is one that never runs.
 */
export const ServerConfigSchema = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  /** 0 means "any free port", which is what tests and the local Compose probe want. */
  port: z.number().int().min(0).max(65535).default(8080),
  bodyLimitBytes: z.number().int().min(1024).max(8_388_608).default(1_048_576),
  shutdownGraceMs: z.number().int().min(0).max(30_000).default(5_000),
}).strict();

export interface RouteDefinition {
  method: string;
  /**Colon parameters in the spec's own notation: `/api/v1/instances/{instanceId}`. */
  path: string;
  operationId: string;
  handle: (request: Request, params: Record<string, string>) => Promise<Response_>;
}

export interface Request {
  method: string;
  path: string;
  url: string;
  headers: IncomingMessage['headers'];
  raw: IncomingMessage;
}

export interface Response_ {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type RequestHandler = (request: Request) => Promise<Response_ | undefined>;

export class ServerService extends Service<z.infer<typeof ServerConfigSchema>> {
  static inject = [] as const;
  static provide = 'server' as const;
  static Config = ServerConfigSchema;

  readonly config: z.infer<typeof ServerConfigSchema>;
  private server: ReturnType<typeof createServer> | undefined;
  private readonly routes: RouteDefinition[] = [];
  private fallback: RequestHandler | undefined;

  constructor(ctx: Context, config: z.infer<typeof ServerConfigSchema>) {
    super(ctx, 'server');
    this.config = config;
  }

  /** Routes are collected before listen, and matched per request so a late registration still takes. */
  addRoute(route: RouteDefinition): void {
    if (this.routes.some((r) => r.method === route.method && r.path === route.path)) {
      // Cordis reports a duplicate *service* eagerly but says nothing about a duplicate route, so the router
      // does: two handlers for one method+path means one of them is dead code that looks alive.
      throw new Error(`route ${route.method} ${route.path} is already registered`);
    }
    this.routes.push(route);
  }

  setFallback(handler: RequestHandler): void {
    this.fallback = handler;
  }

  get listening(): boolean {
    return this.server?.listening === true;
  }

  get address(): { host: string; port: number } {
    const info = this.server?.address() as AddressInfo | undefined;
    if (!info) throw new Error('server is not listening yet -- await the plugin before reading its address');
    return { host: String(info.address), port: info.port };
  }

  /** Exposed for tests: one dispatch, no socket, so route logic is checkable without a listener. */
  async dispatch(request: Request): Promise<Response_> {
    for (const route of this.routes) {
      if (route.method !== request.method.toUpperCase()) continue;
      const params = matchPath(route.path, request.path);
      if (params === null) continue;
      return route.handle(request, params);
    }
    const through = await this.fallback?.(request);
    if (through) return through;
    return { status: 404, body: { error: 'not-found', message: `no route for ${request.method} ${request.path}` } };
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    const listener: RequestListener = (req, res) => {
      void (async () => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const response = await this.dispatch({ method: req.method ?? 'GET', path: url.pathname, url: req.url ?? '/', headers: req.headers, raw: req });
        const payload = JSON.stringify(response.body ?? null);
        res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(response.headers ?? {}) });
        res.end(payload);
      })().catch((error: unknown) => {
        // A handler that throws must not leave the socket hanging and must not crash the process: Cordis has
        // no shutdown story at this tag, so the transport is the place that decides.
        this.ctx.logger.error(`server: handler threw for ${req.method} ${req.url}: ${(error as Error).message ?? String(error)}`);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'internal', message: 'the request handler threw; the server stayed up' }));
      });
    };
    const server = createServer(listener);
    server.timeout = 30_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.config.port, this.config.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.server = server;
    const actual = (server.address() as AddressInfo).port;
    this.ctx.logger.info(`server listening on ${this.config.host}:${String(actual)}`);
    yield async () => {
      await new Promise<void>((resolve) => {
        // Sockets held open by a keep-alive client would block close() forever; destroy them after the grace
        // so a shutdown is bounded. This is the whole reason the disposer exists.
        const timer = setTimeout(() => {
          server.closeAllConnections?.();
          resolve();
        }, this.config.shutdownGraceMs);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.server = undefined;
      this.ctx.logger.info('server closed');
    };
  }
}

/** `{name}` segments bind; anything else must match literally. Trailing slashes are not a second route. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const want = patternParts[i] ?? '';
    const got = pathParts[i] ?? '';
    const param = /^\{(\w+)\}$/.exec(want);
    if (param) params[param[1] ?? ''] = decodeURIComponent(got);
    else if (want !== got) return null;
  }
  return params;
}

declare module 'cordis' {
  interface Context {
    server: ServerService;
  }
}
