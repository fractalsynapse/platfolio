import * as React from 'react';
import { TEMPLATE_CATEGORIES, describeTemplate } from './template-presentation.ts';

export function TemplateCard({ name, repo, version, free, children }: {
  readonly name: string;
  readonly repo: string;
  readonly version?: string;
  readonly free?: boolean;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const template = describeTemplate(name);
  return <article className="ui-template-card" data-category={template.category}>
    <header>
      <p className="ui-template-card-type"><span>{TEMPLATE_CATEGORIES[template.category]}</span><span>{template.kind} · {template.mode}</span></p>
      <h2>{template.title}</h2>
    </header>
    <div className="ui-template-card-meta">
      <span>Published by <strong>{repo.split('/')[0]}</strong></span>
      <span data-release-version="label" hidden={!version}>{version && `Version ${version}`}</span>
    </div>
    <div className="ui-template-card-body">
      <p>{template.summary}</p>
      <ul className="ui-template-highlights" aria-label="Capabilities">
        {template.capabilities.map((capability) => <li key={capability} className="ui-setup-status">{capability}</li>)}
      </ul>
    </div>
    <div className="ui-template-card-specs">
      <dl className="ui-workspace-facts">
        <div><dt>Public access</dt><dd>{template.access}</dd></div>
        {free && <div><dt>Template price</dt><dd>Free</dd></div>}
      </dl>
    </div>
    <footer className="ui-template-card-actions">{children}</footer>
  </article>;
}
