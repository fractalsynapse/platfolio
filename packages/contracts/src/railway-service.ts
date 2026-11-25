import type { RailwayCredential, RailwayTransport } from './railway-transport.ts';

type Access = { transport: RailwayTransport; credential: RailwayCredential };
type ServicePlacement = { serviceId: string; environmentId: string };

export async function configureRailwayService({ transport, credential }: Access, placement: ServicePlacement, input: Record<string, unknown>): Promise<void> {
  const result = await transport.graphql<{ serviceInstanceUpdate: boolean }>({
    operation: 'serviceInstanceUpdate', credential,
    query: 'mutation ($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) }',
    variables: { ...placement, input },
  });
  if (result.serviceInstanceUpdate !== true) throw new Error('Railway did not apply service settings');
}

export async function writeRailwayVariable({ transport, credential }: Access, input: {
  projectId: string; environmentId: string; serviceId?: string; name: string; value: string; skipDeploys?: boolean;
}): Promise<void> {
  const result = await transport.graphql<{ variableUpsert: boolean }>({
    operation: 'variableUpsert', credential,
    query: 'mutation ($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
    variables: { input: { skipDeploys: true, ...input } },
  });
  if (result.variableUpsert !== true) throw new Error('Railway refused the configuration write');
}

export async function deployRailwayService({ transport, credential }: Access, placement: ServicePlacement): Promise<void> {
  const result = await transport.graphql<{ serviceInstanceDeploy: boolean }>({
    operation: 'serviceInstanceDeploy', credential,
    query: 'mutation ($environmentId: String!, $serviceId: String!) { serviceInstanceDeploy(environmentId: $environmentId, serviceId: $serviceId, latestCommit: true) }',
    variables: placement,
  });
  if (result.serviceInstanceDeploy !== true) throw new Error('Railway did not accept the deployment');
}

export async function createRailwayServiceDomain({ transport, credential }: Access, placement: ServicePlacement, targetPort: number): Promise<string> {
  const result = await transport.graphql<{ serviceDomainCreate: { domain: string } }>({
    operation: 'serviceDomainCreate', credential,
    query: 'mutation ($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { id domain } }',
    variables: { input: { ...placement, targetPort } },
  });
  if (!result.serviceDomainCreate?.domain) throw new Error('Railway did not return the allocated domain');
  return result.serviceDomainCreate.domain;
}
