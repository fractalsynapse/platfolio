/**
 * E9 — does the vendored Cordis kernel boot a platfolio control plane **without**
 * `--expose-internals`, with the infrastructure provider selected purely by configuration?
 *
 *   npx -y tsx driver.ts
 *
 * Evidence, not features. Assertions that need an effect/fiber context run inside a plugin body, and
 * registration happens synchronously in that body — the framework requires it (see A6).
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Context, FiberState } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Include from '@cordisjs/plugin-include';

interface Result {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'OBSERVE';
  evidence: string;
}

const results: Result[] = [];
const record = (id: string, name: string, status: Result['status'], evidence: string): void => {
  results.push({ id, name, status, evidence });
};

async function attempt(id: string, name: string, fn: () => Promise<string>): Promise<void> {
  try {
    record(id, name, 'PASS', await fn());
  } catch (error) {
    record(id, name, 'FAIL', (error as Error).message.split('\n')[0].slice(0, 240));
  }
}

/** Boot a profile: the app registers the loader in code; the YAML file selects the plugins. */
async function boot(profile: string): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(Loader);
  await ctx.plugin(Include as any, { path: pathToFileURL(join(process.cwd(), profile)).href });
  return ctx;
}

const dispose = (ctx: Context): Promise<void> => ctx.fiber.dispose();

// ---------------------------------------------------------------- A1 boot without internals

await attempt('A1', 'boots without --expose-internals', async () => {
  if (process.execArgv.includes('--expose-internals')) throw new Error('flag present; not the production profile');
  const ctx = await boot('cordis.alpha.yml');
  const driver = (ctx.infra as any).driver;
  const hasServer = typeof (ctx as any).server === 'object';
  const hasTimer = typeof (ctx as any).timer === 'object';
  await dispose(ctx);
  if (!driver) throw new Error('infra capability did not resolve after boot');
  return `boot ok · provider=${driver} · capabilities resolved: infra, server=${hasServer}, timer=${hasTimer} · no internals flag`;
});

// ---------------------------------------------------------------- A2 provider swapped by config

await attempt('A2', 'provider selected by configuration, not code', async () => {
  const a = await boot('cordis.alpha.yml');
  const b = await boot('cordis.beta.yml');
  const driverA = (a.infra as any).driver;
  const driverB = (b.infra as any).driver;
  const project = (a.infra as any).createProject({ name: 'example-web-app', environments: ['staging', 'production'] });
  await dispose(a);
  await dispose(b);
  if (driverA !== 'alpha' || driverB !== 'beta') throw new Error(`alpha=${driverA} beta=${driverB}`);
  return `identical code, two profiles → ${driverA} / ${driverB} · createProject(${JSON.stringify(project)})`;
});

// ---------------------------------------------------------------- A3 invalid profile handling

await attempt('A3', 'invalid profile: how are bad entries actually treated?', async () => {
  let threw: string | undefined;
  let ctx: Context | undefined;
  try {
    ctx = await boot('cordis.invalid.yml');
  } catch (error) {
    threw = (error as Error).message.split('\n')[0].slice(0, 150);
  }
  if (ctx) await dispose(ctx);
  const detail = threw ?? 'boot completed WITHOUT throwing — invalid entries are tolerated at load';
  if (!threw) {
    // Not a failure of the kernel, but a fact the platform must design around.
    record('A3', 'invalid profile: how are bad entries actually treated?', 'OBSERVE', `${detail} → platfolio must validate profiles itself at boot`);
    return 'observed';
  }
  if (!/entry|name is required|must be|must not/i.test(threw)) throw new Error(`rejected for the wrong reason: ${threw}`);
  record('A3', 'invalid profile: how are bad entries actually treated?', 'PASS', `rejected with located entry errors: ${threw}`);
  return 'observed';
});

// ---------------------------------------------------------------- A4 per-tenant config layering

