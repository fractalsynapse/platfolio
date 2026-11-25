import type { RailwayCredential, RailwayTransport } from './railway-transport.ts';

type ProjectAccess = { transport: RailwayTransport; credential: RailwayCredential };
type Environment = { id: string; name: string };

export async function createRailwayProject({ transport, credential }: ProjectAccess, input: {
  name: string; workspaceId: string; defaultEnvironmentName: string; description: string; prDeploys?: boolean;
}): Promise<string> {
  const data = await transport.graphql<{ projectCreate: { id: string } }>({
    operation: 'projectCreate', credential,
    query: 'mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { id } }',
    variables: { input: { ...input, isPublic: false } },
  });
  return data.projectCreate.id;
}

export async function createRailwayEnvironment({ transport, credential }: ProjectAccess, projectId: string, name: string): Promise<Environment> {
  const data = await transport.graphql<{ environmentCreate: Environment }>({
    operation: 'environmentCreate', credential,
    query: 'mutation ($input: EnvironmentCreateInput!) { environmentCreate(input: $input) { id name } }',
    // An empty environment owns its resources. Cloning would share the source environment's service rows.
    variables: { input: { projectId, name, skipInitialDeploys: true } },
  });
  return data.environmentCreate;
}
