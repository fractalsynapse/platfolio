import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import { PublicHeader } from './public-header.tsx';
interface WorkspaceEntryProps {
  readonly completing: boolean;
  readonly beginning: boolean;
  readonly problem: string;
  readonly begin: () => void;
  readonly beginHub?: () => void;
}

export function WorkspaceEntry({ completing, beginning, problem, begin, beginHub }: WorkspaceEntryProps): React.ReactElement {
  return <>
    <PublicHeader />
    <main className="ui-workspace-panel ui-auth-card">
      <h1>Sign in to Platfolio</h1>
      {problem && <p role="alert">{problem}</p>}
      {completing ? <p role="status">Completing sign-in…</p>
        : <WorkspaceAction type="button" variant="primary" disabled={beginning} onClick={begin}>{beginning ? 'Opening sign-in…' : 'Sign in'}</WorkspaceAction>}
      {beginHub && !completing && <WorkspaceAction type="button" disabled={beginning} onClick={beginHub}>Sign in with hub account</WorkspaceAction>}
    </main>
  </>;
}