await attempt('A4', 'intercept layers provider config per scope', async () => {
  const ctx = await boot('cordis.alpha.yml');
  const base = ctx.infra.scope();
  const tenant = ctx.intercept('infra', { region: 'eu-west', maxProjects: 3 }).intercept('infra', { maxProjects: 5 });
  const scoped = tenant.infra.scope();
  await dispose(ctx);
  if (scoped.maxProjects !== 5 || scoped.region !== 'eu-west') throw new Error(`merged=${JSON.stringify(scoped)}`);
  return `outer=${JSON.stringify(base)} → tenant=${JSON.stringify(scoped)} (inner scope wins per key)`;
});

// ---------------------------------------------------------------- A5 isolation boundary

{
  // Probe only, and inconclusive: this did not settle what isolate() guarantees. Recorded as an
  // observation so nobody reads a PASS here that was never established.
  let summary = '';
  try {
    const ctx = await boot('cordis.alpha.yml');
    const seen = { blocked: false, reason: '', injected: 'none' };
    try {
      await ctx.plugin((c) => {
        try {
          void c.isolate('infra').infra;
        } catch (error) {
          seen.blocked = true;
          seen.reason = (error as Error).message.slice(0, 50);
        }
        c.inject(['infra'], (view) => {
          seen.injected = (view.infra as any).driver;
        });
      });
    } catch (error) {
      seen.reason = `plugin rejected: ${(error as Error).message.slice(0, 50)}`;
    }
    await dispose(ctx);
    summary = `direct isolate access threw=${seen.blocked}; injected provider=${seen.injected}; note=${seen.reason || 'none'}`;
  } catch (error) {
    summary = `probe itself failed: ${(error as Error).message.slice(0, 60)}`;
  }
  record(
    'A5',
    'isolation boundary — INCONCLUSIVE, needs re-test in E11',
    'OBSERVE',
    `${summary} · the documented block in vendor/cordis/packages/core/tests/isolate.spec.ts is asserted on an *injected view* derived through isolate, not on a plugin fiber, so this probe tested the wrong shape. Do not treat isolate() as a security boundary until E11 settles it (D13 already assumes it is composition scoping, not sandboxing).`,
  );
}

// ---------------------------------------------------------------- A6 effect scope rules

await attempt('A6', 'effects must be registered synchronously in the plugin body', async () => {
  const ctx = await boot('cordis.alpha.yml');
  let syncOk = false;
  let syncError = '';
  await ctx.plugin((c) => {
    try {
      const fiber = c.inject(['infra'], (view) => {
        view.on('infra/provider-check', () => {});
      });
      syncOk = !!fiber;
    } catch (error) {
      syncError = (error as Error).message;
    }
  });
  let asyncOk = false;
  let asyncError = '';
  await ctx.plugin(async (c) => {
    await Promise.resolve();
    try {
      c.inject(['infra'], () => {});
      asyncOk = true;
    } catch (error) {
      asyncError = (error as Error).message;
    }
  });
  await dispose(ctx);
  if (!syncOk) throw new Error(`synchronous registration failed: ${syncError}`);
  record(
    'A6',
    'effects must be registered synchronously in the plugin body',
    asyncOk ? 'PASS' : 'OBSERVE',
    `sync inject+listener ok; post-await inject ${asyncOk ? 'also ok' : `rejected: ${asyncError}`} → kernel rule: register effects during sync setup`,
  );
  return 'recorded';
});

// ---------------------------------------------------------------- A7 reversibility

await attempt('A7', 'registration is reversible (fiber dispose is clean)', async () => {
  const ctx = await boot('cordis.alpha.yml');
  let seen = 0;
  const fiber = ctx.inject(['infra'], (view) => {
    view.on('infra/provider-check', () => {
      seen += 1;
    });
  });
  await fiber;
  ctx.emit('infra/provider-check');
  const before = seen;
  await fiber.dispose();
  ctx.emit('infra/provider-check');
  const state = (fiber as any).state;
  const disposed = state === FiberState.DISPOSED;
  await dispose(ctx);
  if (before !== 1 || seen !== 1) throw new Error(`listener survived dispose: before=${before} after=${seen}`);
  return `hits before dispose=${before}, after=${seen} · fiberState=${state} (DISPOSED=${FiberState.DISPOSED}) · disposedFlag=${disposed}`;
});

