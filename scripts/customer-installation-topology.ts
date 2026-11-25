export const openBaoImage = 'quay.io/openbao/openbao@sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315';
export const openBaoData = '/openbao/file';
export const openBaoStart = 'docker-entrypoint.sh server';
export const workerData = '/launch-state';
export const workerStart = 'sh -c \"chown node:node /launch-state && exec su -s /bin/sh node -c \'node /app/scripts/customer-installation-worker.ts\'\"';

export function openBaoConfig(host: string, node: string): string {
  return JSON.stringify({ disable_mlock: true, api_addr: 'http://' + host + ':8200', cluster_addr: 'http://' + host + ':8201',
    storage: { raft: { path: openBaoData, node_id: node } },
    listener: { tcp: { address: '[::]:8200', tls_disable: true } } });
}
