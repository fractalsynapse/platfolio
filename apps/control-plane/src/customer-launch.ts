const callbackPath = '/api/v1/railway/callback';

export interface CustomerLaunchConfig {
  teamId: string;
  workerUrl: string;
  workerKey: string;
  siteOrigin: string;
}

export function customerLaunchConfig(env: NodeJS.ProcessEnv, origins: readonly string[]): CustomerLaunchConfig | undefined {
  const workerUrl = env.PLATFOLIO_LAUNCH_WORKER_URL;
  const workerKey = env.PLATFOLIO_LAUNCH_WORKER_KEY;
  const teamId = env.PLATFOLIO_LAUNCH_TEAM;
  if (!workerUrl && !workerKey && !teamId) return;
  if (!workerUrl || !workerKey || workerKey.length < 32 || !teamId || origins.length !== 1 || env.PLATFOLIO_MARKETPLACE_ENABLED === 'true') {
    throw new Error('The launcher requires a customer worker, team and exactly one site origin');
  }
  const worker = new URL(workerUrl);
  if (!['http:', 'https:'].includes(worker.protocol) ||
      !/^[a-z0-9-]+\.railway\.internal$|^127\.0\.0\.1$/.test(worker.hostname) ||
      worker.username || worker.password || worker.pathname !== '/' || worker.search || worker.hash) {
    throw new Error('The customer worker must be on the installation private network');
  }
  return { workerUrl: worker.origin, workerKey, teamId, siteOrigin: origins[0]! };
}

export function customerLaunch(config: CustomerLaunchConfig, request: typeof fetch) {
  return {
    teamId: config.teamId,
    callbackPath,
    returnTo: new URL('/dashboard/launch', config.siteOrigin).href,
    async call(action: 'report' | 'setup' | 'initialize' | 'unlock' | 'authorize' | 'callback' | 'start' | 'redeploy' | 'remove' | 'marketplace-status' | 'marketplace-enroll' | 'domains-list' | 'domain-attach' | 'domain-detach', body?: object) {
      try {
        const response = await request(config.workerUrl + '/launch', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(action === 'unlock' || action === 'callback' ? 55000 : 15000),
          headers: { authorization: 'Bearer ' + config.workerKey, 'content-type': 'application/json' },
          body: JSON.stringify({ action, body }),
        });
        return response.ok ? { ok: true as const, body: await response.json() as unknown } : { ok: false as const };
      } catch { return { ok: false as const }; }
    },
  };
}
