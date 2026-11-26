import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';

export function ResourceLink({ href, title, detail, kind }: {
  readonly href: string;
  readonly title: string;
  readonly detail: string;
  readonly kind: 'team' | 'app';
}): React.ReactElement {
  const mark = kind === 'team' ? title.slice(0, 2).toUpperCase() : 'P';
  return <WorkspaceLink className="ui-environment-summary ui-hit-primary" href={href}>
    <span className={kind === 'team' ? 'ui-workspace-avatar' : 'ui-environment-symbol'} aria-hidden="true">{mark}</span>
    <span><strong>{title}</strong><br /><span className="ui-workspace-meta">{detail}</span></span>
    <span className="ui-workspace-meta" aria-hidden="true">›</span>
  </WorkspaceLink>;
}
