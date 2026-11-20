import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { InfraPlan, InfraProvider } from '../packages/contracts/src/infra.ts';
import { physicalServiceName } from '../packages/contracts/src/railway-provider.ts';

async function fetchHosted(origin: URL, path: string): Promise<Response> {
  const response = await fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${origin.origin}${path} answered HTTP ${response.status}`);
  return response;
}

export async function verifyHostedCandidate(
  plan: InfraPlan,
  environmentName: string,
  sourceCommit: string,
  provider: Pick<InfraProvider, 'readState'>,
): Promise<void> {
  const environment = plan.environments.find((entry) => entry.name === environmentName);
  const api = environment?.services.find((service) => service.name === 'api');
  const site = environment?.services.find((service) => service.name === 'site');
  if (!environment || !api || !site) throw new Error(`Candidate must plan api and site in ${environmentName}`);

  const config = Object.fromEntries(site.env.map((value) => [value.name, value.literal]));
  const siteUrl = config.PLATFOLIO_SITE_ORIGIN;
  const apiUrl = config.PLATFOLIO_URL;
  const issuerUrl = config.PLATFOLIO_IDENTITY_ISSUER;
  if (!siteUrl || !apiUrl || !issuerUrl) throw new Error(`${environmentName} site is missing its public endpoint configuration`);
  const siteOrigin = new URL(siteUrl);
  const apiOrigin = new URL(apiUrl);
  const issuer = new URL(issuerUrl);
  if ([siteOrigin, apiOrigin, issuer].some((url) => url.protocol !== 'https:')) {
    throw new Error('Hosted verification needs HTTPS endpoints');
  }
  const realmPath = /^\/realms\/([^/]+)$/.exec(issuer.pathname);
  if (!realmPath?.[1]) throw new Error('The site issuer must point at a Keycloak realm');

  const state = await provider.readState(plan.instanceId);
  for (const service of [api, site]) {
    const name = physicalServiceName(service.name, environmentName);
    const observed = state.services.find((entry) => entry.environment === environmentName && entry.name === name);
    if (observed?.status !== 'live' || observed.image !== `${service.image}@${service.digest}`) {
      throw new Error(`Railway did not report ${name} live with the candidate image`);
    }
  }

  const [apiVersion, siteVersion, readiness, overlay, landing, dashboard] = await Promise.all([
    fetchHosted(apiOrigin, '/version').then((response) => response.json()) as Promise<{ commit?: unknown }>,
    fetchHosted(siteOrigin, '/version.json').then((response) => response.json()) as Promise<{ commit?: unknown }>,
    fetchHosted(apiOrigin, '/readyz').then((response) => response.json()) as Promise<{ checks?: { name: string; status: string }[] }>,
    fetchHosted(siteOrigin, '/config.js').then((response) => response.text()),
    fetchHosted(siteOrigin, '/').then((response) => response.text()),
    fetchHosted(siteOrigin, '/dashboard').then((response) => response.text()),
    fetchHosted(siteOrigin, '/callback'),
  ]);
  if (apiVersion.commit !== sourceCommit || siteVersion.commit !== sourceCommit) {
    throw new Error('The API and site must both serve the candidate commit');
  }
  if (!readiness.checks?.some((check) => check.name === 'database' && check.status === 'ok')) {
    throw new Error('The candidate API did not report its database ready');
  }
  const payload = /^window\.__PLATFOLIO_SITE_CONFIG__ = ([\s\S]+);\s*$/.exec(overlay)?.[1];
  const runtime = payload ? JSON.parse(payload) as Record<string, unknown> : undefined;
  if (!runtime || runtime.siteOrigin !== siteUrl || runtime.apiBaseUrl !== apiUrl || runtime.issuerBaseUrl !== issuerUrl) {
    throw new Error('The site did not serve the candidate environment configuration');
  }
  if (/<script\b/i.test(landing) || !/<astro-island\b/i.test(dashboard)) {
    throw new Error('The candidate did not serve the expected landing and dashboard pages');
  }
  console.log(`  ${environmentName}: Railway image references, build identity, database and site routes match the candidate`);

  execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./smoke-browser-auth.ts', import.meta.url)),
    '--sign-in-only', '--base', issuer.origin, '--realm', realmPath[1], '--api', apiOrigin.origin, '--ui-origin', siteOrigin.origin],
  { stdio: 'inherit', timeout: 60_000 });
}
