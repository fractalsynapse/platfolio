import { Context, Service } from 'cordis';
import type { Request, Response_, RouteDefinition } from './server.ts';

/**
 * Capability plugins, written by the application without importing the framework.
 *
 * D15 says only `packages/kernel` may touch Cordis. "Everything's a plugin" says capabilities should compose
 * rather than be wired by hand. Those collide until you notice what a Cordis plugin is at this tag: a plain
 * function `(ctx, config) => disposer`. So an app capability is *data* -- routes, a boot hook, a returned
 * cleanup -- and this service is the one place that turns data into a fiber.
 *
 * The per-extension `ctx.inject` is the part that matters. Cordis checks property access against the fiber
 * that wrote the code, so handing every handler the root context would mean a capability could not read the
 * services it depends on -- measured, not guessed: the first version did exactly that and failed with
 * `cannot get property "store" without inject`. Each extension therefore gets a context scoped to what it
 * declared it requires. The boundary is enforced by the framework, and the declaration is the documentation.
 */
export interface ExtensionDescriptor {
  id: string;
  /** Capabilities this one needs. Anything not listed is unreachable at request time, by the framework itself. */
  requires?: readonly string[];
  routes?: readonly RouteDefinition[];
  onBoot?: (context: KernelContext) => BootResult;
}

export type BootResult = void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

/** The context type the app is allowed to see: capability accessors, no framework vocabulary. */
export type KernelContext = Context;

export class ExtensionService extends Service<{ extensions?: readonly ExtensionDescriptor[] }> {
  static inject = ['server'] as const;
  static provide = 'extensions' as const;

  private readonly extensions: readonly ExtensionDescriptor[];
  private readonly installed: string[] = [];

  constructor(ctx: Context, config: { extensions?: readonly ExtensionDescriptor[] }) {
    super(ctx, 'extensions');
    this.extensions = config.extensions ?? [];
  }

  get installedIds(): readonly string[] {
    return this.installed;
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    const disposers: Array<{ id: string; dispose: () => void | Promise<void> }> = [];
    for (const extension of this.extensions) {
      if (this.installed.includes(extension.id)) {
        throw new Error(`extension "${extension.id}" is registered twice -- two fibers for one capability is how a controller reconciles the same instance concurrently`);
      }
      const routeCount = extension.routes?.length ?? 0;
      const deps = ['server', ...(extension.requires ?? [])];
      // One injected fiber per capability: routes register through the transport, and handlers see only the
      // services they declared.
      const cleanup = await this.ctx.inject(deps, async (scoped: Context): Promise<() => void | Promise<void>> => {
        for (const route of extension.routes ?? []) {
          scoped.server.addRoute({
            ...route,
            operationId: route.operationId || `${extension.id}:${route.method} ${route.path}`,
            handle: (request: Request, params: Record<string, string>) => route.handle(request, params, scoped),
          });
        }
        if (!extension.onBoot) return () => undefined;
        const result = await extension.onBoot(scoped);
        return typeof result === 'function' ? result : () => undefined;
      });
      this.installed.push(extension.id);
      if (typeof cleanup === 'function') disposers.push({ id: extension.id, dispose: cleanup as () => void | Promise<void> });
      this.ctx.logger.info(`extension ${extension.id} installed (${String(routeCount)} route(s), deps ${deps.join(', ')})`);
    }
    yield async () => {
      const failures: string[] = [];
      // Reverse registration order: a capability that started later may depend on the earlier one, so it stops
      // first. A teardown error is logged, never swallowed, because a half-stopped runtime is what a restart
      // then starts from.
      for (const entry of disposers.reverse()) {
        try {
          await entry.dispose();
        } catch (error) {
          failures.push(`${entry.id}: ${(error as Error).message}`);
        }
      }
      if (failures.length > 0) this.ctx.logger.error(`extension teardown failed for ${failures.join(' | ').slice(0, 300)}`);
    };
  }
}

declare module 'cordis' {
  interface Context {
    extensions: ExtensionService;
  }
}
