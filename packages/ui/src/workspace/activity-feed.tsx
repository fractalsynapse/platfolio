import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export interface ActivityEntry {
  readonly id: string;
  readonly title: string;
  readonly at: string;
  readonly detail?: string;
  readonly href?: string;
}

export function ActivityFeed({ title, empty, entries }: { title: string; empty: string; entries: readonly ActivityEntry[] }): React.ReactElement {
  return <WorkspacePanel title={title}>
    {entries.length ? <ol className="ui-workspace-list">
      {entries.map((entry) => <li className="ui-workspace-row" key={entry.id}>
        <div>
          {entry.href ? <WorkspaceLink href={entry.href}><strong>{entry.title}</strong></WorkspaceLink> : <strong>{entry.title}</strong>}
          {entry.detail && <p className="ui-workspace-meta">{entry.detail}</p>}
        </div>
        <time className="ui-workspace-meta" dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
      </li>)}
    </ol> : <p>{empty}</p>}
  </WorkspacePanel>;
}
