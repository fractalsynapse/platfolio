import * as React from 'react';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';

type Removal = 'keep' | 'wipe';

export function HostingRemoval({ name, canWipe = true, pending, onRemove }: {
  readonly name: string;
  readonly canWipe?: boolean;
  readonly pending: boolean;
  readonly onRemove: (options: { data: Removal; confirmation?: string }) => Promise<boolean>;
}): React.ReactElement {
  const [selection, select] = React.useState<Removal>();
  const [confirmation, confirm] = React.useState('');
  const field = React.useId();

  async function remove(data: Removal) {
    const accepted = await onRemove({ data, ...(data === 'wipe' ? { confirmation } : {}) });
    if (accepted) { select(undefined); confirm(''); }
  }

  return <details>
    <summary>Remove app</summary>
    <p>Choose what happens to the app’s storage.</p>
    <p className="ui-workspace-links">
      <WorkspaceAction aria-pressed={selection === 'keep'} disabled={pending} onClick={() => select('keep')}>Remove and keep data</WorkspaceAction>
      {canWipe && <WorkspaceAction aria-pressed={selection === 'wipe'} disabled={pending} onClick={() => select('wipe')}>Remove and wipe data</WorkspaceAction>}
    </p>
    {!canWipe && <p>Permanent removal requires a workspace connection.</p>}
    {selection === 'keep' && <>
      <p>Stops the app and database. Your provider keeps the storage and can still charge for it.</p>
      <WorkspaceAction disabled={pending} onClick={() => void remove('keep')}>Confirm removal</WorkspaceAction>
    </>}
    {canWipe && selection === 'wipe' &&
      <form className="ui-workspace-form" onSubmit={(event) => { event.preventDefault(); if (confirmation === name) void remove('wipe'); }}>
        <p>Removes the hosting project and schedules deletion of its storage. Type <strong>{name}</strong> to confirm.</p>
        <WorkspaceField id={field} label="App name"><input id={field} value={confirmation} onChange={(event) => confirm(event.target.value)} /></WorkspaceField>
        <WorkspaceAction type="submit" disabled={pending || confirmation !== name}>Wipe app data</WorkspaceAction>
      </form>}
  </details>;
}
