import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';

const params = {};

export function AccountIdentity({ tab }: { readonly tab: 'profile' | 'emails' }): React.ReactElement {
  const { state, reload } = useOperation('getAccountProfile', { params });
  const update = useCommand('updateAccountProfile');
  const clock = useClock();
  const [username, setUsername] = React.useState<string>();
  const [displayName, setDisplayName] = React.useState<string>();
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
      } });
      if (result.ok) {
        setUsername(result.value.username);
        setDisplayName(result.value.displayName);
        setSaved(true);
        reload();
      } else {
        setProblem(result.error.status === 400 ? result.error.message : 'Couldn’t save your profile. Try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return <section>
    <h2>{tab === 'profile' ? 'Profile' : 'Sign-in email'}</h2>
    {state.status === 'pending' && <p role="status">Loading your account…</p>}
    {state.status === 'failed' && <p role="status">Couldn’t open your account details. {state.error.status === 503 ? 'Ask a Platfolio owner to check the identity settings.' : ''}
      {' '}<button type="button" className="ui-workspace-trigger ui-hit-primary" onClick={reload}>Try again</button>
    </p>}
    {state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(state.freshness, clock().toISOString()).text}</p>
      {tab === 'emails' ? <dl className="ui-workspace-facts">
        <div><dt>Primary email</dt><dd>{state.data.email || 'No email is set'}{state.data.email && (state.data.emailVerified ? ' · Verified' : ' · Verification needed')}</dd></div>
      </dl> : <form className="ui-workspace-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor="account-username">Username</label>
        <input id="account-username" autoComplete="username" minLength={3} maxLength={255} value={username ?? state.data.username} onChange={(event) => { setUsername(event.target.value); setSaved(false); }} required />
        <label htmlFor="account-display-name">Display name</label>
        <input id="account-display-name" autoComplete="nickname" maxLength={100} value={displayName ?? state.data.displayName} onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }} required />
        <button type="submit" className="ui-workspace-primary ui-hit-primary" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
        {saved && <p role="status">Profile saved.</p>}
        {problem && <p role="alert">{problem}</p>}
      </form>}
    </>}
  </section>;
}
