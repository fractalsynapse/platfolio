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
    <p><WorkspaceLink href={workspacePaths.team(team)}>Team workspace</WorkspaceLink></p>
    <h1>Choose a template</h1>
    {state.status === 'pending' && <p role="status">Loading templates…</p>}
    {state.status === 'failed' && <p role="status">Couldn’t load the templates. <button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button></p>}
    {state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
      {state.data.length === 0 ? <p>No templates are available to install.</p> : state.data.map((release) => <article key={release.template} className="ui-template-card">
        <header><p className="ui-workspace-meta">Web app</p><h2>Starter Web</h2></header>
        <div className="ui-template-card-body">
          <p>Start with a website, an API, and a private PostgreSQL database.</p>
          <dl className="ui-workspace-facts">
            <div><dt>Template price</dt><dd>Free</dd></div>
            <div><dt>Published by</dt><dd>{release.repo.split('/')[0]}</dd></div>
            <div><dt>Version</dt><dd><a href={`https://github.com/${release.repo}/tree/${release.revision}`}>{release.version} · View source</a></dd></div>
          </dl>
          <p>Railway charges for the resources your app uses.</p>
          <WorkspaceLink href={workspacePaths.launchForTeam(team)}>Choose Starter Web</WorkspaceLink>
        </div>
      </article>)}
    </>}
  </>;
}
