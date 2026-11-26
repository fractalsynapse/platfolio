import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { workspacePaths } from './routes.ts';
import { ResourceLink } from './resource-link.tsx';

export function AppList({ team, apps }: { readonly team: string; readonly apps: readonly InstanceResponse[] }): React.ReactElement {
  if (apps.length === 0) return <p className="ui-workspace-empty">This team has no apps yet.</p>;
  return <ul className="ui-environment-list" aria-label="Apps">
    {apps.map((app) => <li key={app.id}>
      <ResourceLink href={workspacePaths.instance(team, app.name)} title={app.name} detail={app.templateRef?.repo ?? app.template} kind="app" />
    </li>)}
  </ul>;
}
