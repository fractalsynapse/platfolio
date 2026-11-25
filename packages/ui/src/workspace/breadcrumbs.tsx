import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';

export interface Breadcrumb {
  readonly label: string;
  readonly href?: string;
}

export function Breadcrumbs({ items }: { readonly items: readonly Breadcrumb[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return <nav aria-label="Breadcrumbs"><ol className="ui-workspace-crumbs">
    {items.map((item, index) => <li key={item.href ?? item.label}>
      {index > 0 && <span aria-hidden="true">/</span>}
      {item.href ? <WorkspaceLink href={item.href}>{item.label}</WorkspaceLink> : <span aria-current="page">{item.label}</span>}
    </li>)}
  </ol></nav>;
}
