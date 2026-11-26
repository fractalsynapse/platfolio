import * as React from 'react';
import { WorkspaceAvatar } from './workspace-avatar.tsx';
import { ResourceText } from './resource-text.tsx';
import { WorkspaceLink } from './workspace-link.tsx';

export function ResourceLink({ href, title, detail, kind }: {
  readonly href: string;
  readonly title: string;
  readonly detail: string;
  readonly kind: 'team' | 'app';
}): React.ReactElement {
  return <WorkspaceLink className="ui-workspace-resource ui-hit-primary" href={href}>
    {kind === 'team' ? <WorkspaceAvatar name={title} limit={1} /> : <span className="ui-environment-symbol" aria-hidden="true">P</span>}
    <ResourceText title={title} detail={detail} />
    <span className="ui-workspace-resource-chevron" aria-hidden="true">›</span>
  </WorkspaceLink>;
}
