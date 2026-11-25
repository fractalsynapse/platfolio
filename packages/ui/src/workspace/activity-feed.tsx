import { useId } from 'react';
import { WorkspaceLink } from './workspace-link.tsx';

export interface ActivityEntry {
  readonly id: string;
  readonly title: string;
  readonly at: string;
  readonly detail?: string;
  readonly href?: string;
}

export function ActivityFeed({ title, empty, entries }: { title: string; empty: string; entries: readonly ActivityEntry[] }) {
  const heading = useId();
  return <section aria-labelledby={heading}>
    <h2 id={heading}>{title}</h2>
    {entries.length ? <ol className="ui-workspace-list">
      {entries.map((entry) => <li className="ui-workspace-row" key={entry.id}>
        <div>
          {entry.href ? <WorkspaceLink href={entry.href}><strong>{entry.title}</strong></WorkspaceLink> : <strong>{entry.title}</strong>}
          {entry.detail && <p className="ui-workspace-meta">{entry.detail}</p>}
        </div>
        <time className="ui-workspace-meta" dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
      </li>)}
    </ol> : <p>{empty}</p>}
  </section>;
}
