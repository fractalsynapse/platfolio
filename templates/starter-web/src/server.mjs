import { createServer } from 'node:http';

// A starter, not a framework: three routes that prove the wiring is real, and nothing that has to be
// deleted before it becomes your application.
const port = Number(process.env.PORT ?? 8080);
const brand = process.env.UI_BRAND ?? 'Starter';
const started = new Date().toISOString();
const db = process.env.DATABASE_URL ? 'configured' : 'absent';

const page = `< <!doctype html><meta charset=utf-8><title>${brand}</title>
<style>body{font:16px/1.5 system-ui;max-width:60ch;margin:4rem auto;padding:0 1rem}code{background:#eee;padding:.15em .35em;border-radius:4px}</style>
<h1>${brand}</h1>
<p>Running on platfolio. This page and the JSON API below are served by the same process.</p>
<ul>
  <li><code>GET /api/ping</code> — liveness plus what the app can see</li>
  <li><code>GET /healthz</code> — the route platfolio's healthcheck calls</li>
</ul>
<p>Replace <code>src/server.mjs</code> and keep <code>/healthz</code>.</p>`;

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, database: db, started })); return; }
  if (path === '/api/ping') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ pong: Date.now(), service: 'starter-web', brand, database: db })); return; }
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page.replace('<', '')); return; }
  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found\n');
});

server.listen(port, () => console.log(`starter-web listening on ${port}`));
