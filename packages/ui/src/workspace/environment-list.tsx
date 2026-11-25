import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { instanceState } from '../components/instances.ts';
import type { Freshness } from '../sdk/transport.ts';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

const StateLabel = instanceState.render;
const shortcuts = [['deployments', 'Deployments'], ['configuration', 'Configuration'], ['domains', 'Domains']] as const;

interface EnvironmentListProps {
  readonly team: string;
  readonly app: InstanceResponse;
  readonly freshness: Freshness;
  readonly now: string;
}

export function EnvironmentList({ team, app, freshness, now }: EnvironmentListProps): React.ReactElement {
  if (app.environments.length === 0) return <p className="ui-workspace-empty">This app hasn’t reported an environment yet.</p>;
  return <ul className="ui-environment-list" aria-label="Environments">
    {app.environments.map((item) => {
      const name = item.environment.charAt(0).toUpperCase() + item.environment.slice(1);
      return <li key={item.environment}>
        <WorkspaceLink className="ui-environment-summary ui-hit-primary" href={workspacePaths.environment(team, app.name, item.environment)}>
          <span className="ui-environment-symbol" aria-hidden="true">▢</span>
          <span><strong>{name}</strong>{app.templateRef && <small>Source · {app.templateRef.commitSha.slice(0, 8)}</small>}
            <StateLabel environment={item.environment} state={item.state} observedAt={freshness.observedAt} now={now} />
          </span>
          <span aria-hidden="true">›</span>
        </WorkspaceLink>
        <nav aria-label={`${name} shortcuts`} className="ui-environment-shortcuts">
          {shortcuts.map(([tab, label]) => <WorkspaceLink key={tab} href={workspacePaths.environment(team, app.name, item.environment, tab)}>{label}</WorkspaceLink>)}
        </nav>
      </li>;
    })}
  </ul>;
}
