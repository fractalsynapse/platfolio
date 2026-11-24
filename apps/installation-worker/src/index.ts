import { lookup } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';

function serviceUrl(raw: string, path: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || !/^[a-z0-9-]+\.railway\.internal$/.test(url.hostname) ||
      url.username || url.password || url.pathname !== path || url.search || url.hash) {
    throw new Error('The worker only probes private Railway service addresses');
  }
  return url;
}
const config = serviceUrl(process.env.PLATFOLIO_OPENBAO_URL ?? '', '/');
const health = new URL('/v1/sys/health', config);
const starterUrl = process.env.PLATFOLIO_STARTER_HEALTH_URL;
const starter = starterUrl ? serviceUrl(starterUrl, '/healthz') : undefined;
let lastStarterCheck = 0;
let previous: string | undefined;
for (;;) {
  let result: string;
  try {
    const addresses = await lookup(config.hostname, { all: true });
    if (!addresses.length) throw new Error('No private addresses');
    const response = await fetch(health, { redirect: 'error', signal: AbortSignal.timeout(3500) });
    const state = await response.json() as { initialized?: boolean; sealed?: boolean };
    if (![200, 429, 472, 473, 501, 503].includes(response.status) ||
        typeof state.initialized !== 'boolean' || typeof state.sealed !== 'boolean') throw new Error('Invalid OpenBao health response');
    result = `reachable=true http=${response.status} initialized=${state.initialized} sealed=${state.sealed}`;
  } catch {
    result = 'reachable=false';
  }
  if (result !== previous) console.log(`PLATFOLIO_OPENBAO_NETWORK ${result}`);
  previous = result;
  if (starter && Date.now() - lastStarterCheck >= 30_000) {
    lastStarterCheck = Date.now();
    const response = await fetch(starter, { redirect: 'error', signal: AbortSignal.timeout(3500) }).catch(() => undefined);
    const state = await response?.json().catch(() => undefined) as { ok?: boolean; database?: string } | undefined;
    console.log(`PLATFOLIO_STARTER_RUNTIME healthy=${response?.status === 200 && state?.ok === true && state.database === 'configured'}`);
  }
  await delay(5000);
}
