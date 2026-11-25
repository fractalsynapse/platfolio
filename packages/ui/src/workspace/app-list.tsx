import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function AppList({ team, apps }: { readonly team: string; readonly apps: readonly InstanceResponse[] }): React.ReactElement {
  if (apps.length === 0) return <p className="ui-workspace-empty">This team has no apps yet.</p>;
  return <ul className="ui-workspace-list" aria-label="Apps">
    {apps.map((app) => <li key={app.id}>
      <WorkspaceLink className="ui-workspace-row ui-hit-primary" href={workspacePaths.instance(team, app.name)}>
        <strong>{app.name}</strong><span className="ui-workspace-meta">{app.template}</span>
      </WorkspaceLink>
    </li>)}
  </ul>;
}
