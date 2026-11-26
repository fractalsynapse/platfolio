import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';

export function ResourceLink({ href, title, detail, kind }: {
  readonly href: string;
  readonly title: string;
  readonly detail: string;
  readonly kind: 'team' | 'app';
}): React.ReactElement {
  const mark = kind === 'team' ? title.charAt(0).toUpperCase() : 'P';
  return <WorkspaceLink className="ui-workspace-resource ui-hit-primary" href={href}>
    <span className={kind === 'team' ? 'ui-workspace-avatar' : 'ui-environment-symbol'} aria-hidden="true">{mark}</span>
    <span className="ui-workspace-resource-text"><strong>{title}</strong><span>{detail}</span></span>
    <span className="ui-workspace-resource-chevron" aria-hidden="true">›</span>
  </WorkspaceLink>;
}