// ---------------------------------------------------------------- A8 HTTP surface

await attempt('A8', 'control plane can serve HTTP here (own node:http surface)', async () => {
  const ctx = await boot('cordis.alpha.yml');
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, driver: (ctx.infra as any).driver }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  const body = (await response.json()) as { ok: boolean; driver: string };
  server.close();
  await dispose(ctx);
  if (response.status !== 200 || body.driver !== 'alpha') throw new Error(`status=${response.status} body=${JSON.stringify(body)}`);
  return `GET 127.0.0.1:${port}/healthz → ${response.status} ${JSON.stringify(body)} · capability resolved inside the handler`;
});

// ---------------------------------------------------------------- A9 published plugin-server

{
  const notes: string[] = [];
  const ctx = await boot('cordis.alpha.yml');
  const registered = typeof (ctx as any).server === 'object';
  notes.push(`plugin-server@1.7.0 registers from the profile: ${registered}`);
  try {
    (ctx as any).server.get('/probe', (_req: any, res: any) => res.end('ok'));
    notes.push('route definition ok');
  } catch (error) {
    notes.push(`route definition FAILS: ${(error as Error).message.slice(0, 90)}`);
    notes.push('cause: it calls Service.resolveConfig, a symbol present only in the fork @deepseek-ai/cordis@4.1.0 (verified in that package lib/utils.js); upstream cordis@4.0.0-rc.12 has resolveIntercept. The declared peer range "^4.0.0-rc.6" permits the broken combination');
  }
  await dispose(ctx);
  record('A9', 'published @cordisjs/plugin-server vs the vendored core', 'OBSERVE', notes.join(' · '));
}

// ---------------------------------------------------------------- A10 runtime facts

{
  const require = createRequire(import.meta.url);
  const pkg = (name: string): string => {
    try {
      return require(`${name}/package.json`).version;
    } catch {
      return 'n/a';
    }
  };
  record(
    'A10',
    'runtime and package facts',
    'OBSERVE',
    `node=${process.version} · cordis=${pkg('cordis')} · loader=${pkg('@cordisjs/plugin-loader')} · include=${pkg('@cordisjs/plugin-include')} · server=${pkg('@cordisjs/plugin-server')} · TS run via tsx (this Node build errors on native type-stripping) · a booted server capability keeps the event loop alive, so an explicit shutdown is required`,
  );
}

// ---------------------------------------------------------------- report

// A3/A6 are dual-path records: the row that carries no evidence string is an artefact of the
// attempt() wrapper, so drop placeholder rows rather than printing noise.
const clean = results.filter((r) => r.evidence && r.evidence !== 'recorded' && r.evidence !== 'observed');
// Collapse duplicate ids, keeping the informative row.
const byId = new Map<string, Result>();
for (const r of clean) {
  const prev = byId.get(r.id);
  if (!prev || (prev.status === 'PASS' && r.status !== 'PASS')) byId.set(r.id, r);
  else if (prev.status === 'OBSERVE' && r.status === 'PASS') byId.set(r.id, r);
}

console.log('\nE9 — Cordis kernel boot experiment\n');
for (const r of [...byId.values()]) {
  console.log(`${r.id.padEnd(4)} ${r.status.padEnd(7)} ${r.name}`);
  console.log(`     ${r.evidence}\n`);
}
const failed = [...byId.values()].filter((r) => r.status === 'FAIL');
const observed = [...byId.values()].filter((r) => r.status === 'OBSERVE');
console.log(`${byId.size} records · ${byId.size - failed.length - observed.length} passed · ${failed.length} failed · ${observed.length} observations.`);
process.exit(failed.length ? 1 : 0);
