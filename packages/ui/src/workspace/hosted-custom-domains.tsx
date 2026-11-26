import { WorkspaceAction } from './workspace-action.tsx';
import * as React from 'react';
import type { ParamsOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { DomainDnsRecords } from './domain-dns-records.tsx';
import { WorkspaceField } from './workspace-field.tsx';
import { WorkspacePanel } from './workspace-panel.tsx';

export function HostedCustomDomains({ params, canManage }: {
  readonly params: ParamsOf<'listHostedCustomDomains'>;
  readonly canManage: boolean;
}) {
  const domains = useOperation('listHostedCustomDomains', { params, key: `custom-domains-${params.instanceId}-${params.environment}` });
  const attach = useCommand('attachHostedCustomDomain');
  const detach = useCommand('detachHostedCustomDomain');
  const clock = useClock();
  const [hostname, setHostname] = React.useState('');
  const [removing, setRemoving] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [problem, setProblem] = React.useState('');

  async function save(action: 'attach' | 'detach', value: string) {
    setPending(true);
    setProblem('');
    try {
      const change = action === 'attach' ? attach : detach;
      const result = await change({ params: { ...params, hostname: value.trim() } });
      if (!result.ok) {
        setProblem(result.error.status === 503
          ? 'Couldn’t change the hostname. Check the Railway and OpenBao connections, then try again.'
          : result.error.message);
      } else {
        setHostname('');
        setRemoving('');
      }
      domains.reload();
    } finally { setPending(false); }
  }

  const observation = domains.state.status === 'loaded' ? ageLabel(domains.state.freshness, clock().toISOString()) : undefined;
  const canAttach = domains.state.status === 'loaded' && !domains.state.data.length && canManage;
  return <WorkspacePanel title={canAttach ? 'Attach a custom domain' : 'Custom domain'} context
    observation={observation?.text} stale={observation?.mayBeStale}>
    {domains.state.status === 'pending' && <p role="status">Checking custom hostnames…</p>}
    {domains.state.status === 'failed' && <p role="status">Couldn’t check custom hostnames. Check that the app, Railway, and OpenBao are ready.</p>}
    {!canAttach && <WorkspaceAction type="button" variant="secondary" disabled={pending} onClick={domains.reload}>Check DNS now</WorkspaceAction>}
    {domains.state.status === 'loaded' && <>
      {domains.state.data.map(({ host, dnsStatus, certificateStatus, records }) => <section key={host} aria-label={host}>
        <h3>{dnsStatus === 'verified' && certificateStatus === 'issued' ? <a href={`https://${host}`}>{host}</a> : host}</h3>
        <p>DNS {dnsStatus === 'verified' ? 'verified' : dnsStatus === 'failed' ? 'needs attention' : 'waiting for records'}
          {' · '}HTTPS {certificateStatus === 'issued' ? 'ready' : certificateStatus === 'failed' ? 'needs attention' : 'certificate pending'}</p>
        <DomainDnsRecords records={records} />
        {canManage && (removing === host ? <div>
          <p>Remove {host} from this environment? The Railway address will still work.</p>
          <WorkspaceAction type="button" variant="plain" disabled={pending} onClick={() => void save('detach', host)}>Remove hostname</WorkspaceAction>{' '}
          <WorkspaceAction type="button" disabled={pending} onClick={() => setRemoving('')}>Cancel</WorkspaceAction>
        </div> : <WorkspaceAction type="button" disabled={pending}
          onClick={() => setRemoving(host)}>Remove</WorkspaceAction>)}
      </section>)}
      {domains.state.data.length === 0 && (canAttach ? <form className="ui-workspace-form" onSubmit={(event) => {
        event.preventDefault();
        if (hostname.trim() && !pending) void save('attach', hostname);
      }}>
        <WorkspaceField id="custom-domain-hostname" label="Hostname">
          <input id="custom-domain-hostname" type="text" autoComplete="off" required maxLength={253} placeholder="staging.example.com"
            value={hostname} onChange={(event) => setHostname(event.currentTarget.value)} disabled={pending} />
        </WorkspaceField>
        <div><WorkspaceAction type="submit" variant="primary" disabled={pending}>{pending ? 'Adding hostname…' : 'Add hostname'}</WorkspaceAction></div>
      </form> : <p>No custom hostname is attached.</p>)}
    </>}
    {problem && <p role="alert">{problem}</p>}
  </WorkspacePanel>;
}
