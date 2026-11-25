import { physicalServiceName } from './railway-provider.ts';

export const customerInstallationServices = {
  database: 'private-db',
  identity: 'private-identity',
  site: 'private-site',
  api: 'private-api',
  worker: 'installation-worker',
  vault: 'openbao',
} as const;

export const installationWorkerReadiness = '/readyz';

export function customerInstallationNames(environment: string) {
  const place = (service: keyof typeof customerInstallationServices) => physicalServiceName(customerInstallationServices[service], environment);
  return {
    database: place('database'), identity: place('identity'), site: place('site'),
    api: place('api'), worker: place('worker'), vault: place('vault'),
  };
}
