import { resolve4, resolve6 } from 'node:dns/promises';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Run at startup in the existing starter-web staging container. Output includes no addresses or credentials.
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || process.env.RAILWAY_PROJECT_NAME !== 'platfolio-starter-web') {
  throw new Error('The network probe only runs in platfolio-starter-web/staging');
}

const database = 'app-db-staging.railway.internal';
const peer = 'api-staging.railway.internal';

async function resolveHost(host: string) {
  return (await Promise.allSettled([resolve4(host), resolve6(host)])).map((result) =>
    result.status === 'fulfilled' ? result.value : String(result.reason.code ?? 'unknown'));
}

function postgresProbe(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 5432 });
    const finish = (result: boolean) => { socket.destroy(); resolve(result); };
    socket.setTimeout(3000, () => finish(false));
    socket.once('error', () => finish(false));
    // PostgreSQL's unauthenticated SSL negotiation returns S or N. It exercises the service behind DNS
    // without logging or using the application's database password.
    socket.once('connect', () => socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])));
    socket.once('data', (data) => finish(data.length === 1 && (data[0] === 83 || data[0] === 78)));
    socket.once('end', () => finish(false));
  });
}

let postgres = false;
for (let attempt = 0; attempt < 10; attempt++) {
  postgres = await postgresProbe(database);
  if (postgres) break;
  await delay(2000);
}
const [ipv4, ipv6] = await resolveHost(database);
const [peer4, peer6] = await resolveHost(peer);
const privateDatabaseReference = URL.canParse(process.env.DATABASE_URL ?? '') &&
  new URL(process.env.DATABASE_URL!).hostname === database;
const unavailable = (result: unknown) => result === 'ENOTFOUND' || result === 'ENODATA';
console.log(`PLATFOLIO_NETWORK_PROOF same-environment IPv4=${Array.isArray(ipv4)} IPv6=${Array.isArray(ipv6)} postgres=${postgres} private-reference=${privateDatabaseReference}`);
console.log(`PLATFOLIO_NETWORK_PROOF cross-project IPv4=${Array.isArray(peer4) ? 'resolved' : peer4} IPv6=${Array.isArray(peer6) ? 'resolved' : peer6}`);
if (!postgres || !privateDatabaseReference || !unavailable(peer4) || !unavailable(peer6)) process.exitCode = 1;
