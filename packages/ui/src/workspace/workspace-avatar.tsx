import * as React from 'react';

export function WorkspaceAvatar({ name, limit = 2 }: {
  readonly name?: string | undefined;
  readonly limit?: 1 | 2;
}): React.ReactElement {
  const initials = name?.trim().split(/\s+/).slice(0, limit).map((word) => Array.from(word)[0]).join('').toUpperCase();
  return <span className="ui-workspace-avatar" aria-hidden="true">
    {initials || <><span className="ui-workspace-avatar-head" /><span className="ui-workspace-avatar-body" /></>}
  </span>;
}
