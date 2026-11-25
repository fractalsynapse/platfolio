import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import type { Freshness } from '../sdk/transport.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { EnvironmentOverview } from './environment-overview.tsx';
import { EnvironmentDeployments } from './environment-deployments.tsx';
import { EnvironmentDomains } from './environment-domains.tsx';
import { HostedCustomDomains } from './hosted-custom-domains.tsx';
import { HostedStarterBrand } from './hosted-starter-brand.tsx';
import { StarterRedeploy } from './starter-redeploy.tsx';
import { ServiceSecretPresence } from './service-secret-presence.tsx';
import { workspacePaths, type WorkspaceRoute } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const tabs = [
  { id: 'overview', label: 'Overview' }, { id: 'deployments', label: 'Deployments' },
  { id: 'configuration', label: 'Configuration' }, { id: 'domains', label: 'Domains' },
] as const;

interface EnvironmentWorkspaceProps {
  readonly instanceId: string;
  readonly canManage: boolean;
  readonly environment: InstanceResponse['environments'][number];
  readonly targets: readonly string[];
  readonly route: Extract<WorkspaceRoute, { kind: 'environment' }>;
  readonly freshness: Freshness;
  readonly now: string;
}

export function EnvironmentWorkspace({ instanceId, canManage, environment, targets, route, freshness, now }: EnvironmentWorkspaceProps): React.ReactElement {
  const params = React.useMemo(() => ({ instanceId, environment: route.environment }), [instanceId, route.environment]);
  const { state, reload } = useOperation('getInstanceEnvironment', { params, key: `environment-${instanceId}-${route.environment}` });
  const clock = useClock();

  return <>
    <div className="ui-environment-navigation">
      {targets.length > 1 && <nav className="ui-workspace-segments" aria-label="Target environment">
        {targets.map((target) => <WorkspaceLink key={target} href={workspacePaths.environment(route.team, route.instance, target, route.tab)}
          aria-current={route.environment === target ? 'page' : undefined}>{target.charAt(0).toUpperCase() + target.slice(1)}</WorkspaceLink>)}
      </nav>}
      <nav className="ui-workspace-segments" aria-label="Environment pages">
        {tabs.map(({ id, label }) => <WorkspaceLink key={id}
          href={workspacePaths.environment(route.team, route.instance, route.environment, id)}
          aria-current={route.tab === id ? 'page' : undefined}>{label}</WorkspaceLink>)}
      </nav>
    </div>
    {state.status === 'pending' && <p role="status">Loading environment details…</p>}
    {state.status === 'failed' && <p role="status">Couldn’t read the environment details.{' '}
      <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button>
    </p>}
    {state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
      {route.tab === 'overview' && <div className="ui-workspace-columns">
        <WorkspacePanel title="Last reported deployment">
          <EnvironmentOverview environment={environment} freshness={freshness} now={now} />
          {state.data.hosting && <p className="ui-workspace-meta">Railway last confirmed {new Date(state.data.hosting.observedAt).toLocaleString()}</p>}
          <WorkspaceLink href={workspacePaths.environment(route.team, route.instance, route.environment, 'deployments')}
            className="ui-workspace-trigger ui-hit-primary">View deployments</WorkspaceLink>
        </WorkspacePanel>
        <WorkspacePanel title="App addresses" context>
          {state.data.hosting && state.data.hosting.state !== 'paused' && state.data.hosting.state !== 'removed' &&
            <p><a href={state.data.hosting.origin}>{new URL(state.data.hosting.origin).hostname}</a></p>}
          {state.data.domains.length > 0 && <ul className="ui-workspace-list">{state.data.domains.map(({ host, service }) =>
            <li key={host} className="ui-workspace-row"><span>{host}</span><small>Planned for {service}</small></li>)}</ul>}
          <WorkspaceLink href={workspacePaths.environment(route.team, route.instance, route.environment, 'domains')}>View domains</WorkspaceLink>
        </WorkspacePanel>
      </div>}
      {route.tab === 'deployments' && <div className="ui-workspace-columns">
        <EnvironmentDeployments deployments={state.data.deployments} />
        {state.data.hosting && <WorkspacePanel title="Railway deployment" context>
          <p>Deployment <code>{state.data.hosting.deploymentId.slice(0, 12)}</code></p>
          <p>Project <code>{state.data.hosting.projectId.slice(0, 12)}</code></p>
          {canManage && state.data.hosting.state !== 'paused' && state.data.hosting.state !== 'removed' &&
            <StarterRedeploy key={state.data.hosting.deploymentId} params={params} progressPath={workspacePaths.instanceSetup(route.team, route.instance)} />}
          {canManage && <p><WorkspaceLink href={workspacePaths.instanceSetup(route.team, route.instance)}>Open app setup</WorkspaceLink></p>}
        </WorkspacePanel>}
      </div>}
      {route.tab === 'domains' && <>
        <EnvironmentDomains domains={state.data.domains} planned={state.data.planned} hosting={state.data.hosting} />
        {state.data.hosting && state.data.hosting.state !== 'paused' && state.data.hosting.state !== 'removed' &&
          <HostedCustomDomains params={params} canManage={canManage} />}
      </>}
      {route.tab === 'configuration' && <WorkspacePanel title="Configuration">
        {route.environment === 'staging' && state.data.hosting && state.data.hosting.state !== 'paused' && state.data.hosting.state !== 'removed' &&
          <HostedStarterBrand key={instanceId} params={params} canManage={canManage} progressPath={workspacePaths.instanceSetup(route.team, route.instance)} />}
        {!state.data.planned && (state.data.hosting ? <p>Starter Web uses a database connection generated in Railway.</p>
          : <p>Register a deployment plan to check this environment’s settings.</p>)}
        {state.data.planned && state.data.services.every(({ secrets }) => secrets.length === 0) && <p>No app secrets are declared for this environment.</p>}
        {state.data.services.filter(({ secrets }) => secrets.length > 0).map(({ name, secrets }) =>
          <ServiceSecretPresence key={name} scope={{ ...params, service: name }} names={secrets} />)}
      </WorkspacePanel>}
      {route.tab === 'overview' && state.data.services.length > 0 && <section aria-label="Planned services">
        <h2>Planned services</h2>
        <ul className="ui-workspace-list">{state.data.services.map(({ name }) => <li className="ui-workspace-row" key={name}>{name}</li>)}</ul>
      </section>}
    </>}
  </>;
}
