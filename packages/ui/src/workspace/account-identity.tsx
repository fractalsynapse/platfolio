import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand } from '../sdk/use-operation.ts';
import { OperationState } from './operation-state.tsx';
import { MainContext } from '../layout/main-context.tsx';
import { WorkspaceAvatar } from './workspace-avatar.tsx';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';
import { useWorkspaceModel } from './workspace-model.ts';

const params = {};

export function AccountIdentity(): React.ReactElement {
  const { state, reload, acceptConfirmed } = useWorkspaceModel().profile;
  const update = useCommand('updateAccountProfile');
  const clock = useClock();
  const [username, setUsername] = React.useState<string>();
  const [displayName, setDisplayName] = React.useState<string>();
  const [avatarUrl, setAvatarUrl] = React.useState<string>();
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const [saved, setSaved] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'loaded') return;
    setPending(true);
    setProblem('');
    setSaved(false);
    try {
      const result = await update({ params, body: {
        username: (username ?? state.data.username).trim(), displayName: (displayName ?? state.data.displayName).trim(),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      } });
      if (result.ok) {
        setUsername(result.value.username);
        setDisplayName(result.value.displayName);
        setAvatarUrl(undefined);
        setSaved(true);
        acceptConfirmed(result.value);
      } else {
        setProblem(result.error.status === 400 ? result.error.message : 'Couldn’t save your profile. Try again.');
      }
    } finally {
      setPending(false);
    }
  }

  const observation = state.status === 'loaded' ? ageLabel(state.freshness, clock().toISOString()) : undefined;
  return <MainContext>
    <WorkspacePanel title="Profile" observation={observation?.text} stale={observation?.mayBeStale}>
      <OperationState status={state.status} pending="Loading your account…" retry={reload}
        failed={<>Couldn’t open your account details. {state.status === 'failed' && state.error.status === 503 &&
          'Ask a Platfolio owner to check the identity settings.'}</>} />
      {state.status === 'loaded' && <form className="ui-workspace-form" onSubmit={(event) => void submit(event)}>
          <WorkspaceField id="account-username" label="Username">
            <input id="account-username" autoComplete="username" minLength={3} maxLength={255} value={username ?? state.data.username} onChange={(event) => { setUsername(event.target.value); setSaved(false); }} required />
          </WorkspaceField>
          <WorkspaceField id="account-avatar-url" label="Avatar image URL">
            <input id="account-avatar-url" type="url" placeholder="https://" maxLength={2048}
              value={avatarUrl ?? state.data.avatarUrl ?? ''}
              onChange={(event) => { setAvatarUrl(event.target.value); setSaved(false); }} />
          </WorkspaceField>
          <WorkspaceField id="account-display-name" label="Display name">
            <input id="account-display-name" autoComplete="nickname" maxLength={100} value={displayName ?? state.data.displayName} onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }} required />
          </WorkspaceField>
          <div><WorkspaceAction type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</WorkspaceAction></div>
          {saved && <p role="status">Profile saved.</p>}
          {problem && <p role="alert">{problem}</p>}
        </form>}
    </WorkspacePanel>
    {state.status === 'loaded' && <WorkspacePanel title="Profile avatar" context>
      <div className="ui-profile-avatar"><WorkspaceAvatar name={state.data.displayName} imageUrl={state.data.avatarUrl} /></div>
    </WorkspacePanel>}
  </MainContext>;
}
