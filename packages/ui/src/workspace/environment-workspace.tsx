import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import type { Freshness } from '../sdk/transport.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { EnvironmentOverview } from './environment-overview.tsx';
import { EnvironmentDeployments } from './environment-deployments.tsx';
import { EnvironmentDomains } from './environment-domains.tsx';
import { ServiceSecretPresence } from './service-secret-presence.tsx';
import { workspacePaths, type WorkspaceRoute } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

const tabs = [
  { id: 'overview', label: 'Overview' }, { id: 'deployments', label: 'Deployments' },
  { id: 'configuration', label: 'Configuration' }, { id: 'domains', label: 'Domains' },
] as const;

interface EnvironmentWorkspaceProps {
  readonly instanceId: string;
  readonly environment: InstanceResponse['environments'][number];
  readonly route: Extract<WorkspaceRoute, { kind: 'environment' }>;
  readonly freshness: Freshness;
  readonly now: string;
}

export function EnvironmentWorkspace({ instanceId, environment, route, freshness, now }: EnvironmentWorkspaceProps): React.ReactElement {
  const params = React.useMemo(() => ({ instanceId, environment: route.environment }), [instanceId, route.environment]);
  const { state, reload } = useOperation('getInstanceEnvironment', { params, key: `environment-${instanceId}-${route.environment}` });
  const clock = useClock();

  return <>
    <nav className="ui-workspace-links" aria-label="Environment">
      {tabs.map(({ id, label }) => <WorkspaceLink key={id}
        href={workspacePaths.environment(route.team, route.instance, route.environment, id)}
        aria-current={route.tab === id ? 'page' : undefined}>{label}</WorkspaceLink>)}
    </nav>
    {route.tab === 'overview' && <EnvironmentOverview environment={environment} freshness={freshness} now={now} />}
    {state.status === 'pending' && <p role="status">Loading environment details…</p>}
    {state.status === 'failed' && <p role="status">Couldn’t read the environment details.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button>
    </p>}
    {state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
      {route.tab === 'deployments' && <EnvironmentDeployments deployments={state.data.deployments} />}
      {route.tab === 'domains' && <EnvironmentDomains domains={state.data.domains} planned={state.data.planned} />}
      {route.tab === 'configuration' && <section aria-label="Environment configuration">
        <h2>Configuration</h2>
        {!state.data.planned && <p>Register a deployment plan to check this environment’s settings.</p>}
        {state.data.planned && state.data.services.every(({ secrets }) => secrets.length === 0) && <p>No app secrets are declared for this environment.</p>}
        {state.data.services.filter(({ secrets }) => secrets.length > 0).map(({ name, secrets }) =>
          <ServiceSecretPresence key={name} scope={{ ...params, service: name }} names={secrets} />)}
      </section>}
      {route.tab === 'overview' && state.data.services.length > 0 && <section aria-label="Planned services">
        <h2>Planned services</h2>
        <ul className="ui-workspace-list">{state.data.services.map(({ name }) => <li className="ui-workspace-row" key={name}>{name}</li>)}</ul>
      </section>}
    </>}
  </>;
}
