import * as React from 'react';
import { WorkspaceLink } from './workspace-link.tsx';
import { ResourceText } from './resource-text.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export interface ActivityEntry {
  readonly id: string;
  readonly title: string;
  readonly at: string;
  readonly detail?: string;
  readonly href?: string;
  readonly label?: string;
  readonly outcome?: { readonly label: string; readonly tone?: 'success' | 'attention' };
}

export function ActivityFeed({ title, empty, entries, history, observation, stale, presentation = 'timeline', children }: {
  readonly title: string;
  readonly empty: string;
  readonly entries: readonly ActivityEntry[];
  readonly history?: React.ReactNode;
  readonly observation?: string | undefined;
  readonly stale?: boolean | undefined;
  readonly presentation?: 'timeline' | 'rows';
  readonly children?: React.ReactNode;
}): React.ReactElement {
  return <WorkspacePanel title={title} observation={observation} stale={stale}>
    {history}
    {entries.length === 0 ? <p className="ui-workspace-empty">{empty}</p> : presentation === 'rows' ?
      <ol className="ui-workspace-list ui-resource-list">
        {entries.map((entry) => {
          const summary = <>
            <ResourceText title={entry.title} detail={<>
              {entry.detail && <>{entry.detail} · </>}
              <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
            </>} />
            {entry.outcome && <span className="ui-setup-status" data-tone={entry.outcome.tone}>{entry.outcome.label}</span>}
          </>;
          return <li key={entry.id}>{entry.href
            ? <WorkspaceLink className="ui-workspace-resource ui-hit-primary" href={entry.href}>{summary}
                <span className="ui-workspace-resource-chevron" aria-hidden="true">›</span>
              </WorkspaceLink>
            : <div className="ui-workspace-resource">{summary}</div>}
          </li>;
        })}
      </ol> : <ol className="ui-activity-timeline">
      {entries.map((entry) => <li key={entry.id}>
        <div className="ui-workspace-links">
          {entry.label && <span className="ui-setup-status">{entry.label}</span>}
          <time className="ui-workspace-meta" dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
        </div>
        <h3>{entry.href ? <WorkspaceLink href={entry.href}>{entry.title}</WorkspaceLink> : entry.title}</h3>
        {entry.detail && <p className="ui-workspace-meta">{entry.detail}</p>}
      </li>)}
    </ol>}
    {children}
  </WorkspacePanel>;
}
