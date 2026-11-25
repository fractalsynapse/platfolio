import type { ReactNode } from 'react';

export function WorkspacePanel({ title, context, children }: {
  readonly title: string;
  readonly context?: boolean;
  readonly children: ReactNode;
}) {
  return <section aria-label={title} className="ui-workspace-panel" data-context={context ? '' : undefined}>
    <h2>{title}</h2>
    {children}
  </section>;
}
