import * as React from 'react';
import type { ParamsOf } from '@platfolio/api-contract/generated/types';
import { ageLabel, useClock } from '../components/freshness.ts';
import { useCommand, useOperation } from '../sdk/use-operation.ts';
import { DomainDnsRecords } from './domain-dns-records.tsx';

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

  return <section aria-label="Custom hostnames">
    <h3>Custom hostnames</h3>
    {domains.state.status === 'pending' && <p role="status">Checking custom hostnames…</p>}
    {domains.state.status === 'failed' && <p role="status">Couldn’t check custom hostnames. Check that the app, Railway, and OpenBao are ready.</p>}
    <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={pending} onClick={domains.reload}>Check DNS now</button>
    {domains.state.status === 'loaded' && <>
      <p className="ui-workspace-meta">{ageLabel(domains.state.freshness, clock().toISOString()).text}</p>
      {domains.state.data.map(({ host, dnsStatus, certificateStatus, records }) => <section key={host} aria-label={host}>
        <h4>{dnsStatus === 'verified' && certificateStatus === 'issued' ? <a href={`https://${host}`}>{host}</a> : host}</h4>
        <p>DNS {dnsStatus === 'verified' ? 'verified' : dnsStatus === 'failed' ? 'needs attention' : 'waiting for records'}
          {' · '}HTTPS {certificateStatus === 'issued' ? 'ready' : certificateStatus === 'failed' ? 'needs attention' : 'certificate pending'}</p>
        <DomainDnsRecords records={records} />
        {canManage && (removing === host ? <div>
          <p>Remove {host} from this environment? The Railway address will still work.</p>
          <button type="button" className="ui-hit-primary" disabled={pending} onClick={() => void save('detach', host)}>Remove hostname</button>{' '}
          <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={pending} onClick={() => setRemoving('')}>Cancel</button>
        </div> : <button type="button" className="ui-workspace-trigger ui-hit-primary" disabled={pending}
          onClick={() => setRemoving(host)}>Remove</button>)}
      </section>)}
      {domains.state.data.length === 0 && (canManage ? <form onSubmit={(event) => {
        event.preventDefault();
        if (hostname.trim() && !pending) void save('attach', hostname);
      }}>
        <p><label>Hostname <input type="text" autoComplete="off" required maxLength={253} placeholder="staging.example.com"
          value={hostname} onChange={(event) => setHostname(event.currentTarget.value)} disabled={pending} /></label></p>
        <button type="submit" className="ui-workspace-primary ui-hit-primary" disabled={pending}>{pending ? 'Adding hostname…' : 'Add hostname'}</button>
      </form> : <p>No custom hostname is attached.</p>)}
    </>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
