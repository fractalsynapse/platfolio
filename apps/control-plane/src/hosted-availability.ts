import type { NewHostedStarter, Store } from '@platfolio/contracts';

const transitions: Readonly<Record<string, 'down' | 'up' | 'paused' | 'removed'>> = {
  'availability.down': 'down',
  'availability.up': 'up',
  'hosting.paused': 'paused',
  'hosting.removed': 'removed',
};

export async function checkHostedApp(
  store: Pick<Store, 'recordHostedAppCheck'>,
  instanceId: string,
  observation: Extract<NewHostedStarter, { state: 'live' }>,
  now: () => Date,
  request: typeof fetch = fetch,
): Promise<void> {
  if (!observation.origin) return;
  const response = await request(observation.origin + '/healthz', {
    redirect: 'manual', signal: AbortSignal.timeout(4500),
  }).catch(() => undefined);
  await response?.body?.cancel().catch(() => undefined);
  await store.recordHostedAppCheck({
    instanceId, deploymentId: observation.deploymentId, checkedAt: now().toISOString(), passing: response?.ok === true,
  });
}

export async function hostedAppStatus(
  store: Pick<Store, 'getHostedStarter' | 'getHostedAppCheck' | 'recentAuditForTargets'>,
  instanceId: string,
) {
  const hosting = await store.getHostedStarter(instanceId);
  if (!hosting.ok || !hosting.value.origin) return;
  const [check, events] = await Promise.all([store.getHostedAppCheck(instanceId), store.recentAuditForTargets([instanceId], 200)]);
  const current = hosting.value.state === 'live' && check?.deploymentId === hosting.value.deploymentId ? check : undefined;
  const state = hosting.value.state === 'live' ? current?.state ?? 'checking' : hosting.value.state;
  const updates = events.flatMap((event) => {
    const observed = transitions[event.action];
    return observed ? [{ id: event.id, at: event.at, state: observed }] : [];
  });
  return { environment: 'staging' as const, state, ...(current ? { checkedAt: current.checkedAt } : {}), updates };
}
