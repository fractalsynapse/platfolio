import * as React from 'react';
import { workspacePaths } from './routes.ts';
import { WorkspaceLink } from './workspace-link.tsx';

export function UnavailablePage(): React.ReactElement {
  return <>
    <h1>Page unavailable</h1>
    <p>Open an app or team from your workspace.</p>
    <WorkspaceLink href={workspacePaths.home}>Your teams</WorkspaceLink>
  </>;
}
