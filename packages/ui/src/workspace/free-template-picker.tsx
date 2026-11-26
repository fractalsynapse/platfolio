import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useOperation } from '../sdk/use-operation.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { workspacePaths } from './routes.ts';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';
import { OperationState } from './operation-state.tsx';
import { TemplateCard } from './template-card.tsx';
import { describeTemplate, templatePaths } from './template-presentation.ts';

const params = {};

export function FreeTemplatePicker({ team }: { readonly team: string }): React.ReactElement {
  const { state, reload } = useOperation('listInstallableTemplates', { params });
  const clock = useClock();
  const [search, setSearch] = React.useState('');
  const terms = search.trim().toLowerCase().split(/\s+/);
  const entries = state.status === 'loaded' ? state.data : [];
  const available = new Map<string, (typeof entries)[number]>();
  for (const release of entries) {
    const current = available.get(release.template);
    if (!current || (!current.installable && release.installable)) available.set(release.template, release);
  }
  const matches = [...available.values()].filter(({ repo, template }) => {
    const { title, summary, capabilities } = describeTemplate(template);
    const text = [title, repo, summary, ...capabilities].join(' ').toLowerCase();
    return terms.every((term) => text.includes(term));
  });

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
      {matches.length === 0 ? <p className="ui-workspace-empty">{state.data.length ? 'No templates match your search.' : <>No templates are available. <WorkspaceLink href={workspacePaths.teamConnections(team)}>Check Marketplace in Connections</WorkspaceLink>.</>}</p> : <div className="ui-columns">
        {matches.map(({ template, repo, version, revision, priceMinor, installable }) => <TemplateCard key={template} name={template} repo={repo} version={version} free={priceMinor === 0}>
          <a className="ui-workspace-secondary ui-hit-primary" href={templatePaths.details(template)}>View details</a>
          {installable === false ? <span>Registered · Installer unavailable</span> :
            <WorkspaceLink className="ui-workspace-primary ui-hit-primary" href={workspacePaths.launchForTeam(team, template, { version, revision })}>Use template</WorkspaceLink>}
        </TemplateCard>)}
      </div>}
    </>}
  </>;
}
