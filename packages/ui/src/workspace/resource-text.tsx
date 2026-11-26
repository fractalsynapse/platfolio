import * as React from 'react';

export function ResourceText({ title, detail }: {
  readonly title: React.ReactNode;
  readonly detail?: React.ReactNode;
}): React.ReactElement {
  return <span className="ui-workspace-resource-text"><strong>{title}</strong>{detail && <span>{detail}</span>}</span>;
}
