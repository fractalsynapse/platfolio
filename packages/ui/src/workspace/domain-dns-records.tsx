import type { HostedCustomDomain } from '@platfolio/api-contract/generated/types';

export function DomainDnsRecords({ records }: { readonly records: HostedCustomDomain['records'] }) {
  if (records.length === 0) return <p>Railway hasn’t returned DNS instructions yet. Check again in a moment.</p>;
  return <ul className="ui-workspace-list" aria-label="DNS records">
    {records.map(({ host, fqdn, zone, type, value, current, status, purpose }) => <li key={`${type}.${fqdn}.${purpose}`}>
      <p><strong>{type} for {purpose === 'traffic' ? 'routing' : purpose === 'ownership' ? 'ownership' : purpose === 'challenge' ? 'certificate verification' : 'DNS'}</strong>
        {' · '}{status === 'propagated' ? 'Verified' : 'Waiting for DNS'}</p>
      <p className="ui-workspace-meta">Zone <code>{zone}</code>{' · '}Full hostname <code>{fqdn}</code></p>
      <p><label>Record name <input readOnly value={host} onFocus={(event) => event.currentTarget.select()} /></label></p>
      <p><label>Value <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} /></label></p>
      {current && current !== value && <p className="ui-workspace-meta">Railway currently sees <code>{current}</code>.</p>}
    </li>)}
  </ul>;
}
