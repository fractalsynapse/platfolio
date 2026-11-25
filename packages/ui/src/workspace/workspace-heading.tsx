import * as React from 'react';
import type { ReactNode } from 'react';

export function WorkspaceHeading({ title, children }: { readonly title: string; readonly children?: ReactNode }): React.ReactElement {
  return <header className="ui-workspace-page-heading"><h1>{title}</h1>{children}</header>;
}
