import * as React from 'react';
import type { ReactNode } from 'react';

export function WorkspacePanel({ title, context, form, observation, stale, children }: {
  readonly title: string;
  readonly context?: boolean;
  readonly form?: boolean;
  readonly observation?: string | undefined;
  readonly stale?: boolean | undefined;
  readonly children: ReactNode;
}): React.ReactElement {
  return <section aria-label={title} className={form ? 'ui-workspace-panel ui-workspace-form-panel' : 'ui-workspace-panel'} data-context={context ? '' : undefined}>
    <h2 title={observation}>{title}</h2>
    {observation && <p className={stale ? 'ui-workspace-meta' : 'ui-sr-only'}>{observation}</p>}
    {children}
  </section>;
}
