import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { workspacePaths } from './routes.ts';

const params = {};

export function FreeTemplatePicker({ team }: { readonly team: string }): React.ReactElement {
  const { state, reload } = useOperation('listInstallableTemplates', { params });
  const clock = useClock();

  return <>
    {state.status === 'pending' && <p role="status">Loading templates…</p>}
    {state.status === 'failed' && <p role="status">Couldn’t load the templates. <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button></p>}
    {state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
      {state.data.length === 0 ? <p>No templates are available to install.</p> : state.data.map((release) => <article key={release.template} className="ui-template-card">
        <header><p className="ui-template-card-type"><span>Web apps</span><span>Web · Development</span></p><h2>Starter Web</h2></header>
        <div className="ui-template-card-meta"><span>Published by <strong>{release.repo.split('/')[0]}</strong></span><span>Version {release.version}</span></div>
        <div className="ui-template-card-body">
          <p>Launch a website with a database and an API for other tools to use.</p>
          <dl className="ui-workspace-facts">
            <div><dt>Template price</dt><dd>Free</dd></div>
            <div><dt>Database</dt><dd>Private PostgreSQL</dd></div>
          </dl>
          <p>Railway charges for the resources your app uses.</p>
        </div>
        <footer className="ui-template-card-actions">
          <a className="ui-workspace-trigger ui-hit-primary" href={`https://github.com/${release.repo}/tree/${release.revision}`}>View source</a>
          <WorkspaceLink className="ui-workspace-primary ui-hit-primary" href={workspacePaths.launchForTeam(team)}>Use template</WorkspaceLink>
        </footer>
      </article>)}
    </>}
  </>;
}
