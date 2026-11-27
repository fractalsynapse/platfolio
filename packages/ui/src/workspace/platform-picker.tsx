import * as React from 'react';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { OperationState } from './operation-state.tsx';
import { workspacePaths } from './routes.ts';
import { WorkspaceAction } from './workspace-action.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspaceLink } from './workspace-link.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

const params = {};
const labels = { 'starter-template': 'Starter template', 'shared-service': 'Shared service', 'hosted-application': 'Hosted application' } as const;

export function PlatformPicker({ teamId, team }: { readonly teamId: string; readonly team: string }): React.ReactElement | null {
  const scope = React.useMemo(() => ({ teamId }), [teamId]);
  const connection = useOperation('getPrivateMarketplaceConnection', { params: scope });
  const connected = connection.state.status === 'loaded' && connection.state.data.state === 'connected';
  const platforms = useOperation('listMarketplacePlatforms', { params, enabled: connected });
  const prepare = useCommand('preparePrivateMarketplaceInstall');
  const clock = useClock();
  const [selected, select] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [instance, setInstance] = React.useState('');
  const listings = platforms.state.status === 'loaded' ? platforms.state.data.filter(({ publisherTeamId }) => publisherTeamId !== undefined) : [];
  const platform = listings.find(({ id }) => id === selected);
  const starter = platform?.variant === 'starter-template';

  async function install(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!platform || pending) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('name') ?? '').trim();
    const sourceRepository = starter ? String(fields.get('repo') ?? '').trim() : undefined;
    const { version, descriptorDigest } = platform.latestRelease;
    setPending(true);
    setStatus('');
    setInstance('');
    try {
      const result = await prepare({ params: scope, body: {
        name, release: { platformId: platform.id, version, descriptorDigest },
        ...(sourceRepository ? { sourceRepository } : {}),
      } });
      if (!result.ok) {
        setStatus(result.error.message);
        return;
      }
      setInstance(result.value.instance.name);
      setStatus(starter ? 'The starter is pinned. Continue in your repository with its CI workflow.'
        : 'The release is verified. Open the instance to apply its deployment plan.');
    } finally {
      setPending(false);
    }
  }

  if (!connected || platforms.state.status === 'loaded' && listings.length === 0) return null;
  return <WorkspacePanel title="Marketplace platforms">
    <OperationState status={platforms.state.status} pending="Loading marketplace platforms…" failed="Couldn’t load marketplace platforms." retry={platforms.reload}>
      {platforms.state.status === 'loaded' && <>
        <p className="ui-workspace-meta">{ageLabel(platforms.state.freshness, clock().toISOString()).text}</p>
        <form className="ui-workspace-form" onSubmit={(event) => void install(event)}>
          <WorkspaceField id="marketplace-platform" label="Platform">
            <select id="marketplace-platform" required value={selected} disabled={pending}
              onChange={(event) => { select(event.target.value); setInstance(''); setStatus(''); }}>
              <option value="">Choose a platform</option>
              {listings.map(({ id, title, variant, latestRelease }) =>
                <option key={id} value={id}>{title} · {labels[variant]} · {latestRelease.version}</option>)}
            </select>
          </WorkspaceField>
          {platform && <>
            {platform.latestRelease.offer === 'maintenance' && <p>This release requires active maintenance coverage to acquire.</p>}
            <WorkspaceField id="marketplace-instance-name" label="Instance name">
              <input id="marketplace-instance-name" name="name" required maxLength={40} pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?" disabled={pending} />
            </WorkspaceField>
            {starter && <WorkspaceField id="marketplace-source-repo" label="Your repository">
              <input id="marketplace-source-repo" name="repo" required maxLength={200} placeholder="owner/repository" disabled={pending} />
            </WorkspaceField>}
            <div><WorkspaceAction variant="primary" type="submit" disabled={pending}>{pending ? 'Verifying release…' : 'Prepare install'}</WorkspaceAction></div>
          </>}
        </form>
        {status && <p role="status">{status}</p>}
        {instance && <WorkspaceLink href={workspacePaths.instance(team, instance)}>Open {instance}</WorkspaceLink>}
      </>}
    </OperationState>
  </WorkspacePanel>;
}
