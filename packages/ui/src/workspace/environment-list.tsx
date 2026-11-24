import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { instanceState } from '../components/instances.tsx';
import type { Freshness } from '../sdk/transport.ts';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

const StateLabel = instanceState.render;

interface EnvironmentListProps {
  readonly team: string;
  readonly app: InstanceResponse;
  readonly freshness: Freshness;
  readonly now: string;
}

export function EnvironmentList({ team, app, freshness, now }: EnvironmentListProps): React.ReactElement {
  if (app.environments.length === 0) return <p className="ui-workspace-empty">This app hasn’t reported an environment yet.</p>;
  return <ul className="ui-workspace-list" aria-label="Environments">
    {app.environments.map((item) => <li key={item.environment}>
      <WorkspaceLink className="ui-workspace-row ui-hit-primary" href={workspacePaths.environment(team, app.name, item.environment)}>
        <strong>{item.environment}</strong>
        <StateLabel environment={item.environment} state={item.state} observedAt={freshness.observedAt} now={now} />
      </WorkspaceLink>
    </li>)}
  </ul>;
}
