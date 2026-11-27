import * as React from 'react';
import type { InstanceResponse, RequestBodyOf } from '@platfolio/api-contract/generated/types';
import { isSelectableEnvironment } from '../components/enums.ts';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { HostingRemoval } from './hosting-removal.tsx';
import { OperationState } from './operation-state.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

type RedeployEnvironment = RequestBodyOf<'redeployInstance'>['environment'];

export function InstanceHosting({ app }: { readonly app: InstanceResponse }): React.ReactElement {
  const params = React.useMemo(() => ({ instanceId: app.id }), [app.id]);
  const hosting = useOperation('getInstanceHostingState', { params });
  const apply = useCommand('applyInstanceHostingPlan');
  const remove = useCommand('removeInstanceHosting');
  const redeploy = useCommand('redeployInstance');
  const [pending, setPending] = React.useState(false);
  const [outcome, setOutcome] = React.useState('');
  const [removed, setRemoved] = React.useState(app.state === 'removed');
  const clock = useClock();
  const services = hosting.state.status === 'loaded' ? hosting.state.data.services : [];
  const environments = [...new Set(services.map(({ environment }) => environment))]
    .filter((environment): environment is RedeployEnvironment => isSelectableEnvironment(environment) || environment === 'preview');

  async function run(operation: () => Promise<{ message: string; accepted: boolean }>) {
    setPending(true);
    setOutcome('');
    try {
      const result = await operation();
      setOutcome(result.message);
      return result.accepted;
    } finally {
      setPending(false);
      hosting.reload();
    }
  }

  function applyPlan() {
    return run(async () => {
      const result = await apply({ params });
      if (!result.ok) return { accepted: false, message: result.error.message };
      return { accepted: result.value.verified, message: result.value.verified
        ? 'The hosting provider verified the deployment.'
        : result.value.failures?.[0]?.message ?? 'The provider could not verify the deployment.' };
    });
  }

  function removeApp(body: RequestBodyOf<'removeInstanceHosting'>) {
    return run(async () => {
      const result = await remove({ params, body });
      if (!result.ok) return { accepted: false, message: result.error.message };
      if (result.value.failures?.length || result.value.orphans.length || body.data === 'keep' && !result.value.retained) {
        return { accepted: false, message: 'The hosting provider could not verify removal. Check the app before trying again.' };
      }
      setRemoved(body.data === 'wipe');
      return { accepted: true, message: body.data === 'keep' ? 'App stopped. Storage kept.' : 'The provider confirmed removal.' };
    });
  }

  function redeployEnvironment(environment: RedeployEnvironment) {
    return run(async () => {
      const result = await redeploy({ params, body: { environment } });
      if (!result.ok) return { accepted: false, message: result.error.message };
      return { accepted: result.value.verified, message: result.value.verified
        ? 'The hosting provider started new deployments.'
        : result.value.refused[0]?.reason ?? 'The hosting provider could not verify a new deployment.' };
    });
  }

  return <WorkspacePanel title="Hosting">
    <p className="ui-workspace-meta">{app.provider}</p>
    {!removed && <OperationState status={hosting.state.status} pending="Checking the app’s hosting project…"
      failed="Platfolio couldn’t verify the hosting project." retry={hosting.reload}>
      {hosting.state.status === 'loaded' && <>
        <p>Project <code>{hosting.state.data.projectExternalId}</code></p>
        <ul className="ui-workspace-list">
          {hosting.state.data.services.map((service) => <li key={service.environment + '/' + service.name}>
            <strong>{service.name}</strong> · {service.environment} · {service.status}
          </li>)}
        </ul>
        <p className="ui-workspace-meta">{ageLabel(hosting.state.freshness, clock().toISOString()).text}</p>
        {app.desiredPlanHash && app.state !== 'paused' && environments.map((environment) =>
          <p key={environment}><WorkspaceAction variant="secondary" disabled={pending} onClick={() => void redeployEnvironment(environment)}>
            Redeploy {environment}
          </WorkspaceAction></p>)}
        <HostingRemoval name={app.name} pending={pending} onRemove={removeApp} />
      </>}
    </OperationState>}
    {!removed && app.desiredPlanHash && <p><WorkspaceAction variant="primary" disabled={pending}
      onClick={() => void applyPlan()}>{app.state === 'paused' ? 'Restore app' : 'Apply deployment plan'}</WorkspaceAction></p>}
    {outcome && <p role="status">{outcome}</p>}
  </WorkspacePanel>;
}
