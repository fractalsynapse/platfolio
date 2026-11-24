import * as React from 'react';
interface WorkspaceEntryProps {
  readonly completing: boolean;
  readonly beginning: boolean;
  readonly problem: string;
  readonly begin: () => void;
}

export function WorkspaceEntry({ completing, beginning, problem, begin }: WorkspaceEntryProps): React.ReactElement {
  return <main className="ui-workspace-entry">
    <p className="ui-workspace-entry-brand">Platfolio</p>
    <h1>Sign in to your workspace</h1>
    {problem && <p role="alert">{problem}</p>}
    {completing ? <p role="status">Completing sign-in…</p>
      : <button type="button" className="ui-workspace-primary ui-hit-primary" disabled={beginning} onClick={begin}>{beginning ? 'Opening sign-in…' : 'Sign in'}</button>}
  </main>;
}
