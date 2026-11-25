import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';

export interface SectionLink {
  readonly href: string;
  readonly label: string;
  readonly current?: boolean;
}

export function SectionNav({ label, links, mode = 'segments' }: {
  readonly label: string;
  readonly links: readonly SectionLink[];
  readonly mode?: 'segments' | 'tabs' | 'links';
}): React.ReactElement {
  return <nav className={`ui-workspace-${mode}`} aria-label={label}>
    {links.map((item) => <WorkspaceLink key={item.href} href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</WorkspaceLink>)}
  </nav>;
}
