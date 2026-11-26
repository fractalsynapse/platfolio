import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export interface ActivityEntry {
  readonly id: string;
  readonly title: string;
  readonly at: string;
  readonly detail?: string;
  readonly href?: string;
  readonly label?: string;
}

export function ActivityFeed({ title, empty, entries, history, observation }: {
  readonly title: string;
  readonly empty: string;
  readonly entries: readonly ActivityEntry[];
  readonly history?: React.ReactNode;
  readonly observation?: string | undefined;
}): React.ReactElement {
  return <WorkspacePanel title={title}>
    {observation && <p className="ui-workspace-meta">{observation}</p>}
    {history}
    {entries.length ? <ol className="ui-activity-timeline">
      {entries.map((entry) => <li key={entry.id}>
        <div className="ui-workspace-links">
          {entry.label && <span className="ui-setup-status">{entry.label}</span>}
          <time className="ui-workspace-meta" dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
        </div>
        <h3>{entry.href ? <WorkspaceLink href={entry.href}>{entry.title}</WorkspaceLink> : entry.title}</h3>
        {entry.detail && <p className="ui-workspace-meta">{entry.detail}</p>}
      </li>)}
    </ol> : <p className="ui-workspace-empty">{empty}</p>}
  </WorkspacePanel>;
}
