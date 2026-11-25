import type { HostedAppCheck } from './persistence.ts';

type Observation = Pick<HostedAppCheck, 'instanceId' | 'deploymentId' | 'checkedAt'> & { passing: boolean };

export function nextAppCheck(current: HostedAppCheck | undefined, input: Observation): { check: HostedAppCheck; changed?: 'up' | 'down' } | undefined {
  if (current && Date.parse(current.checkedAt) >= Date.parse(input.checkedAt)) return;
  const previous = current?.deploymentId === input.deploymentId ? current : undefined;
  const failures = input.passing ? 0 : Math.min((previous?.failures ?? 0) + 1, 2);
  const state = input.passing ? 'up' : failures >= 2 ? 'down' : previous?.state ?? 'checking';
  const changed = state === 'down' && previous?.state !== 'down' ? 'down'
    : state === 'up' && previous?.state === 'down' ? 'up' : undefined;
  return {
    check: { instanceId: input.instanceId, deploymentId: input.deploymentId, checkedAt: input.checkedAt, state, failures },
    ...(changed ? { changed } : {}),
  };
}
