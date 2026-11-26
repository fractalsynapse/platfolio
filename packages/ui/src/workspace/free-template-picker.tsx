import { OperationState } from './operation-state.tsx';
import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { workspacePaths } from './routes.ts';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const params = {};
const starterName = 'Starter Web';
const starterSummary = 'Launch a website with a database and an API for other tools to use.';
const starterCapabilities = ['Website', 'API', 'Private PostgreSQL'];

export function FreeTemplatePicker({ team }: { readonly team: string }): React.ReactElement {
  const { state, reload } = useOperation('listInstallableTemplates', { params });
  const clock = useClock();
  const [search, setSearch] = React.useState('');
  const terms = search.trim().toLowerCase().split(/\s+/);
  const matches = state.status === 'loaded' ? state.data.filter(({ repo }) => {
    const text = [starterName, repo, starterSummary, ...starterCapabilities].join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  }) : [];

  return <>
    <OperationState status={state.status} pending="Loading templates…" failed="Couldn’t load the templates." retry={reload} />
    {state.status === 'loaded' && <>
      <WorkspacePanel title="Template catalog">
        <form className="ui-workspace-form ui-template-search" role="search" aria-label="Search templates"
          onSubmit={(event) => event.preventDefault()} onReset={() => setSearch('')}>
          <WorkspaceField id="template-search" label="Search templates">
            <input id="template-search" type="search" maxLength={100} placeholder="Name, publisher, or capability"
              value={search} onChange={(event) => setSearch(event.target.value)} />
          </WorkspaceField>
          <div><WorkspaceAction type="reset" variant="secondary">Clear search</WorkspaceAction></div>
        </form>
      </WorkspacePanel>
      <p className="ui-workspace-meta"><span role="status">{matches.length} {matches.length === 1 ? 'template' : 'templates'}</span>
        {' · '}{ageLabel(state.freshness, clock().toISOString()).text}</p>
      {matches.length === 0 ? <p className="ui-workspace-empty">{state.data.length ? 'No templates match your search.' : 'No templates are available to install.'}</p> : matches.map((release) => <article key={release.template} className="ui-template-card">
        <header><p className="ui-template-card-type"><span>Web apps</span><span>Web · Development</span></p><h2>{starterName}</h2></header>
        <div className="ui-template-card-meta"><span>Published by <strong>{release.repo.split('/')[0]}</strong></span><span>Version {release.version}</span></div>
        <div className="ui-template-card-body">
          <p>{starterSummary}</p>
          <div className="ui-workspace-links" aria-label="Capabilities">
            {starterCapabilities.map((capability) => <span key={capability} className="ui-setup-status">{capability}</span>)}
          </div>
          <dl className="ui-workspace-facts">
            <div><dt>Template price</dt><dd>Free</dd></div>
            <div><dt>Database</dt><dd>Private PostgreSQL</dd></div>
          </dl>
          <p>Railway charges for the resources your app uses.</p>
        </div>
        <footer className="ui-template-card-actions">
          <a className="ui-workspace-secondary ui-hit-primary" href={`https://github.com/${release.repo}/tree/${release.revision}`}>View source</a>
          <WorkspaceLink className="ui-workspace-primary ui-hit-primary" href={workspacePaths.launchForTeam(team)}>Use template</WorkspaceLink>
        </footer>
      </article>)}
    </>}
  </>;
}
