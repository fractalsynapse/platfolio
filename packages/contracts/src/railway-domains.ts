import type { HostedCustomDomain } from './infra.ts';

export interface RailwayCustomDomain {
  id?: string;
  domain: string;
  status?: {
    verified?: boolean;
    certificateStatus?: string;
    verificationDnsHost?: string;
    verificationToken?: string;
    dnsRecords?: {
      fqdn: string;
      hostlabel?: string | null;
      zone: string;
      recordType?: string | null;
      requiredValue?: string | null;
      currentValue?: string | null;
      status?: string | null;
      purpose?: string | null;
    }[] | null;
  } | null;
}

export function customHostname(value: string): string | undefined {
  const host = value.trim().toLowerCase();
  if (host.length > 253 || /(?:^|\.)railway\.(?:app|internal)$/.test(host)) return;
  const labels = host.split('.');
  if (labels.length < 2 || !/[a-z]/.test(labels.at(-1) ?? '') ||
      !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return;
  return host;
}

export function readRailwayCustomDomain(domain: RailwayCustomDomain): HostedCustomDomain {
  const raw = domain.status?.dnsRecords ?? [];
  const records: HostedCustomDomain['records'] = raw.flatMap((record) => {
    const { fqdn, zone, requiredValue, currentValue, recordType, status, purpose } = record;
    const type = recordType?.endsWith('_CNAME') ? 'CNAME' : recordType?.endsWith('_TXT') ? 'TXT'
      : recordType?.endsWith('_A') ? 'A' : recordType?.endsWith('_NS') ? 'NS' : undefined;
    if (!type || !fqdn || !zone || !requiredValue) return [];
    return [{
      host: record.hostlabel || fqdn, fqdn, zone, type, value: requiredValue,
      ...(currentValue ? { current: currentValue } : {}),
      status: status?.endsWith('PROPAGATED') ? 'propagated' : status?.endsWith('REQUIRES_UPDATE') ? 'requires-update' : 'unspecified',
      purpose: purpose?.endsWith('TRAFFIC_ROUTE') ? 'traffic' : purpose?.endsWith('ACME_DNS01_CHALLENGE') ? 'challenge' : 'unspecified',
    }];
  });
  const verificationHost = domain.status?.verificationDnsHost;
  const verificationValue = domain.status?.verificationToken;
  const zone = raw.find((record) => record.zone)?.zone;
  if (verificationHost && verificationValue && zone) {
    const fqdn = verificationHost === zone || verificationHost.endsWith('.' + zone) ? verificationHost : `${verificationHost}.${zone}`;
    const index = records.findIndex((record) => record.type === 'TXT' && record.fqdn === fqdn);
    if (index === -1) records.push({ host: verificationHost, fqdn, zone, type: 'TXT', value: verificationValue,
      status: domain.status?.verified ? 'propagated' : 'requires-update', purpose: 'ownership' });
    else records[index]!.purpose = 'ownership';
  }
  const certificate = domain.status?.certificateStatus;
  const failed = certificate === 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED';
  return {
    host: domain.domain, records,
    dnsStatus: domain.status?.verified ? 'verified' : failed ? 'failed' : 'pending',
    certificateStatus: certificate === 'CERTIFICATE_STATUS_TYPE_VALID' ? 'issued' : failed ? 'failed' : 'pending',
  };
}
