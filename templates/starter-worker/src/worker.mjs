import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// The only reason this writes to disk rather than counting in memory: the file proves the volume survived a
// container restart, which is the property the archetype exists to provide.
const stateDir = process.env.STATE_DIR ?? '/var/lib/starter-worker';
const log = `${stateDir}/jobs.jsonl`;
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
const port = Number(process.env.PORT ?? 8080);
let processed = 0;
let running = 0;
const queue = [];

async function tick() {
  if (running >= concurrency) return;
  const job = queue.pop();
  if (!job) return;
  running += 1;
  try {
    await new Promise((r) => setTimeout(r, job.work));
    await mkdir(stateDir, { recursive: true });
    await appendFile(log, `${JSON.stringify({ id: job.id, doneAt: new Date().toISOString() })}\n`);
    processed += 1;
  } finally { running -= 1; }
}

createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, processed, running, queued: queue.length, stateDir }));
}).listen(port, () => console.log(`starter-worker health on ${port}`));

setInterval(() => {
  if (Math.random() > 0.6) queue.push({ id: randomUUID(), work: 400 + Math.floor(Math.random() * 900) });
  void tick();
  if (Math.random() > 0.9) readFile(log, 'utf8').then((seen) => console.log(`state recovered: ${seen.split('\n').filter(Boolean).length} jobs previously recorded`)).catch(() => {});
}, 2000);
