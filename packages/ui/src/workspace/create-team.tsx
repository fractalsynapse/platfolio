import { WorkspaceField } from './workspace-field.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { useCommand } from '../sdk/use-operation.ts';
import { WorkspaceLink } from './workspace-link.tsx';
import { workspacePaths } from './routes.ts';

export function CreateTeam({ onCreated }: { readonly onCreated: (team: TeamWithRole) => void }): React.ReactElement {
  const create = useCommand('createTeam');
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resultName = name.trim().toLowerCase();
    setProblem('');
    setPending(true);
    try {
      const result = await create({ params: {}, body: { name: resultName } });
      if (result.ok) onCreated(result.value);
      else setProblem(result.error.status === 409 ? 'That team name is taken. Try another name.'
        : result.error.status === 400 ? 'Use up to 40 letters, numbers, or hyphens. Start and end with a letter or number.'
          : 'Couldn’t create your team. Try again.');
    } finally {
      setPending(false);
    }
  }

  return <>
    <h1>Create a team</h1>
    <p>Use a short name for your team’s web address.</p>
    <form className="ui-workspace-form" onSubmit={(event) => void submit(event)}>
      <WorkspaceField id="new-team-name" label="Name">
        <input id="new-team-name" value={name} onChange={(event) => setName(event.target.value)} pattern="[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,38}[A-Za-z0-9])?" maxLength={40} required />
      </WorkspaceField>
      <div className="ui-workspace-heading">
        <WorkspaceAction variant="primary" type="submit" disabled={pending}>{pending ? 'Creating team…' : 'Create team'}</WorkspaceAction>
        <WorkspaceLink href={workspacePaths.home}>Cancel</WorkspaceLink>
      </div>
      {problem && <p role="alert">{problem}</p>}
    </form>
  </>;
}
