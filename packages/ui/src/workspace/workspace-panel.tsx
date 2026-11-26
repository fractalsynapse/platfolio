import * as React from 'react';
import type { ReactNode } from 'react';

export function WorkspacePanel({ title, context, form, children }: {
  readonly title: string;
  readonly context?: boolean;
  readonly form?: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  return <section aria-label={title} className={form ? 'ui-workspace-panel ui-workspace-form-panel' : 'ui-workspace-panel'} data-context={context ? '' : undefined}>
    <h2>{title}</h2>
    {children}
  </section>;
}
